import { buildSeedWorldCupOdds } from "../../src/model/marketEdges.mjs";

const ODDS_API_BASE = "https://api.the-odds-api.com/v4";
const DEFAULT_WORLD_CUP_KEY = "soccer_fifa_world_cup";

function envList(name, fallback = []) {
  const value = process.env[name];
  if (!value) return fallback;
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function headersToQuota(headers) {
  return {
    remaining: headers.get("x-requests-remaining"),
    used: headers.get("x-requests-used"),
    last: headers.get("x-requests-last")
  };
}

function normalizeBookmaker(bookmaker) {
  return {
    key: bookmaker.key,
    title: bookmaker.title,
    lastUpdate: bookmaker.last_update,
    link: bookmaker.link ?? null,
    markets: (bookmaker.markets ?? []).map((market) => ({
      key: market.key,
      lastUpdate: market.last_update,
      outcomes: (market.outcomes ?? []).map((outcome) => ({
        name: outcome.name,
        price: outcome.price,
        point: outcome.point ?? null,
        link: outcome.link ?? null
      }))
    }))
  };
}

function normalizeEvent(event) {
  return {
    id: event.id,
    sportKey: event.sport_key,
    sportTitle: event.sport_title,
    commenceTime: event.commence_time,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    bookmakers: (event.bookmakers ?? []).map(normalizeBookmaker)
  };
}

async function oddsApiFetch(path, params) {
  const url = new URL(`${ODDS_API_BASE}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { message: text };
  }
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `The Odds API ${response.status}`);
  }
  return { body, quota: headersToQuota(response.headers) };
}

async function discoverWorldCupSportKey(apiKey) {
  const { body } = await oddsApiFetch("/sports", { apiKey, all: "true" });
  const sports = Array.isArray(body) ? body : [];
  const match = sports.find((sport) =>
    sport.group === "Soccer" &&
    /world cup|fifa/i.test(`${sport.key} ${sport.title} ${sport.description}`)
  );
  return match?.key ?? DEFAULT_WORLD_CUP_KEY;
}

export async function fetchWorldCupOddsSnapshot(worldCupDashboard, { refresh = false } = {}) {
  const apiKey = process.env.ODDS_API_KEY;
  const forceSeed = process.env.ODDS_API_MODE === "seed" || process.env.ODDS_API_ENABLED === "false";
  if (!apiKey || forceSeed) {
    return buildSeedWorldCupOdds(worldCupDashboard.matches);
  }

  const regions = envList("ODDS_API_REGIONS", ["us"]).join(",");
  const markets = envList("ODDS_API_MARKETS", ["h2h"]).join(",");
  const bookmakers = envList("ODDS_API_BOOKMAKERS").join(",");
  const configuredKeys = envList("ODDS_API_WORLD_CUP_SPORT_KEY");
  const sportKeys = configuredKeys.length
    ? configuredKeys
    : [await discoverWorldCupSportKey(apiKey)];
  const commenceTimeFrom = process.env.ODDS_API_COMMENCE_FROM || "2026-06-11T00:00:00Z";
  const commenceTimeTo = process.env.ODDS_API_COMMENCE_TO || "2026-07-20T00:00:00Z";
  const events = [];
  const quota = [];
  const errors = [];

  for (const sportKey of sportKeys) {
    try {
      const { body, quota: quotaRow } = await oddsApiFetch(`/sports/${sportKey}/odds`, {
        apiKey,
        regions: bookmakers ? undefined : regions,
        bookmakers,
        markets,
        oddsFormat: "american",
        dateFormat: "iso",
        commenceTimeFrom,
        commenceTimeTo,
        includeLinks: process.env.ODDS_API_INCLUDE_LINKS || "false"
      });
      quota.push({ sportKey, ...quotaRow });
      events.push(...(Array.isArray(body) ? body.map(normalizeEvent) : []));
    } catch (error) {
      errors.push({ sportKey, message: error.message });
    }
  }

  if (!events.length) {
    const seed = buildSeedWorldCupOdds(worldCupDashboard.matches);
    return {
      ...seed,
      provider: "the-odds-api",
      mode: "seed-fallback",
      configured: true,
      quota,
      errors,
      warnings: [
        "No live World Cup odds events were returned. Serving deterministic seed odds until provider mapping is configured.",
        ...seed.warnings
      ]
    };
  }

  return {
    provider: "the-odds-api",
    mode: refresh ? "live-refresh" : "live",
    configured: true,
    generatedAt: new Date().toISOString(),
    markets: markets.split(","),
    regions: bookmakers ? [] : regions.split(","),
    bookmakers: bookmakers ? bookmakers.split(",") : [],
    sportKeys,
    events,
    quota,
    warnings: [],
    errors
  };
}
