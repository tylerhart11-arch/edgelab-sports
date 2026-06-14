import test from "node:test";
import assert from "node:assert/strict";
import { isStaleSeedGame, mergeLiveScores } from "../server/liveState.mjs";

const staleScheduledSeed = {
  id: "seed-old-nba",
  league: "NBA",
  sport: "Basketball",
  season: 2026,
  seasonType: "regular",
  gameTime: "2000-06-01T00:00:00.000Z",
  status: "scheduled",
  awayTeamId: "OKC",
  awayTeam: "Oklahoma City Thunder",
  awayConference: "West",
  homeTeamId: "BOS",
  homeTeam: "Boston Celtics",
  homeConference: "East",
  homeMoneyline: -120,
  awayMoneyline: 110,
  total: 221.5,
  spread: -2.5,
  restDaysHome: 3,
  restDaysAway: 3,
  injurySignalHome: 0.1,
  injurySignalAway: 0.1,
  source: "seed-current"
};

const futureSeed = {
  ...staleScheduledSeed,
  id: "seed-future-nfl",
  league: "NFL",
  sport: "Football",
  gameTime: "2099-09-10T00:20:00.000Z",
  awayTeamId: "DAL",
  awayTeam: "Dallas Cowboys",
  homeTeamId: "PHI",
  homeTeam: "Philadelphia Eagles"
};

const liveEspnEvent = {
  provider: "espn",
  providerId: "401547650",
  league: "NBA",
  gameTime: "2099-06-14T00:00:00.000Z",
  status: "scheduled",
  homeTeam: "Boston Celtics",
  awayTeam: "Oklahoma City Thunder",
  homeScore: Number.NaN,
  awayScore: Number.NaN,
  period: null,
  clock: "",
  venue: "TD Garden",
  sourceUpdatedAt: "2099-06-13T23:00:00.000Z"
};

test("stale seed detection catches old scheduled seed rows", () => {
  assert.equal(isStaleSeedGame(staleScheduledSeed, Date.parse("2026-06-14T12:00:00.000Z")), true);
  assert.equal(isStaleSeedGame({ ...staleScheduledSeed, status: "final" }, Date.parse("2026-06-14T12:00:00.000Z")), false);
  assert.equal(isStaleSeedGame(futureSeed, Date.parse("2026-06-14T12:00:00.000Z")), false);
});

test("live ESPN rows replace stale league seeds and preserve fresh seed fallbacks", () => {
  const merged = mergeLiveScores([staleScheduledSeed, futureSeed], [liveEspnEvent]);

  assert.equal(merged.some((game) => game.id === staleScheduledSeed.id), false);

  const liveRow = merged.find((game) => game.providerId === liveEspnEvent.providerId);
  assert.ok(liveRow);
  assert.equal(liveRow.source, "live-espn");
  assert.equal(liveRow.dataFreshness, "live-schedule");
  assert.equal(liveRow.league, "NBA");
  assert.equal(liveRow.awayTeam, "Oklahoma City Thunder");
  assert.equal(liveRow.homeTeam, "Boston Celtics");
  assert.ok(Number.isFinite(liveRow.homeMoneyline));
  assert.ok(Number.isFinite(liveRow.awayMoneyline));

  const fallback = merged.find((game) => game.id === futureSeed.id);
  assert.ok(fallback);
  assert.equal(fallback.source, "seed-current");
  assert.equal(fallback.dataFreshness, "seed-fallback");
});
