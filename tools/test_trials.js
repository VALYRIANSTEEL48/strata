// node tools/test_trials.js [years] [trials] — return distribution on the real clock
const fs = require('fs'), path = require('path'), root = path.join(__dirname, '..');
const YEARS = +(process.argv[2] || 1), TRIALS = +(process.argv[3] || 40);
const src = ['js/seed.js', 'js/engine.js'].map(f => fs.readFileSync(path.join(root, f), 'utf8')).join('\n').replace(/^const /gm, 'var ').replace(/^let /gm, 'var ');
const res = [], dds = [];
for (let k = 0; k < TRIALS; k++) {
  const store = {};
  global.localStorage = { getItem: x => (x in store ? store[x] : null), setItem: (x, v) => { store[x] = v; }, removeItem: x => { delete store[x]; } };
  global.setTimeout = () => 0;
  global.fmtMoneyPlain = v => '$' + Math.round(v).toLocaleString('en-CA');
  eval(src);
  S = load();
  const start = total(); let peak = start, dd = 0;
  for (let d = 0; d < YEARS * 365; d++) { advance(86400e3); peak = Math.max(peak, total()); dd = Math.max(dd, (peak - total()) / peak); }
  res.push(Math.pow(total() / start, 1 / YEARS) - 1); dds.push(dd);
}
const s = [...res].sort((a, b) => a - b), q = p => s[Math.floor(p * (s.length - 1))], mean = a => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`horizon ${YEARS}y · ${TRIALS} trials`);
console.log('  annualised: mean', (mean(res) * 100).toFixed(1) + '% | p10', (q(.1) * 100).toFixed(1) + '% | median', (q(.5) * 100).toFixed(1) + '% | p90', (q(.9) * 100).toFixed(1) + '%');
console.log('  $60M becomes (median):', '$' + (60 * Math.pow(1 + q(.5), YEARS)).toFixed(1) + 'M');
console.log('  negative outcomes:', (100 * res.filter(r => r < 0).length / res.length).toFixed(0) + '%');
console.log('  max drawdown: mean', (mean(dds) * 100).toFixed(1) + '% | worst', (Math.max(...dds) * 100).toFixed(1) + '%');
