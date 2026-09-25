/* Strata — UI layer */

const APP_VERSION = '2.1.0';
let view = 'home';
let range = '1M';
let classFilter = 'all';
let marketFilter = 'all';
let marketQuery = '';
let activityFilter = 'all';
let openAssetId = null;
let sheetRange = '1M';
let scrub = null;
let refreshTimer = null, lastUpdated = Date.now();

/* trade sheet state */
let tId = null, tSide = 'buy', tMode = 'cad', tInput = '';

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------- identity ---------- */
function holderName() { return (S.settings.holderName || '').trim() || PROFILE.name; }
function entityName() { return (S.settings.entityName || '').trim() || PROFILE.entity; }
function holderInitials() {
  const p = holderName().split(/\s+/).filter(Boolean);
  return ((p[0] ? p[0][0] : '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
function esc(t) { return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function paintIdentity() { $$('.js-initials').forEach(el => { el.textContent = holderInitials(); }); }

/* ---------- formatting ---------- */
function fx(v) { return S.settings.currency === 'USD' ? v * PROFILE.fxUSD : v; }
function sym() { return S.settings.currency === 'USD' ? 'US$' : '$'; }
function fmtMoneyPlain(v) { return '$' + Math.round(v).toLocaleString('en-CA'); }

function money(v, opts = {}) {
  const val = fx(v), abs = Math.abs(val);
  if (S.settings.compact && !opts.full && abs >= 10000) {
    const s = abs >= 1e9 ? (val / 1e9).toFixed(2) + 'B' : abs >= 1e6 ? (val / 1e6).toFixed(2) + 'M' : (val / 1e3).toFixed(1) + 'K';
    return sym() + s;
  }
  return sym() + val.toLocaleString('en-CA', {
    minimumFractionDigits: opts.dec ?? (abs < 1000 ? 2 : 0),
    maximumFractionDigits: opts.dec ?? (abs < 1000 ? 2 : 0)
  });
}
function signed(v) { return (v >= 0 ? '+' : '−') + money(Math.abs(v)); }
function pct(p, d = 2) { return (p >= 0 ? '+' : '−') + Math.abs(p * 100).toFixed(d) + '%'; }
function cls(v) { return v >= 0 ? 'up' : 'down'; }
function priv(str) { return S.settings.hideBalances ? '••••••' : str; }

function unitWord(h) {
  if (h.cls === 'metals') return h.unit || 'oz';
  if (h.cls === 'crypto') return h.sym;
  if (h.cls === 'cash') return '';
  if (h.lot || h.cls === 'realty') return 'units';
  if (h.biz) return 'stake';
  return 'shares';
}
function fmtUnits(u, h) {
  if (h.biz) return (u * 100).toFixed(1) + '% of holding';
  if (h.cls === 'realty' && h.lot) return u === 1 ? 'the property' : u + ' properties';
  if (h.cls === 'cash') return fmtMoneyPlain(u);
  const dec = u < 10 ? (h.cls === 'crypto' ? 4 : 2) : 0;
  return u.toLocaleString('en-CA', { maximumFractionDigits: dec }) + ' ' + unitWord(h);
}
function relTime(t) {
  const d = (S.simTime - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  if (d < 604800) return Math.floor(d / 86400) + 'd ago';
  return new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
function haptic(ms = 8) { if (S.settings.haptics && navigator.vibrate) navigator.vibrate(ms); }
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---------- chart ---------- */
function drawChart(canvas, pts, opts = {}) {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = canvas.clientWidth || 340, h = opts.height || canvas.clientHeight || 190;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  if (pts.length < 2) return;

  const padT = 14, padB = 16, padX = 4;
  const ys = pts.map(p => p[1]);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < hi * 0.0008) { hi *= 1.0008; lo *= 0.9992; }
  const spread = hi - lo;
  lo -= spread * 0.12; hi += spread * 0.12;
  const X = i => padX + (i / (pts.length - 1)) * (w - padX * 2);
  const Y = v => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent-2').trim() || '#4C8DFF';
  const accent1 = css.getPropertyValue('--accent').trim() || '#7C5CFF';

  c.strokeStyle = 'rgba(255,255,255,.05)'; c.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = padT + (i / 3) * (h - padT - padB);
    c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
  }

  if (opts.hwm) {
    let run = -Infinity;
    c.setLineDash([3, 4]); c.strokeStyle = 'rgba(227,179,65,.55)'; c.lineWidth = 1.2;
    c.beginPath();
    pts.forEach((p, i) => { run = Math.max(run, p[1]); const x = X(i), y = Y(run); i === 0 ? c.moveTo(x, y) : c.lineTo(x, y); });
    c.stroke(); c.setLineDash([]);
  }

  if (S.settings.chartFill) {
    const g = c.createLinearGradient(0, padT, 0, h);
    g.addColorStop(0, hexA(opts.color || accent1, .32));
    g.addColorStop(1, hexA(opts.color || accent1, 0));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(X(0), h);
    pts.forEach((p, i) => c.lineTo(X(i), Y(p[1])));
    c.lineTo(X(pts.length - 1), h); c.closePath(); c.fill();
  }

  let stroke = opts.color;
  if (!stroke) { const lg = c.createLinearGradient(0, 0, w, 0); lg.addColorStop(0, accent1); lg.addColorStop(1, accent); stroke = lg; }
  c.strokeStyle = stroke; c.lineWidth = 2; c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath();
  pts.forEach((p, i) => { const x = X(i), y = Y(p[1]); i === 0 ? c.moveTo(x, y) : c.lineTo(x, y); });
  c.stroke();

  const lx = X(pts.length - 1), ly = Y(pts[pts.length - 1][1]);
  c.fillStyle = opts.color || accent;
  c.shadowColor = opts.color || accent; c.shadowBlur = 12;
  c.beginPath(); c.arc(lx, ly, 3.4, 0, 7); c.fill(); c.shadowBlur = 0;

  if (opts.scrub != null && opts.scrub >= 0 && opts.scrub < pts.length) {
    const i = opts.scrub, x = X(i), y = Y(pts[i][1]);
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, padT - 8); c.lineTo(x, h - padB + 6); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 3.2, 0, 7); c.fill();
    const d = new Date(pts[i][0]);
    const txt = priv(money(pts[i][1])) + '  ' + d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    c.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
    const tw = c.measureText(txt).width;
    const bx = Math.max(2, Math.min(w - tw - 12, x - tw / 2 - 5));
    c.fillStyle = 'rgba(20,22,58,.95)';
    roundRect(c, bx, 0, tw + 10, 18, 6); c.fill();
    c.fillStyle = '#ECEEFF'; c.fillText(txt, bx + 5, 12.5);
  }
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function hexA(hex, a) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map(x => x + x).join('') : m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function sparkline(h, w = 40, ht = 22) {
  const pts = assetSeries(h, '1W').map(p => p[1]);
  const lo = Math.min(...pts), hi = Math.max(...pts), rg = hi - lo || 1;
  const d = pts.map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(ht - 3 - ((v - lo) / rg) * (ht - 6)).toFixed(1)}`).join(' L');
  const up = pts[pts.length - 1] >= pts[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${ht}" preserveAspectRatio="none" aria-hidden="true"><path d="M${d}" fill="none" stroke="${up ? 'var(--up)' : 'var(--down)'}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity=".85"/></svg>`;
}

function renderDonut() {
  const totals = classTotals();
  const t = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  const order = Object.keys(CLASSES).sort((a, b) => totals[b] - totals[a]);
  let ang = -Math.PI / 2;
  let svg = '<circle cx="60" cy="60" r="46" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="15"/>';
  for (const k of order) {
    const frac = totals[k] / t;
    if (frac <= 0.0005) continue;
    const a2 = ang + frac * Math.PI * 2 - 0.035;
    const large = frac > 0.5 ? 1 : 0;
    svg += `<path d="M${(60 + 46 * Math.cos(ang)).toFixed(2)} ${(60 + 46 * Math.sin(ang)).toFixed(2)} A46 46 0 ${large} 1 ${(60 + 46 * Math.cos(a2)).toFixed(2)} ${(60 + 46 * Math.sin(a2)).toFixed(2)}" fill="none" stroke="${CLASSES[k].color}" stroke-width="15"/>`;
    ang += frac * Math.PI * 2;
  }
  svg += `<text x="60" y="56" text-anchor="middle" font-size="9" fill="#5D6493" letter-spacing="1">POSITIONS</text>`;
  svg += `<text x="60" y="73" text-anchor="middle" font-size="20" font-weight="700" fill="#ECEEFF">${owned().length}</text>`;
  $('#donut').innerHTML = svg;
  $('#alloc-list').innerHTML = order.filter(k => totals[k] > 0).map(k => `
    <div class="alloc-row"><span class="dot" style="background:${CLASSES[k].color}"></span>
    <span class="nm">${CLASSES[k].short}</span><span class="pc">${(100 * totals[k] / t).toFixed(1)}%</span></div>`).join('');
}

/* ---------- rows ---------- */
function holdingRow(h) {
  const st = S.holdings[h.id];
  const v = valueOf(h), c1 = chg(h.id, 'd1');
  let sub;
  if (st.biz) sub = (st.biz.type === 'venture' ? st.biz.stage + ' · ' : '') + h.venue;
  else if (h.cls === 'realty' && h.qty === 1) sub = h.venue;
  else if (h.cls === 'cash') sub = h.venue;
  else sub = fmtUnits(st.qty, h) + ' · ' + money(st.price, { full: st.price < 10000 });
  const spark = h.cls === 'cash' ? '<span></span>' : sparkline(h);
  return `<button class="row" data-asset="${h.id}">
    <span class="tick" style="color:${CLASSES[h.cls].color}">${esc(h.sym).slice(0, 6)}</span>
    <span class="mid"><span class="nm">${esc(h.name)}</span><span class="sub">${esc(sub)}</span></span>
    ${spark}
    <span class="right"><span class="val">${priv(money(v))}</span><span class="chg ${h.cls === 'cash' ? 'muted' : cls(c1)}">${h.cls === 'cash' ? '—' : pct(c1)}</span></span>
  </button>`;
}

function marketRow(h) {
  const st = S.holdings[h.id];
  const c1 = chg(h.id, 'd1');
  const held = st && st.qty > 1e-9;
  const sub = held ? 'Holding ' + priv(money(valueOf(h))) : esc(h.venue) + (h.lot ? ' · min ' + money(h.lot) : '');
  return `<button class="row" data-asset="${h.id}">
    <span class="tick" style="color:${CLASSES[h.cls].color}">${esc(h.sym).slice(0, 6)}</span>
    <span class="mid"><span class="nm">${esc(h.name)}</span><span class="sub">${sub}</span></span>
    ${sparkline(h)}
    <span class="right"><span class="val">${money(priceOf(h.id), { full: priceOf(h.id) < 10000 })}</span><span class="chg ${cls(c1)}">${pct(c1)}</span></span>
  </button>`;
}

/* ---------- home ---------- */
let heroShown = null, heroRaf = null;
function tweenHero(target) {
  const el = $('#hero-value');
  const paint = v => { el.textContent = priv(money(v, { full: true, dec: 0 })); };
  cancelAnimationFrame(heroRaf);
  const from = heroShown;
  if (from == null || S.settings.hideBalances || Math.abs(target - from) < 1 ||
      (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    heroShown = target; return paint(target);
  }
  const t0 = performance.now();
  const frame = now => {
    const k = Math.min(1, (now - t0) / 700), e = 1 - Math.pow(1 - k, 3);
    heroShown = from + (target - from) * e;
    paint(heroShown);
    if (k < 1) heroRaf = requestAnimationFrame(frame);
  };
  heroRaf = requestAnimationFrame(frame);
}

function renderHome() {
  const t = total(), ch = portfolioChange(range);
  tweenHero(t);
  const pill = $('#hero-chg');
  pill.className = 'pill ' + cls(ch.abs);
  pill.textContent = `${signed(ch.abs)} · ${pct(ch.pct)}`;
  $('#hero-chg-range').textContent = { '1D': 'past 24h', '1W': 'past week', '1M': 'past month', '1Y': 'past year', 'ALL': 'since ' + new Date(S.history[0][0]).getFullYear() }[range];
  const ms = marketStatus(S.simTime);
  $('#hero-clock').innerHTML = `· <span style="color:${ms.open ? 'var(--up)' : 'var(--faint)'}">●</span> ${ms.label} · as of ${new Date(lastUpdated).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}`;
  const dd = drawdownFree();
  const hw = $('#hero-hw');
  hw.textContent = dd < 0.0015 ? 'At all-time high' : `${(dd * 100).toFixed(1)}% below peak`;
  hw.className = 'pill ' + (dd < 0.0015 ? 'ath' : dd > 0.08 ? 'down' : '');

  drawChart($('#chart-main'), seriesFor(range), { hwm: S.settings.hwmLine, scrub });

  const book = bookTotal(), gain = rawTotal() - book;
  $('#s-cash').textContent = priv(money(cashAvailable()));
  $('#s-income').textContent = priv(money(incomeRunRate()));
  $('#s-gain').textContent = priv(signed(gain));
  $('#s-gain').className = 'v num ' + cls(gain);
  $('#s-gain-pc').textContent = pct(gain / book, 1) + ' vs cost';

  renderDonut();

  const biz = owned().filter(h => S.holdings[h.id].biz).sort((a, b) => valueOf(b) - valueOf(a)).slice(0, 4);
  $('#home-biz').innerHTML = biz.map(holdingRow).join('');

  const movers = owned().filter(h => h.cls !== 'cash' && !S.holdings[h.id].biz)
    .map(h => ({ h, c: chg(h.id, 'd1') })).sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 5);
  $('#movers').innerHTML = movers.map(m => holdingRow(m.h)).join('');
  $('#home-activity').innerHTML = S.events.slice(0, 4).map(eventRow).join('') || '<div class="empty">Nothing yet.</div>';
}

const EV_ICON = { ath: '◆', income: '↓', up: '▲', down: '▼', note: '•', trade: '⇄', round: '★', call: '↑' };
function eventRow(e) {
  const color = e.kind === 'up' || e.kind === 'income' ? 'var(--up)' : e.kind === 'down' ? 'var(--down)'
    : e.kind === 'round' ? 'var(--gold)' : e.kind === 'call' ? 'var(--muted)' : 'var(--accent-2)';
  return `<div class="ins"><span class="ico" style="color:${color}">${EV_ICON[e.kind] || '•'}</span>
    <span style="flex:1;min-width:0"><span class="t">${esc(e.title)}</span><span class="b">${esc(e.body)}</span><span class="time">${relTime(e.t)}</span></span></div>`;
}

/* ---------- assets ---------- */
function renderAssets() {
  const totals = classTotals(), tot = rawTotal();
  $('#assets-total').textContent = priv(money(tot));
  const keys = ['all', ...Object.keys(CLASSES)];
  $('#class-chips').innerHTML = keys.map(k => {
    const n = k === 'all' ? owned().length : owned().filter(h => h.cls === k).length;
    return `<button data-class="${k}" aria-selected="${classFilter === k}">${k === 'all' ? 'All' : CLASSES[k].short} ${n}</button>`;
  }).join('');

  const list = owned().filter(h => classFilter === 'all' || h.cls === classFilter).sort((a, b) => valueOf(b) - valueOf(a));
  let html = '';
  if (classFilter === 'all') {
    for (const k of Object.keys(CLASSES).sort((a, b) => totals[b] - totals[a])) {
      const hs = list.filter(h => h.cls === k);
      if (!hs.length) continue;
      html += `<div class="group-head"><span class="t" style="color:${CLASSES[k].color}">${CLASSES[k].name}</span>
        <span class="v">${priv(money(totals[k]))} · ${(100 * totals[k] / tot).toFixed(1)}%</span></div>` + hs.map(holdingRow).join('');
    }
  } else html = list.map(holdingRow).join('');
  $('#holdings-list').innerHTML = html || '<div class="empty">No holdings in this class.</div>';
}

/* ---------- markets ---------- */
function renderMarkets() {
  $('#markets-cash').textContent = priv(money(cashAvailable())) + ' buying power';
  const keys = ['all', 'equity', 'etf', 'crypto', 'metals', 'private', 'realty'];
  $('#market-chips').innerHTML = keys.map(k =>
    `<button data-mclass="${k}" aria-selected="${marketFilter === k}">${k === 'all' ? 'All' : CLASSES[k].short}</button>`).join('');

  const q = marketQuery.trim().toLowerCase();
  const list = ALL_ASSETS.filter(h => h.cls !== 'cash')
    .filter(h => marketFilter === 'all' || h.cls === marketFilter)
    .filter(h => !q || h.name.toLowerCase().includes(q) || h.sym.toLowerCase().includes(q))
    .filter(h => !(S.holdings[h.id] && S.holdings[h.id].biz))   // your own companies aren't on an exchange
    .sort((a, b) => {
      const ah = qtyOf(a.id) > 0 ? 0 : 1, bh = qtyOf(b.id) > 0 ? 0 : 1;
      return ah - bh || a.name.localeCompare(b.name);
    });
  $('#market-list').innerHTML = list.length ? list.map(marketRow).join('') : '<div class="empty">Nothing matches that search.</div>';
}

/* ---------- insights ---------- */
function renderInsights() {
  $('#insights-date').textContent = new Date(S.simTime).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const totals = classTotals(), t = rawTotal();
  const ins = [];
  const top = owned().map(h => ({ h, v: valueOf(h) })).sort((a, b) => b.v - a.v)[0];
  ins.push({ i: '◆', t: 'Largest single position', b: `${top.h.name} is ${(100 * top.v / t).toFixed(1)}% of the book at ${priv(money(top.v))}.` });

  const ventures = owned().filter(h => S.holdings[h.id].biz && S.holdings[h.id].biz.type === 'venture');
  const vv = ventures.reduce((s, h) => s + valueOf(h), 0);
  ins.push({ i: '⚗', t: 'Venture exposure', b: `${ventures.length} pre-revenue companies worth ${priv(money(vv))}, ${(100 * vv / t).toFixed(1)}% of net worth, burning ${priv(money(burnRate()))} a year between them, ${priv(money(callRate()))} of which you fund yourself until a round takes over. None of it is liquid and any of it can go to zero.` });

  const ops = owned().filter(h => S.holdings[h.id].biz && S.holdings[h.id].biz.type === 'operating');
  const ov = ops.reduce((s, h) => s + valueOf(h), 0);
  ins.push({ i: '⚙', t: 'Operating companies carry the income', b: `${ops.length} companies worth ${priv(money(ov))} distribute ${priv(money(ops.reduce((s, h) => s + S.holdings[h.id].biz.revenue * S.holdings[h.id].biz.margin * h.biz.stake * 0.45, 0)))} a year — most of your cash flow.` });

  const cash = totals.cash;
  ins.push({ i: '⌁', t: cash / t > 0.06 ? 'Cash above target' : 'Cash near target', b: `${priv(money(cash))} in cash and short fixed income, ${(100 * cash / t).toFixed(1)}% against a 5% target. Buying power is ${priv(money(cashAvailable()))}.` });

  const illiquid = (totals.realty + totals.private) / t;
  ins.push({ i: '⧗', t: 'Liquidity profile', b: `${(illiquid * 100).toFixed(0)}% of the book is illiquid — property and private companies that take months to sell. Only ${(100 * (totals.equity + totals.etf + totals.crypto + totals.cash) / t).toFixed(0)}% could be raised in a week.` });

  $('#insight-cards').innerHTML = ins.map(x => `<div class="ins"><span class="ico">${x.i}</span><span style="flex:1;min-width:0"><span class="t">${x.t}</span><span class="b">${x.b}</span></span></div>`).join('');

  const perf = Object.keys(CLASSES).map(k => {
    const hs = owned().filter(h => h.cls === k);
    const v = hs.reduce((s, h) => s + valueOf(h), 0);
    const w1 = hs.reduce((s, h) => s + S.holdings[h.id].qty * basePrice(h.id, 'w1'), 0);
    return { k, v, c: w1 ? (v - w1) / w1 : 0 };
  }).filter(p => p.v > 0).sort((a, b) => b.c - a.c);
  const mx = Math.max(...perf.map(p => Math.abs(p.c)), 0.01);
  $('#class-perf').innerHTML = perf.map(p => `
    <div style="padding:9px 0">
      <div style="display:flex;justify-content:space-between;gap:10px;font-size:13px;margin-bottom:6px">
        <span><span class="dot" style="background:${CLASSES[p.k].color};display:inline-block;margin-right:7px"></span>${CLASSES[p.k].name}</span>
        <span class="${cls(p.c)}" style="font-weight:700">${pct(p.c)}</span></div>
      <div class="bar"><i style="width:${Math.max(2, 100 * Math.abs(p.c) / mx)}%;background:${p.c >= 0 ? 'var(--up)' : 'var(--down)'}"></i></div>
    </div>`).join('') + '<div class="footnote">Weekly change by class, position-weighted.</div>';

  const hhi = owned().reduce((s, h) => s + Math.pow(valueOf(h) / t, 2), 0);
  const eq = (totals.equity + totals.etf + totals.crypto + totals.private) / t;
  $('#risk-card').innerHTML = `
    <div class="kv"><span class="k">Est. portfolio volatility</span><span class="v">${(portfolioVol() * 100).toFixed(1)}% p.a.</span></div>
    <div class="kv"><span class="k">Growth / defensive split</span><span class="v">${(eq * 100).toFixed(0)} / ${(100 - eq * 100).toFixed(0)}</span></div>
    <div class="kv"><span class="k">Concentration (HHI)</span><span class="v">${(hhi * 10000).toFixed(0)} · ${hhi < 0.06 ? 'diversified' : 'concentrated'}</span></div>
    <div class="kv"><span class="k">Positions</span><span class="v">${owned().length} across ${Object.keys(CLASSES).filter(k => totals[k] > 0).length} classes</span></div>
    <div class="kv"><span class="k">Drawdown from peak</span><span class="v">${(drawdownFree() * 100).toFixed(2)}%</span></div>
    <div class="kv"><span class="k">Peak net worth</span><span class="v">${priv(money(S.ath))} · ${relTime(S.athAt)}</span></div>
    <div class="kv"><span class="k">Realised gains / fees paid</span><span class="v">${priv(signed(S.realised))} / ${priv(money(S.feesPaid))}</span></div>`;

  const inc = Object.keys(CLASSES).map(k => {
    const a = owned().filter(h => h.cls === k).reduce((s, h) => {
      const b = S.holdings[h.id].biz;
      return s + (b && b.type === 'operating' ? b.revenue * b.margin * h.biz.stake * 0.45 : b ? 0 : valueOf(h) * (h.yld || 0));
    }, 0);
    return { k, a };
  }).filter(x => x.a > 0).sort((a, b) => b.a - a.a);
  const inct = inc.reduce((s, x) => s + x.a, 0) || 1;
  $('#income-card').innerHTML = inc.map(x => `
    <div class="kv"><span class="k"><span class="dot" style="background:${CLASSES[x.k].color};display:inline-block;margin-right:7px"></span>${CLASSES[x.k].short}</span>
    <span class="v">${priv(money(x.a))} <span class="muted" style="font-weight:400">${(100 * x.a / inct).toFixed(0)}%</span></span></div>`).join('') +
    `<div class="kv"><span class="k" style="color:var(--text);font-weight:650">Total annual income</span><span class="v">${priv(money(inct))}</span></div>
     <div class="footnote">Cash the assets pay you — rent, distributions, dividends, interest and staking — not price appreciation. Received since first run: ${priv(money(S.incomeTotal))}.</div>`;

  $('#biz-card').innerHTML = ops.sort((a, b) => valueOf(b) - valueOf(a)).map(h => {
    const b = S.holdings[h.id].biz;
    return `<button class="row norow-spark" data-asset="${h.id}">
      <span class="tick" style="color:${CLASSES.private.color}">${esc(h.sym)}</span>
      <span class="mid"><span class="nm">${esc(h.name)}</span><span class="sub">${priv(money(b.revenue))} rev · ${(b.margin * 100).toFixed(1)}% margin · ${b.multiple.toFixed(1)}×</span></span>
      <span class="right"><span class="val">${priv(money(valueOf(h)))}</span><span class="chg muted">${(stakeOf(h) * 100).toFixed(0)}% owned</span></span></button>`;
  }).join('') || '<div class="empty">No operating companies held.</div>';

  $('#venture-card').innerHTML = ventures.sort((a, b) => valueOf(b) - valueOf(a)).map(h => {
    const b = S.holdings[h.id].biz;
    return `<button class="row norow-spark" data-asset="${h.id}">
      <span class="tick" style="color:${CLASSES.private.color}">${esc(h.sym)}</span>
      <span class="mid"><span class="nm">${esc(h.name)}</span><span class="sub">${b.stage} · ${priv(money(b.burn))}/yr burn${b.rounds ? ' · ' + b.rounds + ' round' + (b.rounds > 1 ? 's' : '') : ''}</span></span>
      <span class="right"><span class="val">${priv(money(valueOf(h)))}</span><span class="chg muted">${(stakeOf(h) * 100).toFixed(0)}% owned</span></span></button>`;
  }).join('') || '<div class="empty">No venture positions held.</div>';
}

/* ---------- activity ---------- */
function renderActivity() {
  const kinds = [['all', 'All'], ['trade', 'Trades'], ['income', 'Income'], ['round', 'Rounds'], ['call', 'Capital calls'], ['up', 'Movers'], ['ath', 'Milestones']];
  $('#activity-chips').innerHTML = kinds.map(k => `<button data-act-filter="${k[0]}" aria-selected="${activityFilter === k[0]}">${k[1]}</button>`).join('');
  const list = S.events.filter(e => activityFilter === 'all' || e.kind === activityFilter ||
    (activityFilter === 'up' && (e.kind === 'up' || e.kind === 'down')) ||
    (activityFilter === 'ath' && (e.kind === 'ath' || e.kind === 'note')));
  $('#activity-count').textContent = list.length + ' events';
  $('#activity-list').innerHTML = list.map(eventRow).join('') || '<div class="empty">Nothing recorded yet.</div>';
}

/* ---------- asset detail ---------- */
function openAsset(id) {
  openAssetId = id; sheetRange = '1M';
  renderAsset();
  $('#sheet').hidden = false;
  haptic();
}
function closeSheet() { $('#sheet').hidden = true; openAssetId = null; }

function footButtons(h) {
  const st = S.holdings[h.id], held = st && st.qty > 1e-9;
  if (h.id === CASH_ID) return `<div class="btnrow" style="margin:0"><button class="btn" data-trade="${h.id}|deposit">Deposit</button><button class="btn" data-trade="${h.id}|withdraw">Withdraw</button></div>`;
  if (h.cls === 'cash') return `<div class="btnrow" style="margin:0"><button class="btn primary" data-trade="${h.id}|buy">Transfer in</button><button class="btn" data-trade="${h.id}|sell">Transfer out</button></div>`;
  if (st && st.biz) return `<button class="btn sell" data-trade="${h.id}|sell">Sell part of your stake</button>`;
  if (!held) return `<button class="btn primary" data-trade="${h.id}|buy">Buy</button>`;
  return `<div class="btnrow" style="margin:0"><button class="btn primary" data-trade="${h.id}|buy">Buy more</button><button class="btn sell" data-trade="${h.id}|sell">Sell</button></div>`;
}

function renderAsset() {
  if (!openAssetId) return;
  if (openAssetId === 'profile') return renderProfile();
  const h = meta(openAssetId), st = S.holdings[h.id] || {};
  const held = st.qty > 1e-9;
  const price = priceOf(h.id), v = (st.qty || 0) * price;
  const c1 = chg(h.id, 'd1'), c7 = chg(h.id, 'w1');

  $('#sheet-title').innerHTML = `<div style="font-size:15px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(h.name)}</div>
    <div style="font-size:11.5px;color:var(--faint)">${esc(h.sym)} · ${esc(h.venue)}</div>`;
  $('#sheet-foot').hidden = false;
  $('#sheet-foot').innerHTML = footButtons(h);

  let extra = '';
  const b = st.biz;
  if (b && b.type === 'operating') {
    const ebitda = b.revenue * b.margin;
    extra += `<div class="section-head"><h2>Company performance</h2></div><div class="card">
      <div class="kv"><span class="k">Revenue (annualised)</span><span class="v">${priv(money(b.revenue))}</span></div>
      <div class="kv"><span class="k">EBITDA margin</span><span class="v">${(b.margin * 100).toFixed(1)}%</span></div>
      <div class="kv"><span class="k">EBITDA</span><span class="v">${priv(money(ebitda))}</span></div>
      <div class="kv"><span class="k">Applied multiple</span><span class="v">${b.multiple.toFixed(2)}×</span></div>
      <div class="kv"><span class="k">Enterprise value</span><span class="v">${priv(money(ebitda * b.multiple))}</span></div>
      <div class="kv"><span class="k">Your stake</span><span class="v">${(stakeOf(h) * 100).toFixed(1)}% · ${priv(money(v))}</span></div>
      <div class="kv"><span class="k">Headcount</span><span class="v">${b.headcount}</span></div>
      <div class="kv"><span class="k">YTD revenue / profit</span><span class="v">${priv(money(b.ytdRevenue))} / ${priv(money(b.ytdProfit))}</span></div>
      ${b.assets ? `<div class="kv"><span class="k">Recognised assets</span><span class="v">${priv(money(b.assets))} <span class="muted" style="font-weight:400">land, reserves and equipment</span></span></div>` : ''}
      ${b.basis === 'arr' ? `<div class="kv"><span class="k">Valuation basis</span><span class="v">${b.arrMultiple.toFixed(1)}× recurring revenue</span></div>` : ''}
    </div>${milestoneCard(h)}
    <div class="section-head"><h2>Company accounts</h2></div><div class="card">
      ${b.accounts.map(a => `<div class="kv"><span class="k">${esc(a.name)}</span><span class="v">${priv(money(a.bal, { full: true }))}</span></div>`).join('')}
      <div class="kv"><span class="k" style="color:var(--text);font-weight:650">Cash on hand</span><span class="v">${priv(money(b.accounts.reduce((s, a) => s + a.bal, 0), { full: true }))}</span></div>
    </div>
    <div class="section-head"><h2>Distributions</h2></div><div class="card">
      <div class="kv"><span class="k">Paid to you since first run</span><span class="v">${priv(money(st.income))}</span></div>
      <div class="kv"><span class="k">Policy</span><span class="v">45% of profit distributed</span></div>
    </div>`;
  } else if (b && b.type === 'venture') {
    extra += `<div class="section-head"><h2>Company</h2></div><div class="card">
      <div class="kv"><span class="k">Stage</span><span class="v">${b.stage}${b.rounds ? ' · ' + b.rounds + ' round' + (b.rounds > 1 ? 's' : '') + ' since' : ''}</span></div>
      <div class="kv"><span class="k">Enterprise valuation</span><span class="v">${priv(money(b.valuation))}</span></div>
      <div class="kv"><span class="k">Your stake</span><span class="v">${(stakeOf(h) * 100).toFixed(1)}%${b.rounds ? ' (from ' + (h.biz.stake * 100).toFixed(0) + '%)' : ''} · ${priv(money(v))}</span></div>
      <div class="kv"><span class="k">Cash burn</span><span class="v">${b.burn > 0 ? priv(money(b.burn)) + ' / yr' : 'none'}</span></div>
      ${b.step === 0 && !b.dead ? `<div class="kv"><span class="k">You fund</span><span class="v">${priv(money(b.burn * (h.biz.ownerShare ?? 0.6)))} / yr${h.biz.offsetBy ? ' <span class="muted" style="font-weight:400">rest covered by ' + esc(h.biz.offsetBy) + '</span>' : ''}</span></div>` : ''}
      <div class="kv"><span class="k">Capital called from you</span><span class="v">${priv(money(b.funded || 0))}${b.step > 0 ? ' <span class="muted" style="font-weight:400">investors fund it now</span>' : ''}</span></div>
      <div class="kv"><span class="k">Burned since first run</span><span class="v">${priv(money(b.cashOut))}</span></div>
      <div class="kv"><span class="k">Headcount</span><span class="v">${b.headcount}</span></div>
      <div class="kv"><span class="k">Outside money raised</span><span class="v">${b.raised ? priv(money(b.raised)) : 'none — self-funded'}</span></div>
      <div class="kv"><span class="k">Current milestone</span><span class="v" style="font-weight:400;text-align:right">${esc(b.milestone)}</span></div>
      <div class="footnote">${b.dead ? 'Wound down. What is left is residual IP and equipment.'
        : 'Pre-revenue. Value moves in steps, when a new lead prices the company — and every round dilutes the stake that steps up. It pays no income and cannot be sold quickly.'}</div>
    </div>${milestoneCard(h)}`;
    extra += '';
  } else if (h.cls === 'realty' && h.qty === 1) {
    const noi = (held ? v : price) * h.yld;
    extra += `<div class="section-head"><h2>Property</h2></div><div class="card">
      <div class="kv"><span class="k">Type</span><span class="v">${esc(h.kind || '—')}</span></div>
      <div class="kv"><span class="k">Location</span><span class="v">${esc(h.venue)}</span></div>
      <div class="kv"><span class="k">Net operating income</span><span class="v">${priv(money(noi))} / yr</span></div>
      <div class="kv"><span class="k">Implied cap rate</span><span class="v">${(h.yld * 100).toFixed(2)}%</span></div>
      <div class="kv"><span class="k">Monthly cash flow</span><span class="v">${priv(money(noi / 12))}</span></div>
      ${held ? `<div class="kv"><span class="k">Rent collected since first run</span><span class="v">${priv(money(st.income))}</span></div>` : ''}
    </div>`;
  } else if (h.yld) {
    extra += `<div class="section-head"><h2>Income</h2></div><div class="card">
      <div class="kv"><span class="k">Yield</span><span class="v">${(h.yld * 100).toFixed(2)}%</span></div>
      <div class="kv"><span class="k">Annual income</span><span class="v">${priv(money((held ? v : price) * h.yld))}</span></div>
      ${held ? `<div class="kv"><span class="k">Received since first run</span><span class="v">${priv(money(st.income))}</span></div>` : ''}
    </div>`;
  }

  const posCard = held ? `<div class="grid2" style="margin-top:8px">
      <div class="card stat"><div class="k">Position</div><div class="v num">${priv(money(v))}</div><div class="s">${esc(fmtUnits(st.qty, h))}</div></div>
      <div class="card stat"><div class="k">Weight</div><div class="v num">${(100 * v / rawTotal()).toFixed(2)}%</div><div class="s">of net worth</div></div>
      <div class="card stat"><div class="k">Book cost</div><div class="v num">${priv(money(st.book))}</div><div class="s">${h.cls === 'cash' ? 'deposited' : 'average cost'}</div></div>
      <div class="card stat"><div class="k">${h.cls === 'cash' ? 'Accrued' : 'Unrealised'}</div><div class="v num ${cls(v - st.book)}">${priv(signed(v - st.book))}</div><div class="s">${pct((v - st.book) / (st.book || 1), 1)}</div></div>
    </div>` : `<div class="grid2" style="margin-top:8px">
      <div class="card stat"><div class="k">Not held</div><div class="v num">${money(price, { full: price < 10000 })}</div><div class="s">per ${unitWord(h).replace(/s$/, '') || 'unit'}</div></div>
      <div class="card stat"><div class="k">Buying power</div><div class="v num">${priv(money(cashAvailable()))}</div><div class="s">settlement cash</div></div>
    </div>`;

  $('#sheet-body').innerHTML = `
    <div class="hero" style="padding-top:8px">
      <div class="value num" style="font-size:30px">${held ? priv(money(v, { full: true, dec: 0 })) : money(price, { full: price < 10000 })}</div>
      <div class="deltarow"><span class="pill ${cls(c1)}">${pct(c1)} today</span><span class="pill ${cls(c7)}">${pct(c7)} week</span>
        ${held && h.cls !== 'cash' ? `<span class="muted">${esc(fmtUnits(st.qty, h))} @ ${money(price, { full: price < 10000 })}</span>` : ''}</div>
    </div>
    <div class="chartwrap">
      <canvas class="chart" id="chart-asset" height="150" style="height:150px"></canvas>
      <div class="ranges">${['1D', '1W', '1M', '1Y', 'ALL'].map(r => `<button data-srange="${r}" aria-selected="${r === sheetRange}">${r}</button>`).join('')}</div>
    </div>
    ${posCard}
    ${extra}
    ${h.note ? `<div class="card"><div class="eyebrow">Position note</div><div style="margin-top:6px;font-size:13px;color:var(--muted)">${esc(h.note)}</div></div>` : ''}
    <div class="card"><div class="eyebrow">Classification</div>
      <div class="kv" style="margin-top:4px"><span class="k">Asset class</span><span class="v" style="color:${CLASSES[h.cls].color}">${CLASSES[h.cls].name}</span></div>
      <div class="kv"><span class="k">Held at</span><span class="v">${esc(h.venue)}</span></div>
      <div class="kv"><span class="k">Expected return</span><span class="v">${(expectedReturn(h) * 100).toFixed(1)}% p.a.${distYield(h) ? ' <span class="muted" style="font-weight:400">(' + (h.mu * 100).toFixed(1) + '% growth + ' + (distYield(h) * 100).toFixed(1) + '% cash)</span>' : ''}</span></div>
      <div class="kv"><span class="k">Volatility</span><span class="v">${((h.sigma || 0) * 100).toFixed(0)}% p.a.</span></div>
      <div class="kv"><span class="k">Trading cost</span><span class="v">${(feeRate(h.cls) * 100).toFixed(2)}%</span></div>
    </div>`;
  drawChart($('#chart-asset'), assetSeries(h, sheetRange), { height: 150, color: c7 >= 0 ? '#2FE0A8' : '#FF5C7A' });
}

/* What the company is expected to do next — a round for a venture, a deal or a
   revaluation for an operating business. Timing is a hazard rate, not a schedule. */
function milestoneCard(h) {
  const n = nextMilestone(h);
  if (!n) return '';
  const when = n.years < 1.5 ? 'within a year or so' : n.years < 3 ? 'in a couple of years' : 'further out';
  return `<div class="card"><div class="eyebrow">${n.label} · ${when}</div>
    <div style="margin-top:6px;font-size:13.5px;font-weight:650">${esc(n.title)}</div>
    <div style="margin-top:4px;font-size:12.5px;color:var(--muted)">${esc(n.detail)}</div></div>`;
}

function renderProfile() {
  $('#sheet-foot').hidden = true;
  $('#sheet-title').innerHTML = `<div style="font-size:15px;font-weight:650">Account</div><div style="font-size:11.5px;color:var(--faint)">${esc(entityName())}</div>`;
  const totals = classTotals();
  $('#sheet-body').innerHTML = `
    <div class="card" style="display:flex;gap:14px;align-items:center">
      <span class="avatar" style="width:54px;height:54px;font-size:17px">${holderInitials()}</span>
      <span style="min-width:0"><span style="display:block;font-weight:650;font-size:16px">${esc(holderName())}</span>
      <span style="display:block;font-size:12px;color:var(--faint)">${PROFILE.tier} · client since ${PROFILE.since}</span></span>
    </div>
    <div class="section-head"><h2>Mandate</h2></div>
    <div class="card">
      <div class="kv"><span class="k">Account holder</span><span class="v">${esc(holderName())}</span></div>
      <div class="kv"><span class="k">Managed entity</span><span class="v">${esc(entityName())}</span></div>
      <div class="kv"><span class="k">Risk profile</span><span class="v">${PROFILE.risk}</span></div>
      <div class="kv"><span class="k">Reporting currency</span><span class="v">${S.settings.currency}</span></div>
      <div class="kv"><span class="k">Net worth under management</span><span class="v">${priv(money(total()))}</span></div>
      <div class="kv"><span class="k">Net deposits since first run</span><span class="v">${priv(signed(S.deposited))}</span></div>
    </div>
    <div class="section-head"><h2>Cash</h2></div>
    <div class="btnrow" style="margin-top:0">
      <button class="btn primary" data-trade="${CASH_ID}|deposit">Deposit funds</button>
      <button class="btn" data-trade="${CASH_ID}|withdraw">Withdraw</button>
    </div>
    <div class="section-head"><h2>Custodians</h2></div>
    <div class="card">
      ${[['Interactive Brokers', 'Equities, ETFs, settlement'], ['RBC Direct Investing', 'Registered accounts'], ['Self-custody (multisig)', 'Digital assets'],
         ['Zurich & Toronto vaults', 'Allocated metals'], [entityName(), 'Property, operating and venture holdings']]
        .map(c => `<div class="kv"><span class="k">${esc(c[0])}</span><span class="v" style="font-weight:400;color:var(--faint);font-size:12px">${esc(c[1])}</span></div>`).join('')}
    </div>
    <div class="section-head"><h2>Holdings by class</h2></div>
    <div class="card">${Object.keys(CLASSES).filter(k => totals[k] > 0).sort((a, b) => totals[b] - totals[a])
      .map(k => `<div class="kv"><span class="k"><span class="dot" style="background:${CLASSES[k].color};display:inline-block;margin-right:7px"></span>${CLASSES[k].name}</span><span class="v">${priv(money(totals[k]))}</span></div>`).join('')}</div>`;
}

/* ---------- trade sheet ---------- */
function openTrade(id, side) {
  tId = id; tSide = side; tInput = '';
  const h = meta(id);
  tMode = h.lot ? 'lots' : (S.holdings[id] && S.holdings[id].biz) ? 'pct' : (h.cls === 'realty' && side === 'sell') ? 'whole' : 'cad';
  renderTrade();
  $('#trade').hidden = false;
  haptic();
  setTimeout(() => { const el = $('#trade-input'); if (el) el.focus(); }, 60);
}
function closeTrade() { $('#trade').hidden = true; tId = null; render(); }

function tradeUnits() {
  const h = meta(tId), price = priceOf(tId), st = S.holdings[tId];
  const amt = parseFloat(String(tInput).replace(/[^0-9.]/g, '')) || 0;
  if (tMode === 'cad') return amt / (price * (tSide === 'buy' ? 1 + feeRate(h.cls) : 1));
  if (tMode === 'units') return amt;
  if (tMode === 'lots') return Math.floor(amt);
  if (tMode === 'pct') return st ? Math.min(st.qty, st.qty * amt / 100) : 0;
  if (tMode === 'whole') return st ? st.qty : 1;
  return amt;
}

function renderTrade() {
  const h = meta(tId), st = S.holdings[tId], price = priceOf(tId);
  const isCash = h.cls === 'cash';
  const isExternal = tSide === 'deposit' || tSide === 'withdraw';
  const units = isExternal ? 0 : tradeUnits();
  const q = isExternal ? null : quote(tId, tSide === 'buy' ? 'buy' : 'sell', units);
  const amt = parseFloat(String(tInput).replace(/[^0-9.]/g, '')) || 0;

  const verb = { buy: isCash ? 'Transfer in' : 'Buy', sell: isCash ? 'Transfer out' : 'Sell', deposit: 'Deposit', withdraw: 'Withdraw' }[tSide];
  $('#trade-title').innerHTML = `<div style="font-size:15px;font-weight:650">${verb} ${esc(h.sym)}</div>
    <div style="font-size:11.5px;color:var(--faint)">${esc(h.name)}${isExternal ? '' : ' · ' + money(price, { full: price < 10000 })}</div>`;

  const sideSwitch = isExternal || isCash ? '' : `
    <div class="seg big" style="margin-top:4px">
      <button data-tside="buy" aria-selected="${tSide === 'buy'}">Buy</button>
      <button data-tside="sell" class="sellside" aria-selected="${tSide === 'sell'}">Sell</button>
    </div>`;

  let inputBlock, quick = '', summary = '', warn = '';
  const cash = cashAvailable();

  if (tMode === 'whole') {
    inputBlock = `<div class="card" style="margin-top:14px"><div class="eyebrow">Whole-asset sale</div>
      <div style="margin-top:6px;font-size:13.5px;color:var(--muted)">A property sells in one piece. This disposes of ${esc(h.name)} in full at its current valuation.</div></div>`;
    summary = summaryRows(h, st ? st.qty : 1, q, 'sell');
  } else if (tMode === 'pct') {
    inputBlock = `<div class="amount"><input id="trade-input" inputmode="decimal" placeholder="0" value="${esc(tInput)}"><span class="cur">%</span></div>`;
    quick = [10, 25, 50, 100].map(p => `<button data-tquick="${p}">${p}%</button>`).join('');
    summary = summaryRows(h, units, q, 'sell');
    if (units > 0) warn = `<div class="footnote">Selling ${(units * 100 / (st.qty || 1)).toFixed(1)}% of your holding leaves you ${((st.qty - units) * 100 / 1).toFixed(1)}% of the original stake. A private sale settles at a ${(feeRate('private') * 100).toFixed(2)}% legal and advisory cost.</div>`;
  } else if (tMode === 'lots') {
    inputBlock = `<div class="amount"><input id="trade-input" inputmode="numeric" placeholder="0" value="${esc(tInput)}"><span class="cur">units</span></div>`;
    quick = [1, 2, 4].map(n => `<button data-tquick="${n}">${n} unit${n > 1 ? 's' : ''}</button>`).join('') + `<button data-tquick="max">Max</button>`;
    summary = summaryRows(h, units, q, tSide);
  } else {
    const curLabel = tMode === 'cad' ? sym() : unitWord(h);
    inputBlock = `<div class="amount">${tMode === 'cad' ? `<span class="cur">${curLabel}</span>` : ''}
      <input id="trade-input" inputmode="decimal" placeholder="0" value="${esc(tInput)}">
      ${tMode === 'cad' ? '' : `<span class="cur">${curLabel}</span>`}</div>`;
    quick = tSide === 'buy'
      ? [0.1, 0.25, 0.5].map(f => `<button data-tquick="${f}">${(f * 100).toFixed(0)}%</button>`).join('') + '<button data-tquick="max">Max</button>'
      : [0.25, 0.5, 1].map(f => `<button data-tquick="${f}">${f === 1 ? 'All' : (f * 100).toFixed(0) + '%'}</button>`).join('');
    summary = summaryRows(h, units, q, tSide);
  }

  if (isExternal) {
    inputBlock = `<div class="amount"><span class="cur">${sym()}</span><input id="trade-input" inputmode="decimal" placeholder="0" value="${esc(tInput)}"></div>`;
    quick = [50000, 250000, 1000000].map(n => `<button data-tquick="${n}">${money(n)}</button>`).join('');
    summary = `<div class="card">
      <div class="kv"><span class="k">Settlement cash now</span><span class="v">${money(cash, { full: true })}</span></div>
      <div class="kv"><span class="k">${tSide === 'deposit' ? 'Deposit' : 'Withdrawal'}</span><span class="v">${tSide === 'deposit' ? '+' : '−'}${money(amt, { full: true })}</span></div>
      <div class="kv"><span class="k">After</span><span class="v">${money(tSide === 'deposit' ? cash + amt : cash - amt, { full: true })}</span></div>
      <div class="footnote">External money in or out of the portfolio. It is tracked separately so it never shows up as investment performance.</div></div>`;
    if (tSide === 'withdraw' && amt > cash) warn = '<div class="warn">More than your settlement cash. Sell something or transfer from savings first.</div>';
  } else if (tSide === 'buy' && q && q.net > cash) {
    warn = `<div class="warn">${money(q.net)} needed, ${money(cash)} available in settlement cash.</div>`;
  } else if (tSide === 'sell' && st && units > st.qty + 1e-9) {
    warn = `<div class="warn">You only hold ${esc(fmtUnits(st.qty, h))}.</div>`;
  }

  $('#trade-body').innerHTML = `${sideSwitch}${inputBlock}
    ${quick ? `<div class="quickrow">${quick}</div>` : ''}
    ${summary}${warn}`;

  const btn = $('#trade-confirm');
  const ok = isExternal ? amt > 0 && !(tSide === 'withdraw' && amt > cash)
    : units > 0 && !(tSide === 'buy' && q.net > cash) && !(tSide === 'sell' && (!st || units > st.qty + 1e-9));
  btn.disabled = !ok;
  btn.className = 'btn ' + (tSide === 'sell' || tSide === 'withdraw' ? 'sell' : 'primary');
  btn.textContent = isExternal
    ? `${verb} ${money(amt, { full: true })}`
    : ok ? `${verb} ${fmtUnits(units, h)} · ${money(q.net, { full: true })}` : verb;
}

function summaryRows(h, units, q, side) {
  if (!q || !(units > 0)) return `<div class="card"><div class="kv"><span class="k">Buying power</span><span class="v">${money(cashAvailable(), { full: true })}</span></div>
    <div class="kv"><span class="k">Price</span><span class="v">${money(priceOf(h.id), { full: priceOf(h.id) < 10000 })}</span></div></div>`;
  const cash = cashAvailable();
  const after = side === 'buy' ? cash - q.net : cash + q.net;
  return `<div class="card">
    <div class="kv"><span class="k">${side === 'buy' ? 'Buying' : 'Selling'}</span><span class="v">${esc(fmtUnits(units, h))}</span></div>
    <div class="kv"><span class="k">Price</span><span class="v">${money(q.price, { full: q.price < 10000 })}</span></div>
    <div class="kv"><span class="k">Value</span><span class="v">${money(q.gross, { full: true })}</span></div>
    <div class="kv"><span class="k">Costs (${(feeRate(h.cls) * 100).toFixed(2)}%)</span><span class="v">${money(q.fee, { full: true })}</span></div>
    <div class="kv"><span class="k">${side === 'buy' ? 'Total cost' : 'Net proceeds'}</span><span class="v">${money(q.net, { full: true })}</span></div>
    <div class="kv"><span class="k">Settlement cash after</span><span class="v">${money(after, { full: true })}</span></div>
  </div>`;
}

function confirmTrade() {
  const h = meta(tId);
  if (tSide === 'deposit' || tSide === 'withdraw') {
    const amt = parseFloat(String(tInput).replace(/[^0-9.]/g, '')) || 0;
    const r = externalFlow(tSide === 'deposit' ? amt : -amt);
    if (!r.ok) return toast(r.why);
    toast(`${tSide === 'deposit' ? 'Deposited' : 'Withdrew'} ${money(amt)}`);
    haptic(18); closeTrade(); return;
  }
  const units = tradeUnits();
  const side = tSide === 'buy' ? 'buy' : 'sell';
  let r;
  if (h.cls === 'cash') {
    const amt = units * priceOf(tId);
    r = side === 'buy' ? transferCash(CASH_ID, tId, amt) : transferCash(tId, CASH_ID, amt);
    if (r.ok) toast('Transferred ' + money(amt));
  } else {
    r = trade(tId, side, units);
    if (r.ok) toast(`${side === 'buy' ? 'Bought' : 'Sold'} ${fmtUnits(units, h)}`);
  }
  if (!r.ok) return toast(r.why);
  haptic(18);
  closeTrade();
}

function quickFill(val) {
  const h = meta(tId), st = S.holdings[tId], price = priceOf(tId);
  if (tSide === 'deposit' || tSide === 'withdraw') { tInput = String(val); return renderTrade(); }
  if (tMode === 'pct') { tInput = String(val); return renderTrade(); }
  if (tMode === 'lots') {
    tInput = val === 'max' ? String(Math.floor(maxBuyUnits(tId))) : String(val);
    return renderTrade();
  }
  if (tSide === 'buy') {
    const cash = cashAvailable();
    const spend = val === 'max' ? cash : cash * val;
    tInput = tMode === 'cad' ? String(Math.floor(spend)) : String(+(spend / (price * (1 + feeRate(h.cls)))).toFixed(6));
  } else {
    const qty = st ? st.qty * (val === 'max' ? 1 : val) : 0;
    tInput = tMode === 'cad' ? String(Math.floor(qty * price)) : String(+qty.toFixed(6));
  }
  renderTrade();
}

function nameChanged() {
  if ($('#p-name')) $('#p-name').textContent = holderName();
  if ($('#p-entity')) $('#p-entity').textContent = entityName() + ' · ' + PROFILE.tier;
  paintIdentity();
  if (!$('#sheet').hidden && openAssetId === 'profile') renderProfile();
}

/* ---------- settings ---------- */
function toggleRow(label, hint, key) {
  return `<button class="item" data-toggle="${key}"><span class="lbl">${label}<span class="hint">${hint}</span></span>
    <span class="switch" role="switch" aria-checked="${!!S.settings[key]}"></span></button>`;
}
function segRow(label, hint, key, opts) {
  return `<div class="item"><span class="lbl">${label}<span class="hint">${hint}</span></span>
    <span class="seg">${opts.map(o => `<button data-set="${key}" data-val="${o[0]}" aria-selected="${S.settings[key] === o[0]}">${o[1]}</button>`).join('')}</span></div>`;
}

function renderSettings() {
  $('#app-version').textContent = 'v' + APP_VERSION;
  $('#p-name').textContent = holderName();
  $('#p-entity').textContent = entityName() + ' · ' + PROFILE.tier;
  paintIdentity();

  const editing = document.activeElement && (document.activeElement.id === 'holder-name' || document.activeElement.id === 'entity-name');
  if (!editing) $('#set-account').innerHTML =
    `<label class="item" for="holder-name"><span class="lbl">Account holder<span class="hint">Name on the profile and statements</span></span>
      <input id="holder-name" class="textfield" type="text" maxlength="40" autocomplete="name" autocapitalize="words" placeholder="${esc(PROFILE.name)}" value="${esc(S.settings.holderName || '')}"></label>
     <label class="item" for="entity-name"><span class="lbl">Managed entity<span class="hint">Holding company that owns the book</span></span>
      <input id="entity-name" class="textfield" type="text" maxlength="40" autocapitalize="words" placeholder="${esc(PROFILE.entity)}" value="${esc(S.settings.entityName || '')}"></label>`;

  $('#set-display').innerHTML =
    segRow('Currency', 'Converted at ' + PROFILE.fxUSD.toFixed(4) + ' USD/CAD', 'currency', [['CAD', 'CAD'], ['USD', 'USD']]) +
    toggleRow('Hide balances', 'Blur every figure from the top bar', 'hideBalances') +
    toggleRow('Abbreviate large numbers', '$1.24M instead of $1,240,000', 'compact') +
    toggleRow('Fill area under charts', 'Gradient fill on the net-worth chart', 'chartFill') +
    `<div class="item"><span class="lbl">Accent<span class="hint">Applies across the app</span></span>
      <span class="swatches">${[['violet', '#7C5CFF'], ['azure', '#3B82F6'], ['magenta', '#C74BE8'], ['emerald', '#14B88A']]
        .map(a => `<button class="swatch" data-accent="${a[0]}" style="background:${a[1]}" aria-selected="${S.settings.accent === a[0]}" aria-label="${a[0]}"></button>`).join('')}</span></div>` +
    toggleRow('Haptics', 'Short vibration on taps', 'haptics');

  const m = marketStatus(S.simTime);
  $('#set-sim').innerHTML =
    segRow('Price updates', 'How often values refresh while open', 'refresh', [['5', '5s'], ['30', '30s'], ['60', '1m'], ['300', '5m']]) +
    toggleRow('All-time-high line', 'Draw the running peak on the net-worth chart', 'hwmLine') +
    `<div class="item"><span class="lbl">Exchanges<span class="hint">${m.detail} · TSX, NYSE, NASDAQ</span></span><span class="val" style="color:${m.open ? 'var(--up)' : 'var(--muted)'}">${m.open ? 'Open' : 'Closed'}</span></div>
     <div class="item"><span class="lbl">Clock<span class="hint">Real time. Crypto trades 24/7; property and private companies revalue continuously; everything runs while the app is closed.</span></span><span class="val">1 : 1</span></div>`;

  $('#set-data').innerHTML =
    `<button class="item" data-act="export"><span class="lbl">Export data<span class="hint">Download this portfolio as JSON</span></span><span class="val">›</span></button>
     <button class="item" data-act="import"><span class="lbl">Import data<span class="hint">Restore from an exported file</span></span><span class="val">›</span></button>
     <button class="item" data-act="snapshot"><span class="lbl">Force a snapshot<span class="hint">Write the current value into history now</span></span><span class="val">›</span></button>
     <button class="item" data-act="reset"><span class="lbl danger">Reset portfolio<span class="hint">Return to the starting $60,000,000 and erase all history</span></span><span class="val">›</span></button>`;

  const days = (S.simTime - S.createdAt) / 86400000;
  $('#set-about').innerHTML =
    `<div class="item"><span class="lbl">Version<span class="hint">Strata Private Wealth</span></span><span class="val">${APP_VERSION}</span></div>
     <div class="item"><span class="lbl">Positions held<span class="hint">${ALL_ASSETS.length} instruments priced</span></span><span class="val">${owned().length}</span></div>
     <div class="item"><span class="lbl">Trades placed<span class="hint">Since first launch</span></span><span class="val">${S.trades.length}</span></div>
     <div class="item"><span class="lbl">Days tracked<span class="hint">Since first launch</span></span><span class="val">${days < 10 ? days.toFixed(1) : Math.floor(days)}</span></div>
     <div class="item"><span class="lbl">Storage used<span class="hint">Local to this device</span></span><span class="val">${(JSON.stringify(S).length / 1024).toFixed(0)} KB</span></div>`;
}

function exportData() {
  const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'strata-portfolio-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Exported');
}
function importData() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const p = JSON.parse(r.result);
        if (!p.holdings || !p.history) throw new Error('bad file');
        S = { ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}) } };
        S.lastReal = Date.now();
        save(); applyTheme(); paintIdentity(); render();
        toast('Portfolio restored');
      } catch (e) { toast("That file isn't a Strata export"); }
    };
    r.readAsText(f);
  };
  inp.click();
}
function resetAll() {
  if (!confirm('Reset the portfolio to its starting $60,000,000 and erase all history and trades? This cannot be undone.')) return;
  const keep = { ...S.settings };
  localStorage.removeItem(STORE_KEY);
  S = freshState(keep);
  heroShown = null;
  save(); applyTheme(); paintIdentity(); render();
  toast('Portfolio reset');
}

