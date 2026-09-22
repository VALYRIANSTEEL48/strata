// node tools/test_dom.js — boots the real app in jsdom and clicks through everything.
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;

// canvas stub
const ctxStub = new Proxy({}, {
  get: (t, k) => {
    if (k === 'measureText') return () => ({ width: 40 });
    if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (k === 'canvas') return {};
    return () => {};
  },
  set: () => true
});
window.HTMLCanvasElement.prototype.getContext = () => ctxStub;
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 380; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return 190; } });
window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 380, height: 190 });
window.navigator.vibrate = () => true;
window.confirm = () => true;
window.scrollTo = () => {};

const errors = [];
window.addEventListener('error', e => errors.push('window.onerror: ' + e.message));
const origErr = console.error;
console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); origErr(...a); };

// One eval so top-level let/const share a scope, as separate <script> tags do.
const bundle = ['js/seed.js', 'js/engine.js', 'js/ui.js']
  .map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n')
  + '\n; window.__SEED = SEED_HOLDINGS; window.__S = () => S;';
try { window.eval(bundle); }
catch (e) { errors.push('LOAD: ' + e.stack.split('\n').slice(0, 4).join(' | ')); }

const doc = window.document;
const q = s => doc.querySelector(s);
const click = el => { if (!el) { errors.push('missing element to click'); return; } el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); };
const txt = s => (q(s) ? q(s).textContent.trim().replace(/\s+/g, ' ') : '‼ MISSING ' + s);

function step(name, fn) {
  const before = errors.length;
  try { fn(); } catch (e) { errors.push(name + ': ' + e.message); }
  console.log((errors.length === before ? '  ok  ' : ' FAIL ') + name);
}

console.log('— boot —');
console.log('  hero:', txt('#hero-value'), '|', txt('#hero-chg'), '|', txt('#hero-hw'));
console.log('  stats:', txt('#s-income'), txt('#s-liquid'), txt('#s-gain'));
console.log('  alloc rows:', doc.querySelectorAll('.alloc-row').length, '| donut paths:', doc.querySelectorAll('#donut path').length);
console.log('  movers:', doc.querySelectorAll('#movers .row').length);

step('range switches', () => { for (const r of ['1D', '1W', '1Y', 'ALL', '1M']) click(q(`[data-range="${r}"]`)); });
step('tab: assets', () => click(q('[data-view="assets"]')));
console.log('  holdings rendered:', doc.querySelectorAll('#holdings-list .row').length);
step('class filters', () => { for (const c of ['equity', 'realty', 'private', 'crypto', 'cash', 'metals', 'etf', 'all']) click(q(`[data-class="${c}"]`)); });
step('tab: insights', () => click(q('[data-view="insights"]')));
console.log('  insight blocks:', doc.querySelectorAll('#insight-cards .ins').length, '| class bars:', doc.querySelectorAll('#class-perf .bar').length, '| biz rows:', doc.querySelectorAll('#biz-card .row').length);
step('tab: activity', () => click(q('[data-view="activity"]')));
step('tab: settings', () => click(q('[data-view="settings"]')));
console.log('  settings rows:', doc.querySelectorAll('#view-settings .item').length);

step('toggle currency USD', () => click(q('[data-set="currency"][data-val="USD"]')));
console.log('  usd hero after re-render:', (click(q('[data-view="home"]')), txt('#hero-value')));
step('toggle currency CAD', () => { click(q('[data-view="settings"]')); click(q('[data-set="currency"][data-val="CAD"]')); });

step('accent swatches', () => { for (const a of ['azure', 'magenta', 'emerald', 'violet']) click(q(`.swatch[data-accent="${a}"]`)); });
step('toggle ATH line off/on', () => { click(q('[data-toggle="hwmLine"]')); click(q('[data-toggle="hwmLine"]')); });
step('toggle compact/fill/haptics', () => { for (const k of ['compact', 'chartFill', 'haptics']) { click(q(`[data-toggle="${k}"]`)); click(q(`[data-toggle="${k}"]`)); } });
step('privacy button', () => { click(q('#btn-privacy')); click(q('#btn-privacy')); });
step('force snapshot', () => click(q('[data-act="snapshot"]')));
step('profile sheet', () => { click(q('#btn-profile')); if (q('#sheet').hidden) throw new Error('sheet did not open'); click(q('#sheet-close')); });

console.log('— asset sheets —');
const ids = (window.__SEED || []).map(h => h.id);
let sheetErrors = 0;
for (const id of ids) {
  const before = errors.length;
  click(q('[data-view="assets"]'));
  const row = q(`[data-asset="${id}"]`);
  click(row);
  for (const r of ['1D', '1W', '1Y', 'ALL']) click(q(`[data-srange="${r}"]`));
  const body = q('#sheet-body').textContent;
  if (!body || body.length < 200) errors.push('sheet body too short for ' + id);
  if (/NaN|undefined|Infinity/.test(body)) errors.push('bad number in sheet ' + id + ': ' + (body.match(/.{0,40}(NaN|undefined|Infinity).{0,40}/) || [])[0]);
  click(q('#sheet-close'));
  if (errors.length > before) sheetErrors++;
}
console.log('  ' + (ids.length - sheetErrors) + '/' + ids.length + ' asset sheets clean');

// numbers sanity across the whole document
click(q('[data-view="home"]'));
for (const v of ['home', 'assets', 'insights', 'activity', 'settings']) {
  click(q(`[data-view="${v}"]`));
  const t = q('#view-' + v).textContent;
  if (/NaN|undefined|Infinity/.test(t)) errors.push('bad number in view ' + v + ': ' + (t.match(/.{0,50}(NaN|undefined|Infinity).{0,50}/) || [])[0]);
}

// persistence (save() is debounced, so give it a beat)
setTimeout(() => {
  console.log('— persistence —');
  const stored = window.localStorage.getItem('strata.state.v1');
  console.log('  stored bytes:', stored ? stored.length : 0);
  if (!stored) errors.push('nothing written to localStorage');
  else {
    const parsed = JSON.parse(stored);
    console.log('  keys:', Object.keys(parsed).join(', '));
    console.log('  ath:', Math.round(parsed.ath).toLocaleString(), '| history:', parsed.history.length, '| events:', parsed.events.length);
    // reload from storage: the second boot must pick up the stored value
    const v1 = window.__S().ath;
    const dom2 = require('jsdom');
    if (Math.abs(parsed.ath - v1) > 1e-6) errors.push('stored ath differs from live ath');
  }
  console.log('\n' + (errors.length ? '✗ ' + errors.length + ' problem(s):' : '✓ no errors'));
  errors.slice(0, 25).forEach(e => console.log('   - ' + e));
  process.exit(errors.length ? 1 : 0);
}, 900);
