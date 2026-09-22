/* Strata — market engine.
   A diversified portfolio simulated on the real clock, persisted to localStorage.

   Time
   ----
   One second in the app is one second in the world. Stocks and ETFs only move while
   North American exchanges are open (9:30–16:00 ET, weekdays); metals trade weekdays;
   crypto never closes; property and private companies revalue continuously. Drift and
   volatility are annual figures measured in each asset's own trading time, so a year of
   use produces a year of returns — nothing compounds faster than it would in reality.

   Model
   -----
   Market assets follow geometric Brownian motion: a shared market factor plus their own
   noise. Operating companies are valued bottom-up (stake x EBITDA x multiple). Income
   accrues continuously into settlement cash; paydays are announced on the calendar.
   Nothing is clamped — the total is what the holdings are worth.                        */

const STORE_KEY = 'strata.state.v1';
const STATE_VERSION = 2;
const YEAR_S = 31557600;
const DAY_MS = 86400000;
const TRADING_YEAR_S = 252 * 6.5 * 3600;   // equities: seconds of exchange time per year
const WEEKDAY_YEAR_S = 261 * 86400;        // metals: weekday seconds per year

const BETA = { equity: 0.80, etf: 0.85, crypto: 0.40, metals: 0.12, realty: 0.08, private: 0.30, cash: 0.02 };
/* Seed volatilities are single-name headline figures; realised paths run at 70% so the
   whole book lands near a real balanced portfolio's ~11% without flattening any one asset. */
const VOL_SCALE = 0.7;
const SESSION = { equity: 'exchange', etf: 'exchange', metals: 'weekday' }; // everything else: 24/7

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
  // ms to add to a UTC timestamp to get New York/Toronto wall-clock time
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
const etWall = t => new Date(t + etOffset(t));          // read with getUTC* methods
const etDayKey = t => { const w = etWall(t); return w.getUTCFullYear() * 10000 + (w.getUTCMonth() + 1) * 100 + w.getUTCDate(); };
const isWeekdayKey = k => { const d = new Date(Date.UTC(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100)).getUTCDay(); return d > 0 && d < 6; };

/* Seconds of [t0, t1] that fall inside a session, computed exactly on ET wall time. */
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

/* ---------- state ---------- */
const DEFAULT_SETTINGS = {
  refresh: '30',        // seconds between price updates while the app is open
  hwmLine: true,
  hideBalances: false,
  currency: 'CAD',
  compact: true,
  accent: 'violet',
  chartFill: true,
  haptics: true
};

let S = null; // live state

function seedBackfill(endValue, endTime) {
  // 3 years of daily closes ending exactly at endValue — with real corrections in it.
  const days = 1095, rnd = mulberry32(20160411);
  let v = 1;
  const path = [];
  for (let i = 0; i < days; i++) {
    v *= Math.exp((0.085 - 0.0072) / 365 + 0.12 / Math.sqrt(365) * gaussFrom(rnd));
    path.push(v);
  }
  const scale = endValue / path[path.length - 1];
  const out = path.map((p, i) => [endTime - (days - i) * DAY_MS, Math.round(p * scale)]);
  out.push([endTime, Math.round(endValue)]);
  return out;
}

function seedCloses(h, rnd) {
  // ten prior closes so 1D / 1W changes are meaningful from the first launch
  const sg = (h.sigma || 0.01) * VOL_SCALE / Math.sqrt(SESSION[h.cls] ? 252 : 365);
  const out = [h.price];
  let p = h.price;
  for (let i = 0; i < 10; i++) { p /= Math.exp(sg * gaussFrom(rnd) + (h.mu || 0) / 365); out.unshift(p); }
  out.pop(); // last close is the one before "now"
  return out;
}

function freshState() {
  const now = Date.now();
  const holdings = {};
  const rnd = mulberry32(7734);
  const yearFrac = (etWall(now) - Date.UTC(etWall(now).getUTCFullYear(), 0, 1)) / (365 * DAY_MS);
  for (const h of SEED_HOLDINGS) {
    const gain = h.cls === 'cash' ? 0.01 : 0.08 + rnd() * 0.85;
    holdings[h.id] = {
      price: h.price,
      closes: seedCloses(h, rnd),
      book: (h.qty * h.price) / (1 + gain),
      income: 0,
      alert: 0
    };
    if (h.biz) {
      const mult0 = h.price / (h.biz.stake * h.biz.revenue * h.biz.margin);
      holdings[h.id].biz = {
        revenue: h.biz.revenue, margin: h.biz.margin, multiple: mult0, mult0,
        accounts: h.biz.accounts.map(a => ({ name: a.name, bal: a.bal })),
        ytdRevenue: h.biz.revenue * yearFrac,
        ytdProfit: h.biz.revenue * h.biz.margin * yearFrac,
        monthProfit: 0
      };
    }
  }
  const total = SEED_HOLDINGS.reduce((s, h) => s + h.qty * h.price, 0);
  return {
    v: STATE_VERSION,
    createdAt: now,
    simTime: now,
    lastReal: now,
    dayKey: etDayKey(now),
    holdings,
    ath: total,
    athAt: now,
    ddFlag: 0,
    incomeTotal: 0,
    incomeByClass: {},
    monthIncome: {},
    history: seedBackfill(total, now),
    compactedAt: 0,
    events: [
      { t: now, kind: 'note', title: 'Portfolio synced', body: 'All ' + SEED_HOLDINGS.length + ' positions reconciled across 6 custodians.' }
    ],
    settings: { ...DEFAULT_SETTINGS }
  };
}

