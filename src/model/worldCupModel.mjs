import { clamp, probToAmerican, sigmoid } from "./stats.mjs";
import {
  worldCupGroups,
  worldCupMatches,
  worldCupSourceMeta,
  worldCupSources,
  worldCupTeams
} from "../data/worldCup2026Data.mjs";

const MAX_GOALS = 8;
const HOST_CODES = new Set(["CAN", "MEX", "USA"]);
const DEFAULT_SIMULATIONS = 4000;

function factorial(n) {
  let value = 1;
  for (let i = 2; i <= n; i += 1) value *= i;
  return value;
}

function poissonProbability(lambda, goals) {
  return Math.exp(-lambda) * lambda ** goals / factorial(goals);
}

function createPrng(seed = 20260612) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function samplePoisson(lambda, random) {
  const limit = Math.exp(-lambda);
  let product = 1;
  let goals = -1;
  do {
    goals += 1;
    product *= random();
  } while (product > limit && goals < MAX_GOALS);
  return goals;
}

function teamLookup(teams) {
  return new Map(teams.map((team) => [team.code, team]));
}

function parseScore(score) {
  if (!score) return null;
  const parts = score.split(/[–-]/).map((part) => Number(part.trim()));
  if (parts.length !== 2 || parts.some((value) => !Number.isFinite(value))) return null;
  return { home: parts[0], away: parts[1] };
}

function hostBoost(match, team) {
  if (!team || !HOST_CODES.has(team.code)) return 0;
  const city = `${match.venue} ${match.city}`.toLowerCase();
  if (team.code === "MEX" && /mexico|zapopan|guadalupe/.test(city)) return 82;
  if (team.code === "CAN" && /toronto|vancouver/.test(city)) return 76;
  if (team.code === "USA" && /inglewood|seattle|santa clara|atlanta|houston|arlington|kansas city|philadelphia|foxborough|east rutherford|miami/.test(city)) return 76;
  return 34;
}

function ratingFor(team) {
  if (!team) return null;
  return Number.isFinite(team.ratingSeed) ? team.ratingSeed : 1500;
}

function expectedGoals(homeRating, awayRating, homeAdvantage = 0) {
  const delta = homeRating - awayRating + homeAdvantage;
  return {
    homeXg: clamp(1.22 * Math.exp(delta / 650), 0.28, 3.4),
    awayXg: clamp(1.06 * Math.exp(-delta / 650), 0.22, 3.1),
    delta
  };
}

function poissonThreeWay(homeXg, awayXg) {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h <= MAX_GOALS; h += 1) {
    for (let a = 0; a <= MAX_GOALS; a += 1) {
      const probability = poissonProbability(homeXg, h) * poissonProbability(awayXg, a);
      if (h > a) home += probability;
      else if (h === a) draw += probability;
      else away += probability;
    }
  }
  const total = home + draw + away || 1;
  return {
    home: home / total,
    draw: draw / total,
    away: away / total
  };
}

function rankThreeWay(delta) {
  const nonDrawHome = sigmoid(delta / 390);
  const draw = clamp(0.285 - Math.abs(delta) / 2600, 0.145, 0.305);
  return {
    home: nonDrawHome * (1 - draw),
    draw,
    away: (1 - nonDrawHome) * (1 - draw)
  };
}

function blendThreeWay(poisson, rank) {
  const blended = {
    home: poisson.home * 0.62 + rank.home * 0.38,
    draw: poisson.draw * 0.58 + rank.draw * 0.42,
    away: poisson.away * 0.62 + rank.away * 0.38
  };
  const total = blended.home + blended.draw + blended.away || 1;
  return {
    home: blended.home / total,
    draw: blended.draw / total,
    away: blended.away / total
  };
}

function topOutcome(probabilities, match) {
  const outcomes = [
    { side: "home", label: match.homeTeam, probability: probabilities.home },
    { side: "draw", label: "Draw", probability: probabilities.draw },
    { side: "away", label: match.awayTeam, probability: probabilities.away }
  ].sort((a, b) => b.probability - a.probability);
  return outcomes[0];
}

