/* Strata — market engine.
   A portfolio you can actually trade, simulated on the real clock and stored locally.

   Time
   ----
   One second in the app is one second in the world. Stocks and ETFs move only while
   North American exchanges are open (9:30–16:00 ET, weekdays); metals trade weekdays;
   crypto never closes; property and private companies revalue continuously. Drift and
   volatility are annual figures measured in each asset's own trading time.

   Assets
   ------
   Market assets follow geometric Brownian motion driven by a shared market factor plus
   their own noise. Operating companies are valued stake x EBITDA x multiple and pay out
   45% of profit. Venture companies are valued stake x enterprise valuation, burn cash,
   and occasionally raise a round that steps the valuation up. Income accrues into
   settlement cash. Nothing is clamped — the total is what the holdings are worth.

   Trading
   -------
   Quantities live in saved state. Buys draw on settlement cash, sells return to it,
   both net of a class-specific fee. Cost base is a running average, so realised and
   unrealised gains are tracked separately.                                            */

const STORE_KEY = 'strata.state.v1';
const STATE_VERSION = 4;
const YEAR_S = 31557600;
const DAY_MS = 86400000;
const TRADING_YEAR_S = 252 * 6.5 * 3600;
const WEEKDAY_YEAR_S = 261 * 86400;
const CASH_ID = 'cash-settle';

const BETA = { equity: 0.80, etf: 0.85, crypto: 0.40, metals: 0.12, realty: 0.08, private: 0.22, cash: 0.02 };
/* Seed volatilities are headline single-name figures; realised paths run at 70%. The
   book is now operator-heavy, so private holdings carry a lower market beta — owned
   companies don't reprice with the S&P, they reprice with their own earnings. */
const VOL_SCALE = 0.7;
const SESSION = { equity: 'exchange', etf: 'exchange', metals: 'weekday' };

/* Venture marks move in jumps, not just drift: a raise steps the valuation up, a bad
   quarter marks it down. Expected jump size is removed from the continuous drift so
   mu stays the honest total expected return rather than being counted twice.
   Compensation is arithmetic, not logarithmic: a portfolio total is a sum, so what has
   to stay honest is the expected value, not the median. The effect is a realistic
   venture shape — most marks drift sideways or down, and the occasional raise carries
   the return. */
const ROUND_UP_MEAN = 0.50;    // E[step]-1 for a step-up of 1.25–1.75
const DOWN_ROUND_RATE = 0.15;  // per year
const ROUND_DOWN_MEAN = -0.325; // E[step]-1 for a markdown of 0.50–0.85

/* ---------- random ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function gaussFrom(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const gauss = () => gaussFrom(Math.random);

/* ---------- Eastern-time calendar ---------- */
let _etFmt = null, _etHour = null, _etOff = 0;
function etOffset(t) {
  const hr = Math.floor(t / 3600000);
  if (hr === _etHour) return _etOff;
  _etHour = hr;
  return (_etOff = etOffsetRaw(t));
}
function etOffsetRaw(t) {
  try {
    _etFmt = _etFmt || new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23'
    });
    const p = {};
    for (const x of _etFmt.formatToParts(new Date(t))) p[x.type] = +x.value;
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(t / 1000) * 1000;
  } catch (e) { return -5 * 3600000; }
}
const etWall = t => new Date(t + etOffset(t));
const etDayKey = t => { const w = etWall(t); return w.getUTCFullYear() * 10000 + (w.getUTCMonth() + 1) * 100 + w.getUTCDate(); };
const isWeekdayKey = k => { const d = new Date(Date.UTC(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100)).getUTCDay(); return d > 0 && d < 6; };

function sessionSeconds(t0, t1, kind) {
  if (!kind) return (t1 - t0) / 1000;
  const off = etOffset((t0 + t1) / 2);
  const w0 = t0 + off, w1 = t1 + off;
  let secs = 0;
  for (let d = Math.floor(w0 / DAY_MS); d <= Math.floor(w1 / DAY_MS); d++) {
    const dow = new Date(d * DAY_MS).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const a = kind === 'exchange' ? d * DAY_MS + 9.5 * 3600000 : d * DAY_MS;
    const b = kind === 'exchange' ? d * DAY_MS + 16 * 3600000 : (d + 1) * DAY_MS;
    secs += Math.max(0, Math.min(b, w1) - Math.max(a, w0)) / 1000;
  }
  return secs;
}

function marketStatus(t = Date.now()) {
  const w = etWall(t), dow = w.getUTCDay(), mins = w.getUTCHours() * 60 + w.getUTCMinutes();
  const open = dow > 0 && dow < 6 && mins >= 570 && mins < 960;
  if (open) return { open: true, label: 'Markets open', detail: 'Closes 4:00 PM ET' };
  let add = 0, nd = dow;
  if (dow > 0 && dow < 6 && mins < 570) add = 0;
  else { do { add++; nd = (nd + 1) % 7; } while (nd === 0 || nd === 6); }
  const day = add === 0 ? 'today' : add === 1 ? 'tomorrow' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][nd];
  return { open: false, label: 'Markets closed', detail: 'Opens ' + day + ' 9:30 AM ET' };
}