function migrate(p) {
  // v1 ran on a compressed clock that may sit ahead of real time: pull it back to now.
  const now = Date.now();
  const shift = Math.max(0, (p.simTime || now) - now);
  const back = t => t - shift;
  p.history = (p.history || []).map(([t, v]) => [back(t), v]).filter(([t]) => t <= now);
  p.events = (p.events || []).map(e => ({ ...e, t: Math.min(now, back(e.t)) }));
  p.athAt = Math.min(now, back(p.athAt || now));
  for (const h of SEED_HOLDINGS) {
    const st = p.holdings[h.id];
    if (!st) continue;
    st.closes = st.closes || [st.w1 || st.price, st.d1 || st.price];
    delete st.d1; delete st.w1;
    st.alert = 0;
    if (st.biz) st.biz.monthProfit = st.biz.monthProfit || 0;
  }
  delete p.lastDay; delete p.lastSnap;
  if (p.settings) { delete p.settings.speed; delete p.settings.ratchet; }
  p.simTime = now; p.lastReal = now; p.dayKey = etDayKey(now);
  p.monthIncome = p.monthIncome || {};
  p.compactedAt = 0;
  p.v = STATE_VERSION;
  return p;
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      let parsed = JSON.parse(raw);
      if (parsed && parsed.holdings) {
        if (parsed.v === 1) parsed = migrate(parsed);
        if (parsed.v === STATE_VERSION) {
          parsed.settings = { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) };
          return parsed;
        }
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
function meta(id) { return SEED_HOLDINGS.find(h => h.id === id); }
function valueOf(h) { return h.qty * S.holdings[h.id].price; }
function rawTotal() { let t = 0; for (const h of SEED_HOLDINGS) t += valueOf(h); return t; }
function total() { return rawTotal(); }

function classTotals() {
  const out = {};
  for (const k in CLASSES) out[k] = 0;
  for (const h of SEED_HOLDINGS) out[h.cls] += valueOf(h);
  return out;
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

  for (const h of SEED_HOLDINGS) {
    const st = S.holdings[h.id];

    if (st.biz) {
      // Operating company: value it off its own numbers. Mean reversion is time-based.
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

    // income accrues on the calendar, whatever the exchange is doing
    if (h.yld && h.id !== 'cash-settle') {
      const inc = h.qty * st.price * h.yld * dtCal;
      income += inc; st.income += inc;
      S.incomeByClass[h.cls] = (S.incomeByClass[h.cls] || 0) + inc;
      S.monthIncome[h.cls] = (S.monthIncome[h.cls] || 0) + inc;
    }
  }

  const settle = S.holdings['cash-settle'];
  settle.price += income;
  settle.income += income;
  S.incomeTotal += income;
}

/* ET-midnight roll: record closes, reset alerts, announce paydays on month ends. */
function rollDay(newKey) {
  const ended = S.dayKey;
  const tradedYesterday = isWeekdayKey(ended);
  for (const h of SEED_HOLDINGS) {
    const st = S.holdings[h.id];
    if (!SESSION[h.cls] || tradedYesterday) {
      st.closes.push(st.price);
      if (st.closes.length > 10) st.closes.shift();
      st.alert = 0;
    }
  }
  const monthEnded = Math.floor(ended / 100) !== Math.floor(newKey / 100);
  if (monthEnded) announcePaydays(Math.floor(ended / 100) % 100);
  if (Math.floor(ended / 10000) !== Math.floor(newKey / 10000)) {
    for (const h of SEED_HOLDINGS) if (h.biz) { S.holdings[h.id].biz.ytdRevenue = 0; S.holdings[h.id].biz.ytdProfit = 0; }
  }
  S.dayKey = newKey;
}

function announcePaydays(month) {
  const mi = S.monthIncome;
  const monthName = new Date(Date.UTC(2000, month - 1, 1)).toLocaleString('en-CA', { month: 'long', timeZone: 'UTC' });
  if (mi.realty) logEvent('income', 'Rent collected — ' + monthName, fmtMoneyPlain(mi.realty) + ' net across 5 properties and Granite REIT.');
  if (mi.private) logEvent('income', 'Company distributions — ' + monthName, fmtMoneyPlain(mi.private) + ' from Northpine, Meridian and Harbour & Vine.');
  const divs = (mi.equity || 0) + (mi.etf || 0);
  if (divs) logEvent('income', 'Dividends — ' + monthName, fmtMoneyPlain(divs) + ' from equities and ETFs.');
  const interest = (mi.cash || 0) + (mi.crypto || 0);
  if (interest) logEvent('income', 'Interest & staking — ' + monthName, fmtMoneyPlain(interest) + ' from savings, GICs and staked ETH/SOL.');
  for (const h of SEED_HOLDINGS) if (h.biz) S.holdings[h.id].biz.monthProfit = 0;
  S.monthIncome = {};
}

function logEvent(kind, title, body) {
  S.events.unshift({ t: S.simTime, kind, title, body });
  if (S.events.length > 120) S.events.length = 120;
}

function checkAlerts() {
  // each holding speaks up once per session when it moves hard
  for (const h of SEED_HOLDINGS) {
    if (h.cls === 'cash' || h.cls === 'realty' || h.biz) continue;
    const st = S.holdings[h.id];
    const c = chg(h.id, 'd1');
    const threshold = h.cls === 'crypto' ? 0.08 : h.cls === 'etf' ? 0.025 : h.cls === 'metals' ? 0.03 : 0.05;
    const lvl = Math.floor(Math.abs(c) / threshold);
    if (lvl > (st.alert || 0)) {
      st.alert = lvl;
      logEvent(c >= 0 ? 'up' : 'down',
        h.sym + (c >= 0 ? ' up ' : ' down ') + Math.abs(c * 100).toFixed(1) + '% today',
        h.name + ' at ' + fmtMoneyPlain(st.price) + (h.qty > 1 ? ' — position ' + fmtMoneyPlain(valueOf(h)) + '.' : '.'));
    }
  }
}

function checkPortfolioEvents(prevAth) {
  const t = total();
  if (t > prevAth * 1.0005) {
    const last = S.events.find(e => e.kind === 'ath');
    if (!last || S.simTime - last.t > DAY_MS) {
      logEvent('ath', 'New all-time high', fmtMoneyPlain(t) + ' — previous peak ' + fmtMoneyPlain(prevAth) + '.');
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

/* History: 10-minute points for 2 days, hourly to 60 days, daily beyond. */
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
  if (!(realDeltaMs > 0)) { S.lastReal = Date.now(); return false; } // clock skew guard
  const to = S.simTime + realDeltaMs;
  const prevAth = S.ath;
  // live ticks are one step; catch-up after time away runs in <=15-minute steps (max 3000)
  const steps = Math.min(Math.max(1, Math.ceil(realDeltaMs / 900000)), 3000);
  const per = realDeltaMs / steps;
  for (let i = 0; i < steps; i++) {
    const t0 = S.simTime, t1 = i === steps - 1 ? to : t0 + per;
    stepMarket(t0, t1);
    S.simTime = t1;
    const key = etDayKey(t1);
    if (key !== S.dayKey) { checkAlerts(); rollDay(key); }   // catch the day's move before it closes
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
  const h = meta(id), c = S.holdings[id].closes;
  if (!c || !c.length) return S.holdings[id].price;
  if (period === 'w1') return c[Math.max(0, c.length - (SESSION[h.cls] ? 5 : 7))];
  return c[c.length - 1];
}
function chg(id, period) {
  const base = basePrice(id, period);
  return base ? (S.holdings[id].price - base) / base : 0;
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

/* Illustrative path for one asset: stable shape per asset+range, pinned to the real
   recent closes at the right edge and to the live price at the end. */
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
  const cur = S.holdings[h.id].price;
  const start = range === '1D' ? basePrice(h.id, 'd1') : range === '1W' ? basePrice(h.id, 'w1') : null;
  // blend so the path starts at the true reference close when we have one
  return path.map((p, i) => {
    const endK = cur / path[n - 1];
    let val = p * endK;
    if (start) {
      const startErr = start - path[0] * endK;
      val += startErr * (1 - i / (n - 1));
    }
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
  for (const h of SEED_HOLDINGS) {
    if (h.biz) { const b = S.holdings[h.id].biz; annual += b.revenue * b.margin * h.biz.stake * 0.45; }
    else if (h.yld) annual += valueOf(h) * h.yld;
  }
  return annual;
}

function portfolioVol() {
  let w = 0, t = rawTotal();
  for (const h of SEED_HOLDINGS) w += (valueOf(h) / t) * (h.sigma || 0) * VOL_SCALE;
  return w;
}

function drawdownFree() { return (S.ath - rawTotal()) / S.ath; }