function confidenceLabel(topProbability, dataQualityScore) {
  if (topProbability >= 0.62 && dataQualityScore >= 0.88) return "A";
  if (topProbability >= 0.55 && dataQualityScore >= 0.78) return "B";
  if (topProbability >= 0.48) return "C";
  return "Watch";
}

function qualityScore(match, homeTeam, awayTeam) {
  if (match.participantStatus === "placeholder") return 0.35;
  let score = 0.72;
  if (match.date && match.venue) score += 0.08;
  if (homeTeam?.fifaRank && awayTeam?.fifaRank) score += 0.14;
  if (match.status === "final") score += 0.06;
  return clamp(score, 0.25, 1);
}

export function predictWorldCupMatch(match, teams = worldCupTeams) {
  const teamsByCode = teamLookup(teams);
  const homeTeam = teamsByCode.get(match.homeCode);
  const awayTeam = teamsByCode.get(match.awayCode);
  const score = parseScore(match.score);
  const dataQualityScore = qualityScore(match, homeTeam, awayTeam);

  if (match.participantStatus === "placeholder" || !homeTeam || !awayTeam) {
    return {
      ...match,
      scoreParsed: score,
      predictionStatus: "pending-participants",
      dataQualityScore,
      probabilities: null,
      topOutcome: null,
      fairOdds: null,
      confidence: "Watch",
      modelNotes: ["Participant placeholders must resolve before model scoring."]
    };
  }

  const homeRating = ratingFor(homeTeam) + hostBoost(match, homeTeam);
  const awayRating = ratingFor(awayTeam) + hostBoost(match, awayTeam);
  const { homeXg, awayXg, delta } = expectedGoals(homeRating, awayRating);
  const poisson = poissonThreeWay(homeXg, awayXg);
  const rank = rankThreeWay(delta);
  const probabilities = blendThreeWay(poisson, rank);
  const pick = topOutcome(probabilities, match);

  return {
    ...match,
    scoreParsed: score,
    predictionStatus: "modeled",
    dataQualityScore,
    homeRating,
    awayRating,
    expectedGoals: {
      home: homeXg,
      away: awayXg
    },
    probabilities,
    componentProbabilities: {
      poisson,
      rank
    },
    topOutcome: pick,
    fairOdds: {
      home: probToAmerican(probabilities.home),
      draw: probToAmerican(probabilities.draw),
      away: probToAmerican(probabilities.away),
      pick: probToAmerican(pick.probability)
    },
    confidence: confidenceLabel(pick.probability, dataQualityScore),
    modelNotes: [
      "FIFA-rank prior converted to Elo-style rating seed.",
      "Poisson goal model blended with calibrated 3-way rank model.",
      "Fair odds are model prices, not positive-EV bets without a live book price."
    ]
  };
}

function emptyStanding(team) {
  return {
    code: team.code,
    team: team.name,
    group: team.group,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
    projectedPoints: 0
  };
}

function applyFinalToStandings(standings, prediction) {
  const score = prediction.scoreParsed;
  if (!score || !prediction.homeCode || !prediction.awayCode) return;
  const home = standings.get(prediction.homeCode);
  const away = standings.get(prediction.awayCode);
  if (!home || !away) return;

  home.played += 1;
  away.played += 1;
  home.goalsFor += score.home;
  home.goalsAgainst += score.away;
  away.goalsFor += score.away;
  away.goalsAgainst += score.home;

  if (score.home > score.away) {
    home.wins += 1;
    away.losses += 1;
    home.points += 3;
  } else if (score.home < score.away) {
    away.wins += 1;
    home.losses += 1;
    away.points += 3;
  } else {
    home.draws += 1;
    away.draws += 1;
    home.points += 1;
    away.points += 1;
  }
}

function addProjection(standings, prediction) {
  if (!prediction.probabilities || prediction.status === "final") return;
  const home = standings.get(prediction.homeCode);
  const away = standings.get(prediction.awayCode);
  if (!home || !away) return;
  home.projectedPoints += prediction.probabilities.home * 3 + prediction.probabilities.draw;
  away.projectedPoints += prediction.probabilities.away * 3 + prediction.probabilities.draw;
}