/* ---------- asset registry ---------- */
const ALL_ASSETS = SEED_HOLDINGS.concat(CATALOG);
const ASSET_BY_ID = {};
for (const a of ALL_ASSETS) ASSET_BY_ID[a.id] = a;
function meta(id) { return ASSET_BY_ID[id]; }
function owned() { return ALL_ASSETS.filter(a => S.holdings[a.id] && S.holdings[a.id].qty > 1e-9); }
function tradable(a) { return !(S.holdings[a.id] && S.holdings[a.id].biz); } // you can't sell half a company you run... except stake sales, handled below

/* ---------- state ---------- */
const DEFAULT_SETTINGS = {
  refresh: '30',
  holderName: '',
  entityName: '',
  hwmLine: true,
  hideBalances: false,
  currency: 'CAD',
  compact: true,
  accent: 'violet',
  chartFill: true,
  haptics: true
};

let S = null;

function seedBackfill(endValue, endTime) {
  const days = 1095, rnd = mulberry32(20160411);
  let v = 1;
  const path = [];
  for (let i = 0; i < days; i++) {
    v *= Math.exp((0.085 - 0.0072) / 365 + 0.115 / Math.sqrt(365) * gaussFrom(rnd));
    path.push(v);
  }
  const scale = endValue / path[path.length - 1];
  const out = path.map((p, i) => [endTime - (days - i) * DAY_MS, Math.round(p * scale)]);
  out.push([endTime, Math.round(endValue)]);
  return out;
}

function seedCloses(h, rnd) {
  const sg = (h.sigma || 0.01) * VOL_SCALE / Math.sqrt(SESSION[h.cls] ? 252 : 365);
  const out = [h.price];
  let p = h.price;
  for (let i = 0; i < 10; i++) { p /= Math.exp(sg * gaussFrom(rnd) + (h.mu || 0) / 365); out.unshift(p); }
  out.pop();
  return out;
}

function newPosition(h, qty, price, book) {
  const rnd = mulberry32(hashStr(h.id));
  const pos = { qty, price, closes: seedCloses(h, rnd), book, income: 0, alert: 0 };
  if (h.biz) {
    const b = h.biz;
    if (b.type === 'venture') {
      pos.biz = { type: 'venture', valuation: b.valuation, burn: b.burn, headcount: b.headcount, stake: b.stake,
        stage: b.stage, milestone: b.milestone, step: 0, rounds: 0, downs: 0, cashOut: 0, raised: 0, dead: false };
      pos.price = b.stake * b.valuation;
    } else {
      const mult0 = (h.price / b.stake - (b.assets || 0)) / (b.revenue * b.margin);
      const yearFrac = (etWall(Date.now()) - Date.UTC(etWall(Date.now()).getUTCFullYear(), 0, 1)) / (365 * DAY_MS);
      pos.biz = {
        type: 'operating', revenue: b.revenue, margin: b.margin, multiple: mult0, mult0, stake: b.stake,
        assets: b.assets || 0, basis: 'ebitda', arrMult: 0, headcount: b.headcount, evStep: 0,
        accounts: b.accounts.map(a => ({ name: a.name, bal: a.bal })),
        ytdRevenue: b.revenue * yearFrac, ytdProfit: b.revenue * b.margin * yearFrac, monthProfit: 0
      };
    }
  }
  return pos;
}

function freshState(keepSettings) {
  const now = Date.now();
  S = { holdings: {}, settings: { ...DEFAULT_SETTINGS, ...(keepSettings || {}) } }; // so newPosition can read S if needed
  const holdings = {};
  const rnd = mulberry32(7734);
  for (const h of SEED_HOLDINGS) {
    const gain = h.cls === 'cash' ? 0.01 : 0.08 + rnd() * 0.85;
    holdings[h.id] = newPosition(h, h.qty, h.price, (h.qty * h.price) / (1 + gain));
  }
  for (const h of CATALOG) if (!holdings[h.id]) holdings[h.id] = newPosition(h, 0, h.price, 0);
  const total = SEED_HOLDINGS.reduce((s, h) => s + h.qty * h.price, 0);
  return {
    v: STATE_VERSION,
    createdAt: now, simTime: now, lastReal: now, dayKey: etDayKey(now),
    holdings,
    ath: total, athAt: now, ddFlag: 0,
    incomeTotal: 0, incomeByClass: {}, monthIncome: {},
    realised: 0, feesPaid: 0, deposited: 0,
    trades: [],
    history: seedBackfill(total, now),
    compactedAt: 0,
    events: [{ t: now, kind: 'note', title: 'Portfolio synced', body: SEED_HOLDINGS.length + ' positions reconciled across 6 custodians.' }],
    settings: { ...DEFAULT_SETTINGS, ...(keepSettings || {}) }
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.holdings) {
        if (parsed.v === STATE_VERSION) {
          parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
          return parsed;
        }
        // the book itself changed shape in v3: rebuild it, but keep the person's settings
        const keep = parsed.settings || {};
        delete keep.speed; delete keep.ratchet;
        const fresh = freshState(keep);
        fresh.events.unshift({ t: Date.now(), kind: 'note', title: 'Portfolio restructured', body: 'Private holdings expanded to eleven owned companies. Settings kept.' });
        return fresh;
      }
    }
  } catch (e) { console.warn('State unreadable, starting fresh.', e); }
  return freshState();
}

