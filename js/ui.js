/* Strata — UI layer */

const APP_VERSION = '1.2.1';
let view = 'home';
let range = '1M';
let classFilter = 'all';
let openAssetId = null;
let sheetRange = '1M';
let scrub = null;
let refreshTimer = null, lastUpdated = Date.now();

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---------- formatting ---------- */
function fx(v) { return S.settings.currency === 'USD' ? v * PROFILE.fxUSD : v; }
function sym() { return S.settings.currency === 'USD' ? 'US$' : '$'; }

function fmtMoneyPlain(v) {
  return '$' + Math.round(v).toLocaleString('en-CA');
}
function money(v, opts = {}) {
  const val = fx(v);
  const abs = Math.abs(val);
  if (S.settings.compact && !opts.full && abs >= 10000) {
    let s;
    if (abs >= 1e9) s = (val / 1e9).toFixed(2) + 'B';
    else if (abs >= 1e6) s = (val / 1e6).toFixed(2) + 'M';
    else s = (val / 1e3).toFixed(1) + 'K';
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

function relTime(t) {
  const d = (S.simTime - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  if (d < 604800) return Math.floor(d / 86400) + 'd ago';
  return new Date(t).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
}
function simDate() {
  return new Date(S.simTime).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function haptic(ms = 8) { if (S.settings.haptics && navigator.vibrate) navigator.vibrate(ms); }

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- chart ---------- */
function drawChart(canvas, pts, opts = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const w = canvas.clientWidth, h = opts.height || canvas.clientHeight || 190;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  if (pts.length < 2) return;

  const padT = 14, padB = 18, padX = 6;
  const ys = pts.map(p => p[1]);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < hi * 0.0008) { hi = hi * 1.0008; lo = lo * 0.9992; }
  const spread = hi - lo;
  lo -= spread * 0.12; hi += spread * 0.12;
  const X = i => padX + (i / (pts.length - 1)) * (w - padX * 2);
  const Y = v => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent-2').trim() || '#4C8DFF';
  const accent1 = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7C5CFF';

  // baseline grid
  c.strokeStyle = 'rgba(255,255,255,.05)';
  c.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = padT + (i / 3) * (h - padT - padB);
    c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
  }

  // high-water staircase
  if (opts.hwm) {
    let run = -Infinity;
    c.setLineDash([3, 4]);
    c.strokeStyle = 'rgba(227,179,65,.55)';
    c.lineWidth = 1.2;
    c.beginPath();
    pts.forEach((p, i) => {
      run = Math.max(run, p[1]);
      const x = X(i), y = Y(run);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    });
    c.stroke();
    c.setLineDash([]);
  }

  // area fill
  if (S.settings.chartFill) {
    const g = c.createLinearGradient(0, padT, 0, h);
    g.addColorStop(0, hexA(accent1, .34));
    g.addColorStop(1, hexA(accent1, 0));
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(X(0), h);
    pts.forEach((p, i) => c.lineTo(X(i), Y(p[1])));
    c.lineTo(X(pts.length - 1), h);
    c.closePath(); c.fill();
  }

  // line
  const lg = c.createLinearGradient(0, 0, w, 0);
  lg.addColorStop(0, accent1); lg.addColorStop(1, accent);
  c.strokeStyle = opts.color || lg;
  c.lineWidth = 2; c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath();
  pts.forEach((p, i) => { const x = X(i), y = Y(p[1]); i === 0 ? c.moveTo(x, y) : c.lineTo(x, y); });
  c.stroke();

  // last point
  const lx = X(pts.length - 1), ly = Y(pts[pts.length - 1][1]);
  c.fillStyle = opts.color || accent;
  c.shadowColor = opts.color || accent; c.shadowBlur = 12;
  c.beginPath(); c.arc(lx, ly, 3.4, 0, 7); c.fill();
  c.shadowBlur = 0;

  // scrub crosshair
  if (opts.scrub != null && opts.scrub >= 0 && opts.scrub < pts.length) {
    const i = opts.scrub, x = X(i), y = Y(pts[i][1]);
    c.strokeStyle = 'rgba(255,255,255,.25)'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(x, padT - 8); c.lineTo(x, h - padB + 6); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 3.2, 0, 7); c.fill();
    const label = money(pts[i][1], { full: !S.settings.compact });
    const date = new Date(pts[i][0]).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    c.font = '600 11px ' + getComputedStyle(document.body).fontFamily;
    const txt = priv(label) + '  ' + date;
    const tw = c.measureText(txt).width;
    let bx = Math.max(2, Math.min(w - tw - 12, x - tw / 2 - 5));
    c.fillStyle = 'rgba(20,22,58,.95)';
    roundRect(c, bx, 0, tw + 10, 18, 6); c.fill();
    c.fillStyle = '#ECEEFF';
    c.fillText(txt, bx + 5, 12.5);
  }
}
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function hexA(hex, a) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map(x => x + x).join('') : m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function sparkline(hm, w = 46, h = 22) {
  const pts = assetSeries(hm, '1W').map(p => p[1]);
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const rg = hi - lo || 1;
  const d = pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - 2 - ((v - lo) / rg) * (h - 4)}`).join(' L');
  const up = pts[pts.length - 1] >= pts[0];
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="M${d}" fill="none" stroke="${up ? 'var(--up)' : 'var(--down)'}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity=".9"/></svg>`;
}

