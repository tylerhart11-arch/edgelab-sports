# Render Deployment

EdgeLab Sports is a Node web service, so deploy it on Render as a Web Service.

## Recommended Setup

Use the included `render.yaml` Blueprint.

1. Push this project to a GitHub repository.
2. Open Render.
3. Choose **New** > **Blueprint**.
4. Connect the GitHub repository.
5. Render should detect `render.yaml`.
6. Add `ODDS_API_KEY` when Render prompts for it, or leave it blank to run with seeded demo odds.
7. Deploy.

Render will use:

| Field | Value |
| --- | --- |
| Runtime | `node` |
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Health check | `/api/health` |
| Data directory | `/var/data` |

## Cost Choice

The blueprint uses Render's `starter` plan with a 1 GB persistent disk. That is the better fit for this app because odds snapshots and closing-line tracking survive restarts and redeploys.

For a free demo, remove the `disk` block from `render.yaml`, change `plan: starter` to `plan: free`, and remove the `EDGELAB_DATA_DIR` env var. The app will still run, but odds snapshots saved on the server can reset after restarts or redeploys.

The browser bet ledger is stored in each user's browser local storage either way.

## Manual Web Service Setup

If you do not use the Blueprint, create a Render Web Service with:

```text
Language: Node
Build Command: npm install && npm run build
Start Command: npm start
Health Check Path: /api/health
```

Environment variables:

```text
ENABLE_LIVE=true
LIVE_POLL_SECONDS=60
EDGELAB_DATA_DIR=/var/data
ODDS_API_REGIONS=us
ODDS_API_MARKETS=h2h
ODDS_API_WORLD_CUP_SPORT_KEY=soccer_fifa_world_cup
ODDS_API_KEY=your_key_here
```

`ODDS_API_KEY` is optional. Without it, the World Cup odds page uses labeled seeded odds so the UI remains usable.