/* ---------- navigation ---------- */
function applyTheme() {
  document.documentElement.dataset.accent = S.settings.accent;
  const colors = { violet: '#07081A', azure: '#05070F', magenta: '#08040F', emerald: '#04100F' };
  document.querySelector('meta[name=theme-color]').content = colors[S.settings.accent] || '#07081A';
}
function go(v) {
  view = v; scrub = null;
  $$('.view').forEach(el => { el.hidden = el.id !== 'view-' + v; });
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v));
  $('#scroll').scrollTop = 0;
  render();
  haptic();
}
function render() {
  if (view === 'home') renderHome();
  else if (view === 'assets') renderAssets();
  else if (view === 'markets') renderMarkets();
  else if (view === 'insights') renderInsights();
  else if (view === 'activity') renderActivity();
  else if (view === 'settings') renderSettings();
  if (!$('#sheet').hidden) renderAsset();
  if (!$('#trade').hidden && tId) renderTrade();
}

/* ---------- events ---------- */
function wire() {
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]');
    if (b) { if (!$('#trade').hidden) closeTrade(); if (!$('#sheet').hidden) closeSheet(); go(b.dataset.view); }
  });

  document.body.addEventListener('click', e => {
    const tradeBtn = e.target.closest('[data-trade]');
    if (tradeBtn) { const [id, side] = tradeBtn.dataset.trade.split('|'); return openTrade(id, side); }

    const goto = e.target.closest('[data-goto]');
    if (goto) { if (!$('#sheet').hidden) closeSheet(); return go(goto.dataset.goto); }

    const asset = e.target.closest('[data-asset]');
    if (asset) return openAsset(asset.dataset.asset);

    const r = e.target.closest('[data-range]');
    if (r) {
      range = r.dataset.range; scrub = null;
      $$('#ranges button').forEach(b => b.setAttribute('aria-selected', b.dataset.range === range));
      haptic(); return renderHome();
    }
    const sr = e.target.closest('[data-srange]');
    if (sr) { sheetRange = sr.dataset.srange; haptic(); return renderAsset(); }

    const chip = e.target.closest('[data-class]');
    if (chip) { classFilter = chip.dataset.class; haptic(); return renderAssets(); }
    const mchip = e.target.closest('[data-mclass]');
    if (mchip) { marketFilter = mchip.dataset.mclass; haptic(); return renderMarkets(); }
    const afil = e.target.closest('[data-act-filter]');
    if (afil) { activityFilter = afil.dataset.actFilter; haptic(); return renderActivity(); }

    const tside = e.target.closest('[data-tside]');
    if (tside) {
      tSide = tside.dataset.tside; tInput = '';
      const h = meta(tId);
      tMode = h.lot ? 'lots' : (S.holdings[tId] && S.holdings[tId].biz) ? 'pct' : (h.cls === 'realty' && tSide === 'sell' && qtyOf(tId) > 0) ? 'whole' : 'cad';
      haptic(); return renderTrade();
    }
    const tq = e.target.closest('[data-tquick]');
    if (tq) { haptic(); return quickFill(tq.dataset.tquick === 'max' ? 'max' : parseFloat(tq.dataset.tquick)); }

    const tg = e.target.closest('[data-toggle]');
    if (tg) { S.settings[tg.dataset.toggle] = !S.settings[tg.dataset.toggle]; save(); haptic(12); return render(); }

    const set = e.target.closest('[data-set]');
    if (set) {
      S.settings[set.dataset.set] = set.dataset.val;
      save(); haptic(12);
      if (set.dataset.set === 'refresh') { scheduleRefresh(); toast('Updating every ' + ({ 5: '5 seconds', 30: '30 seconds', 60: 'minute', 300: '5 minutes' }[set.dataset.val])); }
      return render();
    }
    const acc = e.target.closest('.swatch[data-accent]');
    if (acc) { S.settings.accent = acc.dataset.accent; save(); applyTheme(); haptic(); return render(); }

    const act = e.target.closest('[data-act]');
    if (act) {
      const a = act.dataset.act;
      if (a === 'export') return exportData();
      if (a === 'import') return importData();
      if (a === 'reset') return resetAll();
      if (a === 'snapshot') { snapshot(); save(); toast('Snapshot written'); return render(); }
    }
  });

  document.body.addEventListener('input', e => {
    if (e.target.id === 'trade-input') { tInput = e.target.value; return renderTradeLive(); }
    if (e.target.id === 'market-search') { marketQuery = e.target.value; return renderMarkets(); }
    if (e.target.id === 'holder-name') { S.settings.holderName = e.target.value; nameChanged(); }
    if (e.target.id === 'entity-name') { S.settings.entityName = e.target.value; nameChanged(); }
  });
  document.body.addEventListener('change', e => {
    if (e.target.id !== 'holder-name' && e.target.id !== 'entity-name') return;
    const key = e.target.id === 'holder-name' ? 'holderName' : 'entityName';
    S.settings[key] = e.target.value.trim().replace(/\s+/g, ' ');
    e.target.value = S.settings[key];
    nameChanged(); save(); haptic();
    toast(S.settings[key] ? 'Saved' : 'Reset to default');
  });
  document.body.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'holder-name' || e.target.id === 'entity-name' || e.target.id === 'market-search') e.target.blur();
    if (e.target.id === 'trade-input') { e.preventDefault(); if (!$('#trade-confirm').disabled) confirmTrade(); }
  });

  $('#trade-close').addEventListener('click', closeTrade);
  $('#trade-confirm').addEventListener('click', confirmTrade);
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#btn-activity').addEventListener('click', () => { if (!$('#sheet').hidden) closeSheet(); go('activity'); });
  $('#btn-privacy').addEventListener('click', () => {
    S.settings.hideBalances = !S.settings.hideBalances;
    $('#btn-privacy').setAttribute('aria-pressed', S.settings.hideBalances);
    heroShown = null;
    save(); haptic(12); render();
    toast(S.settings.hideBalances ? 'Balances hidden' : 'Balances shown');
  });
  const openAccount = () => { openAssetId = 'profile'; renderProfile(); $('#sheet').hidden = false; haptic(); };
  $('#btn-profile').addEventListener('click', openAccount);
  $('#profile-card').addEventListener('click', openAccount);
  $('#hero-value').addEventListener('click', () => { refreshNow(); scheduleRefresh(); haptic(); toast('Updated'); });

  const cv = $('#chart-main');
  const at = e => {
    const rect = cv.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pts = seriesFor(range);
    scrub = Math.max(0, Math.min(pts.length - 1, Math.round((x - 4) / (rect.width - 8) * (pts.length - 1))));
    drawChart(cv, pts, { hwm: S.settings.hwmLine, scrub });
  };
  cv.addEventListener('touchstart', at, { passive: true });
  cv.addEventListener('touchmove', at, { passive: true });
  cv.addEventListener('touchend', () => { scrub = null; renderHome(); });
  cv.addEventListener('mousemove', at);
  cv.addEventListener('mouseleave', () => { scrub = null; renderHome(); });

  window.addEventListener('resize', () => render());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { advance(Date.now() - S.lastReal); lastUpdated = Date.now(); render(); scheduleRefresh(); }
  });
  window.addEventListener('pagehide', persistNow);
}