/* ---------- donut ---------- */
function renderDonut() {
  const totals = classTotals();
  const t = Object.values(totals).reduce((a, b) => a + b, 0);
  const order = Object.keys(CLASSES).sort((a, b) => totals[b] - totals[a]);
  let ang = -Math.PI / 2;
  let svg = '<circle cx="60" cy="60" r="46" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="15"/>';
  for (const k of order) {
    const frac = totals[k] / t;
    if (frac <= 0) continue;
    const a2 = ang + frac * Math.PI * 2 - 0.035;
    const large = frac > 0.5 ? 1 : 0;
    const x1 = 60 + 46 * Math.cos(ang), y1 = 60 + 46 * Math.sin(ang);
    const x2 = 60 + 46 * Math.cos(a2), y2 = 60 + 46 * Math.sin(a2);
    svg += `<path d="M${x1.toFixed(2)} ${y1.toFixed(2)} A46 46 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" fill="none" stroke="${CLASSES[k].color}" stroke-width="15" stroke-linecap="butt"/>`;
    ang += frac * Math.PI * 2;
  }
  svg += `<text x="60" y="56" text-anchor="middle" font-size="9" fill="#5D6493" letter-spacing="1">CLASSES</text>`;
  svg += `<text x="60" y="72" text-anchor="middle" font-size="19" font-weight="700" fill="#ECEEFF">${order.filter(k => totals[k] > 0).length}</text>`;
  $('#donut').innerHTML = svg;

  $('#alloc-list').innerHTML = order.map(k => `
    <div class="alloc-row">
      <span class="dot" style="background:${CLASSES[k].color}"></span>
      <span class="nm">${CLASSES[k].short}</span>
      <span class="pc">${(100 * totals[k] / t).toFixed(1)}%</span>
    </div>`).join('');
}

/* ---------- rows ---------- */
function holdingRow(h) {
  const st = S.holdings[h.id];
  const v = valueOf(h);
  const c1 = chg(h.id, 'd1');
  const isUnit = h.qty > 1 && h.cls !== 'realty' && !h.biz;
  const sub = isUnit
    ? `${h.qty.toLocaleString()} ${h.cls === 'metals' ? 'oz' : h.cls === 'crypto' ? h.sym : 'units'} · ${money(st.price, { full: st.price < 10000 })}`
    : (h.venue || CLASSES[h.cls].short);
  return `<button class="row" data-asset="${h.id}">
    <span class="tick" style="color:${CLASSES[h.cls].color}">${h.sym.slice(0, 6)}</span>
    <span class="mid"><span class="nm">${h.name}</span><span class="sub">${sub}</span></span>
    ${sparkline(h)}
    <span class="right"><span class="val">${priv(money(v))}</span><br><span class="chg ${cls(c1)}">${pct(c1)}</span></span>
  </button>`;
}

/* ---------- home ---------- */
let heroShown = null, heroRaf = null;
function tweenHero(target) {
  const el = $('#hero-value');
  const paint = v => { el.innerHTML = priv(money(v, { full: true, dec: 0 })); };
  cancelAnimationFrame(heroRaf);
  const from = heroShown;
  if (from == null || S.settings.hideBalances || Math.abs(target - from) < 1 ||
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    heroShown = target; return paint(target);
  }
  const t0 = performance.now(), dur = 700;
  const frame = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    heroShown = from + (target - from) * e;
    paint(heroShown);
    if (k < 1) heroRaf = requestAnimationFrame(frame);
  };
  heroRaf = requestAnimationFrame(frame);
}