let saveQueued = false;
function persistNow() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }
  catch (e) { compactHistory(true); try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (_) {} }
}
function save() {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(() => { saveQueued = false; persistNow(); }, 400);
}

/* ---------- valuation ---------- */
function qtyOf(id) { const st = S.holdings[id]; return st ? st.qty : 0; }
function priceOf(id) { const st = S.holdings[id]; return st ? st.price : meta(id).price; }
function valueOf(h) { const st = S.holdings[h.id]; return st ? st.qty * st.price : 0; }
function rawTotal() { let t = 0; for (const id in S.holdings) { const st = S.holdings[id]; t += st.qty * st.price; } return t; }
function total() { return rawTotal(); }
function cashAvailable() { return priceOf(CASH_ID) * qtyOf(CASH_ID); }

function classTotals() {
  const out = {};
  for (const k in CLASSES) out[k] = 0;
  for (const h of owned()) out[h.cls] += valueOf(h);
  return out;
}

/* ---------- trading ---------- */
function feeRate(cls) { return FEES[cls] ?? 0.002; }

function quote(id, side, units) {
  const h = meta(id);
  const price = priceOf(id);
  const gross = units * price;
  const fee = Math.abs(gross) * feeRate(h.cls);
  return { price, gross, fee, net: side === 'buy' ? gross + fee : gross - fee };
}

function maxBuyUnits(id) {
  const h = meta(id);
  const price = priceOf(id);
  const cash = cashAvailable() - (id === CASH_ID ? 0 : 0);
  return Math.max(0, cash / (price * (1 + feeRate(h.cls))));
}

function canTrade(id, side) {
  const h = meta(id), st = S.holdings[id];
  if (id === CASH_ID) return { ok: false, why: 'Settlement cash funds every other trade.' };
  if (st && st.biz && side === 'buy') return { ok: false, why: 'Increasing your stake needs a negotiated round, not a market order.' };
  if (h.cls === 'realty' && side === 'sell') return { ok: true, whole: true };
  if (side === 'sell' && !(st && st.qty > 1e-9)) return { ok: false, why: 'Nothing to sell.' };
  return { ok: true };
}

function trade(id, side, units, opts = {}) {
  const h = meta(id);
  units = +units;
  if (!(units > 0)) return { ok: false, why: 'Enter an amount.' };
  const st = S.holdings[id];
  const q = quote(id, side, units);

  if (side === 'buy') {
    if (q.net > cashAvailable() + 1e-6) return { ok: false, why: 'Not enough settlement cash.' };
    const pos = st || (S.holdings[id] = newPosition(h, 0, h.price, 0));
    pos.qty += units;
    pos.book += q.net;
    S.holdings[CASH_ID].price -= q.net;
  } else {
    if (!st || units > st.qty + 1e-9) return { ok: false, why: 'You do not hold that many units.' };
    const share = units / st.qty;
    const costOut = st.book * share;
    st.book -= costOut;
    st.qty -= units;
    S.realised += q.net - costOut;
    S.holdings[CASH_ID].price += q.net;
    if (st.qty <= 1e-9) { st.qty = 0; st.book = 0; }
  }
  S.feesPaid += q.fee;

  const rec = { t: S.simTime, id, sym: h.sym, name: h.name, side, units, price: q.price, gross: q.gross, fee: q.fee, cls: h.cls };
  S.trades.unshift(rec);
  if (S.trades.length > 200) S.trades.length = 200;
  logEvent('trade', (side === 'buy' ? 'Bought ' : 'Sold ') + h.sym,
    fmtUnits(units, h) + ' at ' + fmtMoneyPlain(q.price) + ' — ' + fmtMoneyPlain(q.gross) + (q.fee > 0.5 ? ' plus ' + fmtMoneyPlain(q.fee) + ' costs' : '') + '.');
  snapshot();
  save();
  return { ok: true, ...q };
}

function transferCash(fromId, toId, amount) {
  amount = +amount;
  if (!(amount > 0)) return { ok: false, why: 'Enter an amount.' };
  const from = S.holdings[fromId], to = S.holdings[toId];
  if (!from || from.price < amount - 1e-6) return { ok: false, why: 'Not enough in that account.' };
  from.price -= amount;
  to.price += amount;
  from.book = Math.max(0, from.book - amount);
  to.book += amount;
  logEvent('trade', 'Transfer', fmtMoneyPlain(amount) + ' from ' + meta(fromId).name + ' to ' + meta(toId).name + '.');
  save();
  return { ok: true };
}

