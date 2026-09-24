/* Strata — seed portfolio and market catalogue.
   Prices normalised to CAD. mu = expected annual total return, sigma = annual
   volatility, yld = annual income paid into settlement cash.

   Owned companies come in two shapes:
     operating — valued stake x EBITDA x multiple, distributes 45% of profit
     venture   — valued stake x enterprise valuation, burns cash, raises rounds  */

const CLASSES = {
  private: { name: 'Private & business equity', short: 'Private', color: '#C77DFF' },
  realty:  { name: 'Real estate', short: 'Real estate', color: '#2FC4B2' },
  equity:  { name: 'Public equities', short: 'Equities', color: '#7C6BFF' },
  etf:     { name: 'Index funds & ETFs', short: 'ETFs', color: '#4C8DFF' },
  crypto:  { name: 'Digital assets', short: 'Crypto', color: '#FF8A5B' },
  metals:  { name: 'Precious metals', short: 'Metals', color: '#E3B341' },
  cash:    { name: 'Cash & fixed income', short: 'Cash', color: '#8B93B0' }
};

const SEED_HOLDINGS = [
  /* ============ OWNED COMPANIES — operating ============ */
  { id:'biz-kawartha', cls:'private', sym:'KTC', name:'Kawartha Trading Co.', venue:'Owned · 100%', qty:1, price:3320000, mu:0.030, sigma:0.13, yld:0, kind:'Operating company',
    note:'2 restaurants, 2 pubs and 5 farming operations across the Kawarthas',
    biz:{ type:'operating', stake:1.00, revenue:6400000, margin:0.108, multiple:4.80, headcount:128, seasonality:0.20, accounts:[
      { name:'Operating account — BMO', bal:286000 }, { name:'Farm division account', bal:194000 },
      { name:'Liquor, food & inventory float', bal:88000 }, { name:'Tip & gratuity trust', bal:41000 },
      { name:'HST & payroll remittance reserve', bal:132000 } ] } },

  { id:'biz-northpine', cls:'private', sym:'NPIG', name:'Northpine Industrial Group', venue:'Owned · 72%', qty:1, price:3286000, mu:0.030, sigma:0.11, yld:0, kind:'Operating company',
    note:'Contract manufacturing, industrial supply and third-party logistics',
    biz:{ type:'operating', stake:0.72, revenue:6400000, margin:0.132, multiple:5.40, headcount:62, seasonality:0.07, accounts:[
      { name:'Operating account — RBC', bal:398000 }, { name:'Payroll account', bal:176000 },
      { name:'Fleet & fuel card float', bal:59000 }, { name:'Tax reserve (HST/CIT)', bal:224000 } ] } },

  { id:'biz-selkirk', cls:'private', sym:'SRM', name:'Selkirk Ridge Mining Corp.', venue:'Owned · 58%', qty:1, price:1700000, mu:0.020, sigma:0.26, yld:0, kind:'Operating company',
    note:'Two producing aggregate pits and a small polymetallic operation in BC',
    biz:{ type:'operating', stake:0.58, revenue:4100000, margin:0.210, multiple:3.40, headcount:47, seasonality:0.16, accounts:[
      { name:'Operating account — CIBC', bal:212000 }, { name:'Reclamation bond reserve', bal:340000 },
      { name:'Equipment & haul fleet fund', bal:118000 } ] } },

  { id:'biz-meridian', cls:'private', sym:'MDP', name:'Meridian Dental Partners', venue:'Owned · 45%', qty:1, price:1850000, mu:0.030, sigma:0.08, yld:0, kind:'Operating company',
    note:'Three-clinic group practice, partner-operated',
    biz:{ type:'operating', stake:0.45, revenue:2580000, margin:0.215, multiple:7.40, headcount:18, seasonality:0.04, accounts:[
      { name:'Clinic operating — TD', bal:268000 }, { name:'Partner distribution pool', bal:154000 },
      { name:'Equipment sinking fund', bal:97000 } ] } },

  { id:'biz-overdrive', cls:'private', sym:'OMG', name:'Overdrive Media Group', venue:'Owned · 100%', qty:1, price:1701000, mu:0.070, sigma:0.30, yld:0, kind:'Operating company',
    note:'Production studio running three channels: automotive, technology, and music & soundscapes',
    biz:{ type:'operating', stake:1.00, revenue:1350000, margin:0.300, multiple:4.20, headcount:11, seasonality:0.12, accounts:[
      { name:'Studio operating account', bal:96000 }, { name:'Sponsorship escrow', bal:74000 },
      { name:'Equipment & production fund', bal:52000 } ] } },

  { id:'biz-ninebark', cls:'private', sym:'NBG', name:'Ninebark Games', venue:'Owned · 100%', qty:1, price:889000, mu:0.045, sigma:0.38, yld:0, kind:'Operating company',
    note:'Two released indie titles with long-tail storefront revenue; third in production',
    biz:{ type:'operating', stake:1.00, revenue:950000, margin:0.260, multiple:3.60, headcount:9, seasonality:0.28, accounts:[
      { name:'Studio operating account', bal:143000 }, { name:'Storefront receivables float', bal:61000 } ] } },

  { id:'biz-strategerium', cls:'private', sym:'STGM', name:'Strategerium', venue:'Owned · 76%', qty:1, price:716000, mu:0.120, sigma:0.34, yld:0, kind:'Operating company',
    note:'Strategic planning software; first tabletop and D&D licensing contracts signed',
    biz:{ type:'operating', stake:0.76, revenue:620000, margin:0.160, multiple:9.50, headcount:8, seasonality:0.05, accounts:[
      { name:'Operating account — Wise', bal:88000 }, { name:'Deferred revenue held', bal:46000 } ] } },

  /* ============ OWNED COMPANIES — venture ============ */
  { id:'biz-prometheon', cls:'private', sym:'PMTH', name:'Prometheon', venue:'Owned · 63%', qty:1, price:3024000, mu:0.170, sigma:0.52, yld:0, kind:'Venture · R&D',
    note:'Fusion R&D — field-reversed configuration test bed, pre-revenue',
    biz:{ type:'venture', stake:0.63, valuation:4800000, burn:2100000, headcount:19, stage:'Series A', milestone:'Sustained 12ms confinement', roundRate:0.55 } },

  { id:'biz-avro', cls:'private', sym:'AVRO', name:'AVRO Aerospace', venue:'Owned · 67%', qty:1, price:2412000, mu:0.150, sigma:0.46, yld:0, kind:'Venture · Aerospace',
    note:'Small-lift launch and high-altitude platforms; two suborbital tests flown',
    biz:{ type:'venture', stake:0.67, valuation:3600000, burn:1650000, headcount:23, stage:'Series A', milestone:'Second suborbital test flight', roundRate:0.50 } },

  { id:'biz-blackriver', cls:'private', sym:'BRAI', name:'Blackriver AI', venue:'Owned · 41%', qty:1, price:1394000, mu:0.185, sigma:0.58, yld:0, kind:'Venture · Defence AI',
    note:'Experimental autonomy and decision-support research under defence contract',
    biz:{ type:'venture', stake:0.41, valuation:3400000, burn:1400000, headcount:14, stage:'Seed', milestone:'Phase II research contract', roundRate:0.60 } },

  { id:'biz-ironwood', cls:'private', sym:'IWDS', name:'Ironwood Defence Systems', venue:'Owned · 52%', qty:1, price:1352000, mu:0.145, sigma:0.50, yld:0, kind:'Venture · Defence',
    note:'Experimental small arms, directed-energy and soldier equipment prototyping',
    biz:{ type:'venture', stake:0.52, valuation:2600000, burn:1150000, headcount:17, stage:'Seed', milestone:'Live-fire evaluation scheduled', roundRate:0.45 } },

  /* ============ PRE-IPO SECONDARIES ============ */
  { id:'spacex', cls:'private', sym:'SPACEX', name:'SpaceX', venue:'Secondary', qty:1, price:1800000, mu:0.160, sigma:0.20, yld:0, kind:'Pre-IPO', note:'Common stock, 2 yr lock-up' },
  { id:'anthropic', cls:'private', sym:'ANTHRPC', name:'Anthropic', venue:'Secondary', qty:1, price:1200000, mu:0.190, sigma:0.26, yld:0, kind:'Pre-IPO', note:'SPV interest' },
  { id:'stripe', cls:'private', sym:'STRIPE', name:'Stripe', venue:'Secondary', qty:1, price:900000, mu:0.120, sigma:0.18, yld:0, kind:'Pre-IPO', note:'Direct secondary' },
  { id:'databricks', cls:'private', sym:'DBRX', name:'Databricks', venue:'Secondary', qty:1, price:750000, mu:0.140, sigma:0.22, yld:0, kind:'Pre-IPO', note:'SPV interest' },

  /* ============ REAL ESTATE ============ */
  { id:'re-cambridge', cls:'realty', sym:'IND-01', name:'Cambridge Industrial Flex Campus', venue:'Cambridge, ON', qty:1, price:4200000, mu:0.042, sigma:0.06, yld:0.0620, kind:'Industrial', note:'118,000 sq ft · 3 tenants · WALT 6.1 yrs' },
  { id:'re-winnipeg', cls:'realty', sym:'MFR-03', name:'Osborne Village 24-Unit Block', venue:'Winnipeg, MB', qty:1, price:3100000, mu:0.036, sigma:0.05, yld:0.0610, kind:'Multi-family', note:'96% occupancy · avg rent $1,540' },
  { id:'re-farm', cls:'realty', sym:'AGR-05', name:'Section 14 Farmland — 320 acres', venue:'Rosetown, SK', qty:1, price:1150000, mu:0.048, sigma:0.05, yld:0.0310, kind:'Agricultural', note:'Cash-rent lease, canola/wheat rotation' },
  { id:'grt', cls:'realty', sym:'GRT.UN', name:'Granite REIT', venue:'TSX', qty:12000, price:78.00, mu:0.050, sigma:0.18, yld:0.0450, note:'Listed industrial REIT' },

  /* ============ PUBLIC EQUITIES ============ */
  { id:'nvda', cls:'equity', sym:'NVDA', name:'NVIDIA Corp.', venue:'NASDAQ', qty:4000, price:250.00, mu:0.115, sigma:0.42, yld:0.0003, note:'Accelerated compute' },
  { id:'msft', cls:'equity', sym:'MSFT', name:'Microsoft Corp.', venue:'NASDAQ', qty:1300, price:640.00, mu:0.100, sigma:0.24, yld:0.0072, note:'Cloud & software' },
  { id:'asml', cls:'equity', sym:'ASML', name:'ASML Holding N.V.', venue:'NASDAQ', qty:600, price:1300.00, mu:0.100, sigma:0.33, yld:0.0090, note:'EUV lithography monopoly' },
  { id:'tsm', cls:'equity', sym:'TSM', name:'Taiwan Semiconductor', venue:'NYSE', qty:2800, price:265.00, mu:0.105, sigma:0.36, yld:0.0130, note:'Foundry leader' },
  { id:'brkb', cls:'equity', sym:'BRK.B', name:'Berkshire Hathaway', venue:'NYSE', qty:1100, price:700.00, mu:0.085, sigma:0.17, yld:0, note:'Ballast / compounder' },
  { id:'cost', cls:'equity', sym:'COST', name:'Costco Wholesale', venue:'NASDAQ', qty:450, price:1320.00, mu:0.085, sigma:0.20, yld:0.0055, note:'Defensive retail' },
  { id:'ry', cls:'equity', sym:'RY', name:'Royal Bank of Canada', venue:'TSX', qty:4000, price:190.00, mu:0.075, sigma:0.19, yld:0.0350, note:'Domestic financials' },
  { id:'cnq', cls:'equity', sym:'CNQ', name:'Canadian Natural Res.', venue:'TSX', qty:12000, price:62.00, mu:0.070, sigma:0.31, yld:0.0480, note:'Energy / inflation hedge' },
  { id:'shop', cls:'equity', sym:'SHOP', name:'Shopify Inc.', venue:'TSX', qty:5200, price:155.00, mu:0.115, sigma:0.50, yld:0, note:'High-beta growth' },
  { id:'atd', cls:'equity', sym:'ATD', name:'Alimentation Couche-Tard', venue:'TSX', qty:7200, price:75.00, mu:0.080, sigma:0.22, yld:0.0095, note:'Consumer staples' },

  /* ============ ETFs ============ */
  { id:'vfv', cls:'etf', sym:'VFV', name:'Vanguard S&P 500 (CAD)', venue:'TSX', qty:8000, price:165.00, mu:0.085, sigma:0.16, yld:0.0115, note:'Core US beta' },
  { id:'xic', cls:'etf', sym:'XIC', name:'iShares Core S&P/TSX', venue:'TSX', qty:20000, price:44.00, mu:0.080, sigma:0.15, yld:0.0280, note:'Core Canada' },
  { id:'xef', cls:'etf', sym:'XEF', name:'iShares Core MSCI EAFE', venue:'TSX', qty:20000, price:45.00, mu:0.075, sigma:0.17, yld:0.0290, note:'Developed ex-NA' },
  { id:'xec', cls:'etf', sym:'XEC', name:'iShares Core Emerging Mkts', venue:'TSX', qty:16000, price:34.00, mu:0.080, sigma:0.21, yld:0.0250, note:'EM sleeve' },
  { id:'zag', cls:'etf', sym:'ZAG', name:'BMO Aggregate Bond Index', venue:'TSX', qty:40000, price:15.00, mu:0.038, sigma:0.05, yld:0.0390, note:'Duration / dry powder' },
  { id:'qqq', cls:'etf', sym:'QQQ', name:'Invesco QQQ Trust', venue:'NASDAQ', qty:1000, price:820.00, mu:0.095, sigma:0.22, yld:0.0055, note:'Large-cap tech tilt' },
  { id:'smh', cls:'etf', sym:'SMH', name:'VanEck Semiconductor', venue:'NASDAQ', qty:2000, price:420.00, mu:0.105, sigma:0.38, yld:0.0050, note:'Satellite / thematic' },
  { id:'vdy', cls:'etf', sym:'VDY', name:'Vanguard FTSE Cdn High Div', venue:'TSX', qty:13000, price:62.00, mu:0.070, sigma:0.16, yld:0.0430, note:'Income sleeve' },

  /* ============ DIGITAL ASSETS ============ */
  { id:'btc', cls:'crypto', sym:'BTC', name:'Bitcoin', venue:'Cold storage', qty:14, price:148000, mu:0.150, sigma:0.62, yld:0, note:'2-of-3 multisig, self-custodied' },
  { id:'eth', cls:'crypto', sym:'ETH', name:'Ethereum', venue:'Cold storage', qty:300, price:5200, mu:0.130, sigma:0.72, yld:0.0310, note:'Partially staked (3.1% net)' },
  { id:'sol', cls:'crypto', sym:'SOL', name:'Solana', venue:'Cold storage', qty:1800, price:320, mu:0.130, sigma:0.95, yld:0.0620, note:'Staked via validator' },

  /* ============ METALS ============ */
  { id:'xau', cls:'metals', sym:'XAU', name:'Gold bullion', venue:'Allocated vault, Zurich', qty:400, price:3400, mu:0.050, sigma:0.15, yld:0, unit:'oz', note:'LBMA good delivery, allocated' },
  { id:'xag', cls:'metals', sym:'XAG', name:'Silver bullion', venue:'Allocated vault, Toronto', qty:17500, price:48, mu:0.055, sigma:0.28, yld:0, unit:'oz', note:'1,000 oz bars' },

  /* ============ CASH ============ */
  { id:'cash-hisa', cls:'cash', sym:'HISA', name:'High-interest savings (CAD)', venue:'EQ Bank', qty:1, price:780000, mu:0, sigma:0, yld:0.0400, note:'Liquid reserve' },
  { id:'cash-gic', cls:'cash', sym:'GIC', name:'GIC ladder — 1 to 5 yr', venue:'Laddered, 5 rungs', qty:1, price:1200000, mu:0, sigma:0, yld:0.0390, note:'One rung matures each year' },
  { id:'cash-usd', cls:'cash', sym:'USD', name:'US dollar cash', venue:'Corporate FX account', qty:1, price:450000, mu:0.005, sigma:0.06, yld:0.0420, note:'Held for USD purchases' },
  { id:'cash-settle', cls:'cash', sym:'SETL', name:'Brokerage settlement cash', venue:'Margin account', qty:1, price:1204000, mu:0, sigma:0, yld:0.0325, note:'Trades settle here. All income lands here.' }
];