function renderHome() {
  const t = total();
  const ch = portfolioChange(range);
  tweenHero(t);
  const pill = $('#hero-chg');
  pill.className = 'pill ' + cls(ch.abs);
  pill.textContent = `${signed(ch.abs)} · ${pct(ch.pct)}`;
  $('#hero-chg-range').textContent = { '1D': 'past 24h', '1W': 'past week', '1M': 'past month', '1Y': 'past year', 'ALL': 'since ' + new Date(S.history[0][0]).getFullYear() }[range];
  const ms = marketStatus(S.simTime);
  const upd = new Date(lastUpdated).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  $('#hero-clock').innerHTML = `· <span style="color:${ms.open ? 'var(--up)' : 'var(--faint)'}">●</span> ${ms.label} · as of ${upd}`;
  const dd = drawdownFree();
  const pillHW = $('#hero-hw');
  pillHW.textContent = dd < 0.0015 ? 'At all-time high' : `${(dd * 100).toFixed(1)}% below peak`;
  pillHW.className = 'pill ' + (dd < 0.0015 ? 'ath' : dd > 0.08 ? 'down' : '');

  drawChart($('#chart-main'), seriesFor(range), { hwm: S.settings.hwmLine, scrub });

  const totals = classTotals();
  const liquid = totals.cash + totals.etf + totals.equity + totals.crypto;
  const book = SEED_HOLDINGS.reduce((s, h) => s + S.holdings[h.id].book, 0);
  $('#s-income').textContent = priv(money(incomeRunRate()));
  $('#s-liquid').textContent = priv(money(liquid));
  $('#s-liquid-pc').textContent = (100 * liquid / rawTotal()).toFixed(0) + '% of total';
  const gain = rawTotal() - book;
  $('#s-gain').textContent = priv(signed(gain));
  $('#s-gain').className = 'v num ' + cls(gain);
  $('#s-gain-pc').textContent = pct(gain / book, 1) + ' vs cost';

  renderDonut();

  const movers = SEED_HOLDINGS.filter(h => h.cls !== 'cash')
    .map(h => ({ h, c: chg(h.id, 'd1') }))
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 5);
  $('#movers').innerHTML = movers.map(m => holdingRow(m.h)).join('');

  $('#home-activity').innerHTML = S.events.slice(0, 4).map(eventRow).join('') || '<div class="muted" style="padding:8px 4px">Nothing yet. The market opens as soon as you leave this screen.</div>';
}

const EV_ICON = { ath: '◆', income: '↓', up: '▲', down: '▼', note: '•', trade: '⇄' };
function eventRow(e) {
  const color = e.kind === 'up' || e.kind === 'income' ? 'var(--up)' : e.kind === 'down' ? 'var(--down)' : 'var(--accent-2)';
  return `<div class="ins">
    <span class="ico" style="color:${color}">${EV_ICON[e.kind] || '•'}</span>
    <span style="flex:1"><span class="t">${e.title}</span><span class="b">${e.body}</span><span class="time">${relTime(e.t)}</span></span>
  </div>`;
}

/* ---------- assets ---------- */
function renderAssets() {
  const totals = classTotals();
  $('#assets-total').textContent = priv(money(rawTotal()));
  const keys = ['all', ...Object.keys(CLASSES)];
  $('#class-chips').innerHTML = keys.map(k => {
    const label = k === 'all' ? 'All' : CLASSES[k].short;
    const n = k === 'all' ? SEED_HOLDINGS.length : SEED_HOLDINGS.filter(h => h.cls === k).length;
    return `<button data-class="${k}" aria-selected="${classFilter === k}">${label} ${n}</button>`;
  }).join('');

  const list = SEED_HOLDINGS.filter(h => classFilter === 'all' || h.cls === classFilter)
    .sort((a, b) => valueOf(b) - valueOf(a));

  let html = '';
  if (classFilter === 'all') {
    for (const k of Object.keys(CLASSES).sort((a, b) => totals[b] - totals[a])) {
      const hs = list.filter(h => h.cls === k);
      if (!hs.length) continue;
      html += `<div class="section-head" style="margin:14px 2px 4px"><h2 style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${CLASSES[k].color}">${CLASSES[k].name}</h2><span class="link num">${priv(money(totals[k]))} · ${(100 * totals[k] / rawTotal()).toFixed(1)}%</span></div>`;
      html += hs.map(holdingRow).join('');
    }
  } else {
    html = list.map(holdingRow).join('');
  }
  $('#holdings-list').innerHTML = html;
}