function externalFlow(amount) {
  // money in or out of the whole portfolio, so returns aren't distorted by it
  amount = +amount;
  const cash = S.holdings[CASH_ID];
  if (amount < 0 && cash.price < -amount) return { ok: false, why: 'Not enough settlement cash.' };
  cash.price += amount;
  cash.book += amount;
  S.deposited += amount;
  logEvent('note', amount >= 0 ? 'Deposit' : 'Withdrawal', fmtMoneyPlain(Math.abs(amount)) + (amount >= 0 ? ' added to settlement cash.' : ' withdrawn from settlement cash.'));
  snapshot(); save();
  return { ok: true };
}

/* ---------- simulation ---------- */
function stepMarket(t0, t1) {
  const calSec = (t1 - t0) / 1000;
  const dtCal = calSec / YEAR_S;
  const dtEx = sessionSeconds(t0, t1, 'exchange') / TRADING_YEAR_S;
  const dtWk = sessionSeconds(t0, t1, 'weekday') / WEEKDAY_YEAR_S;
  const zm = gauss();
  const monthPhase = Math.sin((etWall(t1).getUTCMonth() / 12) * Math.PI * 2);
  let income = 0;

  for (const id in S.holdings) {
    const h = meta(id), st = S.holdings[id];
    if (!h) continue;

    if (st.biz && st.biz.type === 'operating') {
      const b = st.biz, m = h.biz, sq = Math.sqrt(dtCal);
      const rv = h.sigma || 0.15;                 // revenue is as erratic as the business is
      b.revenue *= Math.exp((h.mu - 0.5 * rv * rv) * dtCal + rv * sq * gauss());
      b.margin = Math.max(0.02, m.margin + (b.margin - m.margin) * Math.exp(-4 * dtCal) + 0.03 * sq * gauss());
      b.multiple = Math.max(2.5, b.mult0 + (b.multiple - b.mult0) * Math.exp(-1 * dtCal) + 0.8 * sq * gauss());
      b.assets = (b.assets || 0) * Math.exp(0.03 * dtCal);   // land and reserves appreciate
      const ebitda = b.revenue * b.margin;
      st.price = b.stake * enterpriseValue(b);

      applyBusinessEvents(h, st, b, m, dtCal);

      const seasonal = 1 + m.seasonality * monthPhase;
      const profit = ebitda * seasonal * dtCal;
      b.ytdRevenue += b.revenue * seasonal * dtCal;
      b.ytdProfit += profit;
      b.monthProfit += profit;
      const share = (profit * 0.55) / b.accounts.length;
      b.accounts.forEach(a => { a.bal += share; });
      const dist = profit * b.stake * 0.45;
      income += dist; st.income += dist;
      S.incomeByClass.private = (S.incomeByClass.private || 0) + dist;
      S.monthIncome.private = (S.monthIncome.private || 0) + dist;
      continue;
    }

    if (st.biz && st.biz.type === 'venture') {
      const b = st.biz, m = h.biz, sq = Math.sqrt(dtCal);
      const sg = h.sigma * VOL_SCALE;
      // between rounds a private mark barely moves: no one is repricing it
      b.valuation *= Math.exp((h.mu - 0.5 * sg * sg) * dtCal + sg * sq * gauss());
      b.cashOut += b.burn * dtCal;
      if (!b.dead && b.step === 0) capitalCall(h, b, b.burn * (m.ownerShare ?? 0.6) * dtCal);
      applyVentureArc(h, st, b, m, dtCal);
      st.price = b.stake * b.valuation;
      continue;
    }

    const session = SESSION[h.cls];
    const dt = session === 'exchange' ? dtEx : session === 'weekday' ? dtWk : dtCal;
    if (dt > 0) {
      if (h.sigma > 0) {
        const beta = BETA[h.cls] ?? 0.3;
        const z = beta * zm + Math.sqrt(Math.max(0, 1 - beta * beta)) * gauss();
        const sg = h.sigma * VOL_SCALE;
        st.price *= Math.exp((h.mu - (h.yld || 0) - 0.5 * sg * sg) * dt + sg * Math.sqrt(dt) * z);
      } else if (h.mu) {
        st.price *= Math.exp((h.mu - (h.yld || 0)) * dt);
      }
    }

    if (h.yld && h.id !== CASH_ID && st.qty > 0) {
      const inc = st.qty * st.price * h.yld * dtCal;
      income += inc; st.income += inc;
      S.incomeByClass[h.cls] = (S.incomeByClass[h.cls] || 0) + inc;
      S.monthIncome[h.cls] = (S.monthIncome[h.cls] || 0) + inc;
    }
  }

  const settle = S.holdings[CASH_ID];
  settle.price += income;
  settle.income += income;
  S.incomeTotal += income;
}

/* What a company is worth on its current basis, before your ownership share. */
function enterpriseValue(b) {
  const core = b.basis === 'arr' ? b.revenue * b.arrMult : b.revenue * b.margin * b.multiple;
  return core + (b.assets || 0);
}