/* ============ MARKET CATALOGUE — things you can buy ============ */
const CATALOG = [
  { id:'aapl', cls:'equity', sym:'AAPL', name:'Apple Inc.', venue:'NASDAQ', price:318.00, mu:0.090, sigma:0.25, yld:0.0045, note:'Hardware & services' },
  { id:'googl', cls:'equity', sym:'GOOGL', name:'Alphabet Inc.', venue:'NASDAQ', price:392.00, mu:0.100, sigma:0.28, yld:0.0040, note:'Search, cloud, AI' },
  { id:'amzn', cls:'equity', sym:'AMZN', name:'Amazon.com Inc.', venue:'NASDAQ', price:330.00, mu:0.100, sigma:0.30, yld:0, note:'Retail & AWS' },
  { id:'meta', cls:'equity', sym:'META', name:'Meta Platforms', venue:'NASDAQ', price:1020.00, mu:0.095, sigma:0.34, yld:0.0030, note:'Social & compute build-out' },
  { id:'amd', cls:'equity', sym:'AMD', name:'Advanced Micro Devices', venue:'NASDAQ', price:310.00, mu:0.105, sigma:0.45, yld:0, note:'Accelerators & CPUs' },
  { id:'lmt', cls:'equity', sym:'LMT', name:'Lockheed Martin', venue:'NYSE', price:690.00, mu:0.075, sigma:0.21, yld:0.0270, note:'Prime defence contractor' },
  { id:'rtx', cls:'equity', sym:'RTX', name:'RTX Corp.', venue:'NYSE', price:230.00, mu:0.075, sigma:0.22, yld:0.0200, note:'Aerospace & defence' },
  { id:'cae', cls:'equity', sym:'CAE', name:'CAE Inc.', venue:'TSX', price:42.00, mu:0.080, sigma:0.28, yld:0, note:'Simulation & training' },
  { id:'bam', cls:'equity', sym:'BAM', name:'Brookfield Asset Mgmt', venue:'TSX', price:86.00, mu:0.090, sigma:0.24, yld:0.0310, note:'Alternative asset manager' },
  { id:'enb', cls:'equity', sym:'ENB', name:'Enbridge Inc.', venue:'TSX', price:68.00, mu:0.065, sigma:0.18, yld:0.0590, note:'Pipelines, high payout' },
  { id:'cp', cls:'equity', sym:'CP', name:'Canadian Pacific Kansas City', venue:'TSX', price:118.00, mu:0.080, sigma:0.20, yld:0.0075, note:'North American rail' },
  { id:'agi', cls:'equity', sym:'AGI', name:'Alamos Gold', venue:'TSX', price:44.00, mu:0.075, sigma:0.38, yld:0.0040, note:'Intermediate gold producer' },
  { id:'lly', cls:'equity', sym:'LLY', name:'Eli Lilly & Co.', venue:'NYSE', price:1180.00, mu:0.095, sigma:0.28, yld:0.0060, note:'Metabolic franchise' },
  { id:'tsla', cls:'equity', sym:'TSLA', name:'Tesla Inc.', venue:'NASDAQ', price:520.00, mu:0.100, sigma:0.55, yld:0, note:'High-beta' },

  { id:'xeqt', cls:'etf', sym:'XEQT', name:'iShares Core Equity ETF', venue:'TSX', price:41.00, mu:0.085, sigma:0.16, yld:0.0180, note:'One-ticket global equity' },
  { id:'zsp', cls:'etf', sym:'ZSP', name:'BMO S&P 500 Index', venue:'TSX', price:108.00, mu:0.085, sigma:0.16, yld:0.0110, note:'US large cap' },
  { id:'xgd', cls:'etf', sym:'XGD', name:'iShares S&P/TSX Gold', venue:'TSX', price:38.00, mu:0.070, sigma:0.35, yld:0.0090, note:'Gold miners' },
  { id:'zre', cls:'etf', sym:'ZRE', name:'BMO Equal Weight REITs', venue:'TSX', price:23.00, mu:0.060, sigma:0.19, yld:0.0490, note:'Canadian REIT basket' },
  { id:'xbb', cls:'etf', sym:'XBB', name:'iShares Core Cdn Universe Bond', venue:'TSX', price:29.00, mu:0.038, sigma:0.05, yld:0.0380, note:'Broad bond exposure' },
  { id:'shld', cls:'etf', sym:'SHLD', name:'Global X Defence Tech', venue:'NYSE', price:74.00, mu:0.095, sigma:0.26, yld:0.0050, note:'Defence & aerospace basket' },

  { id:'link', cls:'crypto', sym:'LINK', name:'Chainlink', venue:'Cold storage', price:41.00, mu:0.120, sigma:0.95, yld:0, note:'Oracle network' },
  { id:'avax', cls:'crypto', sym:'AVAX', name:'Avalanche', venue:'Cold storage', price:62.00, mu:0.120, sigma:1.05, yld:0.0700, note:'Staking available' },
  { id:'xmr', cls:'crypto', sym:'XMR', name:'Monero', venue:'Cold storage', price:390.00, mu:0.110, sigma:0.80, yld:0, note:'Privacy chain' },

  { id:'xpt', cls:'metals', sym:'XPT', name:'Platinum bullion', venue:'Allocated vault, Zurich', price:1980.00, mu:0.050, sigma:0.24, yld:0, unit:'oz', note:'Industrial & investment demand' },
  { id:'xpd', cls:'metals', sym:'XPD', name:'Palladium bullion', venue:'Allocated vault, Zurich', price:1540.00, mu:0.040, sigma:0.32, yld:0, unit:'oz', note:'Thin, volatile market' },

  { id:'openai', cls:'private', sym:'OPENAI', name:'OpenAI', venue:'Secondary', price:500000, mu:0.180, sigma:0.30, yld:0, kind:'Pre-IPO', lot:500000, note:'SPV interest · $500K minimum' },
  { id:'anduril', cls:'private', sym:'ANDURIL', name:'Anduril Industries', venue:'Secondary', price:250000, mu:0.200, sigma:0.30, yld:0, kind:'Pre-IPO', lot:250000, note:'Defence autonomy · $250K minimum' },
  { id:'epic', cls:'private', sym:'EPIC', name:'Epic Games', venue:'Secondary', price:250000, mu:0.110, sigma:0.26, yld:0, kind:'Pre-IPO', lot:250000, note:'Engine & storefront · $250K minimum' },
  { id:'helion', cls:'private', sym:'HELION', name:'Helion Energy', venue:'Secondary', price:250000, mu:0.220, sigma:0.42, yld:0, kind:'Pre-IPO', lot:250000, note:'Fusion · $250K minimum' },

  { id:'re-halifax', cls:'realty', sym:'MIX-02', name:'Barrington Street Mixed-Use', venue:'Halifax, NS', price:2600000, mu:0.038, sigma:0.07, yld:0.0570, kind:'Mixed-use', lot:2600000, note:'Retail podium + 11 residential units' },
  { id:'re-kelowna', cls:'realty', sym:'STR-04', name:'Okanagan Waterfront Residence', venue:'Kelowna, BC', price:2350000, mu:0.040, sigma:0.09, yld:0.0290, kind:'Residential', lot:2350000, note:'Seasonal short-term rental' },
  { id:'re-calgary', cls:'realty', sym:'OFF-06', name:'Beltline Office Conversion', venue:'Calgary, AB', price:3450000, mu:0.044, sigma:0.09, yld:0.0660, kind:'Office / conversion', lot:3450000, note:'42,000 sq ft, partial residential conversion approved' },
  { id:'re-storage', cls:'realty', sym:'SSF-07', name:'Whitby Self-Storage Facility', venue:'Whitby, ON', price:1980000, mu:0.046, sigma:0.06, yld:0.0710, kind:'Self-storage', lot:1980000, note:'420 units, 91% occupancy' }
];

const PROFILE = {
  name: 'Alexander Hetherington',
  entity: 'Hetherington Industries',
  advisor: 'Private client desk · Meridian',
  since: 2016,
  tier: 'Private Client',
  risk: 'Growth — operator-weighted',
  currency: 'CAD',
  fxUSD: 0.7300
};

/* Trading costs by asset class: commission, spread, or closing costs. */
const FEES = { equity: 0.0015, etf: 0.0015, crypto: 0.0040, metals: 0.0100, realty: 0.0200, private: 0.0050, cash: 0 };
