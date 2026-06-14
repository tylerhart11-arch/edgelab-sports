# EdgeLab Sports Data Quality Audit

Generated: 2026-06-10T21:58:33.733Z

## Dataset And Grain

- Historical rows: 928
- Current slate rows: 7
- Recommended picks: 7
- Leagues: NFL, NBA, MLB, NHL, MLS, NCAAF, NCAAB
- Seasons: 2022, 2023, 2024, 2025

## Main Findings

### Critical: Historical games and odds are synthetic seeded data, not actual prior-season results or closing lines.

- Evidence: 928 historical rows are generated in src/data/sportsData.mjs; source labels are seed-historical.
- Impact: Holdout accuracy, ROI, feature weights, and action-model tuning are useful for UI plumbing only, not real betting confidence.
- Remediation: Replace seed history with provider-backed historical game results plus opening/closing odds before using recommendations financially.

### High: Some current slate games are past-dated but still marked scheduled.

- Evidence: 4 current slate rows have gameTime before audit time and status != final.
- Impact: Pick settlement and live accuracy can remain pending even after games should be settled.
- Remediation: Prefer live-provider canonical status for current slate, and add a test that past current-slate rows must be final or live-mapped.

### High: Holdout sizes are too small for stable per-league model selection.

- Evidence: 7/7 leagues have fewer than 50 holdout games.
- Impact: Log loss differences between action and benchmark models can be noise; league-level tuning may overfit demo history.
- Remediation: Train/test on full multi-season provider data and use rolling-origin backtests by season/week.

### Medium: Several recommended picks show unusually large model-market gaps.

- Evidence: 2/7 current picks include model-market gap flags; 2 have edge > 12%.
- Impact: Large apparent edges are more likely seed-data artifacts than true sportsbook mispricing.
- Remediation: Keep the risk flag, lower confidence on model-market gaps, and validate against real closing-line movement.

## Key Evidence

- Duplicate game ids: 0
- Bad league refs: 0
- Bad team refs: 0
- Invalid odds rows: 0
- Past current slate rows not final: 4
- Model-market gap picks: 2
- Capped Kelly picks: 2

## League Model Profile

| League | Historical | Current | Train | Test | Action | Benchmark | Best LL | Action LL | Action Cal |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |
| NFL | 128 | 1 | 96 | 32 | logistic | market | 0.681 | 0.742 | 0.181 |
| NBA | 128 | 1 | 96 | 32 | logistic | market | 0.662 | 0.716 | 0.159 |
| MLB | 160 | 1 | 120 | 40 | logistic | logistic | 0.261 | 0.261 | 0.157 |
| NHL | 128 | 1 | 96 | 32 | ensemble | logistic | 0.360 | 0.393 | 0.126 |
| MLS | 128 | 1 | 96 | 32 | logistic | logistic | 0.141 | 0.141 | 0.081 |
| NCAAF | 128 | 1 | 96 | 32 | ensemble | market | 0.705 | 0.730 | 0.164 |
| NCAAB | 128 | 1 | 96 | 32 | logistic | poisson | 0.667 | 0.672 | 0.139 |