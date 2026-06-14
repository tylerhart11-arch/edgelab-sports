import { currentSlate, getLeague, leagues } from "../src/data/sportsData.mjs";
import { fetchEspnScoreboard } from "./providers/espn.mjs";
import { clamp, deterministicNoise, probToAmerican } from "../src/model/stats.mjs";

const normalize = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export class LiveScoreService {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.pollSeconds = options.pollSeconds ?? 60;
    this.scoreboard = [];
    this.errors = [];
    this.lastUpdated = null;
    this.mode = "seed";
    this.timer = null;
  }

  async start() {
    if (!this.enabled) {
      this.mode = "seed";
      return;
    }
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch((error) => {
        this.errors.unshift({ at: new Date().toISOString(), message: error.message });
        this.errors = this.errors.slice(0, 8);
      });
    }, this.pollSeconds * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh() {
    if (!this.enabled) return this.snapshot();
    const results = [];
    const errors = [];
    await Promise.all(leagues.map(async (league) => {
      try {
        const rows = await fetchEspnScoreboard(league.id);
        results.push(...rows);
      } catch (error) {
        errors.push({ league: league.id, message: error.message, at: new Date().toISOString() });
      }
    }));
    if (results.length) {
      this.scoreboard = results;
      this.mode = errors.length ? "live-partial" : "live";
      this.lastUpdated = new Date().toISOString();
    } else {
      this.mode = "seed";
    }
    this.errors = [...errors, ...this.errors].slice(0, 12);
    return this.snapshot();
  }

  snapshot() {
    const now = Date.now();
    const staleSeedGames = currentSlate.filter((game) => isStaleSeedGame(game, now)).length;
    return {
      enabled: this.enabled,
      mode: this.mode,
      pollSeconds: this.pollSeconds,
      lastUpdated: this.lastUpdated,
      errors: this.errors,
      scoreboard: this.scoreboard,
      freshness: {
        staleSeedGames,
        liveEvents: this.scoreboard.length,
        liveLeagues: [...new Set(this.scoreboard.map((event) => event.league))].sort(),
        policy: "ESPN events are the primary slate. Seed games are used only when a league has no live feed and the seed game has not gone stale."
      }
    };
  }

  mergedSlate() {
    return mergeLiveScores(currentSlate, this.scoreboard);
  }
}

export function mergeLiveScores(seedGames, liveGames) {
  const now = Date.now();
  const liveRows = (liveGames ?? [])
    .map((event) => liveEventToSlateGame(event))
    .filter(Boolean);
  const liveLeagues = new Set(liveRows.map((game) => game.league));
  const seedRows = seedGames
    .filter((game) => !liveLeagues.has(game.league))
    .map((game) => markSeedFreshness(game, now))
    .filter((game) => !game.stale);

  if (!liveRows.length) return seedRows;
  return [...liveRows, ...seedRows]
    .sort((a, b) => new Date(a.gameTime) - new Date(b.gameTime));
}

function markSeedFreshness(game, now = Date.now()) {
  const stale = isStaleSeedGame(game, now);
  return {
    ...game,
    stale,
    source: stale ? "stale-seed" : game.source,
    dataFreshness: stale ? "stale" : "seed-fallback"
  };
}

export function isStaleSeedGame(game, now = Date.now()) {
  if (game.source !== "seed-current") return false;
  const gameTime = new Date(game.gameTime).getTime();
  if (!Number.isFinite(gameTime)) return true;
  return game.status === "scheduled" && gameTime < now - 60 * 60 * 1000;
}

function liveEventToSlateGame(event) {
  if (!event?.league || !event.homeTeam || !event.awayTeam) return null;
  const league = getLeague(event.league);
  if (!league) return null;
  const prices = syntheticMarket(event, league);
  return {
    id: `${event.league}-${event.provider ?? "live"}-${event.providerId}`,
    providerId: event.providerId,
    league: event.league,
    sport: league.sport,
    season: seasonFor(event.gameTime),
    seasonType: "regular",
    gameTime: event.gameTime,
    status: event.status,
    awayTeamId: teamId(event.awayTeam),
    awayTeam: event.awayTeam,
    awayConference: "Live",
    homeTeamId: teamId(event.homeTeam),
    homeTeam: event.homeTeam,
    homeConference: "Live",
    homeScore: Number.isFinite(event.homeScore) ? event.homeScore : undefined,
    awayScore: Number.isFinite(event.awayScore) ? event.awayScore : undefined,
    homeMoneyline: prices.homeMoneyline,
    awayMoneyline: prices.awayMoneyline,
    total: prices.total,
    spread: prices.spread,
    restDaysHome: 3,
    restDaysAway: 3,
    injurySignalHome: 0.1,
    injurySignalAway: 0.1,
    source: "live-espn",
    dataFreshness: event.status === "scheduled" ? "live-schedule" : event.status,
    liveScore: {
      homeScore: event.homeScore,
      awayScore: event.awayScore,
      period: event.period,
      clock: event.clock,
      venue: event.venue,
      sourceUpdatedAt: event.sourceUpdatedAt
    }
  };
}

function syntheticMarket(event, league) {
  const key = `${event.league}-${event.providerId}-${event.homeTeam}-${event.awayTeam}`;
  const homeProb = clamp(0.5 + deterministicNoise(`${key}-home-prob`, 0.06), 0.38, 0.62);
  const hold = 0.045;
  const total = Math.max(1, Math.round((league.baseScore * 2 + deterministicNoise(`${key}-total`, league.scoreVolatility)) * 10) / 10);
  const spread = Math.round(deterministicNoise(`${key}-spread`, Math.max(1, league.marginScale * 0.35)) * 2) / 2;
  return {
    homeMoneyline: probToAmerican(homeProb * (1 + hold)),
    awayMoneyline: probToAmerican((1 - homeProb) * (1 + hold)),
    total,
    spread
  };
}

function seasonFor(gameTime) {
  const date = new Date(gameTime);
  return Number.isFinite(date.getTime()) ? date.getFullYear() : new Date().getFullYear();
}

function teamId(teamName) {
  return normalize(teamName).split(" ").map((part) => part[0]).join("").slice(0, 6).toUpperCase() || "TEAM";
}

export function mergeSeedWithMatchingLiveScores(seedGames, liveGames) {
  if (!liveGames?.length) return seedGames;
  return seedGames.map((game) => {
    const live = liveGames.find((event) =>
      event.league === game.league &&
      (
        (normalize(event.homeTeam).includes(normalize(game.homeTeam)) || normalize(game.homeTeam).includes(normalize(event.homeTeam))) &&
        (normalize(event.awayTeam).includes(normalize(game.awayTeam)) || normalize(game.awayTeam).includes(normalize(event.awayTeam)))
      )
    );
    if (!live) return game;
    return {
      ...game,
      status: live.status,
      homeScore: Number.isFinite(live.homeScore) ? live.homeScore : game.homeScore,
      awayScore: Number.isFinite(live.awayScore) ? live.awayScore : game.awayScore,
      liveScore: {
        homeScore: live.homeScore,
        awayScore: live.awayScore,
        period: live.period,
        clock: live.clock,
        venue: live.venue,
        sourceUpdatedAt: live.sourceUpdatedAt
      },
      source: "live-espn"
    };
  });
}
