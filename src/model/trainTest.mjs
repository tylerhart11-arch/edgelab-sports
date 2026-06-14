import {
  accuracy,
  brierScore,
  calibrationError,
  clamp,
  expectedValue,
  kellyFraction,
  logit,
  logLoss,
  normalCdf,
  probToAmerican,
  removeVig,
  sigmoid
} from "./stats.mjs";
import { getLeague } from "../data/sportsData.mjs";

const MODEL_NAMES = ["elo", "poisson", "bayesian", "market", "logistic", "ensemble"];
const ACTION_LOGLOSS_TOLERANCE = 0.05;
const ACTION_CALIBRATION_TOLERANCE = 0.05;

function createTeamState() {
  return {
    elo: 1500,
    games: 0,
    wins: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    recentMargins: []
  };
}

function createState() {
  return {
    teams: new Map(),
    leagueGames: 0,
    leaguePoints: 0
  };
}

function teamKey(game, side) {
  return `${game.league}:${side === "home" ? game.homeTeamId || game.homeTeam : game.awayTeamId || game.awayTeam}`;
}

function ensureTeam(state, key) {
  if (!state.teams.has(key)) state.teams.set(key, createTeamState());
  return state.teams.get(key);
}

function averagePoints(team, fallback) {
  return team.games ? team.pointsFor / team.games : fallback;
}

function averageAllowed(team, fallback) {
  return team.games ? team.pointsAgainst / team.games : fallback;
}

function recentMargin(team) {
  if (!team.recentMargins.length) return 0;
  return team.recentMargins.reduce((sum, margin, idx) => sum + margin * (idx + 1), 0) /
    team.recentMargins.reduce((sum, _margin, idx) => sum + idx + 1, 0);
}

function predictBaseModels(state, game) {
  const league = getLeague(game.league);
  const home = ensureTeam(state, teamKey(game, "home"));
  const away = ensureTeam(state, teamKey(game, "away"));
  const leagueAverage = state.leagueGames ? state.leaguePoints / (state.leagueGames * 2) : league.baseScore;
  const homeAdvElo = league.homeAdvantagePoints * 12;
  const eloDelta = home.elo - away.elo + homeAdvElo;
  const elo = 1 / (1 + 10 ** (-eloDelta / 400));

  const homeExpected = (averagePoints(home, leagueAverage) + averageAllowed(away, leagueAverage) + leagueAverage) / 3 +
    league.homeAdvantagePoints;
  const awayExpected = (averagePoints(away, leagueAverage) + averageAllowed(home, leagueAverage) + leagueAverage) / 3;
  const diffMean = homeExpected - awayExpected;
  const diffVariance = Math.max(1, homeExpected + awayExpected + league.scoreVolatility / 2);
  const poisson = clamp(normalCdf(diffMean / Math.sqrt(diffVariance)), 0.05, 0.95);

  const homeWinRate = (home.wins + 1) / (home.games + 2);
  const awayWinRate = (away.wins + 1) / (away.games + 2);
  const recordSignal = sigmoid((homeWinRate - awayWinRate) * 3);
  const formSignal = sigmoid((recentMargin(home) - recentMargin(away) + league.homeAdvantagePoints) / league.marginScale);
  const bayesian = clamp(0.55 * recordSignal + 0.45 * formSignal, 0.05, 0.95);

  const market = removeVig(game.homeMoneyline, game.awayMoneyline).home;
  const rest = clamp(((game.restDaysHome ?? 3) - (game.restDaysAway ?? 3)) / 7, -1, 1);
  const injury = clamp((game.injurySignalAway ?? 0) - (game.injurySignalHome ?? 0), -0.5, 0.5);

  return {
    elo,
    poisson,
    bayesian,
    market,
    rest,
    injury,
    homeExpected,
    awayExpected
  };
}

