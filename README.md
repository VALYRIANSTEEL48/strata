# Strata — Private Wealth (demo)

A prop portfolio app. No accounts, no network calls, no real money — a $60,000,000 CAD
book that lives entirely in your phone's local storage and keeps moving whether the app
is open or not. Nothing is faked upward: the total is just what the holdings are worth,
so it corrects and recovers like a real one, and drift does the rest.

![icon](icons/preview-64.png)

## Put it on your Samsung phone

1. **Make a repo.** On github.com, *New repository* → public → create.
2. **Upload these files.** *Add file → Upload files*, then drag the whole unzipped folder
   contents in (keep the `css/`, `js/`, `icons/` folders — the paths matter). Commit.
3. **Turn on Pages.** Repo *Settings → Pages →* Source: *Deploy from a branch*, branch
   `main`, folder `/ (root)`. Save. After a minute the URL appears at the top of that page:
   `https://<you>.github.io/<repo>/`
4. **Install it.** Open that URL in Chrome on the phone → ⋮ menu → **Add to Home screen**
   (Chrome may label it *Install app*). It lands on your home screen with its own icon,
   opens full-screen with no browser chrome, and works offline.

To ship an update: replace the changed files in the repo, and bump `CACHE` in `sw.js`
(e.g. `strata-v1.0.5`) so phones pick up the new version instead of the cached one.

## What's in the book

| Class | Weight | Holdings |
|---|---|---|
| Real estate | 23.9% | 5 properties (industrial, mixed-use, multi-family, residential, farmland) + Granite REIT |
| Public equities | 20.7% | NVDA, MSFT, ASML, TSM, BRK.B, COST, RY, CNQ, SHOP, ATD |
| Private & business equity | 18.6% | SpaceX, Anthropic, Stripe, Databricks secondaries + 3 owned operating companies |
| Index funds & ETFs | 18.3% | VFV, XIC, XEF, XEC, ZAG, QQQ, SMH, VDY |
| Digital assets | 8.9% | BTC, ETH, SOL |
| Cash & fixed income | 5.1% | HISA, GIC ladder, USD cash, settlement cash |
| Precious metals | 4.6% | Allocated gold and silver |

Tickers, funds and pre-IPO names are real. The properties and the three operating
companies (Northpine Logistics, Meridian Dental Partners, Harbour & Vine Hospitality)
are invented, with their own revenue, margin, EBITDA multiple and bank accounts.

## How the numbers move

- **Market assets** follow geometric Brownian motion: an annual drift and volatility per
  holding, driven by a shared market factor plus its own noise, so positions move together
  the way real ones do. Crypto is wild, bonds barely twitch.
- **Operating companies** are valued bottom-up — revenue drifts, margin and multiple
  wander, value = your stake × EBITDA × multiple. Profit accrues into the company accounts
  and 45% is distributed to you.
- **Income** (dividends, distributions, rent, staking, interest) accrues continuously and
  lands in brokerage settlement cash, which is why that line only ever grows.
- **Peaks and drawdowns are real.** The gold staircase on the chart is the running
  all-time high; the home screen says either *At all-time high* or how far below peak you
  are, and the activity feed logs new highs, pullbacks past 5/10/15%, and recoveries.
- **Time is real.** One second in the app is one second in the world, and it keeps
  running while the app is closed. Stocks and ETFs only move during exchange hours
  (9:30–4:00 ET, weekdays) — the home screen shows whether markets are open. Metals
  trade weekdays, crypto never stops, property and private companies revalue
  continuously. At this size the book is still lively: a 5-minute look typically moves
  it $5–10K, and $20–40K during a busy session.
- **Day and week changes are real**: each holding keeps its actual recent closes, so
  *today* means since the last close (Friday's, over a weekend), not a rolling guess.
- **Paydays land on the calendar.** Income accrues continuously, and at each month end
  the feed announces rent, company distributions, dividends and interest for the month.

Monte-Carlo on the real clock: after one year, a median of about $63M, with roughly one
year in four finishing red — normal for a growth-tilted balanced portfolio. After five
years, a median of about $86M and no losing runs; typical worst drawdown 10–12%, worst
seen 18.5%. Three years of seeded history sit behind the opening balance.

## Settings that actually do something

Currency (CAD/USD), hide balances, abbreviated numbers, chart fill, all-time-high line,
accent colour, haptics, price-update frequency (5s / 30s / 1m / 5m, default 30s), forcing a history snapshot, JSON export, JSON import, and a full
reset back to $60,000,000. The Market section shows live exchange status.

## Files

```
index.html            app shell
css/app.css           theme + layout
js/seed.js            the portfolio: holdings, weights, drift, volatility, yield
js/engine.js          simulation, persistence, peak/drawdown tracking
js/ui.js              rendering, charts, navigation, settings
sw.js                 offline cache
manifest.webmanifest  install metadata
tools/                icon generator + three headless test harnesses (not shipped to the phone)
```

`node tools/test_engine.js` replays a real year of daily 5-minute check-ins.
`node tools/test_trials.js 5 10` Monte-Carlos the return distribution over a chosen
horizon. `node tools/test_dom.js` boots the app in jsdom and clicks every tab, toggle and
holding. None of them are needed to run the app.

State lives in `localStorage` under `strata.state.v1` (~35 KB at first run, ~115 KB after a
year — recent history is kept at 10-minute detail, older history thins to hourly, then daily). Clearing Chrome's site data resets the portfolio.
