import {
  americanToProb,
  clamp,
  deterministicNoise,
  expectedValue,
  kellyFraction,
  probToAmerican
} from "./stats.mjs";

const OUTCOMES = ["home", "draw", "away"];

export function normalizeTeamName(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|cf|the|national|team)\b/g, "")
    .trim();
}

function outcomeNameFor(match, outcome) {
  if (outcome === "home") return match.homeTeam;
  if (outcome === "away") return match.awayTeam;
  return "Draw";
}

function impliedHold(outcomes) {
  const probabilities = outcomes
    .map((outcome) => americanToProb(outcome.price))
    .filter((value) => Number.isFinite(value));
  return probabilities.reduce((sum, value) => sum + value, 0) - 1;
}

export function removeVigThreeWay(outcomes) {
  const raw = outcomes.map((outcome) => ({
    name: outcome.name,
    price: outcome.price,
    impliedProbability: americanToProb(outcome.price)
  }));
  const total = raw.reduce((sum, row) => sum + row.impliedProbability, 0) || 1;
  return raw.map((row) => ({
    ...row,
    noVigProbability: row.impliedProbability / total
  }));
}

function findH2hMarket(bookmaker) {
  return bookmaker.markets?.find((market) => market.key === "h2h");
}

function bestOutcomePrice(event, outcomeName) {
  const normalizedTarget = normalizeTeamName(outcomeName);
  const rows = [];
  for (const bookmaker of event.bookmakers ?? []) {
    const market = findH2hMarket(bookmaker);
    if (!market) continue;
    const outcome = market.outcomes?.find((candidate) =>
      normalizeTeamName(candidate.name) === normalizedTarget
    );
    if (!outcome || !Number.isFinite(outcome.price)) continue;
    rows.push({
      bookmakerKey: bookmaker.key,
      bookmaker: bookmaker.title,
      price: outcome.price,
      lastUpdate: bookmaker.lastUpdate ?? bookmaker.last_update,
      link: outcome.link ?? bookmaker.link ?? null,
      hold: impliedHold(market.outcomes ?? [])
    });
  }
  return rows.sort((a, b) => b.price - a.price)[0] ?? null;
}

function matchEventForGame(match, events) {
  const byMatchNo = events.find((event) => event.matchNo === match.matchNo);
  if (byMatchNo) return byMatchNo;

  const home = normalizeTeamName(match.homeTeam);
  const away = normalizeTeamName(match.awayTeam);
  return events.find((event) => {
    const eventHome = normalizeTeamName(event.homeTeam);
    const eventAway = normalizeTeamName(event.awayTeam);
    const teamsMatch =
      (eventHome === home && eventAway === away) ||
      (eventHome === away && eventAway === home);
    if (!teamsMatch) return false;
    if (!event.commenceTime || !match.date) return true;
    return event.commenceTime.slice(0, 10) === match.date;
  });
}

function scoreMarketOutcome(match, outcome, priceRow) {
  const modelProbability = match.probabilities?.[outcome];
  if (!Number.isFinite(modelProbability) || !priceRow) return null;
  const impliedProbability = americanToProb(priceRow.price);
  const edge = modelProbability - impliedProbability;
  const ev = expectedValue(modelProbability, priceRow.price);
  return {
    outcome,
    label: outcomeNameFor(match, outcome),
    modelProbability,
    fairOdds: match.fairOdds?.[outcome] ?? probToAmerican(modelProbability),
    bookOdds: priceRow.price,
    bookmaker: priceRow.bookmaker,
    bookmakerKey: priceRow.bookmakerKey,
    lastUpdate: priceRow.lastUpdate,
    hold: priceRow.hold,
    impliedProbability,
    edge,
    expectedValue: ev,
    kelly: kellyFraction(modelProbability, priceRow.price),
    confidence: edge > 0.055 && ev > 0.08 ? "A" : edge > 0.035 && ev > 0.045 ? "B" : edge > 0.015 && ev > 0 ? "C" : "Watch"
  };
}

