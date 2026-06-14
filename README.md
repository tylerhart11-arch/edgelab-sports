# EdgeLab Sports

EdgeLab Sports is a local-first sports betting analytics tracker. It ships with deterministic seeded data so the app works immediately, plus live-result adapters that can poll public scoreboards and settle picks as games finish.

## What It Does

- Tracks major U.S. sports coverage: NFL, NBA, MLB, NHL, MLS, NCAAF, and NCAAB.
- Adds a World Cup 2026 desk with all 104 fixtures, 48 teams, group outlooks, and 3-way soccer model probabilities.
- Produces a Best Bets board with model probability, fair odds, book odds, edge, Kelly stake, confidence, and risk flags.
- Trains on prior seasons and evaluates on the latest completed holdout season.
- Tracks prediction accuracy overall and by sport/league.
- Polls live results and exposes data health so you can tell whether you are using live or seeded fallback data.
- Keeps a local bet ledger in the browser so you can add recommendations and track bankroll impact.

## Run It

```powershell
npm test
npm run build
npm start
```

Then open:

```text
http://127.0.0.1:4317
```

World Cup page:

```text
http://127.0.0.1:4317/?view=worldcup
```

## Deploy On Render

The recommended hosted deployment target is Render because this project is a Node web service with API routes, live polling, and optional odds snapshot storage.

Use the included `render.yaml` Blueprint, or follow [docs/RENDER_DEPLOY.md](docs/RENDER_DEPLOY.md) for manual setup.

Production defaults:

```text
Build command: npm install && npm run build
Start command: npm start
Health check path: /api/health
```

The Blueprint uses a small persistent disk mounted at `/var/data` so closing-line snapshots can survive deploys. For a free demo, remove the disk block and use Render's free web service plan, with the tradeoff that server-side odds snapshots can reset.

## Use It As An App

Fastest local app launch:

```powershell
npm run app
```

Or double-click:

```text
EdgeLab Sports.cmd
```

That starts the local model server if needed and opens EdgeLab Sports in a dedicated Edge/Chrome app window. You can also install it from Edge/Chrome using the browser's install-app button because the project includes a PWA manifest, service worker, and app icons.

## Production Data Plan

This app is built so live data can replace seed data without changing the UI or model layer.

Recommended providers:

| Need | Production option | Notes |
| --- | --- | --- |
| Live scores/results | ESPN scoreboard adapters, SportsData.io, Sportradar | ESPN is useful for development; commercial providers are better for reliability/SLA. |
| Odds by sportsbook | The Odds API, SportsData.io, OddsJam, SportsbookReview feeds | Use closing-line history for CLV and model evaluation. |
| Historical results | Kaggle/open data for prototypes, SportsData.io/Sportradar for production | Needed for clean train/test splits by season. |
| Injuries/lineups | Rotowire, SportsData.io, league feeds | Useful risk flags, especially NBA/NFL/MLB. |

Environment variables:

```powershell
$env:PORT="4317"
$env:ENABLE_LIVE="true"
$env:LIVE_POLL_SECONDS="60"
```

The app will run without keys. If live calls fail, it falls back to seeded data and marks the source mode in Data Health.

World Cup 2026 source refresh:

```powershell
node scripts/refresh-worldcup2026.mjs
```

The app ships with a local World Cup seed so it works offline. The `/api/world-cup-2026?refresh=true` endpoint can also attempt a fresh public-source pull and falls back to the local seed if the source is unavailable.

World Cup odds and closing-line refresh:

```powershell
$env:ODDS_API_KEY="your_the_odds_api_key"
$env:ODDS_API_REGIONS="us"
$env:ODDS_API_MARKETS="h2h"
$env:ODDS_API_WORLD_CUP_SPORT_KEY="soccer_fifa_world_cup"
```

Then call:

```text
http://127.0.0.1:4317/api/odds/world-cup-2026?refresh=true&persist=true
```

Without `ODDS_API_KEY`, the app uses deterministic seed odds so the market-edge UI still works locally. With a key, the adapter follows The Odds API v4 odds shape: sport key, `regions`, `markets=h2h`, and `oddsFormat=american`. Persisted odds snapshots are stored at `data/odds-snapshots.json` and power the closing-line tracker.

## Modeling Notes

The model lab combines:

- Elo rating differential with margin-adjusted updates.
- Poisson/normal score distribution model.
- Bayesian form model with shrinkage toward league average.
- Market-implied prior from no-vig moneyline probabilities.
- Logistic stacked blend trained on historical pregame features.
- Holdout evaluation by season with log loss, Brier score, accuracy, ROI, and calibration error.

This is a serious local modeling skeleton, not a guarantee of profitable betting. Real profitability requires high-quality closing odds, injury/news timing, market limits, and careful risk controls.

The World Cup model is a separate 3-way soccer model that blends FIFA-ranking priors, host-nation venue adjustment, a Poisson expected-goals grid, and calibrated draw handling. Its fair odds are model prices; they become betting edges only when compared against a live sportsbook price after removing vig.

The odds layer keeps that separation explicit:

- Model fair price: what EdgeLab thinks the true price should be.
- Book price: best available sportsbook price from the odds provider.
- Edge: model probability minus book-implied probability.
- EV: expected unit profit at the available book price.
- Kelly: capped quarter-Kelly sizing for bankroll discipline.
- Closing-line tracker: persisted snapshots used to evaluate line movement and eventual CLV.