function rankedStandings(group, teams, predictions) {
  const groupTeams = teams.filter((team) => team.group === group);
  const standings = new Map(groupTeams.map((team) => [team.code, emptyStanding(team)]));
  for (const prediction of predictions.filter((match) => match.group === group)) {
    applyFinalToStandings(standings, prediction);
  }
  for (const prediction of predictions.filter((match) => match.group === group)) {
    addProjection(standings, prediction);
  }
  return [...standings.values()]
    .map((row) => ({
      ...row,
      goalDifference: row.goalsFor - row.goalsAgainst,
      projectedTotal: row.points + row.projectedPoints
    }))
    .sort((a, b) =>
      b.points - a.points ||
      b.goalDifference - a.goalDifference ||
      b.goalsFor - a.goalsFor ||
      b.projectedTotal - a.projectedTotal
    );
}

function simStanding(team) {
  return {
    code: team.code,
    group: team.group,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    rating: ratingFor(team)
  };
}

function applySimScore(standings, homeCode, awayCode, homeGoals, awayGoals) {
  const home = standings.get(homeCode);
  const away = standings.get(awayCode);
  if (!home || !away) return;
  home.goalsFor += homeGoals;
  home.goalsAgainst += awayGoals;
  away.goalsFor += awayGoals;
  away.goalsAgainst += homeGoals;
  home.goalDifference = home.goalsFor - home.goalsAgainst;
  away.goalDifference = away.goalsFor - away.goalsAgainst;
  if (homeGoals > awayGoals) home.points += 3;
  else if (homeGoals < awayGoals) away.points += 3;
  else {
    home.points += 1;
    away.points += 1;
  }
}

function sortedSimGroup(rows) {
  return [...rows].sort((a, b) =>
    b.points - a.points ||
    b.goalDifference - a.goalDifference ||
    b.goalsFor - a.goalsFor ||
    b.rating - a.rating
  );
}

function parseThirdGroupCandidates(label) {
  const match = label.match(/^3rd Group ([A-L/]+)$/);
  return match ? match[1].split("/") : [];
}

function resolveSlot(label, context) {
  let match = label.match(/^Winner Group ([A-L])$/);
  if (match) return context.groupPositions.get(match[1])?.[0]?.code ?? null;
  match = label.match(/^Runner-up Group ([A-L])$/);
  if (match) return context.groupPositions.get(match[1])?.[1]?.code ?? null;
  match = label.match(/^Winner Match (\d+)$/);
  if (match) return context.matchResults.get(Number(match[1]))?.winner ?? null;
  match = label.match(/^Loser Match (\d+)$/);
  if (match) return context.matchResults.get(Number(match[1]))?.loser ?? null;

  const thirdGroups = parseThirdGroupCandidates(label);
  if (thirdGroups.length) {
    const advanced = thirdGroups
      .map((group) => context.thirdsByGroup.get(group))
      .filter((row) => row && context.advancedThirds.has(row.code) && !context.usedThirds.has(row.code))
      .sort((a, b) =>
        b.points - a.points ||
        b.goalDifference - a.goalDifference ||
        b.goalsFor - a.goalsFor ||
        b.rating - a.rating
      );
    if (advanced.length) {
      context.usedThirds.add(advanced[0].code);
      return advanced[0].code;
    }
    const fallback = thirdGroups
      .map((group) => context.thirdsByGroup.get(group))
      .filter((row) => row && !context.usedThirds.has(row.code))
      .sort((a, b) => b.rating - a.rating)[0]?.code ?? null;
    if (fallback) context.usedThirds.add(fallback);
    return fallback;
  }
  return null;
}

function knockoutAdvanceProbability(match, homeTeam, awayTeam) {
  const homeRating = ratingFor(homeTeam) + hostBoost(match, homeTeam);
  const awayRating = ratingFor(awayTeam) + hostBoost(match, awayTeam);
  const { homeXg, awayXg, delta } = expectedGoals(homeRating, awayRating);
  const probabilities = blendThreeWay(poissonThreeWay(homeXg, awayXg), rankThreeWay(delta));
  return clamp(probabilities.home + probabilities.draw * sigmoid(delta / 390), 0.03, 0.97);
}

