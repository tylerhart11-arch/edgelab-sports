import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { historicalGames, currentSlate, leagues, teamsByLeague } from "../src/data/sportsData.mjs";
import { buildAccuracyReport, buildRecommendedPicks } from "../src/model/picks.mjs";
import { runModelLab } from "../src/model/trainTest.mjs";
import { espnLeaguePaths } from "../server/providers/espn.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "qa");
const now = new Date();
const leagueIds = leagues.map((league) => league.id);
const modelLab = runModelLab(historicalGames, leagueIds);
const picks = buildRecommendedPicks(modelLab, currentSlate);
const accuracy = buildAccuracyReport(modelLab);

const allGameRows = [...historicalGames, ...currentSlate];

function countBy(rows, keyFn) {
  return rows.reduce((counts, row) => {
    const key = keyFn(row);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function dupes(rows, keyFn) {
  return Object.entries(countBy(rows, keyFn)).filter(([, count]) => count > 1);
}

function nullish(value) {
  return value === null || value === undefined || value === "";
}

function pct(value, denom) {
  return denom ? value / denom : 0;
}

function dateOnly(date) {
  return new Date(date).toISOString().slice(0, 10);
}

const requiredGameColumns = [
  "id",
  "league",
  "sport",
  "season",
  "gameTime",
  "status",
  "homeTeam",
  "awayTeam",
  "homeMoneyline",
  "awayMoneyline",
  "total",
  "spread"
];

const nullRates = Object.fromEntries(requiredGameColumns.map((column) => [
  column,
  pct(allGameRows.filter((row) => nullish(row[column])).length, allGameRows.length)
]));

const invalidOddsRows = allGameRows.filter((row) =>
  !Number.isFinite(row.homeMoneyline) ||
  !Number.isFinite(row.awayMoneyline) ||
  row.homeMoneyline === 0 ||
  row.awayMoneyline === 0 ||
  Math.abs(row.homeMoneyline) < 80 ||
  Math.abs(row.awayMoneyline) < 80
);

const invalidScores = historicalGames.filter((row) =>
  row.status === "final" &&
  (!Number.isFinite(row.homeScore) || !Number.isFinite(row.awayScore) || row.homeScore < 0 || row.awayScore < 0)
);

const badLeagueRefs = allGameRows.filter((row) => !leagueIds.includes(row.league));
const badTeamRefs = allGameRows.filter((row) => {
  const teams = new Set((teamsByLeague[row.league] ?? []).map(([id]) => id));
  return !teams.has(row.homeTeamId) || !teams.has(row.awayTeamId);
});

const statusValues = countBy(allGameRows, (row) => row.status);
const currentStatusByDate = currentSlate.map((row) => ({
  id: row.id,
  league: row.league,
  status: row.status,
  gameDate: dateOnly(row.gameTime),
  isPast: new Date(row.gameTime) < now
})).filter((row) => row.isPast && row.status !== "final");

const seasons = [...new Set(historicalGames.map((row) => row.season))].sort();
const leagueProfile = leagueIds.map((leagueId) => {
  const historical = historicalGames.filter((row) => row.league === leagueId);
  const slate = currentSlate.filter((row) => row.league === leagueId);
  const model = modelLab.models[leagueId];
  return {
    league: leagueId,
    teams: teamsByLeague[leagueId]?.length ?? 0,
    historicalRows: historical.length,
    currentRows: slate.length,
    seasons: [...new Set(historical.map((row) => row.season))].sort(),
    trainGames: model.trainGames,
    testGames: model.testGames,
    actionModel: model.actionModel,
    benchmarkModel: model.benchmarkModel,
    bestLogLoss: model.metrics[0].logLoss,
    actionLogLoss: model.metrics.find((metric) => metric.name === model.actionModel)?.logLoss,
    actionCalibrationError: model.metrics.find((metric) => metric.name === model.actionModel)?.calibrationError
  };
});

const tinyHoldouts = leagueProfile.filter((row) => row.testGames < 50);
const actionBenchmarkGaps = leagueProfile.map((row) => ({
  league: row.league,
  actionModel: row.actionModel,
  benchmarkModel: row.benchmarkModel,
  logLossGap: (row.actionLogLoss ?? row.bestLogLoss) - row.bestLogLoss,
  actionCalibrationError: row.actionCalibrationError
})).filter((row) => row.logLossGap > 0.05 || row.actionCalibrationError > 0.15);

const pickQuality = picks.map((pick) => ({
  id: pick.id,
  league: pick.league,
  matchup: pick.matchup,
  model: pick.model,
  probability: pick.modelWinProbability,
  edge: pick.edge,
  kelly: pick.kelly,
  riskFlags: pick.riskFlags
}));

const oversizedEdges = pickQuality.filter((pick) => pick.edge > 0.12);
const cappedKelly = pickQuality.filter((pick) => pick.kelly >= 0.08);
const modelMarketGaps = pickQuality.filter((pick) => pick.riskFlags.includes("model-market gap"));

const report = {
  generatedAt: now.toISOString(),
  sourceFiles: [
    "src/data/sportsData.mjs",
    "src/model/trainTest.mjs",
    "src/model/picks.mjs",
    "server/providers/espn.mjs"
  ],
  datasetSummary: {
    intendedUse: "sports betting analytics dashboard, model tuning view, best-bets recommendations, and accuracy reporting",
    grain: {
      historicalGames: "one row per league-game-season matchup at pregame moneyline grain",
      currentSlate: "one row per upcoming or live game at moneyline market grain",
      modelPredictions: "one row per holdout game per model candidate"
    },
    leagues: leagueIds,
    seasons,
    rowCounts: {
      historicalGames: historicalGames.length,
      currentSlate: currentSlate.length,
      allGameRows: allGameRows.length,
      recommendedPicks: picks.length
    },
    modelAccuracy: {
      overall: accuracy.overall,
      recommended: accuracy.recommended,
      bySport: accuracy.bySport,
      byLeague: accuracy.byLeague
    }
  },
  checks: {
    completeness: {
      requiredColumns: requiredGameColumns,
      nullRates
    },
    uniqueness: {
      duplicateGameIds: dupes(allGameRows, (row) => row.id),
      duplicateCurrentSlateIds: dupes(currentSlate, (row) => row.id),
      duplicateHistoricalCompositeKeys: dupes(historicalGames, (row) => `${row.league}|${row.season}|${row.homeTeamId}|${row.awayTeamId}|${dateOnly(row.gameTime)}`)
    },
    validity: {
      invalidOddsRows: invalidOddsRows.map((row) => row.id),
      invalidScores: invalidScores.map((row) => row.id),
      statusValues
    },
    integrity: {
      badLeagueRefs: badLeagueRefs.map((row) => row.id),
      badTeamRefs: badTeamRefs.map((row) => row.id),
      missingEspnMappings: leagueIds.filter((leagueId) => !espnLeaguePaths[leagueId])
    },
    timeliness: {
      pastCurrentSlateRowsNotFinal: currentStatusByDate,
      minHistoricalDate: historicalGames.at(0)?.gameTime,
      maxHistoricalDate: historicalGames.at(-1)?.gameTime,
      minCurrentDate: currentSlate.map((row) => row.gameTime).sort()[0],
      maxCurrentDate: currentSlate.map((row) => row.gameTime).sort().at(-1)
    },
    modelQuality: {
      leagueProfile,
      tinyHoldouts,
      actionBenchmarkGaps,
      oversizedEdges,
      cappedKelly,
      modelMarketGaps
    }
  },
  riskSummary: [
    {
      severity: "Critical",
      issue: "Historical games and odds are synthetic seeded data, not actual prior-season results or closing lines.",
      evidence: `${historicalGames.length} historical rows are generated in src/data/sportsData.mjs; source labels are seed-historical.`,
      impact: "Holdout accuracy, ROI, feature weights, and action-model tuning are useful for UI plumbing only, not real betting confidence.",
      remediation: "Replace seed history with provider-backed historical game results plus opening/closing odds before using recommendations financially."
    },
    {
      severity: "High",
      issue: "Some current slate games are past-dated but still marked scheduled.",
      evidence: `${currentStatusByDate.length} current slate rows have gameTime before audit time and status != final.`,
      impact: "Pick settlement and live accuracy can remain pending even after games should be settled.",
      remediation: "Prefer live-provider canonical status for current slate, and add a test that past current-slate rows must be final or live-mapped."
    },
    {
      severity: "High",
      issue: "Holdout sizes are too small for stable per-league model selection.",
      evidence: `${tinyHoldouts.length}/${leagueProfile.length} leagues have fewer than 50 holdout games.`,
      impact: "Log loss differences between action and benchmark models can be noise; league-level tuning may overfit demo history.",
      remediation: "Train/test on full multi-season provider data and use rolling-origin backtests by season/week."
    },
    {
      severity: "Medium",
      issue: "Several recommended picks show unusually large model-market gaps.",
      evidence: `${modelMarketGaps.length}/${picks.length} current picks include model-market gap flags; ${oversizedEdges.length} have edge > 12%.`,
      impact: "Large apparent edges are more likely seed-data artifacts than true sportsbook mispricing.",
      remediation: "Keep the risk flag, lower confidence on model-market gaps, and validate against real closing-line movement."
    }
  ]
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "data-quality-audit.json"), JSON.stringify(report, null, 2));

const markdown = [
  "# EdgeLab Sports Data Quality Audit",
  "",
  `Generated: ${report.generatedAt}`,
  "",
  "## Dataset And Grain",
  "",
  `- Historical rows: ${historicalGames.length}`,
  `- Current slate rows: ${currentSlate.length}`,
  `- Recommended picks: ${picks.length}`,
  `- Leagues: ${leagueIds.join(", ")}`,
  `- Seasons: ${seasons.join(", ")}`,
  "",
  "## Main Findings",
  "",
  ...report.riskSummary.map((finding) => [
    `### ${finding.severity}: ${finding.issue}`,
    "",
    `- Evidence: ${finding.evidence}`,
    `- Impact: ${finding.impact}`,
    `- Remediation: ${finding.remediation}`,
    ""
  ].join("\n")),
  "## Key Evidence",
  "",
  `- Duplicate game ids: ${report.checks.uniqueness.duplicateGameIds.length}`,
  `- Bad league refs: ${report.checks.integrity.badLeagueRefs.length}`,
  `- Bad team refs: ${report.checks.integrity.badTeamRefs.length}`,
  `- Invalid odds rows: ${report.checks.validity.invalidOddsRows.length}`,
  `- Past current slate rows not final: ${currentStatusByDate.length}`,
  `- Model-market gap picks: ${modelMarketGaps.length}`,
  `- Capped Kelly picks: ${cappedKelly.length}`,
  "",
  "## League Model Profile",
  "",
  "| League | Historical | Current | Train | Test | Action | Benchmark | Best LL | Action LL | Action Cal |",
  "| --- | ---: | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |",
  ...leagueProfile.map((row) => `| ${row.league} | ${row.historicalRows} | ${row.currentRows} | ${row.trainGames} | ${row.testGames} | ${row.actionModel} | ${row.benchmarkModel} | ${row.bestLogLoss.toFixed(3)} | ${(row.actionLogLoss ?? 0).toFixed(3)} | ${(row.actionCalibrationError ?? 0).toFixed(3)} |`)
].join("\n");

await writeFile(join(outDir, "data-quality-audit.md"), markdown);

console.log(JSON.stringify({
  ok: true,
  outputJson: "qa/data-quality-audit.json",
  outputMarkdown: "qa/data-quality-audit.md",
  rowCounts: report.datasetSummary.rowCounts,
  riskSummary: report.riskSummary.map((row) => ({ severity: row.severity, issue: row.issue }))
}, null, 2));