/* ---------- insights ---------- */
function renderInsights() {
  $('#insights-date').textContent = simDate();
  const totals = classTotals();
  const t = rawTotal();

  // narrative insights, derived from live state
  const ins = [];
  const top = SEED_HOLDINGS.map(h => ({ h, v: valueOf(h) })).sort((a, b) => b.v - a.v)[0];
  const topW = top.v / t;
  ins.push({ i: '◆', t: 'Largest single position', b: `${top.h.name} is ${(topW * 100).toFixed(1)}% of the book at ${priv(money(top.v))}. A private-client desk would flag anything above 8% in one name.` });

  const cash = totals.cash;
  ins.push({
    i: '⌁', t: cash / t > 0.06 ? 'Cash drag building' : 'Cash near target',
    b: `${priv(money(cash))} sits in cash and short fixed income — ${(100 * cash / t).toFixed(1)}% against a 5% target. ${cash / t > 0.06 ? 'Roughly ' + priv(money(cash - t * 0.05)) + ' could be deployed into the bond or EAFE sleeve.' : 'No action needed this quarter.'}`
  });

  const cryptoW = totals.crypto / t;
  ins.push({
    i: '⚠', t: cryptoW > 0.11 ? 'Digital assets above band' : 'Digital assets in band',
    b: `Crypto is ${(cryptoW * 100).toFixed(1)}% of net worth (band: 6–11%). It contributes about ${((0.62 * totals.crypto / t) / portfolioVol() * 100).toFixed(0)}% of total portfolio volatility from ${(cryptoW * 100).toFixed(0)}% of the capital.`
  });

  const illiquid = (totals.realty + totals.private) / t;
  ins.push({ i: '⧗', t: 'Liquidity profile', b: `${(illiquid * 100).toFixed(0)}% of the portfolio is illiquid — property and private companies that need months, not minutes, to sell. Coverage of one year of operating expenses is met ${(cash / 1400000).toFixed(1)}× over.` });

  ins.push({ i: '↑', t: 'Income covers the base', b: `Yield, rent and business distributions run at ${priv(money(incomeRunRate()))} a year — roughly ${priv(money(incomeRunRate() / 12))} a month landing in settlement cash before any asset is sold.` });

  $('#insight-cards').innerHTML = ins.map(x => `<div class="ins"><span class="ico">${x.i}</span><span style="flex:1"><span class="t">${x.t}</span><span class="b">${x.b}</span></span></div>`).join('');

  // class performance bars
  const perf = Object.keys(CLASSES).map(k => {
    const hs = SEED_HOLDINGS.filter(h => h.cls === k);
    const v = hs.reduce((s, h) => s + valueOf(h), 0);
    const w1 = hs.reduce((s, h) => s + h.qty * basePrice(h.id, 'w1'), 0);
    return { k, v, c: w1 ? (v - w1) / w1 : 0 };
  }).sort((a, b) => b.c - a.c);
  const mx = Math.max(...perf.map(p => Math.abs(p.c)), 0.01);
  $('#class-perf').innerHTML = perf.map(p => `
    <div style="padding:9px 0">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px">
        <span><span class="dot" style="background:${CLASSES[p.k].color};display:inline-block;margin-right:7px"></span>${CLASSES[p.k].name}</span>
        <span class="${cls(p.c)}" style="font-weight:700">${pct(p.c)}</span>
      </div>
      <div class="bar"><i style="width:${Math.max(2, 100 * Math.abs(p.c) / mx)}%;background:${p.c >= 0 ? 'var(--up)' : 'var(--down)'}"></i></div>
    </div>`).join('') + `<div class="footnote">Weekly change by class, position-weighted.</div>`;

  // risk
  const vol = portfolioVol();
  const eq = (totals.equity + totals.etf + totals.crypto + totals.private) / t;
  const hhi = SEED_HOLDINGS.reduce((s, h) => s + Math.pow(valueOf(h) / t, 2), 0);
  $('#risk-card').innerHTML = `
    <div class="kv"><span class="k">Est. portfolio volatility</span><span class="v">${(vol * 100).toFixed(1)}% p.a.</span></div>
    <div class="kv"><span class="k">Growth / defensive split</span><span class="v">${(eq * 100).toFixed(0)} / ${(100 - eq * 100).toFixed(0)}</span></div>
    <div class="kv"><span class="k">Concentration (HHI)</span><span class="v">${(hhi * 10000).toFixed(0)} · ${hhi < 0.06 ? 'diversified' : 'concentrated'}</span></div>
    <div class="kv"><span class="k">Positions</span><span class="v">${SEED_HOLDINGS.length} across ${Object.keys(CLASSES).length} classes</span></div>
    <div class="kv"><span class="k">Drawdown from peak</span><span class="v">${(drawdownFree() * 100).toFixed(2)}%</span></div>
    <div class="kv"><span class="k">Peak net worth</span><span class="v">${priv(money(S.ath))} · ${S.athAt ? relTime(S.athAt) : '—'}</span></div>`;

  // income
  const inc = Object.keys(CLASSES).map(k => {
    const hs = SEED_HOLDINGS.filter(h => h.cls === k);
    const a = hs.reduce((s, h) => s + (h.biz ? S.holdings[h.id].biz.revenue * S.holdings[h.id].biz.margin * h.biz.stake * 0.45 : valueOf(h) * (h.yld || 0)), 0);
    return { k, a };
  }).filter(x => x.a > 0).sort((a, b) => b.a - a.a);
  const inct = inc.reduce((s, x) => s + x.a, 0);
  $('#income-card').innerHTML = inc.map(x => `
    <div class="kv"><span class="k"><span class="dot" style="background:${CLASSES[x.k].color};display:inline-block;margin-right:7px"></span>${CLASSES[x.k].short}</span>
    <span class="v">${priv(money(x.a))} <span class="muted" style="font-weight:400">${(100 * x.a / inct).toFixed(0)}%</span></span></div>`).join('') +
    `<div class="kv"><span class="k" style="font-weight:650;color:var(--text)">Total annual income</span><span class="v">${priv(money(inct))}</span></div>
     <div class="footnote">Paid into brokerage settlement cash as it accrues. Accrued since first run: ${priv(money(S.incomeTotal))}.</div>`;

  // businesses
  $('#biz-card').innerHTML = SEED_HOLDINGS.filter(h => h.biz).map(h => {
    const b = S.holdings[h.id].biz;
    const ebitda = b.revenue * b.margin;
    return `<button class="row" data-asset="${h.id}">
      <span class="tick" style="color:${CLASSES.private.color}">${h.sym}</span>
      <span class="mid"><span class="nm">${h.name}</span><span class="sub">${priv(money(b.revenue))} revenue · ${(b.margin * 100).toFixed(1)}% margin · ${b.multiple.toFixed(1)}× EBITDA</span></span>
      <span class="right"><span class="val">${priv(money(valueOf(h)))}</span><br><span class="chg muted">${(h.biz.stake * 100).toFixed(0)}% owned</span></span>
    </button>`;
  }).join('');
}