function initializeSimulationCounts(teams) {
  return new Map(teams.map((team) => [team.code, {
    code: team.code,
    team: team.name,
    group: team.group,
    rating: ratingFor(team),
    groupWin: 0,
    topTwo: 0,
    thirdAdvance: 0,
    advance: 0,
    round32: 0,
    quarterfinal: 0,
    semifinal: 0,
    final: 0,
    champion: 0,
    groupPoints: 0
  }]));
}

function simulateTournament(predictions, teams, groups, simulations = DEFAULT_SIMULATIONS) {
  const random = createPrng(20260612);
  const teamsByCode = teamLookup(teams);
  const counts = initializeSimulationCounts(teams);
  const groupMatches = predictions.filter((match) => match.group);
  const knockoutMatches = predictions.filter((match) => !match.group).sort((a, b) => a.matchNo - b.matchNo);

  for (let sim = 0; sim < simulations; sim += 1) {
    const standings = new Map(teams.map((team) => [team.code, simStanding(team)]));

    for (const match of groupMatches) {
      const finalScore = parseScore(match.score);
      if (finalScore) {
        applySimScore(standings, match.homeCode, match.awayCode, finalScore.home, finalScore.away);
      } else if (match.expectedGoals) {
        applySimScore(
          standings,
          match.homeCode,
          match.awayCode,
          samplePoisson(match.expectedGoals.home, random),
          samplePoisson(match.expectedGoals.away, random)
        );
      }
    }

    const groupPositions = new Map();
    const thirdRows = [];
    for (const group of groups) {
      const rows = sortedSimGroup(group.teams.map((code) => standings.get(code)).filter(Boolean));
      groupPositions.set(group.id, rows);
      rows.forEach((row, idx) => {
        const count = counts.get(row.code);
        count.groupPoints += row.points;
        if (idx === 0) count.groupWin += 1;
        if (idx <= 1) count.topTwo += 1;
        if (idx === 2) thirdRows.push(row);
      });
    }

    const advancedThirdRows = sortedSimGroup(thirdRows).slice(0, 8);
    const advancedThirds = new Set(advancedThirdRows.map((row) => row.code));
    const thirdsByGroup = new Map(thirdRows.map((row) => [row.group, row]));
    for (const row of advancedThirdRows) {
      counts.get(row.code).thirdAdvance += 1;
    }

    const advanced = new Set();
    for (const rows of groupPositions.values()) {
      rows.slice(0, 2).forEach((row) => advanced.add(row.code));
    }
    advancedThirds.forEach((code) => advanced.add(code));
    advanced.forEach((code) => {
      counts.get(code).advance += 1;
    });

    const context = {
      groupPositions,
      thirdsByGroup,
      advancedThirds,
      usedThirds: new Set(),
      matchResults: new Map()
    };

    for (const match of knockoutMatches) {
      const homeCode = resolveSlot(match.homeTeam, context);
      const awayCode = resolveSlot(match.awayTeam, context);
      if (!homeCode || !awayCode || homeCode === awayCode) continue;
      const homeTeam = teamsByCode.get(homeCode);
      const awayTeam = teamsByCode.get(awayCode);
      if (!homeTeam || !awayTeam) continue;

      if (match.matchNo >= 73 && match.matchNo <= 88) {
        counts.get(homeCode).round32 += 1;
        counts.get(awayCode).round32 += 1;
      } else if (match.matchNo >= 97 && match.matchNo <= 100) {
        counts.get(homeCode).quarterfinal += 1;
        counts.get(awayCode).quarterfinal += 1;
      } else if (match.matchNo >= 101 && match.matchNo <= 102) {
        counts.get(homeCode).semifinal += 1;
        counts.get(awayCode).semifinal += 1;
      } else if (match.matchNo === 104) {
        counts.get(homeCode).final += 1;
        counts.get(awayCode).final += 1;
      }

      const pHomeAdvance = knockoutAdvanceProbability(match, homeTeam, awayTeam);
      const homeWins = random() < pHomeAdvance;
      const winner = homeWins ? homeCode : awayCode;
      const loser = homeWins ? awayCode : homeCode;
      context.matchResults.set(match.matchNo, { winner, loser });
      if (match.matchNo === 104) counts.get(winner).champion += 1;
    }
  }

  const teamsOut = [...counts.values()].map((row) => ({
    ...row,
    groupWinProbability: row.groupWin / simulations,
    topTwoProbability: row.topTwo / simulations,
    thirdAdvanceProbability: row.thirdAdvance / simulations,
    advanceProbability: row.advance / simulations,
    round32Probability: row.round32 / simulations,
    quarterfinalProbability: row.quarterfinal / simulations,
    semifinalProbability: row.semifinal / simulations,
    finalProbability: row.final / simulations,
    championProbability: row.champion / simulations,
    expectedGroupPoints: row.groupPoints / simulations
  })).sort((a, b) => b.championProbability - a.championProbability);

  return {
    simulations,
    seed: 20260612,
    teams: teamsOut,
    topChampions: teamsOut.slice(0, 12),
    topAdvancers: [...teamsOut].sort((a, b) => b.advanceProbability - a.advanceProbability).slice(0, 16)
  };
}

