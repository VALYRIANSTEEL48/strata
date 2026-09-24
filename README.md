# Strata — Private Wealth (demo)

A prop portfolio app you can actually operate. No accounts, no network calls, no real
money — a $60,000,000 CAD book held by Hetherington Industries that lives in your phone's
local storage, keeps moving whether the app is open or not, and can be traded.

![icon](icons/preview-64.png)

## Put it on your Samsung phone

1. **Make a repo** on github.com — public, no README needed.
2. **Upload these files at the top level.** Unzip first, select everything *inside* the
   folder, and drag it onto *Add file → Upload files*. `index.html` must sit at the root
   of the repo, with the `css/`, `js/` and `icons/` folders beside it. Commit.
3. **Turn on Pages.** *Settings → Pages →* Source: *Deploy from a branch*, branch `main`,
   folder `/ (root)`. The URL appears at the top of that page after a minute.
4. **Install it.** Open that URL in Chrome on the phone → ⋮ → **Add to Home screen**.

To ship an update, replace the changed files and bump `CACHE` in `sw.js` so phones fetch
the new version instead of the cached one.

## The book

| Class | Weight | Holdings |
|---|---|---|
| Private & business equity | 43.8% | 11 companies you own, plus SpaceX, Anthropic, Stripe and Databricks secondaries |
| Real estate | 15.6% | Cambridge industrial campus, Winnipeg apartment block, Saskatchewan farmland, Granite REIT |
| Public equities | 12.6% | NVDA, MSFT, ASML, TSM, BRK.B, COST, RY, CNQ, SHOP, ATD |
| Index funds & ETFs | 11.2% | VFV, XIC, XEF, XEC, ZAG, QQQ, SMH, VDY |
| Digital assets | 7.0% | BTC, ETH, SOL |
| Cash & fixed income | 6.1% | HISA, GIC ladder, USD cash, settlement cash |
| Precious metals | 3.7% | Allocated gold and silver |

### The companies

**Operating** — valued stake × EBITDA × multiple, distributing 45% of profit to you:

| Company | Owned | What it is |
|---|---|---|
| Kawartha Trading Co. | 100% | 2 restaurants, 2 pubs, 5 farming operations |
| Northpine Industrial Group | 72% | Contract manufacturing, industrial supply, 3PL |
| Selkirk Ridge Mining Corp. | 58% | Two aggregate pits and a small polymetallic operation |
| Meridian Dental Partners | 45% | Three-clinic group practice |
| Overdrive Media Group | 100% | Studio running car, tech and music/soundscape channels |
| Ninebark Games | 100% | Two released indie titles, a third in production |
| Strategerium | 76% | Strategic planning software, D&D licensing contracts |

**Venture** — pre-revenue, valued on the last mark, burning cash, raising rounds:

| Company | Owned | What it is |
|---|---|---|
| Prometheon | 63% | Fusion R&D, field-reversed configuration test bed |
| AVRO Aerospace | 67% | Small-lift launch and high-altitude platforms |
| Blackriver AI | 41% | Experimental autonomy for defence applications |
| Ironwood Defence Systems | 52% | Experimental arms, directed energy, soldier equipment |

Tickers, funds and pre-IPO names are real. The properties and the eleven companies are
invented, each with its own revenue, margin, multiple, headcount and bank accounts.

## Trading

The **Markets** tab lists 64 instruments — every holding plus a catalogue of stocks, ETFs,
crypto, bullion, pre-IPO secondaries and four property listings. Open anything and buy.

- **Buys draw on settlement cash**, sells return to it, both net of a real cost: 0.15% on
  stocks and ETFs, 0.4% crypto, 1% bullion, 0.5% private, 2% closing costs on property.
- **Enter dollars or units**, or tap 25% / 50% / Max. Pre-IPO secondaries trade in lots
  with minimums; property sells whole; a company stake sells by percentage.
- **Cost base is a running average**, so unrealised and realised gains stay separate.
  Fees paid and realised gains both show in Insights.
- **Transfer between cash accounts**, and deposit or withdraw outside money from the
  Account page — external flows are tracked apart from investment performance.
- Your own companies aren't listed on any exchange, so they don't appear in Markets. You
  can sell down a stake from the holding itself.

## How the numbers move

- **Time is real.** One second in the app is one second in the world, and it keeps running
  while the app is closed. Stocks and ETFs move only during exchange hours (9:30–4:00 ET,
  weekdays); metals trade weekdays; crypto never stops; property and private companies
  revalue continuously. A 5-minute look typically moves the book $5–10K.
- **Market assets** follow geometric Brownian motion around a shared market factor.
- **Operating companies** are valued bottom-up. Revenue drifts, margin and multiple wander,
  profit accrues into the company accounts and 45% is distributed to you. Their expected
  return is organic growth plus the cash yield the multiple implies — a business bought at
  4.8× EBITDA yields about 9% in cash.
- **Venture companies** move in jumps. Raises step the mark up 25–75%; missed milestones
  cut it 15–50%. Expected jump size is netted out of the drift, so most marks drift
  sideways and the occasional raise carries the return — the real shape of venture.
- **Income** — rent, distributions, dividends, interest, staking — accrues continuously
  into settlement cash. At each month end the feed reports what landed.
- **Peaks and drawdowns are real.** The gold staircase on the chart is the running
  all-time high.

Monte-Carlo over one year: mean 11.4%, median 7.5%, with roughly one year in seven
finishing red and a typical worst drawdown of 5–10%. The distribution is right-skewed
because the ventures carry the upside. Drawdowns are shallower than a listed portfolio's
because private marks don't reprice every day — which is how private books really behave,
and also how they hide risk.

## Settings

Account holder name and managed entity (both editable), currency (CAD/USD), hide balances,
abbreviated numbers, chart fill, all-time-high line, accent colour, haptics, price update
frequency (5s to 5m, default 30s), forcing a history snapshot, JSON export, JSON import,
and a full reset.

## Files

```
index.html            app shell: flex layout, anchored nav
css/app.css           theme and layout
js/seed.js            the book, the companies, the market catalogue
js/engine.js          simulation, trading, persistence
js/ui.js              rendering, charts, navigation, trade flow
sw.js                 offline cache
manifest.webmanifest  install metadata
tools/                icon generator and three headless test harnesses
```

`node tools/test_dom.js` boots the app in jsdom and clicks every tab, toggle, holding and
trade path. `node tools/test_engine.js` replays a real year of daily check-ins.
`node tools/test_trials.js 1 14` Monte-Carlos the return distribution.

State lives in `localStorage` under `strata.state.v1` (~63 KB at first run, ~130 KB after a
year). Clearing Chrome's site data resets the portfolio.