function updateState(state, game) {
  if (!Number.isFinite(game.homeScore) || !Number.isFinite(game.awayScore)) return;
  const league = getLeague(game.league);
  const home = ensureTeam(state, teamKey(game, "home"));
  const away = ensureTeam(state, teamKey(game, "away"));
  const actual = game.homeScore > game.awayScore ? 1 : 0;
  const expected = 1 / (1 + 10 ** (-(home.elo - away.elo + league.homeAdvantagePoints * 12) / 400));
  const margin = Math.abs(game.homeScore - game.awayScore);
  const k = 18 + Math.log1p(margin) * 5;
  const change = k * (actual - expected);
  home.elo += change;
  away.elo -= change;
  home.games += 1;
  away.games += 1;
  home.wins += actual;
  away.wins += 1 - actual;
  home.pointsFor += game.homeScore;
  home.pointsAgainst += game.awayScore;
  away.pointsFor += game.awayScore;
  away.pointsAgainst += game.homeScore;
  home.recentMargins.push(game.homeScore - game.awayScore);
  away.recentMargins.push(game.awayScore - game.homeScore);
  home.recentMargins = home.recentMargins.slice(-6);
  away.recentMargins = away.recentMargins.slice(-6);
  state.leagueGames += 1;
  state.leaguePoints += game.homeScore + game.awayScore;
}

function rowFromGame(state, game) {
  const base = predictBaseModels(state, game);
  return {
    game,
    actual: game.homeScore > game.awayScore ? 1 : 0,
    base,
    features: [
      1,
      logit(base.elo),
      logit(base.poisson),
      logit(base.bayesian),
      logit(base.market),
      base.rest,
      base.injury
    ]
  };
}

function buildRows(games, initialState = createState(), update = true) {
  const rows = [];
  const state = initialState;
  for (const game of [...games].sort((a, b) => new Date(a.gameTime) - new Date(b.gameTime))) {
    rows.push(rowFromGame(state, game));
    if (update) updateState(state, game);
  }
  return { rows, state };
}

function fitLogistic(rows) {
  const featureCount = rows[0]?.features.length ?? 0;
  let weights = Array.from({ length: featureCount }, (_, idx) => (idx === 0 ? 0 : 0.18));
  const lr = 0.035;
  const l2 = 0.004;
  for (let epoch = 0; epoch < 700; epoch += 1) {
    const gradients = Array.from({ length: featureCount }, () => 0);
    for (const row of rows) {
      const z = row.features.reduce((sum, feature, idx) => sum + feature * weights[idx], 0);
      const prediction = sigmoid(z);
      const error = prediction - row.actual;
      row.features.forEach((feature, idx) => {
        gradients[idx] += error * feature + (idx === 0 ? 0 : l2 * weights[idx]);
      });
    }
    weights = weights.map((weight, idx) => weight - (lr * gradients[idx]) / Math.max(1, rows.length));
  }
  return weights;
}

function logisticProbability(weights, row) {
  if (!weights?.length) return row.base.market;
  return clamp(sigmoid(row.features.reduce((sum, feature, idx) => sum + feature * weights[idx], 0)), 0.03, 0.97);
}

function scoreCandidate(name, predictions) {
  const rows = predictions.map((row) => ({ probability: row[name], actual: row.actual }));
  const pickRows = predictions.map((row) => {
    const selectedHome = row[name] >= 0.5;
    const selectedProb = selectedHome ? row[name] : 1 - row[name];
    const odds = selectedHome ? row.game.homeMoneyline : row.game.awayMoneyline;
    const ev = expectedValue(selectedProb, odds);
    const won = selectedHome ? row.actual === 1 : row.actual === 0;
    return { selectedProb, odds, ev, won };
  }).filter((row) => row.ev > 0.01);
  const roi = pickRows.length
    ? pickRows.reduce((sum, row) => {
      const profit = row.won
        ? (row.odds > 0 ? row.odds / 100 : 100 / Math.abs(row.odds))
        : -1;
      return sum + profit;
    }, 0) / pickRows.length
    : 0;
  return {
    name,
    games: rows.length,
    logLoss: logLoss(rows),
    brier: brierScore(rows),
    accuracy: accuracy(rows),
    calibrationError: calibrationError(rows),
    recommendedPicks: pickRows.length,
    roi
  };
}