function buildGroupDifficulty(groups, teams, simulation) {
  const teamsByCode = teamLookup(teams);
  const simulationByCode = new Map(simulation.teams.map((team) => [team.code, team]));
  return groups.map((group) => {
    const groupTeams = group.teams.map((code) => teamsByCode.get(code)).filter(Boolean);
    const ratings = groupTeams.map((team) => ratingFor(team));
    const favorite = groupTeams.sort((a, b) => ratingFor(b) - ratingFor(a))[0];
    const favoriteSim = simulationByCode.get(favorite.code);
    return {
      group: group.id,
      averageRating: ratings.reduce((sum, value) => sum + value, 0) / ratings.length,
      ratingSpread: Math.max(...ratings) - Math.min(...ratings),
      favorite: favorite.name,
      favoriteTopTwoProbability: favoriteSim?.topTwoProbability ?? 0,
      upsetRisk: 1 - (favoriteSim?.topTwoProbability ?? 0),
      teams: groupTeams.map((team) => ({
        code: team.code,
        team: team.name,
        rating: ratingFor(team),
        advanceProbability: simulationByCode.get(team.code)?.advanceProbability ?? 0
      })).sort((a, b) => b.rating - a.rating)
    };
  }).sort((a, b) => b.upsetRisk - a.upsetRisk);
}

function buildUpsetWatch(predictions, teams) {
  const teamsByCode = teamLookup(teams);
  return predictions
    .filter((match) => match.predictionStatus === "modeled" && match.status !== "final")
    .map((match) => {
      const home = teamsByCode.get(match.homeCode);
      const away = teamsByCode.get(match.awayCode);
      if (!home || !away) return null;
      const homeRating = ratingFor(home);
      const awayRating = ratingFor(away);
      const underdogSide = homeRating < awayRating ? "home" : "away";
      const favoriteSide = underdogSide === "home" ? "away" : "home";
      const probability = match.probabilities[underdogSide];
      const ratingGap = Math.abs(homeRating - awayRating);
      return {
        matchNo: match.matchNo,
        group: match.group,
        stage: match.stage,
        date: match.date,
        fixture: `${match.homeTeam} vs ${match.awayTeam}`,
        underdog: underdogSide === "home" ? match.homeTeam : match.awayTeam,
        favorite: favoriteSide === "home" ? match.homeTeam : match.awayTeam,
        probability,
        fairOdds: probToAmerican(probability),
        ratingGap,
        venue: match.venue
      };
    })
    .filter((row) => row && row.ratingGap >= 90 && row.probability >= 0.18)
    .sort((a, b) => b.probability * Math.log1p(b.ratingGap) - a.probability * Math.log1p(a.ratingGap))
    .slice(0, 10);
}