/* One-off things that happen to a real business and reprice it: an appraisal that puts
   land on the books at market, a resource statement, a bolt-on acquisition, a product
   launch, or a re-rate onto a revenue multiple. Each fires once, on a hazard rate. */
const SETBACKS = {
  'biz-kawartha': ['loses its head chef and a full season to a kitchen fire', 'faces a bad harvest and input costs it cannot pass on'],
  'biz-northpine': ['loses an anchor supply contract to a lower bidder', 'absorbs a freight-rate squeeze it cannot pass through'],
  'biz-selkirk': ['hits a grade shortfall and a permitting delay', 'writes off a stripping programme that did not pay'],
  'biz-meridian': ['loses two associate dentists to a consolidator', 'sees fee guide changes compress margins'],
  'biz-overdrive': ['is hit by a platform algorithm change and an ad-rate slump', 'loses a sponsor mid-contract'],
  'biz-ninebark': ['sees the back catalogue decay faster than modelled', 'slips its milestone and burns the publisher advance'],
  'biz-strategerium': ['loses its largest contract at renewal', 'sees churn spike as a competitor undercuts it']
};

function applyBusinessEvents(h, st, b, m, dtCal) {
  // recurring setbacks: the things that go wrong in an operating business
  if (Math.random() < 0.13 * dtCal) {
    const before = b.stake * enterpriseValue(b);
    const hit = 0.80 + Math.random() * 0.14;
    b.revenue *= hit;
    b.margin = Math.max(0.02, b.margin * (0.88 + Math.random() * 0.1));
    st.price = b.stake * enterpriseValue(b);
    const lines = SETBACKS[h.id] || ['has a bad year'];
    logEvent('down', h.name + ' — setback',
      h.name + ' ' + lines[Math.floor(Math.random() * lines.length)] + '. Revenue down ' + ((1 - hit) * 100).toFixed(0) +
      '%, your stake off ' + fmtMoneyPlain(Math.abs(st.price - before)) + '.');
    return;
  }

  const plan = m.events;
  if (!plan || b.evStep >= plan.length) return;
  const ev = plan[b.evStep];
  if (Math.random() >= dtCal / ev.years) return;

  const before = b.stake * enterpriseValue(b);
  const set = ev.set || {};
  const disappoints = Math.random() < (ev.pFail ?? 0.30);   // it happened; it just didn't deliver
  const k = disappoints ? 0.18 : 1;

  if (set.assets != null) b.assets = set.assets * (disappoints ? 0.45 + Math.random() * 0.2 : 0.85 + Math.random() * 0.3);
  if (set.revenueMult != null) b.revenue *= 1 + (set.revenueMult - 1) * k * (0.9 + Math.random() * 0.2);
  if (set.multiple != null && !disappoints) { b.multiple = set.multiple; b.mult0 = set.multiple; }
  if (set.basis) b.basis = set.basis;
  if (set.arrMult != null) b.arrMult = set.arrMult * (disappoints ? 0.6 : 0.9 + Math.random() * 0.2);
  if (set.headcount != null) b.headcount = Math.round(set.headcount * (disappoints ? 0.6 : 1));
  b.evStep++;
  st.price = b.stake * enterpriseValue(b);
  const delta = st.price - before;
  logEvent(disappoints ? 'down' : 'reval', h.name + ' — ' + ev.title,
    (disappoints ? ev.body + ' It comes in well under plan.' : ev.body) +
    ' Your stake ' + (delta >= 0 ? 'up ' : 'down ') + fmtMoneyPlain(Math.abs(delta)) + ' to ' + fmtMoneyPlain(st.price) + '.');
}

/* Before anyone else is in, the burn is yours. Capital calls draw on settlement cash,
   then savings, then the GIC ladder. If nothing is left the company takes bridge money
   on bad terms and you are diluted for it — which is what actually happens. */
function capitalCall(h, b, amount) {
  if (!(amount > 0)) return;
  let need = amount;
  for (const id of [CASH_ID, 'cash-hisa', 'cash-gic']) {
    const acct = S.holdings[id];
    if (!acct || acct.price <= 0) continue;
    const take = Math.min(need, acct.price);
    acct.price -= take; acct.book = Math.max(0, acct.book - take);
    need -= take;
    if (need <= 1e-9) break;
  }
  const funded = amount - need;
  b.funded = (b.funded || 0) + funded;
  S.capitalCalled = (S.capitalCalled || 0) + funded;
  S.monthCalls = (S.monthCalls || 0) + funded;
  if (need > 1e-9) {
    // unfunded: bridge financing, priced against you
    b.stake *= Math.max(0, 1 - need / Math.max(b.valuation * 0.02, 1));
    b.bridged = (b.bridged || 0) + need;
    if (!b.bridgeWarned || S.simTime - b.bridgeWarned > 30 * DAY_MS) {
      b.bridgeWarned = S.simTime;
      logEvent('down', h.name + ' takes bridge financing',
        'Capital call could not be funded from cash. A bridge note covers the shortfall and dilutes you to ' + (b.stake * 100).toFixed(0) + '%.');
    }
  }
}

