import { currentSlate, getLeague, leagues } from "../src/data/sportsData.mjs";
import { fetchEspnScoreboard } from "./providers/espn.mjs";
import { clamp, deterministicNoise, probToAmerican } from "../src/model/stats.mjs";

const DEFAULT_TIME_ZONE = "America/Chicago";

const normalize = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

export class LiveScoreService {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.pollSeconds = options.pollSeconds ?? 60;
    this.scoreboard = [];
    this.rawScoreboard = [];
    this.quarantinedEvents = [];
    this.errors = [];
    this.lastUpdated = null;
    this.mode = "seed";
    this.timer = null;
    this.timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
    this.dateKey = todayDateKey(options.now ?? new Date(), this.timeZone);
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
    const dateKey = todayDateKey(new Date(), this.timeZone);
    this.dateKey = dateKey;
    await Promise.all(leagues.map(async (league) => {
      try {
        const rows = await fetchEspnScoreboard(league.id, { date: espnDateKey(dateKey) });
        results.push(...rows);
      } catch (error) {
        errors.push({ league: league.id, message: error.message, at: new Date().toISOString() });
      }
    }));
    const audit = auditLiveEvents(results, { dateKey, timeZone: this.timeZone });
    this.rawScoreboard = results;
    this.scoreboard = audit.validEvents;
    this.quarantinedEvents = audit.quarantinedEvents;
    if (results.length || errors.length < leagues.length) {
      if (this.scoreboard.length) {
        this.mode = errors.length ? "live-partial" : "live";
      } else {
        this.mode = errors.length ? "live-partial-empty" : "live-no-games";
      }
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
    const outOfWindowSeedGames = currentSlate.filter((game) => !isGameOnDate(game.gameTime, this.dateKey, this.timeZone)).length;
    return {
      enabled: this.enabled,
      mode: this.mode,
      pollSeconds: this.pollSeconds,
      lastUpdated: this.lastUpdated,
      errors: this.errors,
      scoreboard: this.scoreboard,
      freshness: {
        dateKey: this.dateKey,
        timeZone: this.timeZone,
        staleSeedGames,
        outOfWindowSeedGames,
        rawEvents: this.rawScoreboard.length,
        liveEvents: this.scoreboard.length,
        quarantinedEvents: this.quarantinedEvents.length,
        quarantinedSample: this.quarantinedEvents.slice(0, 6).map((event) => ({
          league: event.league,
          matchup: `${event.awayTeam} at ${event.homeTeam}`,
          gameTime: event.gameTime,
          localDate: localDateKey(event.gameTime, this.timeZone),
          reason: event.reason
        })),
        liveLeagues: [...new Set(this.scoreboard.map((event) => event.league))].sort(),
        policy: "Today's slate is date-scoped. ESPN is requested with today's date, out-of-window provider rows are quarantined, and seed games are used only when they are also for today and not stale."
      }
    };
  }

  mergedSlate() {
    return mergeLiveScores(currentSlate, this.scoreboard, { dateKey: this.dateKey, timeZone: this.timeZone });
  }
}

export function mergeLiveScores(seedGames, liveGames, options = {}) {
  const now = Date.now();
  const dateKey = normalizeDateKey(options.dateKey ?? todayDateKey(now, options.timeZone ?? DEFAULT_TIME_ZONE));
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const liveRows = (liveGames ?? [])
    .filter((event) => isGameOnDate(event.gameTime, dateKey, timeZone))
    .map((event) => liveEventToSlateGame(event))
    .filter(Boolean);
  const liveLeagues = new Set(liveRows.map((game) => game.league));
  const seedRows = seedGames
    .filter((game) => !liveLeagues.has(game.league))
    .map((game) => markSeedFreshness(game, now, { dateKey, timeZone }))
    .filter((game) => !game.stale && game.inDateWindow);

  if (!liveRows.length) return seedRows;
  return [...liveRows, ...seedRows]
    .sort((a, b) => new Date(a.gameTime) - new Date(b.gameTime));
}

function markSeedFreshness(game, now = Date.now(), options = {}) {
  const stale = isStaleSeedGame(game, now);
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const dateKey = normalizeDateKey(options.dateKey ?? todayDateKey(now, timeZone));
  const inDateWindow = isGameOnDate(game.gameTime, dateKey, timeZone);
  return {
    ...game,
    stale,
    inDateWindow,
    source: stale ? "stale-seed" : game.source,
    dataFreshness: stale ? "stale" : inDateWindow ? "seed-fallback" : "out-of-window"
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

export function auditLiveEvents(events, options = {}) {
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const dateKey = normalizeDateKey(options.dateKey ?? todayDateKey(options.now ?? new Date(), timeZone));
  const validEvents = [];
  const quarantinedEvents = [];
  for (const event of events ?? []) {
    if (!isGameOnDate(event.gameTime, dateKey, timeZone)) {
      quarantinedEvents.push({ ...event, reason: "outside-today-window" });
      continue;
    }
    validEvents.push(event);
  }
  return { dateKey, timeZone, validEvents, quarantinedEvents };
}

export function todayDateKey(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  return localDateKey(now, timeZone);
}

export function espnDateKey(dateKey) {
  return normalizeDateKey(dateKey).replaceAll("-", "");
}

export function localDateKey(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function normalizeDateKey(dateKey) {
  const raw = String(dateKey || "").trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return localDateKey(new Date(raw), DEFAULT_TIME_ZONE);
}

function isGameOnDate(gameTime, dateKey, timeZone = DEFAULT_TIME_ZONE) {
  return localDateKey(gameTime, timeZone) === normalizeDateKey(dateKey);
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
