import test from "node:test";
import assert from "node:assert/strict";
import { auditLiveEvents, espnDateKey, isStaleSeedGame, mergeLiveScores, todayDateKey } from "../server/liveState.mjs";

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
  gameTime: "2099-06-14T20:20:00.000Z",
  awayTeamId: "DAL",
  awayTeam: "Dallas Cowboys",
  homeTeamId: "PHI",
  homeTeam: "Philadelphia Eagles"
};

const liveEspnEvent = {
  provider: "espn",
  providerId: "401547650",
  league: "NBA",
  gameTime: "2099-06-14T20:00:00.000Z",
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
  const merged = mergeLiveScores([staleScheduledSeed, futureSeed], [liveEspnEvent], {
    dateKey: "2099-06-14",
    timeZone: "America/Chicago"
  });

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

test("live slate is date-scoped and quarantines provider rows outside today", () => {
  const tomorrowEvent = {
    ...liveEspnEvent,
    providerId: "tomorrow",
    gameTime: "2099-06-15T20:00:00.000Z",
    homeTeam: "Tomorrow Home",
    awayTeam: "Tomorrow Away"
  };

  const audit = auditLiveEvents([liveEspnEvent, tomorrowEvent], {
    dateKey: "2099-06-14",
    timeZone: "America/Chicago"
  });
  assert.equal(audit.validEvents.length, 1);
  assert.equal(audit.quarantinedEvents.length, 1);
  assert.equal(audit.quarantinedEvents[0].reason, "outside-today-window");

  const merged = mergeLiveScores([], [liveEspnEvent, tomorrowEvent], {
    dateKey: "2099-06-14",
    timeZone: "America/Chicago"
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].providerId, liveEspnEvent.providerId);
});

test("today date keys are stable for ESPN date-scoped requests", () => {
  assert.equal(todayDateKey(new Date("2026-06-14T12:00:00-05:00"), "America/Chicago"), "2026-06-14");
  assert.equal(espnDateKey("2026-06-14"), "20260614");
});