/* A self-funded venture has no outside price. When it raises, the new lead reprices the
   whole company, which is why these move in steps. Missed milestones cut the mark and
   push the next round out. */
function applyVentureArc(h, st, b, m, dtCal) {
  if (b.dead) return;
  const arc = m.arc || [];
  const next = arc[b.step];

  const sinceRound = S.simTime - (b.lastRound || 0);
  if (next && sinceRound > 270 * DAY_MS && Math.random() < dtCal / next.years) {
    const disp = 0.65 + Math.random() * 0.55;               // the lead's number, not yours
    const post = Math.max(b.valuation * 1.1, next.post * disp);
    const raise = post * (0.18 + Math.random() * 0.16);     // new money buys new shares
    const keep = 1 - raise / post;                          // and dilutes everyone already in
    const wasStake = b.stake;
    b.stake *= keep;
    b.valuation = post;
    b.raised = (b.raised || 0) + raise;
    b.stage = next.stage; b.burn = next.burn; b.headcount = next.headcount; b.milestone = next.milestone;
    b.step++; b.rounds = (b.rounds || 0) + 1; b.lastRound = S.simTime;
    logEvent('round', h.name + ' raises ' + next.stage,
      'Priced by a new lead at ' + fmtMoneyPlain(post) + ' post on ' + fmtMoneyPlain(raise) + ' of new money. You are diluted from ' +
      (wasStake * 100).toFixed(0) + '% to ' + (b.stake * 100).toFixed(0) + '%, worth ' + fmtMoneyPlain(b.stake * post) +
      '. Burn rises to ' + fmtMoneyPlain(b.burn) + '/yr across ' + b.headcount + ' people.');
    return;
  }

  // failure risk is highest before anyone else has validated it, and falls with each round
  const failRate = 0.09 * Math.pow(0.55, b.step);
  if (Math.random() < failRate * dtCal) {
    b.dead = true; b.burn = 0; b.step = arc.length;
    b.valuation *= 0.04;
    b.stage = 'Wound down'; b.milestone = 'Assets and IP sold off';
    logEvent('down', h.name + ' wound down',
      'The programme failed and the company is being wound up. Your stake is written down to ' + fmtMoneyPlain(b.stake * b.valuation) + ' of residual IP and equipment.');
    return;
  }

  if (Math.random() < (m.downRate || 0.1) * dtCal) {
    const step = 0.55 + Math.random() * 0.30;
    b.valuation *= step;
    b.burn *= 0.80;
    b.downs = (b.downs || 0) + 1;
    logEvent('down', h.name + ' marked down',
      'Milestone missed. The mark is cut ' + ((1 - step) * 100).toFixed(0) + '% to ' + fmtMoneyPlain(b.valuation) +
      ' and burn trimmed to ' + fmtMoneyPlain(b.burn) + '/yr. The next round moves out.');
  }
}

/* Your live ownership: diluted by every round a venture raises. */
function stakeOf(h) {
  const st = S.holdings[h.id];
  return st && st.biz && st.biz.stake != null ? st.biz.stake : (h.biz ? h.biz.stake : 1);
}

function rollDay(newKey) {
  const ended = S.dayKey;
  const tradedYesterday = isWeekdayKey(ended);
  for (const id in S.holdings) {
    const h = meta(id), st = S.holdings[id];
    if (!h) continue;
    if (!SESSION[h.cls] || tradedYesterday) {
      st.closes.push(st.price);
      if (st.closes.length > 10) st.closes.shift();
      st.alert = 0;
    }
  }
  if (Math.floor(ended / 100) !== Math.floor(newKey / 100)) announcePaydays(Math.floor(ended / 100) % 100);
  if (Math.floor(ended / 10000) !== Math.floor(newKey / 10000)) {
    for (const h of owned()) {
      const b = S.holdings[h.id].biz;
      if (b && b.type === 'operating') { b.ytdRevenue = 0; b.ytdProfit = 0; }
    }
  }
  S.dayKey = newKey;
}

function announcePaydays(month) {
  const mi = S.monthIncome;
  const monthName = new Date(Date.UTC(2000, month - 1, 1)).toLocaleString('en-CA', { month: 'long', timeZone: 'UTC' });
  if (mi.realty) logEvent('income', 'Rent collected — ' + monthName, fmtMoneyPlain(mi.realty) + ' net from property.');
  if (mi.private) logEvent('income', 'Company distributions — ' + monthName, fmtMoneyPlain(mi.private) + ' from the operating companies.');
  const divs = (mi.equity || 0) + (mi.etf || 0);
  if (divs) logEvent('income', 'Dividends — ' + monthName, fmtMoneyPlain(divs) + ' from equities and ETFs.');
  const interest = (mi.cash || 0) + (mi.crypto || 0);
  if (interest) logEvent('income', 'Interest & staking — ' + monthName, fmtMoneyPlain(interest) + ' from savings, GICs and staked tokens.');
  if (S.monthCalls > 1) {
    const selfFunded = owned().filter(x => { const b = S.holdings[x.id].biz; return b && b.type === 'venture' && b.step === 0 && !b.dead; });
    logEvent('call', 'Capital calls — ' + monthName, fmtMoneyPlain(S.monthCalls) + ' funded to ' +
      (selfFunded.length ? selfFunded.map(x => x.sym).join(', ') : 'the venture book') + ' out of settlement cash.');
  }
  S.monthCalls = 0;
  for (const h of owned()) { const b = S.holdings[h.id].biz; if (b && b.type === 'operating') b.monthProfit = 0; }
  S.monthIncome = {};
}

