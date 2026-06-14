import { accuracy, brierScore, calibrationError, expectedValue, logLoss } from "./stats.mjs";
import { predictGame } from "./trainTest.mjs";

export function buildRecommendedPicks(modelLab, games, options = {}) {
  const minEdge = options.minEdge ?? 0.012;
  return games
    .filter((game) => isActionablePregame(game, options))
    .map((game) => predictGame(modelLab, game))
    .filter(Boolean)
    .map((pick) => ({
      id: `${pick.game.id}-${pick.pickSide}`,
      gameId: pick.game.id,
      league: pick.game.league,
      sport: pick.game.sport,
      gameTime: pick.game.gameTime,
      matchup: `${pick.game.awayTeam} at ${pick.game.homeTeam}`,
      market: "Moneyline",
      pick: pick.pickTeam,
      pickSide: pick.pickSide,
      model: pick.model,
      modelWinProbability: pick.pickProbability,
      homeProbability: pick.homeProbability,
      awayProbability: pick.awayProbability,
      fairOdds: pick.fairOdds,
      bookOdds: pick.bookOdds,
      edge: pick.edge,
      expectedValue: pick.expectedValue,
      kelly: pick.kelly,
      confidence: pick.confidence,
      riskFlags: pick.riskFlags,
      status: pick.game.status,
      source: pick.game.source,
      dataFreshness: pick.game.dataFreshness ?? "unknown",
      liveScore: pick.game.liveScore ?? null,
      result: settlePick(pick)
    }))
    .filter((pick) => pick.edge >= minEdge || pick.confidence !== "Watch")
    .sort((a, b) => b.expectedValue - a.expectedValue);
}

function isActionablePregame(game, options = {}) {
  if (!game || game.stale || game.source === "stale-seed") return false;
  if (game.status !== "scheduled") return false;
  const now = options.now ? new Date(options.now).getTime() : Date.now();
  const gameTime = new Date(game.gameTime).getTime();
  if (!Number.isFinite(gameTime)) return false;
  return gameTime > now - 30 * 60 * 1000;
}

export function settlePick(pick) {
  const game = pick.game;
  if (game.status !== "final" || !Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore)) {
    return "pending";
  }
  if (game.homeScore === game.awayScore) return "push";
  const homeWon = game.homeScore > game.awayScore;
  const pickedHome = pick.pickSide === "home";
  return homeWon === pickedHome ? "win" : "loss";
}

export function buildAccuracyReport(modelLab) {
  const predictionRows = Object.values(modelLab.models).flatMap((model) =>
    model.testPredictions.map((row) => {
      const probability = row.ensemble;
      const pickHome = probability >= 0.5;
      const selectedProbability = pickHome ? probability : 1 - probability;
      const odds = pickHome ? row.game.homeMoneyline : row.game.awayMoneyline;
      const ev = expectedValue(selectedProbability, odds);
      const won = pickHome ? row.actual === 1 : row.actual === 0;
      return {
        league: row.game.league,
        sport: row.game.sport,
        probability,
        selectedProbability,
        actual: row.actual,
        pickCorrect: won,
        ev,
        odds,
        recommended: ev > 0.01,
        season: row.game.season
      };
    })
  );
  const recommended = predictionRows.filter((row) => row.recommended);
  return {
    overall: summarizeRows(predictionRows),
    recommended: summarizeRows(recommended),
    bySport: groupSummaries(predictionRows, "sport"),
    byLeague: groupSummaries(predictionRows, "league"),
    bestFitByLeague: Object.values(modelLab.models).map((model) => ({
      league: model.leagueId,
      bestModel: model.bestModel,
      actionModel: model.actionModel,
      benchmarkModel: model.benchmarkModel,
      trainSeasons: model.trainSeasons,
      testSeason: model.testSeason,
      trainGames: model.trainGames,
      testGames: model.testGames,
      bestLogLoss: model.metrics[0].logLoss,
      bestBrier: model.metrics[0].brier,
      bestAccuracy: model.metrics[0].accuracy
    }))
  };
}

function summarizeRows(rows) {
  if (!rows.length) {
    return {
      picks: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      accuracy: 0,
      logLoss: 0,
      brier: 0,
      calibrationError: 0,
      roi: 0,
      avgEdgeProxy: 0
    };
  }
  const wins = rows.filter((row) => row.pickCorrect).length;
  const losses = rows.length - wins;
  const roi = rows.reduce((sum, row) => {
    const profit = row.pickCorrect
      ? (row.odds > 0 ? row.odds / 100 : 100 / Math.abs(row.odds))
      : -1;
    return sum + profit;
  }, 0) / rows.length;
  const probabilityRows = rows.map((row) => ({ probability: row.probability, actual: row.actual }));
  return {
    picks: rows.length,
    wins,
    losses,
    pushes: 0,
    accuracy: wins / rows.length,
    logLoss: logLoss(probabilityRows),
    brier: brierScore(probabilityRows),
    calibrationError: calibrationError(probabilityRows),
    roi,
    avgEdgeProxy: rows.reduce((sum, row) => sum + row.ev, 0) / rows.length
  };
}

function groupSummaries(rows, key) {
  const groups = new Map();
  rows.forEach((row) => {
    const group = row[key] || "Unknown";
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  });
  return [...groups.entries()]
    .map(([name, groupRows]) => ({ name, ...summarizeRows(groupRows) }))
    .sort((a, b) => b.picks - a.picks);
}