/* ---------- activity ---------- */
function renderActivity() {
  $('#activity-count').textContent = S.events.length + ' events';
  $('#activity-list').innerHTML = S.events.map(eventRow).join('') ||
    '<div class="muted" style="padding:10px 4px">No activity recorded yet.</div>';
}

/* ---------- asset detail ---------- */
function openAsset(id) {
  openAssetId = id; sheetRange = '1M';
  renderAsset();
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  haptic();
}
function closeSheet() {
  $('#sheet').hidden = true; openAssetId = null;
  document.body.style.overflow = '';
}

function renderAsset() {
  if (!openAssetId) return;
  if (openAssetId === 'profile') return renderProfile();
  const h = meta(openAssetId), st = S.holdings[h.id];
  const v = valueOf(h), c1 = chg(h.id, 'd1'), c7 = chg(h.id, 'w1');
  const gain = v - st.book;

  $('#sheet-title').innerHTML = `<div style="font-size:15px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h.name}</div>
    <div style="font-size:11.5px;color:var(--faint)">${h.sym} · ${h.venue}</div>`;

  const unitLine = h.qty === 1
    ? `<div class="muted" style="font-size:12.5px">${h.kind || CLASSES[h.cls].name} · ${h.venue}</div>`
    : `<div class="muted" style="font-size:12.5px">${h.qty.toLocaleString()} ${h.cls === 'metals' ? 'oz' : 'units'} × ${money(st.price, { full: st.price < 10000 })}</div>`;

  let extra = '';
  if (st.biz) {
    const b = st.biz, m = h.biz;
    const ebitda = b.revenue * b.margin;
    extra += `<div class="section-head"><h2>Company performance</h2></div><div class="card">
      <div class="kv"><span class="k">Revenue (annualised)</span><span class="v">${priv(money(b.revenue))}</span></div>
      <div class="kv"><span class="k">EBITDA margin</span><span class="v">${(b.margin * 100).toFixed(1)}%</span></div>
      <div class="kv"><span class="k">EBITDA</span><span class="v">${priv(money(ebitda))}</span></div>
      <div class="kv"><span class="k">Applied multiple</span><span class="v">${b.multiple.toFixed(2)}×</span></div>
      <div class="kv"><span class="k">Enterprise value</span><span class="v">${priv(money(ebitda * b.multiple))}</span></div>
      <div class="kv"><span class="k">Your stake</span><span class="v">${(m.stake * 100).toFixed(0)}% · ${priv(money(v))}</span></div>
      <div class="kv"><span class="k">Headcount</span><span class="v">${m.headcount}</span></div>
      <div class="kv"><span class="k">YTD revenue / profit</span><span class="v">${priv(money(b.ytdRevenue))} / ${priv(money(b.ytdProfit))}</span></div>
    </div>
    <div class="section-head"><h2>Company accounts</h2></div><div class="card">
      ${b.accounts.map(a => `<div class="kv"><span class="k">${a.name}</span><span class="v">${priv(money(a.bal, { full: true }))}</span></div>`).join('')}
      <div class="kv"><span class="k" style="color:var(--text);font-weight:650">Cash on hand</span><span class="v">${priv(money(b.accounts.reduce((s, a) => s + a.bal, 0), { full: true }))}</span></div>
    </div>
    <div class="section-head"><h2>Distributions</h2></div><div class="card">
      <div class="kv"><span class="k">Paid to you since first run</span><span class="v">${priv(money(st.income))}</span></div>
      <div class="kv"><span class="k">Policy</span><span class="v">45% of profit distributed</span></div>
    </div>`;
  } else if (h.cls === 'realty' && h.qty === 1) {
    const noi = v * h.yld;
    extra += `<div class="section-head"><h2>Property</h2></div><div class="card">
      <div class="kv"><span class="k">Type</span><span class="v">${h.kind}</span></div>
      <div class="kv"><span class="k">Location</span><span class="v">${h.venue}</span></div>
      <div class="kv"><span class="k">Net operating income</span><span class="v">${priv(money(noi))} / yr</span></div>
      <div class="kv"><span class="k">Implied cap rate</span><span class="v">${(h.yld * 100).toFixed(2)}%</span></div>
      <div class="kv"><span class="k">Monthly cash flow</span><span class="v">${priv(money(noi / 12))}</span></div>
      <div class="kv"><span class="k">Rent collected since first run</span><span class="v">${priv(money(st.income))}</span></div>
    </div>`;
  } else if (h.yld) {
    extra += `<div class="section-head"><h2>Income</h2></div><div class="card">
      <div class="kv"><span class="k">Yield</span><span class="v">${(h.yld * 100).toFixed(2)}%</span></div>
      <div class="kv"><span class="k">Annual income</span><span class="v">${priv(money(v * h.yld))}</span></div>
      <div class="kv"><span class="k">Received since first run</span><span class="v">${priv(money(st.income))}</span></div>
    </div>`;
  }

  $('#sheet-body').innerHTML = `
    <div class="hero" style="padding-top:2px">
      <div class="value num" style="font-size:32px">${priv(money(v, { full: true, dec: 0 }))}</div>
      <div class="deltarow"><span class="pill ${cls(c1)}">${pct(c1)} today</span><span class="pill ${cls(c7)}">${pct(c7)} week</span></div>
      ${unitLine}
    </div>
    <div class="chartwrap">
      <canvas class="chart" id="chart-asset" height="160" style="height:160px"></canvas>
      <div class="ranges" id="sheet-ranges">
        ${['1D', '1W', '1M', '1Y', 'ALL'].map(r => `<button data-srange="${r}" aria-selected="${r === sheetRange}">${r}</button>`).join('')}
      </div>
    </div>
    <div class="grid2" style="margin-top:8px">
      <div class="card tight stat"><div class="k">Weight</div><div class="v num">${(100 * v / rawTotal()).toFixed(2)}%</div><div class="s">of net worth</div></div>
      <div class="card tight stat"><div class="k">Volatility</div><div class="v num">${((h.sigma || 0) * 100).toFixed(0)}%</div><div class="s">annualised</div></div>
      <div class="card tight stat"><div class="k">Book cost</div><div class="v num">${priv(money(st.book))}</div><div class="s">${h.cls === 'cash' ? 'deposited' : 'all-in basis'}</div></div>
      <div class="card tight stat"><div class="k">${h.cls === 'cash' ? 'Accrued' : 'Unrealised'}</div><div class="v num ${cls(gain)}">${priv(signed(gain))}</div><div class="s">${pct(gain / st.book, 1)}</div></div>
    </div>
    ${extra}
    ${h.note && !st.biz ? `<div class="card"><div class="eyebrow">Position note</div><div style="margin-top:6px;font-size:13px;color:var(--muted)">${h.note}</div></div>` : ''}
    <div class="card"><div class="eyebrow">Classification</div>
      <div class="kv" style="margin-top:4px"><span class="k">Asset class</span><span class="v" style="color:${CLASSES[h.cls].color}">${CLASSES[h.cls].name}</span></div>
      <div class="kv"><span class="k">Held at</span><span class="v">${h.venue}</span></div>
      <div class="kv"><span class="k">Expected return</span><span class="v">${(h.mu * 100).toFixed(1)}% p.a.</span></div>
    </div>`;

  drawChart($('#chart-asset'), assetSeries(h, sheetRange), { height: 160, color: chg(h.id, 'w1') >= 0 ? '#2FE0A8' : '#FF5C7A' });
}

