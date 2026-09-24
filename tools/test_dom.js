// node tools/test_dom.js — boots the real app in jsdom and exercises everything
const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'),
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
const ctxStub = new Proxy({}, { get: (t, k) => k === 'measureText' ? (() => ({ width: 40 }))
  : k === 'createLinearGradient' ? (() => ({ addColorStop() {} })) : k === 'canvas' ? {} : (() => {}), set: () => true });
window.HTMLCanvasElement.prototype.getContext = () => ctxStub;
Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', { get() { return 380; } });
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get() { return 190; } });
window.HTMLElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 380, height: 190 });
window.navigator.vibrate = () => true; window.confirm = () => true; window.scrollTo = () => {};

const errors = [];
window.addEventListener('error', e => errors.push('onerror: ' + e.message));
const origErr = console.error; console.error = (...a) => { errors.push('console.error: ' + a.join(' ')); origErr(...a); };
const bundle = ['js/seed.js', 'js/engine.js', 'js/ui.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n')
  + '\n; window.__API = { ALL_ASSETS, S: () => S, total, owned, cashAvailable, priceOf, qtyOf, meta, advance, money };';
try { window.eval(bundle); } catch (e) { errors.push('LOAD: ' + e.stack.split('\n').slice(0, 4).join(' | ')); }

const doc = window.document, q = s => doc.querySelector(s), qa = s => Array.from(doc.querySelectorAll(s));
const click = el => { if (!el) { errors.push('missing element to click'); return; } el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); };
const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
const txt = s => (q(s) ? q(s).textContent.trim().replace(/\s+/g, ' ') : '‼ MISSING ' + s);
const step = (name, fn) => { const b = errors.length; try { fn(); } catch (e) { errors.push(name + ': ' + e.message); } console.log((errors.length === b ? '  ok  ' : ' FAIL ') + name); };
const API = () => window.__API;

console.log('— boot —');
console.log('  hero:', txt('#hero-value'), '|', txt('#hero-chg'));
console.log('  stats:', txt('#s-cash'), txt('#s-income'), txt('#s-gain'));
console.log('  companies on home:', qa('#home-biz .row').length, '| movers:', qa('#movers .row').length, '| alloc rows:', qa('.alloc-row').length);

step('ranges', () => { for (const r of ['1D','1W','1Y','ALL','1M']) click(q(`[data-range="${r}"]`)); });
step('tab assets', () => click(q('[data-view="assets"]')));
console.log('  holdings:', qa('#holdings-list .row').length, '| groups:', qa('#holdings-list .group-head').length);
step('class filters', () => { for (const c of ['private','realty','equity','etf','crypto','metals','cash','all']) click(q(`[data-class="${c}"]`)); });
step('tab markets', () => click(q('[data-view="markets"]')));
console.log('  market rows:', qa('#market-list .row').length);
step('market search', () => { type(q('#market-search'), 'defence'); if (qa('#market-list .row').length < 1) throw new Error('search found nothing'); type(q('#market-search'), ''); });
step('market filters', () => { for (const c of ['equity','private','realty','all']) click(q(`[data-mclass="${c}"]`)); });
step('tab insights', () => click(q('[data-view="insights"]')));
console.log('  insights:', qa('#insight-cards .ins').length, '| operating:', qa('#biz-card .row').length, '| venture:', qa('#venture-card .row').length);
step('tab activity', () => { click(q('#btn-activity')); for (const f of ['trade','income','round','up','ath','all']) click(q(`[data-act-filter="${f}"]`)); });
step('tab settings', () => click(q('[data-view="settings"]')));
step('entity + holder name', () => {
  type(q('#holder-name'), 'Jordan Castellano');
  const ent = q('#entity-name');
  if (ent.placeholder !== 'Hetherington Industries') throw new Error('entity default wrong: ' + ent.placeholder);
  if (q('#btn-profile').textContent !== 'JC') throw new Error('initials not applied');
  type(q('#holder-name'), '');
});
step('display toggles', () => { for (const k of ['compact','chartFill','haptics','hwmLine','hideBalances','hideBalances']) click(q(`[data-toggle="${k}"]`)); });
step('refresh + currency', () => { click(q('[data-set="refresh"][data-val="5"]')); click(q('[data-set="refresh"][data-val="30"]')); click(q('[data-set="currency"][data-val="USD"]')); click(q('[data-set="currency"][data-val="CAD"]')); });