export function buildSeedWorldCupOdds(matches) {
  const events = matches
    .filter((match) => match.predictionStatus === "modeled" && match.status !== "final")
    .slice(0, 48)
    .map((match) => {
      const bookmakers = ["DraftKings", "FanDuel", "BetMGM"].map((title, bookIdx) => {
        const shifted = OUTCOMES.map((outcome, outcomeIdx) => {
          const base = match.probabilities[outcome];
          const noise = deterministicNoise(`${match.matchNo}-${title}-${outcome}`, 0.032);
          const protectedFavorite = base > 0.62 ? 0.01 : 0;
          return clamp(base + noise + protectedFavorite + 0.006 * outcomeIdx, 0.025, 0.92);
        });
        const total = shifted.reduce((sum, value) => sum + value, 0) || 1;
        const hold = 1.065 + bookIdx * 0.006;
        const outcomes = OUTCOMES.map((outcome, idx) => ({
          name: outcomeNameFor(match, outcome),
          price: probToAmerican(clamp((shifted[idx] / total) * hold, 0.02, 0.94))
        }));
        return {
          key: title.toLowerCase().replace(/[^a-z]/g, ""),
          title,
          lastUpdate: new Date().toISOString(),
          markets: [{ key: "h2h", outcomes }]
        };
      });
      return {
        id: `seed-wc26-${match.matchNo}`,
        matchNo: match.matchNo,
        sportKey: "soccer_fifa_world_cup_seed",
        commenceTime: `${match.date}T18:00:00Z`,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        bookmakers
      };
    });

  return {
    provider: "seed",
    mode: "seed",
    configured: false,
    generatedAt: new Date().toISOString(),
    markets: ["h2h"],
    regions: ["us"],
    events,
    quota: null,
    warnings: ["Seeded odds are deterministic demo prices. Add ODDS_API_KEY for live market data."],
    errors: []
  };
}

export function buildWorldCupMarketBoard(worldCupDashboard, oddsSnapshot, history = {}) {
  const events = oddsSnapshot?.events ?? [];
  const markets = worldCupDashboard.matches
    .filter((match) => match.predictionStatus === "modeled")
    .map((match) => {
      const event = matchEventForGame(match, events);
      const outcomes = OUTCOMES
        .map((outcome) => scoreMarketOutcome(match, outcome, bestOutcomePrice(event ?? {}, outcomeNameFor(match, outcome))))
        .filter(Boolean);
      const best = outcomes
        .filter((outcome) => outcome.expectedValue > 0 && outcome.edge > 0)
        .sort((a, b) => b.expectedValue - a.expectedValue)[0] ?? null;
      return {
        matchNo: match.matchNo,
        group: match.group,
        stage: match.stage,
        date: match.date,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        status: match.status,
        eventId: event?.id ?? null,
        hasOdds: Boolean(event),
        outcomes,
        best,
        marketHold: outcomes.length ? Math.min(...outcomes.map((row) => row.hold).filter(Number.isFinite)) : null
      };
    });

  const bestEdges = markets
    .filter((market) => market.best)
    .map((market) => ({
      ...market.best,
      id: `wc26-edge-${market.matchNo}-${market.best.outcome}`,
      matchNo: market.matchNo,
      group: market.group,
      stage: market.stage,
      date: market.date,
      matchup: `${market.homeTeam} vs ${market.awayTeam}`,
      marketHold: market.marketHold
    }))
    .sort((a, b) => b.expectedValue - a.expectedValue);

  const oddsEventCount = markets.filter((market) => market.hasOdds).length;
  return {
    generatedAt: new Date().toISOString(),
    source: {
      provider: oddsSnapshot.provider,
      mode: oddsSnapshot.mode,
      configured: oddsSnapshot.configured,
      generatedAt: oddsSnapshot.generatedAt,
      markets: oddsSnapshot.markets,
      regions: oddsSnapshot.regions,
      quota: oddsSnapshot.quota,
      warnings: oddsSnapshot.warnings ?? [],
      errors: oddsSnapshot.errors ?? []
    },
    summary: {
      modeledMatches: worldCupDashboard.quality.modeledMatches,
      oddsEventCount,
      edgeCount: bestEdges.length,
      averageHold: average(markets.flatMap((market) => market.outcomes.map((row) => row.hold)).filter(Number.isFinite)),
      maxExpectedValue: bestEdges[0]?.expectedValue ?? 0,
      maxKelly: Math.max(0, ...bestEdges.map((edge) => edge.kelly))
    },
    bestEdges,
    markets,
    history
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
