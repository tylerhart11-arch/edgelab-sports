const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";

export const espnLeaguePaths = {
  NFL: ["football", "nfl"],
  NBA: ["basketball", "nba"],
  MLB: ["baseball", "mlb"],
  NHL: ["hockey", "nhl"],
  MLS: ["soccer", "usa.1"],
  NCAAF: ["football", "college-football"],
  NCAAB: ["basketball", "mens-college-basketball"]
};

export async function fetchEspnScoreboard(leagueId, options = {}) {
  const path = espnLeaguePaths[leagueId];
  if (!path) return [];
  const [sport, league] = path;
  const url = new URL(`${ESPN_BASE}/${sport}/${league}/scoreboard`);
  if (options.date) url.searchParams.set("dates", options.date);
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "EdgeLabSports/0.1"
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 9000)
  });
  if (!response.ok) {
    throw new Error(`ESPN ${leagueId} ${response.status}`);
  }
  const payload = await response.json();
  return (payload.events ?? []).map((event) => normalizeEspnEvent(leagueId, event));
}

function normalizeEspnEvent(leagueId, event) {
  const competition = event.competitions?.[0] ?? {};
  const competitors = competition.competitors ?? [];
  const home = competitors.find((team) => team.homeAway === "home") ?? competitors[0] ?? {};
  const away = competitors.find((team) => team.homeAway === "away") ?? competitors[1] ?? {};
  const statusType = competition.status?.type ?? event.status?.type ?? {};
  const statusName = `${statusType.name ?? ""} ${statusType.description ?? ""} ${statusType.detail ?? ""}`.toUpperCase();
  const statusState = statusType.state ?? "";
  const status = statusType.completed || statusState === "post" || statusName.includes("FINAL") || statusName.includes("FULL_TIME")
    ? "final"
    : statusState === "in" || statusName.includes("IN_PROGRESS") || statusName.includes("LIVE") || Number(competition.status?.period ?? 0) > 0
      ? "live"
      : "scheduled";
  return {
    provider: "espn",
    providerId: event.id,
    league: leagueId,
    sport: event.sport?.name,
    gameTime: event.date,
    status,
    period: competition.status?.period ?? null,
    clock: competition.status?.displayClock ?? "",
    homeTeam: home.team?.displayName ?? home.team?.name ?? "Home",
    awayTeam: away.team?.displayName ?? away.team?.name ?? "Away",
    homeScore: Number(home.score),
    awayScore: Number(away.score),
    neutralSite: competition.neutralSite ?? false,
    venue: competition.venue?.fullName ?? "",
    sourceUpdatedAt: new Date().toISOString()
  };
}