function renderProfile() {
  const t = total();
  $('#sheet-title').innerHTML = `<div style="font-size:15px;font-weight:650">Account</div><div style="font-size:11.5px;color:var(--faint)">${PROFILE.entity}</div>`;
  $('#sheet-body').innerHTML = `
    <div class="card" style="display:flex;gap:14px;align-items:center">
      <span class="avatar" style="width:54px;height:54px;font-size:17px">AR</span>
      <span><span style="display:block;font-weight:650;font-size:16px">${PROFILE.name}</span>
      <span style="display:block;font-size:12px;color:var(--faint)">${PROFILE.tier} · client since ${PROFILE.since}</span></span>
    </div>
    <div class="section-head"><h2>Mandate</h2></div>
    <div class="card">
      <div class="kv"><span class="k">Managed entity</span><span class="v">${PROFILE.entity}</span></div>
      <div class="kv"><span class="k">Risk profile</span><span class="v">${PROFILE.risk}</span></div>
      <div class="kv"><span class="k">Reporting currency</span><span class="v">${S.settings.currency}</span></div>
      <div class="kv"><span class="k">Relationship</span><span class="v">${PROFILE.advisor}</span></div>
      <div class="kv"><span class="k">Net worth under management</span><span class="v">${priv(money(t))}</span></div>
    </div>
    <div class="section-head"><h2>Custodians</h2></div>
    <div class="card">
      ${[['Interactive Brokers', 'Equities, ETFs, settlement'], ['RBC Direct Investing', 'Registered accounts'], ['Self-custody (multisig)', 'Digital assets'],
       ['Silver Gold Bull / Zurich vault', 'Allocated metals'], ['Reid Family Holdings Inc.', 'Property & private equity']]
      .map(c => `<div class="kv"><span class="k">${c[0]}</span><span class="v" style="font-weight:400;color:var(--faint);font-size:12px">${c[1]}</span></div>`).join('')}
    </div>
    <div class="section-head"><h2>Statements</h2></div>
    <div class="list">
      ${['July 2026', 'June 2026', 'Q2 2026 review', 'May 2026'].map(s => `<button class="item" data-noop="1"><span class="lbl">${s}<span class="hint">PDF · generated on device</span></span><span class="val">›</span></button>`).join('')}
    </div>`;
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
  $('#p-name').textContent = PROFILE.name;
  $('#p-entity').textContent = PROFILE.entity + ' · ' + PROFILE.tier;

  $('#set-display').innerHTML =
    segRow('Currency', 'Converted at ' + PROFILE.fxUSD.toFixed(4) + ' USD/CAD', 'currency', [['CAD', 'CAD'], ['USD', 'USD']]) +
    toggleRow('Hide balances', 'Blur every figure with one tap from the top bar', 'hideBalances') +
    toggleRow('Abbreviate large numbers', '$1.24M instead of $1,240,000', 'compact') +
    toggleRow('Fill area under charts', 'Gradient fill on the net-worth chart', 'chartFill') +
    `<div class="item"><span class="lbl">Accent<span class="hint">Applies across the app</span></span>
      <span class="swatches">${[['violet', '#7C5CFF'], ['azure', '#3B82F6'], ['magenta', '#C74BE8'], ['emerald', '#14B88A']]
        .map(a => `<button class="swatch" data-accent="${a[0]}" style="background:${a[1]}" aria-selected="${S.settings.accent === a[0]}" aria-label="${a[0]}"></button>`).join('')}</span></div>` +
    toggleRow('Haptics', 'Short vibration on taps', 'haptics');

  $('#set-sim').innerHTML =

    segRow('Price updates', 'How often values refresh while the app is open', 'refresh', [['5', '5s'], ['30', '30s'], ['60', '1m'], ['300', '5m']]) +
    toggleRow('All-time-high line', 'Draw the running peak on the net-worth chart', 'hwmLine') +
    (() => { const m = marketStatus(S.simTime); return `<div class="item"><span class="lbl">Exchanges<span class="hint">${m.detail} · TSX, NYSE, NASDAQ</span></span><span class="val" style="color:${m.open ? 'var(--up)' : 'var(--muted)'}">${m.open ? 'Open' : 'Closed'}</span></div>`; })() +
     `<div class="item"><span class="lbl">Clock<span class="hint">Real time. Crypto trades 24/7; property and private companies revalue continuously; everything keeps running while the app is closed.</span></span><span class="val">1 : 1</span></div>
     <div class="item"><span class="lbl">Peak net worth<span class="hint">${S.athAt ? 'Set ' + relTime(S.athAt) : 'Since first run'}</span></span><span class="val">${priv(money(S.ath))}</span></div>`;

  $('#set-data').innerHTML =
    `<button class="item" data-act="export"><span class="lbl">Export data<span class="hint">Download this portfolio as JSON</span></span><span class="val">›</span></button>
     <button class="item" data-act="import"><span class="lbl">Import data<span class="hint">Restore from an exported file</span></span><span class="val">›</span></button>
     <button class="item" data-act="snapshot"><span class="lbl">Force a snapshot<span class="hint">Write the current value into history now</span></span><span class="val">›</span></button>
     <button class="item" data-act="reset"><span class="lbl danger">Reset portfolio<span class="hint">Return to $60,000,000 and erase all history</span></span><span class="val">›</span></button>`;

  const days = ((S.simTime - S.createdAt) / 86400000);
  $('#set-about').innerHTML =
    `<div class="item"><span class="lbl">Version<span class="hint">Strata Private Wealth</span></span><span class="val">${APP_VERSION}</span></div>
     <div class="item"><span class="lbl">Positions tracked<span class="hint">Across ${Object.keys(CLASSES).length} asset classes</span></span><span class="val">${SEED_HOLDINGS.length}</span></div>
     <div class="item"><span class="lbl">Days tracked<span class="hint">Since first launch</span></span><span class="val">${days < 10 ? days.toFixed(1) : Math.floor(days)}</span></div>
     <div class="item"><span class="lbl">Storage used<span class="hint">Local to this device</span></span><span class="val">${(JSON.stringify(S).length / 1024).toFixed(0)} KB</span></div>`;
}