function blendWeights(candidateMetrics) {
  const base = candidateMetrics.filter((metric) => metric.name !== "ensemble");
  const minLoss = Math.min(...base.map((metric) => metric.logLoss));
  const raw = base.map((metric) => ({
    name: metric.name,
    weight: Math.exp(-(metric.logLoss - minLoss) * 12)
  }));
  const total = raw.reduce((sum, row) => sum + row.weight, 0) || 1;
  return Object.fromEntries(raw.map((row) => [row.name, row.weight / total]));
}

function applyEnsemble(row, weights) {
  return clamp(
    row.elo * (weights.elo ?? 0) +
    row.poisson * (weights.poisson ?? 0) +
    row.bayesian * (weights.bayesian ?? 0) +
    row.market * (weights.market ?? 0) +
    row.logistic * (weights.logistic ?? 0),
    0.03,
    0.97
  );
}

function metricLookup(metrics) {
  return Object.fromEntries(metrics.map((metric) => [metric.name, metric]));
}

function selectActionModel(metrics) {
  const byName = metricLookup(metrics);
  const logistic = byName.logistic;
  const ensemble = byName.ensemble;
  if (logistic && ensemble) {
    const logisticCloseEnough =
      logistic.logLoss <= ensemble.logLoss + ACTION_LOGLOSS_TOLERANCE &&
      logistic.calibrationError <= ensemble.calibrationError + ACTION_CALIBRATION_TOLERANCE;
    if (logisticCloseEnough) return "logistic";
    return "ensemble";
  }
  return metrics.find((metric) => metric.name !== "market")?.name ?? metrics[0]?.name ?? "ensemble";
}

export function fitLeagueModel(leagueId, games) {
  const leagueGames = games.filter((game) => game.league === leagueId && game.status === "final");
  const seasons = [...new Set(leagueGames.map((game) => game.season))].sort();
  const holdoutSeason = seasons.at(-1);
  const trainGames = leagueGames.filter((game) => game.season < holdoutSeason);
  const testGames = leagueGames.filter((game) => game.season === holdoutSeason);
  const trainState = createState();
  const { rows: trainRows } = buildRows(trainGames, trainState, true);
  const logisticWeights = fitLogistic(trainRows);
  const testState = trainState;
  const { rows: testRows } = buildRows(testGames, testState, true);
  const testPredictions = testRows.map((row) => ({
    game: row.game,
    actual: row.actual,
    elo: row.base.elo,
    poisson: row.base.poisson,
    bayesian: row.base.bayesian,
    market: row.base.market,
    logistic: logisticProbability(logisticWeights, row)
  }));
  const baseMetrics = ["elo", "poisson", "bayesian", "market", "logistic"].map((name) => scoreCandidate(name, testPredictions));
  const weights = blendWeights(baseMetrics);
  testPredictions.forEach((row) => {
    row.ensemble = applyEnsemble(row, weights);
  });
  const metrics = [...baseMetrics, scoreCandidate("ensemble", testPredictions)].sort((a, b) => a.logLoss - b.logLoss);
  const benchmarkModel = metrics[0].name;
  const actionModel = selectActionModel(metrics);
  const productionState = createState();
  buildRows(leagueGames, productionState, true);
  return {
    leagueId,
    trainSeasons: seasons.filter((season) => season < holdoutSeason),
    testSeason: holdoutSeason,
    trainGames: trainGames.length,
    testGames: testGames.length,
    logisticWeights,
    ensembleWeights: weights,
    benchmarkModel,
    actionModel,
    bestModel: actionModel,
    metrics,
    testPredictions,
    productionState
  };
}

