// node tools/test_engine.js — one real year of a daily user, on the real clock
const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
const store = {};
global.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
global.setTimeout = fn => { fn(); return 0; };
global.fmtMoneyPlain = v => '$' + Math.round(v).toLocaleString('en-CA');
eval(['js/seed.js', 'js/engine.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n').replace(/^const /gm, 'var ').replace(/^let /gm, 'var '));

S = load();
const start = total();
console.log('start         ', fmtMoneyPlain(start), '| market:', marketStatus().label, '|', marketStatus().detail);

let peak = start, maxDD = 0, t0 = Date.now(), sessionMoves = [];
for (let day = 0; day < 365; day++) {
  // closed for ~23.9h, then a 5-minute session of 2-second ticks
  advance((23.9 - 0) * 3600e3 + Math.random() * 3600e3 - 1800e3);
  const a = total();
  for (let i = 0; i < 150; i++) advance(2000);
  sessionMoves.push(Math.abs(total() - a));
  peak = Math.max(peak, total()); maxDD = Math.max(maxDD, (peak - total()) / peak);
}
const end = total(), yrs = (S.simTime - S.createdAt) / (365 * 86400e3);
console.log('elapsed       ', yrs.toFixed(2), 'years in', ((Date.now() - t0) / 1000).toFixed(1) + 's of compute');
console.log('end           ', fmtMoneyPlain(end), '(' + ((end / start - 1) * 100).toFixed(1) + '%)');
console.log('max drawdown  ', (maxDD * 100).toFixed(1) + '%');
sessionMoves.sort((a, b) => a - b);
console.log('5-min session move: median', fmtMoneyPlain(sessionMoves[182]), '| p90', fmtMoneyPlain(sessionMoves[328]));
console.log('income        ', fmtMoneyPlain(S.incomeTotal));
console.log('history       ', S.history.length, 'points ·', (JSON.stringify(S).length / 1024).toFixed(0), 'KB stored');
const kinds = {}; S.events.forEach(e => kinds[e.kind] = (kinds[e.kind] || 0) + 1);
console.log('events (last 120):', JSON.stringify(kinds));
console.log('latest        ', S.events.slice(0, 4).map(e => e.title).join(' | '));