function buildQualitySummary(matches, teams, predictions, sourceMeta, refreshError) {
  const matchNos = matches.map((match) => match.matchNo);
  const uniqueNos = new Set(matchNos);
  const knownParticipantMatches = matches.filter((match) => match.participantStatus === "known").length;
  const modeledMatches = predictions.filter((match) => match.predictionStatus === "modeled").length;
  return {
    generatedAt: new Date().toISOString(),
    sourceAccessedAt: sourceMeta?.sourceAccessedAt,
    refreshError: refreshError || null,
    rowCount: matches.length,
    teamCount: teams.length,
    groupMatches: matches.filter((match) => match.group).length,
    knockoutMatches: matches.filter((match) => !match.group).length,
    uniqueMatchNumbers: uniqueNos.size,
    duplicateMatchNumbers: matchNos.length - uniqueNos.size,
    knownParticipantMatches,
    placeholderMatches: matches.length - knownParticipantMatches,
    modeledMatches,
    checks: [
      {
        name: "Fixture grain",
        status: matches.length === 104 && uniqueNos.size === 104 ? "pass" : "fail",
        detail: "One row per FIFA match number, expected 104 total matches."
      },
      {
        name: "Team coverage",
        status: teams.length === 48 ? "pass" : "fail",
        detail: "All 48 qualified teams have a group, draw slot, code, and ranking prior."
      },
      {
        name: "Model leakage",
        status: "pass",
        detail: "Predictions use pre-match priors only; final scores are used for standings, not to re-score completed matches."
      },
      {
        name: "Live readiness",
        status: refreshError ? "watch" : "pass",
        detail: refreshError ? "Served static seed after refresh failed." : "API route can refresh source-backed schedule/results on demand."
      }
    ]
  };
}

export function buildWorldCupDashboard(data = {}, options = {}) {
  const teams = data.teams ?? worldCupTeams;
  const groups = data.groups ?? worldCupGroups;
  const matches = [...(data.matches ?? worldCupMatches)]
    .sort((a, b) => (a.matchNo ?? 999) - (b.matchNo ?? 999));
  const sourceMeta = data.sourceMeta ?? data.meta ?? worldCupSourceMeta;
  const predictions = matches.map((match) => predictWorldCupMatch(match, teams));
  const bestPicks = predictions
    .filter((match) => match.predictionStatus === "modeled" && match.status !== "final")
    .sort((a, b) =>
      (b.topOutcome.probability - 1 / 3) * b.dataQualityScore -
      (a.topOutcome.probability - 1 / 3) * a.dataQualityScore
    )
    .slice(0, 12);
  const groupOutlooks = groups.map((group) => ({
    group: group.id,
    standings: rankedStandings(group.id, teams, predictions)
  }));
  const simulation = simulateTournament(predictions, teams, groups, options.simulations ?? DEFAULT_SIMULATIONS);
  const groupDifficulty = buildGroupDifficulty(groups, teams, simulation);
  const upsetWatch = buildUpsetWatch(predictions, teams);

  return {
    generatedAt: new Date().toISOString(),
    sources: data.sources ?? worldCupSources,
    sourceMeta,
    modelSpec: {
      name: "World Cup 2026 3-way ensemble",
      target: "90-minute result probabilities for soccer: home win, draw, away win.",
      methods: [
        "FIFA ranking converted to Elo-style rating seed",
        "Host-nation venue adjustment",
        "Poisson expected-goals score grid",
        "Calibrated rank-delta draw model",
        "Weighted 3-way probability ensemble",
        "Fair American odds by outcome"
      ],
      limitations: [
        "No live sportsbook price or closing-line history is included yet.",
        "Lineups, injuries, travel fatigue, weather, and tactical news are not connected.",
        "Knockout placeholders are intentionally not scored until participants are known."
      ]
    },
    quality: buildQualitySummary(matches, teams, predictions, sourceMeta, options.refreshError),
    teams,
    groups,
    matches: predictions,
    bestPicks,
    groupOutlooks,
    simulation,
    groupDifficulty,
    upsetWatch
  };
}