function logEvent(kind, title, body) {
  S.events.unshift({ t: S.simTime, kind, title, body });
  if (S.events.length > 150) S.events.length = 150;
}

function checkAlerts() {
  for (const h of owned()) {
    if (h.cls === 'cash' || h.cls === 'realty') continue;
    const st = S.holdings[h.id];
    if (st.biz) continue;
    const c = chg(h.id, 'd1');
    const threshold = h.cls === 'crypto' ? 0.08 : h.cls === 'etf' ? 0.025 : h.cls === 'metals' ? 0.03 : 0.05;
    const lvl = Math.floor(Math.abs(c) / threshold);
    if (lvl > (st.alert || 0)) {
      st.alert = lvl;
      logEvent(c >= 0 ? 'up' : 'down',
        h.sym + (c >= 0 ? ' up ' : ' down ') + Math.abs(c * 100).toFixed(1) + '% today',
        h.name + ' at ' + fmtMoneyPlain(st.price) + (st.qty > 1 ? ' — position ' + fmtMoneyPlain(valueOf(h)) + '.' : '.'));
    }
  }
}

function checkPortfolioEvents(prevAth) {
  const t = total();
  if (t > prevAth * 1.0005) {
    const last = S.events.find(e => e.kind === 'ath');
    const big = !last || t > last.peak * 1.02;
    if (!last || big || S.simTime - last.t > 7 * DAY_MS) {
      logEvent('ath', 'New all-time high', fmtMoneyPlain(t) + ' — previous peak ' + fmtMoneyPlain(prevAth) + '.');
      S.events[0].peak = t;
    }
  }
  const dd = drawdownFree();
  const level = dd >= 0.15 ? 3 : dd >= 0.10 ? 2 : dd >= 0.05 ? 1 : 0;
  if (level > (S.ddFlag || 0)) {
    logEvent('down', [null, 'Pullback from peak', 'Correction underway', 'Deep drawdown'][level],
      (dd * 100).toFixed(1) + '% below the ' + fmtMoneyPlain(S.ath) + ' peak — ' + fmtMoneyPlain(S.ath - t) + ' off the top.');
  }
  if (level === 0 && (S.ddFlag || 0) > 0) logEvent('up', 'Recovered', 'Back within 5% of the all-time high.');
  S.ddFlag = level;
}

function snapshot() {
  const v = Math.round(total());
  const last = S.history[S.history.length - 1];
  if (!last || S.simTime - last[0] >= 600000) S.history.push([S.simTime, v]);
  else last[1] = v;
  if (S.history.length - (S.compactedAt || 0) > 300) compactHistory();
}
function compactHistory(aggressive) {
  const now = S.simTime, out = [];
  let lastBucket = null;
  for (const p of S.history) {
    const age = now - p[0];
    const size = age < 2 * DAY_MS ? 600000 : age < 60 * DAY_MS && !aggressive ? 3600000 : DAY_MS;
    const bucket = size + ':' + Math.floor(p[0] / size);
    if (bucket === lastBucket) out[out.length - 1] = p; else out.push(p);
    lastBucket = bucket;
  }
  S.history = out;
  S.compactedAt = out.length;
}

function advance(realDeltaMs) {
  if (!(realDeltaMs > 0)) { S.lastReal = Date.now(); return false; }
  const to = S.simTime + realDeltaMs;
  const prevAth = S.ath;
  const steps = Math.min(Math.max(1, Math.ceil(realDeltaMs / 900000)), 3000);
  const per = realDeltaMs / steps;
  for (let i = 0; i < steps; i++) {
    const t0 = S.simTime, t1 = i === steps - 1 ? to : t0 + per;
    stepMarket(t0, t1);
    S.simTime = t1;
    const key = etDayKey(t1);
    if (key !== S.dayKey) { checkAlerts(); rollDay(key); }
    const raw = rawTotal();
    if (raw > S.ath) { S.ath = raw; S.athAt = S.simTime; }
    snapshot();
  }
  checkAlerts();
  checkPortfolioEvents(prevAth);
  S.lastReal = Date.now();
  save();
  return true;
}

/* ---------- derived metrics ---------- */
function basePrice(id, period) {
  const h = meta(id), st = S.holdings[id];
  if (!st) return meta(id).price;
  const c = st.closes;
  if (!c || !c.length) return st.price;
  if (period === 'w1') return c[Math.max(0, c.length - (SESSION[h.cls] ? 5 : 7))];
  return c[c.length - 1];
}
function chg(id, period) {
  const base = basePrice(id, period);
  return base ? (priceOf(id) - base) / base : 0;
}