/* Redraw the trade sheet without stealing focus from the number field. */
function renderTradeLive() {
  const el = $('#trade-input');
  const pos = el ? el.selectionStart : null;
  renderTrade();
  const el2 = $('#trade-input');
  if (el2) { el2.focus(); try { el2.setSelectionRange(pos ?? el2.value.length, pos ?? el2.value.length); } catch (e) {} }
}

/* ---------- refresh loop ---------- */
function refreshNow() {
  const changed = advance(Date.now() - S.lastReal);
  lastUpdated = Date.now();
  if (changed && !document.hidden) {
    if (view === 'home' && scrub == null) renderHome();
    else if (view === 'assets') renderAssets();
    else if (view === 'markets') renderMarkets();
    else if (view === 'insights') renderInsights();
    if (!$('#sheet').hidden && openAssetId && openAssetId !== 'profile') renderAsset();
  }
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  const secs = Math.max(5, +S.settings.refresh || 30);
  refreshTimer = setTimeout(() => { refreshNow(); scheduleRefresh(); }, secs * 1000);
}

/* ---------- boot ---------- */
S = load();
applyTheme();
paintIdentity();
$('#btn-privacy').setAttribute('aria-pressed', S.settings.hideBalances);
advance(Date.now() - S.lastReal);
wire();
go('home');
scheduleRefresh();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
