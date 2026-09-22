/* Strata — seed portfolio.
   All prices normalised to CAD. mu = annual drift, sigma = annual volatility,
   yld = annual income yield paid into cash (dividends / rent / distributions). */

const CLASSES = {
  equity:  { name: 'Public equities', short: 'Equities', color: '#7C6BFF' },
  etf:     { name: 'Index funds & ETFs', short: 'ETFs', color: '#4C8DFF' },
  realty:  { name: 'Real estate', short: 'Real estate', color: '#2FC4B2' },
  private: { name: 'Private & business equity', short: 'Private', color: '#C77DFF' },
  crypto:  { name: 'Digital assets', short: 'Crypto', color: '#FF8A5B' },
  metals:  { name: 'Precious metals', short: 'Metals', color: '#E3B341' },
  cash:    { name: 'Cash & fixed income', short: 'Cash', color: '#8B93B0' }
};

const SEED_HOLDINGS = [
  // ---------- Public equities : 12,400,000 ----------
  { id:'nvda', cls:'equity', sym:'NVDA', name:'NVIDIA Corp.', venue:'NASDAQ', qty:6000, price:250.00, mu:0.115, sigma:0.42, yld:0.0003, note:'Accelerated compute' },
  { id:'msft', cls:'equity', sym:'MSFT', name:'Microsoft Corp.', venue:'NASDAQ', qty:2400, price:640.00, mu:0.100, sigma:0.24, yld:0.0072, note:'Cloud & software' },
  { id:'asml', cls:'equity', sym:'ASML', name:'ASML Holding N.V.', venue:'NASDAQ', qty:900, price:1300.00, mu:0.100, sigma:0.33, yld:0.0090, note:'EUV lithography monopoly' },
  { id:'tsm',  cls:'equity', sym:'TSM',  name:'Taiwan Semiconductor', venue:'NYSE', qty:5000, price:265.00, mu:0.105, sigma:0.36, yld:0.0130, note:'Foundry leader' },
  { id:'brkb', cls:'equity', sym:'BRK.B',name:'Berkshire Hathaway', venue:'NYSE', qty:1700, price:700.00, mu:0.085, sigma:0.17, yld:0.0000, note:'Ballast / compounder' },
  { id:'cost', cls:'equity', sym:'COST', name:'Costco Wholesale', venue:'NASDAQ', qty:900, price:1320.00, mu:0.085, sigma:0.20, yld:0.0055, note:'Defensive retail' },
  { id:'ry',   cls:'equity', sym:'RY',   name:'Royal Bank of Canada', venue:'TSX', qty:6500, price:190.00, mu:0.075, sigma:0.19, yld:0.0350, note:'Domestic financials' },
  { id:'cnq',  cls:'equity', sym:'CNQ',  name:'Canadian Natural Res.', venue:'TSX', qty:18000, price:62.00, mu:0.070, sigma:0.31, yld:0.0480, note:'Energy / inflation hedge' },
  { id:'shop', cls:'equity', sym:'SHOP', name:'Shopify Inc.', venue:'TSX', qty:8000, price:155.00, mu:0.115, sigma:0.50, yld:0.0000, note:'High-beta growth' },
  { id:'atd',  cls:'equity', sym:'ATD',  name:'Alimentation Couche-Tard', venue:'TSX', qty:12000, price:75.00, mu:0.080, sigma:0.22, yld:0.0095, note:'Consumer staples' },

  // ---------- ETFs : 10,990,000 ----------
  { id:'vfv',  cls:'etf', sym:'VFV',  name:'Vanguard S&P 500 (CAD)', venue:'TSX', qty:12000, price:165.00, mu:0.085, sigma:0.16, yld:0.0115, note:'Core US beta' },
  { id:'xic',  cls:'etf', sym:'XIC',  name:'iShares Core S&P/TSX', venue:'TSX', qty:30000, price:44.00, mu:0.080, sigma:0.15, yld:0.0280, note:'Core Canada' },
  { id:'xef',  cls:'etf', sym:'XEF',  name:'iShares Core MSCI EAFE', venue:'TSX', qty:40000, price:45.00, mu:0.075, sigma:0.17, yld:0.0290, note:'Developed ex-NA' },
  { id:'xec',  cls:'etf', sym:'XEC',  name:'iShares Core Emerging Mkts', venue:'TSX', qty:25000, price:34.00, mu:0.080, sigma:0.21, yld:0.0250, note:'EM sleeve' },
  { id:'zag',  cls:'etf', sym:'ZAG',  name:'BMO Aggregate Bond Index', venue:'TSX', qty:60000, price:15.00, mu:0.038, sigma:0.05, yld:0.0390, note:'Duration / dry powder' },
  { id:'qqq',  cls:'etf', sym:'QQQ',  name:'Invesco QQQ Trust', venue:'NASDAQ', qty:2000, price:820.00, mu:0.095, sigma:0.22, yld:0.0055, note:'Large-cap tech tilt' },
  { id:'smh',  cls:'etf', sym:'SMH',  name:'VanEck Semiconductor', venue:'NASDAQ', qty:3000, price:420.00, mu:0.105, sigma:0.38, yld:0.0050, note:'Satellite / thematic' },
  { id:'vdy',  cls:'etf', sym:'VDY',  name:'Vanguard FTSE Cdn High Div', venue:'TSX', qty:20000, price:62.00, mu:0.070, sigma:0.16, yld:0.0430, note:'Income sleeve' },

  // ---------- Real estate : 14,336,000 ----------
  { id:'re-cambridge', cls:'realty', sym:'IND-01', name:'Cambridge Industrial Flex Campus', venue:'Cambridge, ON', qty:1, price:4200000, mu:0.042, sigma:0.06, yld:0.0620, note:'118,000 sq ft · 3 tenants · WALT 6.1 yrs', kind:'Industrial' },
  { id:'re-halifax', cls:'realty', sym:'MIX-02', name:'Barrington Street Mixed-Use', venue:'Halifax, NS', qty:1, price:2600000, mu:0.038, sigma:0.07, yld:0.0570, note:'Retail podium + 11 residential units', kind:'Mixed-use' },
  { id:'re-winnipeg', cls:'realty', sym:'MFR-03', name:'Osborne Village 24-Unit Block', venue:'Winnipeg, MB', qty:1, price:3100000, mu:0.036, sigma:0.05, yld:0.0610, note:'96% occupancy · avg rent $1,540', kind:'Multi-family' },
  { id:'re-kelowna', cls:'realty', sym:'STR-04', name:'Okanagan Waterfront Residence', venue:'Kelowna, BC', qty:1, price:2350000, mu:0.040, sigma:0.09, yld:0.0290, note:'Seasonal short-term rental', kind:'Residential' },
  { id:'re-farm', cls:'realty', sym:'AGR-05', name:'Section 14 Farmland — 320 acres', venue:'Rosetown, SK', qty:1, price:1150000, mu:0.048, sigma:0.05, yld:0.0310, note:'Cash-rent lease, canola/wheat rotation', kind:'Agricultural' },
  { id:'grt',  cls:'realty', sym:'GRT.UN', name:'Granite REIT', venue:'TSX', qty:12000, price:78.00, mu:0.050, sigma:0.18, yld:0.0450, note:'Listed industrial REIT' },

  // ---------- Private & business equity : 11,150,000 ----------
  { id:'spacex', cls:'private', sym:'SPACEX', name:'SpaceX', venue:'Secondary', qty:1, price:1800000, mu:0.160, sigma:0.20, yld:0, note:'Series-N common, 2 yr lock-up', kind:'Pre-IPO' },
  { id:'anthropic', cls:'private', sym:'ANTHRPC', name:'Anthropic', venue:'Secondary', qty:1, price:1200000, mu:0.190, sigma:0.26, yld:0, note:'SPV interest', kind:'Pre-IPO' },
  { id:'stripe', cls:'private', sym:'STRIPE', name:'Stripe', venue:'Secondary', qty:1, price:900000, mu:0.120, sigma:0.18, yld:0, note:'Direct secondary', kind:'Pre-IPO' },
  { id:'databricks', cls:'private', sym:'DBRX', name:'Databricks', venue:'Secondary', qty:1, price:750000, mu:0.140, sigma:0.22, yld:0, note:'SPV interest', kind:'Pre-IPO' },

  { id:'biz-northpine', cls:'private', sym:'NPLG', name:'Northpine Logistics Group', venue:'Owned · 72%', qty:1, price:3400000, mu:0.065, sigma:0.10, yld:0, kind:'Operating company',
    biz:{ stake:0.72, revenue:6200000, margin:0.125, multiple:6.1, headcount:38, seasonality:0.09, accounts:[
      { name:'Operating account — RBC', bal:412000 }, { name:'Payroll account', bal:186000 }, { name:'Fuel & fleet card float', bal:64000 }, { name:'Tax reserve (HST/CIT)', bal:238000 }
    ]}},
  { id:'biz-meridian', cls:'private', sym:'MDP', name:'Meridian Dental Partners', venue:'Owned · 45%', qty:1, price:1850000, mu:0.075, sigma:0.08, yld:0, kind:'Operating company',
    biz:{ stake:0.45, revenue:2580000, margin:0.215, multiple:7.4, headcount:18, seasonality:0.04, accounts:[
      { name:'Clinic operating — TD', bal:268000 }, { name:'Partner distribution pool', bal:154000 }, { name:'Equipment sinking fund', bal:97000 }
    ]}},
  { id:'biz-harbour', cls:'private', sym:'HVH', name:'Harbour & Vine Hospitality', venue:'Owned · 100%', qty:1, price:1250000, mu:0.050, sigma:0.14, yld:0, kind:'Operating company',
    biz:{ stake:1.0, revenue:2770000, margin:0.098, multiple:4.6, headcount:34, seasonality:0.22, accounts:[
      { name:'Operating account — BMO', bal:143000 }, { name:'Tip & gratuity trust', bal:38000 }, { name:'Liquor & inventory float', bal:71000 }
    ]}},

  // ---------- Digital assets : 5,312,000 ----------
  { id:'btc', cls:'crypto', sym:'BTC', name:'Bitcoin', venue:'Cold storage', qty:22, price:148000, mu:0.150, sigma:0.62, yld:0, note:'2-of-3 multisig, self-custodied' },
  { id:'eth', cls:'crypto', sym:'ETH', name:'Ethereum', venue:'Cold storage', qty:260, price:5200, mu:0.130, sigma:0.72, yld:0.0310, note:'Partially staked (3.1% net)' },
  { id:'sol', cls:'crypto', sym:'SOL', name:'Solana', venue:'Cold storage', qty:2200, price:320, mu:0.130, sigma:0.95, yld:0.0620, note:'Staked via validator' },

  // ---------- Precious metals : 2,756,000 ----------
  { id:'xau', cls:'metals', sym:'XAU', name:'Gold bullion — 500 oz', venue:'Allocated vault, Zurich', qty:500, price:3400, mu:0.050, sigma:0.15, yld:0, note:'LBMA good delivery, allocated' },
  { id:'xag', cls:'metals', sym:'XAG', name:'Silver bullion — 22,000 oz', venue:'Allocated vault, Toronto', qty:22000, price:48, mu:0.055, sigma:0.28, yld:0, note:'1,000 oz bars' },

  // ---------- Cash & fixed income : 3,056,000 ----------
  { id:'cash-hisa', cls:'cash', sym:'HISA', name:'High-interest savings (CAD)', venue:'EQ Bank', qty:1, price:780000, mu:0, sigma:0, yld:0.0400, note:'Liquid reserve' },
  { id:'cash-gic', cls:'cash', sym:'GIC', name:'GIC ladder — 1 to 5 yr', venue:'Laddered, 5 rungs', qty:1, price:1200000, mu:0, sigma:0, yld:0.0390, note:'One rung matures each year' },
  { id:'cash-usd', cls:'cash', sym:'USD', name:'US dollar cash', venue:'Corporate FX account', qty:1, price:450000, mu:0.005, sigma:0.06, yld:0.0420, note:'Held for USD purchases' },
  { id:'cash-settle', cls:'cash', sym:'SETL', name:'Brokerage settlement cash', venue:'Margin account', qty:1, price:626000, mu:0, sigma:0, yld:0.0325, note:'Undeployed — see rebalancing' }
];

const PROFILE = {
  name: 'Alexander Reid',
  handle: 'A. Reid',
  entity: 'Reid Family Holdings Inc.',
  advisor: 'Private client desk · Meridian',
  since: 2016,
  tier: 'Private Client',
  risk: 'Growth — 78/22',
  currency: 'CAD',
  fxUSD: 0.7300 // 1 CAD -> USD, display-only conversion
};