/* ---------- settings actions ---------- */
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
        save(); applyTheme(); render();
        toast('Portfolio restored');
      } catch (e) { toast("That file isn't a Strata export"); }
    };
    r.readAsText(f);
  };
  inp.click();
}
function resetAll() {
  if (!confirm('Reset the portfolio to $60,000,000 and erase all simulated history? This cannot be undone.')) return;
  localStorage.removeItem(STORE_KEY);
  S = freshState();
  save(); applyTheme(); render();
  toast('Portfolio reset');
}

/* ---------- theme + nav ---------- */
function applyTheme() {
  document.documentElement.dataset.accent = S.settings.accent;
  const colors = { violet: '#07081A', azure: '#05070F', magenta: '#08040F', emerald: '#04100F' };
  document.querySelector('meta[name=theme-color]').content = colors[S.settings.accent] || '#07081A';
}

function go(v) {
  view = v; scrub = null;
  $$('.view').forEach(el => el.hidden = el.id !== 'view-' + v);
  $$('#tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.view === v));
  window.scrollTo(0, 0);
  render();
  haptic();
}

function render() {
  if (view === 'home') renderHome();
  else if (view === 'assets') renderAssets();
  else if (view === 'insights') renderInsights();
  else if (view === 'activity') renderActivity();
  else if (view === 'settings') renderSettings();
  if (!$('#sheet').hidden) renderAsset();
}

/* ---------- events ---------- */
function wire() {
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-view]'); if (b) go(b.dataset.view);
  });
  document.body.addEventListener('click', e => {
    const goto = e.target.closest('[data-goto]');
    if (goto) return go(goto.dataset.goto);

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

    const tg = e.target.closest('[data-toggle]');
    if (tg) {
      const k = tg.dataset.toggle;
      S.settings[k] = !S.settings[k];
      save(); haptic(12);
      return render();
    }
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
      if (a === 'snapshot') { S.history.push([S.simTime, Math.round(total())]); save(); toast('Snapshot written'); return render(); }
    }
    if (e.target.closest('[data-noop]')) return toast('Statements are not available in the demo');
  });

  $('#hero-value').addEventListener('click', () => { refreshNow(); scheduleRefresh(); haptic(); toast('Updated'); });
  $('#btn-privacy').addEventListener('click', () => {
    S.settings.hideBalances = !S.settings.hideBalances;
    $('#btn-privacy').setAttribute('aria-pressed', S.settings.hideBalances);
    save(); haptic(12); render();
    toast(S.settings.hideBalances ? 'Balances hidden' : 'Balances shown');
  });
  $('#btn-profile').addEventListener('click', () => { openAssetId = 'profile'; renderProfile(); $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; haptic(); });
  $('#profile-card').addEventListener('click', () => { openAssetId = 'profile'; renderProfile(); $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; haptic(); });
  $('#sheet-close').addEventListener('click', closeSheet);

  // chart scrubbing
  const cv = $('#chart-main');
  const at = e => {
    const rect = cv.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pts = seriesFor(range);
    scrub = Math.max(0, Math.min(pts.length - 1, Math.round((x - 6) / (rect.width - 12) * (pts.length - 1))));
    drawChart(cv, pts, { hwm: S.settings.hwmLine, scrub });
  };
  cv.addEventListener('touchstart', e => { at(e); }, { passive: true });
  cv.addEventListener('touchmove', e => { at(e); }, { passive: true });
  cv.addEventListener('touchend', () => { scrub = null; renderHome(); });
  cv.addEventListener('mousemove', at);
  cv.addEventListener('mouseleave', () => { scrub = null; renderHome(); });

  window.addEventListener('resize', () => render());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { advance(Date.now() - S.lastReal); lastUpdated = Date.now(); render(); scheduleRefresh(); }
  });
}

/* ---------- boot ---------- */
S = load();
applyTheme();
$('#btn-privacy').setAttribute('aria-pressed', S.settings.hideBalances);
advance(Date.now() - S.lastReal);
wire();
go('home');

/* Prices update on the chosen cadence. The engine integrates whatever time has
   passed, so a 5-minute refresh lands on exactly the same value a 5-second one would. */
function refreshNow() {
  const changed = advance(Date.now() - S.lastReal);
  lastUpdated = Date.now();
  if (changed && !document.hidden) {
    if (view === 'home' && scrub == null) renderHome();
    else if (view === 'assets') renderAssets();
    else if (view === 'insights') renderInsights();
    if (!$('#sheet').hidden && openAssetId && openAssetId !== 'profile') renderAsset();
  }
}
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  const secs = Math.max(5, +S.settings.refresh || 30);
  refreshTimer = setTimeout(() => { refreshNow(); scheduleRefresh(); }, secs * 1000);
}
scheduleRefresh();

window.addEventListener('pagehide', () => {
  persistNow();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