function historyIn(rangeMs) {
  const cutoff = S.simTime - rangeMs;
  const h = S.history;
  let i = h.length - 1;
  while (i > 0 && h[i][0] > cutoff) i--;
  return h.slice(Math.max(0, i));
}

function seriesFor(range) {
  const map = { '1D': DAY_MS, '1W': 7 * DAY_MS, '1M': 30 * DAY_MS, '1Y': 365 * DAY_MS, 'ALL': Infinity };
  const ms = map[range] ?? 30 * DAY_MS;
  let pts = (ms === Infinity ? S.history : historyIn(ms)).slice();
  if (pts.length < 2) pts = S.history.slice(-2);
  pts[pts.length - 1] = [S.simTime, total()];
  const MAX = 180;
  if (pts.length > MAX) {
    const out = [], stepN = pts.length / MAX;
    for (let i = 0; i < MAX; i++) out.push(pts[Math.floor(i * stepN)]);
    out.push(pts[pts.length - 1]);
    return out;
  }
  return pts;
}

function assetSeries(h, range) {
  const n = 90;
  const rnd = mulberry32(hashStr(h.id + range));
  const yrs = { '1D': 1 / 365, '1W': 7 / 365, '1M': 1 / 12, '1Y': 1, 'ALL': 3 }[range] ?? 1 / 12;
  const dt = yrs / n, sq = Math.sqrt(dt);
  const sig = Math.max(0.03, (h.sigma || 0.06) * VOL_SCALE);
  let v = 1; const path = [];
  for (let i = 0; i < n; i++) {
    v *= Math.exp((h.mu - 0.5 * sig * sig) * dt + sig * sq * gaussFrom(rnd));
    path.push(v);
  }
  const cur = priceOf(h.id);
  const endK = cur / path[n - 1];
  const start = S.holdings[h.id] ? (range === '1D' ? basePrice(h.id, 'd1') : range === '1W' ? basePrice(h.id, 'w1') : null) : null;
  return path.map((p, i) => {
    let val = p * endK;
    if (start) val += (start - path[0] * endK) * (1 - i / (n - 1));
    return [i, val];
  });
}

function portfolioChange(range) {
  const s = seriesFor(range);
  const a = s[0][1], b = s[s.length - 1][1];
  return { abs: b - a, pct: a ? (b - a) / a : 0 };
}

function incomeRunRate() {
  let annual = 0;
  for (const h of owned()) {
    const st = S.holdings[h.id];
    if (st.biz && st.biz.type === 'operating') annual += st.biz.revenue * st.biz.margin * st.biz.stake * 0.45;
    else if (h.yld) annual += valueOf(h) * h.yld;
  }
  return annual;
}

function burnRate() {
  let b = 0;
  for (const h of owned()) { const st = S.holdings[h.id]; if (st.biz && st.biz.type === 'venture' && !st.biz.dead) b += st.biz.burn; }
  return b;
}
/* The part of that burn you personally fund — the rest is grants, contracts or investors. */
function callRate() {
  let c = 0;
  for (const h of owned()) {
    const st = S.holdings[h.id];
    if (st.biz && st.biz.type === 'venture' && st.biz.step === 0 && !st.biz.dead) c += st.biz.burn * (h.biz.ownerShare ?? 0.6);
  }
  return c;
}

function portfolioVol() {
  let w = 0;
  const t = rawTotal();
  for (const h of owned()) w += (valueOf(h) / t) * (h.sigma || 0) * VOL_SCALE;
  return w;
}

function bookTotal() { let b = 0; for (const id in S.holdings) b += S.holdings[id].book; return b; }
function drawdownFree() { return (S.ath - rawTotal()) / S.ath; }

/* Total expected return: for an operating company that is revenue growth plus the
   distribution yield its multiple implies; for a venture, drift plus expected jumps. */
function expectedReturn(h) { return h.mu + distYield(h); }
function distYield(h) {
  const st = S.holdings[h.id];
  if (!st || !st.biz || st.biz.type !== 'operating') return 0;
  const b = st.biz;
  return (0.45 * b.revenue * b.margin) / enterpriseValue(b);
}
/* The next thing due to happen to a company, for the UI to show. */
function nextMilestone(h) {
  const st = S.holdings[h.id];
  if (!st || !st.biz) return null;
  const b = st.biz, m = h.biz;
  if (b.type === 'venture') {
    if (b.dead) return null;
    const nxt = (m.arc || [])[b.step];
    return nxt ? { label: 'Next round', title: nxt.stage + ' target ' + fmtMoneyPlain(nxt.post), detail: nxt.milestone, years: nxt.years } : null;
  }
  const ev = (m.events || [])[b.evStep];
  return ev ? { label: 'Next expected', title: ev.title, detail: ev.body, years: ev.years } : null;
}