export function runModelLab(games, leagueIds) {
  const models = Object.fromEntries(leagueIds.map((leagueId) => [leagueId, fitLeagueModel(leagueId, games)]));
  const allMetrics = Object.values(models).flatMap((model) => model.metrics.map((metric) => ({ ...metric, league: model.leagueId })));
  const aggregate = MODEL_NAMES.map((name) => {
    const rows = Object.values(models).flatMap((model) => model.testPredictions.map((row) => ({
      probability: row[name],
      actual: row.actual
    })));
    return {
      name,
      games: rows.length,
      logLoss: logLoss(rows),
      brier: brierScore(rows),
      accuracy: accuracy(rows),
      calibrationError: calibrationError(rows)
    };
  }).sort((a, b) => a.logLoss - b.logLoss);
  return {
    generatedAt: new Date().toISOString(),
    models,
    aggregate,
    allMetrics
  };
}

export function predictGame(modelLab, game) {
  const leagueModel = modelLab.models[game.league];
  if (!leagueModel) return null;
  const row = rowFromGame(leagueModel.productionState, game);
  const base = {
    elo: row.base.elo,
    poisson: row.base.poisson,
    bayesian: row.base.bayesian,
    market: row.base.market,
    logistic: logisticProbability(leagueModel.logisticWeights, row)
  };
  base.ensemble = applyEnsemble(base, leagueModel.ensembleWeights);
  const selectedModel = leagueModel.actionModel ?? (leagueModel.bestModel === "market" ? "ensemble" : leagueModel.bestModel);
  const market = removeVig(game.homeMoneyline, game.awayMoneyline);
  const rawHomeProbability = clamp(base[selectedModel] ?? base.ensemble, 0.03, 0.97);
  const calibrationShrink = clamp(0.28 + leagueModel.metrics[0].calibrationError * 1.8, 0.28, 0.48);
  const homeProbability = clamp(
    rawHomeProbability * (1 - calibrationShrink) + market.home * calibrationShrink,
    0.08,
    0.92
  );
  const homeEdge = homeProbability - market.home;
  const awayProbability = 1 - homeProbability;
  const awayEdge = awayProbability - market.away;
  const pickHome = homeEdge >= awayEdge;
  const pickProbability = pickHome ? homeProbability : awayProbability;
  const pickOdds = pickHome ? game.homeMoneyline : game.awayMoneyline;
  const edge = pickHome ? homeEdge : awayEdge;
  const fairOdds = probToAmerican(pickProbability);
  return {
    game,
    model: selectedModel,
    baseProbabilities: base,
    homeProbability,
    awayProbability,
    pickSide: pickHome ? "home" : "away",
    pickTeam: pickHome ? game.homeTeam : game.awayTeam,
    pickProbability,
    fairOdds,
    bookOdds: pickOdds,
    edge,
    expectedValue: expectedValue(pickProbability, pickOdds),
    kelly: kellyFraction(pickProbability, pickOdds),
    confidence: confidenceLabel(pickProbability, edge, leagueModel),
    riskFlags: riskFlags(game, pickProbability, edge, leagueModel, pickOdds, Math.abs(rawHomeProbability - market.home))
  };
}

function confidenceLabel(probability, edge, leagueModel) {
  const best = leagueModel.metrics[0];
  if (edge > 0.055 && probability > 0.6 && best.calibrationError < 0.08) return "A";
  if (edge > 0.035 && probability > 0.56) return "B";
  if (edge > 0.018) return "C";
  return "Watch";
}

function riskFlags(game, probability, edge, leagueModel, pickOdds, modelMarketGap) {
  const flags = [];
  if (edge < 0.018) flags.push("thin edge");
  if (game.source === "live-espn") flags.push("proxy odds");
  if (game.dataFreshness === "seed-fallback") flags.push("seed fallback");
  if (modelMarketGap > 0.18) flags.push("model-market gap");
  if ((game.injurySignalHome ?? 0) > 0.22 || (game.injurySignalAway ?? 0) > 0.22) flags.push("injury volatility");
  if (Math.abs((game.restDaysHome ?? 3) - (game.restDaysAway ?? 3)) >= 4) flags.push("rest mismatch");
  if (probability > 0.72 && Math.abs(pickOdds ?? 0) > 180) flags.push("price sensitivity");
  if (leagueModel.testGames < 20) flags.push("small holdout");
  return flags.length ? flags : ["normal"];
}
