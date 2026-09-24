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
const STATE_VERSION = 3;
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
      pos.biz = { type: 'venture', valuation: b.valuation, burn: b.burn, stage: b.stage, milestone: b.milestone, rounds: 0, cashOut: 0 };
      pos.price = b.stake * b.valuation;
    } else {
      const mult0 = h.price / (b.stake * b.revenue * b.margin);
      const yearFrac = (etWall(Date.now()) - Date.UTC(etWall(Date.now()).getUTCFullYear(), 0, 1)) / (365 * DAY_MS);
      pos.biz = {
        type: 'operating', revenue: b.revenue, margin: b.margin, multiple: mult0, mult0,
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
      b.revenue *= Math.exp((h.mu - 0.5 * 0.04) * dtCal + 0.20 * sq * gauss());
      b.margin = Math.max(0.02, m.margin + (b.margin - m.margin) * Math.exp(-4 * dtCal) + 0.03 * sq * gauss());
      b.multiple = Math.max(2.5, b.mult0 + (b.multiple - b.mult0) * Math.exp(-1 * dtCal) + 0.8 * sq * gauss());
      const ebitda = b.revenue * b.margin;
      st.price = m.stake * ebitda * b.multiple;

      const seasonal = 1 + m.seasonality * monthPhase;
      const profit = ebitda * seasonal * dtCal;
      b.ytdRevenue += b.revenue * seasonal * dtCal;
      b.ytdProfit += profit;
      b.monthProfit += profit;
      const share = (profit * 0.55) / b.accounts.length;
      b.accounts.forEach(a => { a.bal += share; });
      const dist = profit * m.stake * 0.45;
      income += dist; st.income += dist;
      S.incomeByClass.private = (S.incomeByClass.private || 0) + dist;
      S.monthIncome.private = (S.monthIncome.private || 0) + dist;
      continue;
    }

    if (st.biz && st.biz.type === 'venture') {
      const b = st.biz, m = h.biz, sq = Math.sqrt(dtCal);
      const sg = h.sigma * VOL_SCALE;
      const upRate = m.roundRate || 0.5;
      const jumpDrift = upRate * ROUND_UP_MEAN + DOWN_ROUND_RATE * ROUND_DOWN_MEAN;
      b.valuation *= Math.exp((h.mu - jumpDrift - 0.5 * sg * sg) * dtCal + sg * sq * gauss());
      b.cashOut += b.burn * dtCal;

      const STAGES = ['Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Growth'];
      if (Math.random() < upRate * dtCal) {
        const step = 1.25 + Math.random() * 0.5;
        b.valuation *= step;
        b.rounds = (b.rounds || 0) + 1;
        b.stage = STAGES[Math.min(STAGES.length - 1, STAGES.indexOf(b.stage) + 1)] || b.stage;
        b.burn *= 1.35;
        logEvent('round', h.name + ' raises ' + b.stage,
          'Marked up ' + ((step - 1) * 100).toFixed(0) + '% to ' + fmtMoneyPlain(b.valuation) + '. Your ' + (m.stake * 100).toFixed(0) + '% is now ' + fmtMoneyPlain(m.stake * b.valuation) + '.');
      } else if (Math.random() < DOWN_ROUND_RATE * dtCal) {
        const step = 0.50 + Math.random() * 0.35;
        b.valuation *= step;
        b.burn *= 0.80;
        logEvent('down', h.name + ' marked down',
          'Valuation cut ' + ((1 - step) * 100).toFixed(0) + '% to ' + fmtMoneyPlain(b.valuation) + ' after a missed milestone. Burn reduced to ' + fmtMoneyPlain(b.burn) + '/yr.');
      }
      st.price = m.stake * b.valuation;
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
    if (!last || S.simTime - last.t > DAY_MS) logEvent('ath', 'New all-time high', fmtMoneyPlain(t) + ' — previous peak ' + fmtMoneyPlain(prevAth) + '.');
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
    if (st.biz && st.biz.type === 'operating') annual += st.biz.revenue * st.biz.margin * h.biz.stake * 0.45;
    else if (h.yld) annual += valueOf(h) * h.yld;
  }
  return annual;
}

function burnRate() {
  let b = 0;
  for (const h of owned()) { const st = S.holdings[h.id]; if (st.biz && st.biz.type === 'venture') b += st.biz.burn; }
  return b;
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
function expectedReturn(h) {
  const st = S.holdings[h.id];
  if (st && st.biz && st.biz.type === 'operating') return h.mu + 0.45 / st.biz.multiple;
  return h.mu;
}
function distYield(h) {
  const st = S.holdings[h.id];
  return st && st.biz && st.biz.type === 'operating' ? 0.45 / st.biz.multiple : 0;
}