console.log('— trading —');
step('buy AAPL with cash amount', () => {
  click(q('[data-view="markets"]'));
  type(q('#market-search'), 'Apple');
  click(q('#market-list .row'));
  click(q('[data-trade$="|buy"]'));
  type(q('#trade-input'), '250000');
  const btn = q('#trade-confirm');
  if (btn.disabled) throw new Error('confirm disabled: ' + txt('#trade-body'));
  const before = API().cashAvailable();
  click(btn);
  if (!q('#trade').hidden) throw new Error('trade sheet stayed open');
  const spent = before - API().cashAvailable();
  if (Math.abs(spent - 250000) > 2000) throw new Error('cash moved ' + Math.round(spent));
  if (!(API().qtyOf('aapl') > 0)) throw new Error('no shares received');
  console.log('    → bought', API().qtyOf('aapl').toFixed(1), 'AAPL for', Math.round(spent).toLocaleString());
});
step('quick-fill max respects buying power', () => {
  click(q('[data-view="markets"]')); type(q('#market-search'), 'Alphabet'); click(q('#market-list .row'));
  click(q('[data-trade$="|buy"]')); click(q('[data-tquick="max"]'));
  if (q('#trade-confirm').disabled) throw new Error('max should be affordable');
  click(q('#trade-confirm'));
  if (API().cashAvailable() < -1) throw new Error('cash went negative');
  console.log('    → cash after max buy:', Math.round(API().cashAvailable()).toLocaleString());
});
step('overspend is blocked', () => {
  click(q('[data-view="markets"]')); type(q('#market-search'), 'Lockheed'); click(q('#market-list .row'));
  click(q('[data-trade$="|buy"]')); type(q('#trade-input'), '99000000');
  if (!q('#trade-confirm').disabled) throw new Error('confirm should be disabled');
  if (!/needed/.test(txt('#trade-body'))) throw new Error('no warning shown');
  click(q('#trade-close'));
});
step('sell half a position', () => {
  click(q('[data-view="assets"]')); click(q('[data-asset="aapl"]'));
  click(q('[data-trade$="|sell"]'));
  click(q('[data-tquick="0.5"]'));
  const before = API().qtyOf('aapl'), cash = API().cashAvailable();
  click(q('#trade-confirm'));
  const after = API().qtyOf('aapl');
  if (Math.abs(after - before / 2) > 0.01) throw new Error('units wrong: ' + before + ' -> ' + after);
  if (API().cashAvailable() <= cash) throw new Error('no proceeds credited');
  console.log('    → sold half, realised', Math.round(API().S().realised).toLocaleString());
});
step('sell a stake in a company (percent mode)', () => {
  click(q('[data-view="assets"]')); click(q('[data-asset="biz-prometheon"]'));
  click(q('[data-trade$="|sell"]'));
  click(q('[data-tquick="25"]'));
  const before = API().qtyOf('biz-prometheon');
  click(q('#trade-confirm'));
  const after = API().qtyOf('biz-prometheon');
  if (Math.abs(after - before * 0.75) > 1e-6) throw new Error('stake wrong: ' + before + ' -> ' + after);
});
step('deposit external funds', () => {
  click(q('#btn-profile'));
  click(q('[data-trade$="|deposit"]'));
  type(q('#trade-input'), '4000000');
  const before = API().cashAvailable();
  click(q('#trade-confirm'));
  if (Math.abs(API().cashAvailable() - before - 4000000) > 1) throw new Error('deposit not applied');
  if (Math.abs(API().S().deposited - 4000000) > 1) throw new Error('deposit not tracked');
});

step('buy a property (lot mode)', () => {
  click(q('[data-view="markets"]')); type(q('#market-search'), 'Whitby'); click(q('#market-list .row'));
  click(q('[data-trade$="|buy"]')); click(q('[data-tquick="1"]'));
  const ok = !q('#trade-confirm').disabled;
  click(q('#trade-confirm'));
  if (!ok) throw new Error('property not affordable after deposit');
  if (API().qtyOf('re-storage') !== 1) throw new Error('property not acquired');
  console.log('    → acquired Whitby self-storage for', API().money(API().priceOf('re-storage')));
});
step('cash transfer between accounts', () => {
  click(q('[data-view="assets"]')); click(q('[data-asset="cash-hisa"]'));
  click(q('[data-trade$="|sell"]'));           // transfer out to settlement
  type(q('#trade-input'), '100000');
  click(q('#trade-confirm'));
  if (API().qtyOf('cash-hisa') !== 1) throw new Error('cash qty changed');
});
console.log('— sheets —');
let bad = 0;
for (const a of API().ALL_ASSETS) {
  const b = errors.length;
  click(q('[data-view="assets"]'));
  window.eval(`openAsset(${JSON.stringify(a.id)})`);
  for (const r of ['1D','1W','1Y','ALL']) click(q(`[data-srange="${r}"]`));
  const body = q('#sheet-body').textContent;
  if (body.length < 150) errors.push('sheet too short: ' + a.id);
  if (/NaN|undefined|Infinity/.test(body)) errors.push('bad number in ' + a.id + ': ' + (body.match(/.{0,40}(NaN|undefined|Infinity).{0,30}/) || [])[0]);
  click(q('#sheet-close'));
  if (errors.length > b) bad++;
}
console.log('  ' + (API().ALL_ASSETS.length - bad) + '/' + API().ALL_ASSETS.length + ' asset sheets clean');

for (const v of ['home','assets','markets','insights','activity','settings']) {
  window.eval(`go(${JSON.stringify(v)})`);
  const t = q('#view-' + v).textContent;
  if (/NaN|undefined|Infinity/.test(t)) errors.push('bad number in view ' + v + ': ' + (t.match(/.{0,50}(NaN|undefined|Infinity).{0,40}/) || [])[0]);
}
API().advance(4 * 86400e3);
window.eval('render()');
console.log('— after 4 days —');
console.log('  total:', API().money(API().total()), '| positions:', API().owned().length, '| events:', API().S().events.length);

setTimeout(() => {
  const stored = window.localStorage.getItem('strata.state.v1');
  console.log('— persistence —  stored:', stored ? (stored.length / 1024).toFixed(0) + ' KB' : 'NOTHING');
  if (!stored) errors.push('nothing persisted');
  else { const p = JSON.parse(stored); console.log('  trades:', p.trades.length, '| holdings priced:', Object.keys(p.holdings).length, '| v', p.v); }
  console.log('\n' + (errors.length ? '✗ ' + errors.length + ' problem(s):' : '✓ no errors'));
  errors.slice(0, 20).forEach(e => console.log('   - ' + e));
  process.exit(errors.length ? 1 : 0);
}, 900);
