import { currentSlate, leagues } from "../src/data/sportsData.mjs";
import { fetchEspnScoreboard } from "./providers/espn.mjs";

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
    return {
      enabled: this.enabled,
      mode: this.mode,
      pollSeconds: this.pollSeconds,
      lastUpdated: this.lastUpdated,
      errors: this.errors,
      scoreboard: this.scoreboard
    };
  }

  mergedSlate() {
    return mergeLiveScores(currentSlate, this.scoreboard);
  }
}

export function mergeLiveScores(seedGames, liveGames) {
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
