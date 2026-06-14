import test from "node:test";
import assert from "node:assert/strict";
import { historicalGames, currentSlate, leagues } from "../src/data/sportsData.mjs";
import { buildAccuracyReport, buildRecommendedPicks } from "../src/model/picks.mjs";
import { runModelLab } from "../src/model/trainTest.mjs";
import { worldCupMatches, worldCupTeams } from "../src/data/worldCup2026Data.mjs";
import { buildWorldCupDashboard, predictWorldCupMatch } from "../src/model/worldCupModel.mjs";
import { buildSeedWorldCupOdds, buildWorldCupMarketBoard } from "../src/model/marketEdges.mjs";
import { espnLeaguePaths } from "../server/providers/espn.mjs";

test("coverage excludes WNBA from leagues, slate, training data, and live polling", () => {
  assert.equal(leagues.some((league) => league.id === "WNBA"), false);
  assert.equal(currentSlate.some((game) => game.league === "WNBA"), false);
  assert.equal(historicalGames.some((game) => game.league === "WNBA"), false);
  assert.equal(Object.hasOwn(espnLeaguePaths, "WNBA"), false);
});

test("model lab uses prior seasons for train and latest completed season for test", () => {
  const lab = runModelLab(historicalGames, leagues.map((league) => league.id));
  for (const model of Object.values(lab.models)) {
    assert.deepEqual(model.trainSeasons, [2022, 2023, 2024]);
    assert.equal(model.testSeason, 2025);
    assert.ok(model.trainGames > model.testGames);
    assert.ok(model.metrics.length >= 6);
    assert.notEqual(model.actionModel, "market");
  }
});

test("action model favors the tuned logistic stack for close NBA and NFL model races", () => {
  const lab = runModelLab(historicalGames, leagues.map((league) => league.id));
  assert.equal(lab.models.NBA.actionModel, "logistic");
  assert.equal(lab.models.NFL.actionModel, "logistic");
  assert.equal(lab.models.NBA.benchmarkModel, "market");
  assert.equal(lab.models.NFL.benchmarkModel, "market");
});

test("recommended picks have bounded probabilities, edges, and stake sizing", () => {
  const lab = runModelLab(historicalGames, leagues.map((league) => league.id));
  const picks = buildRecommendedPicks(lab, currentSlate);
  assert.ok(picks.length > 0);
  for (const pick of picks) {
    assert.ok(pick.modelWinProbability > 0.03 && pick.modelWinProbability < 0.97);
    assert.ok(Number.isFinite(pick.edge));
    assert.ok(pick.kelly >= 0 && pick.kelly <= 0.08);
    assert.ok(["A", "B", "C", "Watch"].includes(pick.confidence));
  }
});

test("accuracy report includes overall, sport, and league breakdowns", () => {
  const lab = runModelLab(historicalGames, leagues.map((league) => league.id));
  const report = buildAccuracyReport(lab);
  assert.ok(report.overall.picks > 0);
  assert.ok(report.bySport.length >= 4);
  assert.ok(report.byLeague.length >= leagues.length);
  assert.ok(report.bestFitByLeague.every((row) => row.trainSeasons.includes(2024) && row.testSeason === 2025));
});

test("World Cup 2026 seed covers the full 48-team, 104-match tournament", () => {
  assert.equal(worldCupTeams.length, 48);
  assert.equal(worldCupMatches.length, 104);
  assert.equal(worldCupMatches.filter((match) => match.group).length, 72);
  assert.equal(worldCupMatches.filter((match) => !match.group).length, 32);
  assert.equal(new Set(worldCupMatches.map((match) => match.matchNo)).size, 104);
  assert.deepEqual(
    [...new Set(worldCupTeams.map((team) => team.group))],
    "ABCDEFGHIJKL".split("")
  );
});

test("World Cup model scores known fixtures and defers placeholder fixtures", () => {
  const known = worldCupMatches.find((match) => match.participantStatus === "known" && match.status !== "final");
  const placeholder = worldCupMatches.find((match) => match.participantStatus === "placeholder");
  const knownPrediction = predictWorldCupMatch(known);
  const placeholderPrediction = predictWorldCupMatch(placeholder);

  assert.equal(knownPrediction.predictionStatus, "modeled");
  assert.equal(placeholderPrediction.predictionStatus, "pending-participants");
  assert.ok(knownPrediction.probabilities.home > 0 && knownPrediction.probabilities.home < 1);
  assert.ok(knownPrediction.probabilities.draw > 0 && knownPrediction.probabilities.draw < 1);
  assert.ok(knownPrediction.probabilities.away > 0 && knownPrediction.probabilities.away < 1);
  assert.ok(Math.abs(
    knownPrediction.probabilities.home +
    knownPrediction.probabilities.draw +
    knownPrediction.probabilities.away -
    1
  ) < 0.000001);
});

test("World Cup dashboard reports source-quality checks and group outlooks", () => {
  const dashboard = buildWorldCupDashboard();
  assert.equal(dashboard.quality.rowCount, 104);
  assert.equal(dashboard.quality.duplicateMatchNumbers, 0);
  assert.equal(dashboard.groupOutlooks.length, 12);
  assert.equal(dashboard.simulation.simulations, 4000);
  assert.ok(dashboard.simulation.topChampions[0].championProbability > 0);
  assert.ok(dashboard.simulation.topAdvancers[0].advanceProbability > 0.5);
  assert.ok(dashboard.simulation.teams.every((team) =>
    team.advanceProbability >= 0 &&
    team.advanceProbability <= 1 &&
    team.round32Probability >= 0 &&
    team.round32Probability <= 1 &&
    team.championProbability >= 0 &&
    team.championProbability <= 1
  ));
  assert.equal(dashboard.groupDifficulty.length, 12);
  assert.ok(dashboard.upsetWatch.length > 0);
  assert.ok(dashboard.bestPicks.length > 0);
  assert.ok(dashboard.quality.checks.every((check) => ["pass", "watch", "fail"].includes(check.status)));
});

test("World Cup seeded odds produce bounded market-edge calculations", () => {
  const dashboard = buildWorldCupDashboard();
  const odds = buildSeedWorldCupOdds(dashboard.matches);
  const board = buildWorldCupMarketBoard(dashboard, odds, { snapshotCount: 0, status: "empty" });

  assert.equal(board.source.mode, "seed");
  assert.ok(board.summary.oddsEventCount > 0);
  assert.ok(board.summary.averageHold > 0);
  assert.ok(board.summary.averageHold < 0.12);
  assert.ok(board.summary.maxExpectedValue < 0.35);
  assert.ok(board.bestEdges.length > 0);
  for (const edge of board.bestEdges) {
    assert.ok(edge.modelProbability > 0 && edge.modelProbability < 1);
    assert.ok(Number.isFinite(edge.bookOdds));
    assert.ok(Number.isFinite(edge.expectedValue));
    assert.ok(edge.kelly >= 0 && edge.kelly <= 0.08);
    assert.ok(["A", "B", "C", "Watch"].includes(edge.confidence));
  }
});
