import { clamp, deterministicNoise, probToAmerican, sigmoid } from "../model/stats.mjs";

export const leagues = [
  {
    id: "NFL",
    name: "NFL",
    sport: "Football",
    providerSport: "football",
    providerLeague: "nfl",
    activeMonths: "Sep-Feb",
    markets: ["Moneyline", "Spread", "Total", "Player props"],
    conferences: ["AFC", "NFC"],
    baseScore: 23,
    scoreVolatility: 13,
    homeAdvantagePoints: 2.1,
    marginScale: 7.5
  },
  {
    id: "NBA",
    name: "NBA",
    sport: "Basketball",
    providerSport: "basketball",
    providerLeague: "nba",
    activeMonths: "Oct-Jun",
    markets: ["Moneyline", "Spread", "Total", "Player props"],
    conferences: ["East", "West"],
    baseScore: 113,
    scoreVolatility: 19,
    homeAdvantagePoints: 2.6,
    marginScale: 11
  },
  {
    id: "MLB",
    name: "MLB",
    sport: "Baseball",
    providerSport: "baseball",
    providerLeague: "mlb",
    activeMonths: "Mar-Nov",
    markets: ["Moneyline", "Run line", "Total", "Pitcher props"],
    conferences: ["AL", "NL"],
    baseScore: 4.4,
    scoreVolatility: 3.2,
    homeAdvantagePoints: 0.18,
    marginScale: 1.4
  },
  {
    id: "NHL",
    name: "NHL",
    sport: "Hockey",
    providerSport: "hockey",
    providerLeague: "nhl",
    activeMonths: "Oct-Jun",
    markets: ["Moneyline", "Puck line", "Total", "Goal props"],
    conferences: ["East", "West"],
    baseScore: 3.1,
    scoreVolatility: 2.1,
    homeAdvantagePoints: 0.22,
    marginScale: 1.2
  },
  {
    id: "MLS",
    name: "MLS",
    sport: "Soccer",
    providerSport: "soccer",
    providerLeague: "usa.1",
    activeMonths: "Feb-Dec",
    markets: ["Moneyline", "Asian handicap", "Total", "Both teams score"],
    conferences: ["East", "West"],
    baseScore: 1.45,
    scoreVolatility: 1.4,
    homeAdvantagePoints: 0.28,
    marginScale: 0.85
  },
  {
    id: "NCAAF",
    name: "College Football",
    sport: "Football",
    providerSport: "football",
    providerLeague: "college-football",
    activeMonths: "Aug-Jan",
    markets: ["Moneyline", "Spread", "Total"],
    conferences: ["SEC", "Big Ten", "Big 12", "ACC", "Pac-12"],
    baseScore: 29,
    scoreVolatility: 17,
    homeAdvantagePoints: 2.8,
    marginScale: 10
  },
  {
    id: "NCAAB",
    name: "College Basketball",
    sport: "Basketball",
    providerSport: "basketball",
    providerLeague: "mens-college-basketball",
    activeMonths: "Nov-Apr",
    markets: ["Moneyline", "Spread", "Total"],
    conferences: ["SEC", "Big Ten", "Big 12", "ACC", "Big East"],
    baseScore: 74,
    scoreVolatility: 15,
    homeAdvantagePoints: 2.9,
    marginScale: 9
  }
];

export const teamsByLeague = {
  NFL: [
    ["KC", "Kansas City Chiefs", "AFC", 1715],
    ["BUF", "Buffalo Bills", "AFC", 1665],
    ["BAL", "Baltimore Ravens", "AFC", 1680],
    ["CIN", "Cincinnati Bengals", "AFC", 1600],
    ["SF", "San Francisco 49ers", "NFC", 1695],
    ["PHI", "Philadelphia Eagles", "NFC", 1648],
    ["DAL", "Dallas Cowboys", "NFC", 1608],
    ["DET", "Detroit Lions", "NFC", 1635]
  ],
  NBA: [
    ["BOS", "Boston Celtics", "East", 1710],
    ["NYK", "New York Knicks", "East", 1620],
    ["MIL", "Milwaukee Bucks", "East", 1605],
    ["MIA", "Miami Heat", "East", 1560],
    ["OKC", "Oklahoma City Thunder", "West", 1715],
    ["DEN", "Denver Nuggets", "West", 1665],
    ["MIN", "Minnesota Timberwolves", "West", 1630],
    ["DAL", "Dallas Mavericks", "West", 1600]
  ],
  MLB: [
    ["LAD", "Los Angeles Dodgers", "NL", 1690],
    ["ATL", "Atlanta Braves", "NL", 1640],
    ["NYM", "New York Mets", "NL", 1585],
    ["CHC", "Chicago Cubs", "NL", 1550],
    ["NYY", "New York Yankees", "AL", 1665],
    ["BAL", "Baltimore Orioles", "AL", 1605],
    ["HOU", "Houston Astros", "AL", 1595],
    ["TEX", "Texas Rangers", "AL", 1565]
  ],
  NHL: [
    ["FLA", "Florida Panthers", "East", 1685],
    ["CAR", "Carolina Hurricanes", "East", 1635],
    ["NYR", "New York Rangers", "East", 1600],
    ["TOR", "Toronto Maple Leafs", "East", 1585],
    ["EDM", "Edmonton Oilers", "West", 1670],
    ["DAL", "Dallas Stars", "West", 1630],
    ["COL", "Colorado Avalanche", "West", 1615],
    ["VGK", "Vegas Golden Knights", "West", 1580]
  ],
  MLS: [
    ["MIA", "Inter Miami CF", "East", 1645],
    ["CLB", "Columbus Crew", "East", 1635],
    ["CIN", "FC Cincinnati", "East", 1605],
    ["ATL", "Atlanta United", "East", 1545],
    ["LAFC", "Los Angeles FC", "West", 1635],
    ["SEA", "Seattle Sounders FC", "West", 1590],
    ["DAL", "FC Dallas", "West", 1510],
    ["ATX", "Austin FC", "West", 1505]
  ],
  NCAAF: [
    ["UGA", "Georgia", "SEC", 1730],
    ["TEX", "Texas", "SEC", 1685],
    ["ALA", "Alabama", "SEC", 1665],
    ["OSU", "Ohio State", "Big Ten", 1710],
    ["MICH", "Michigan", "Big Ten", 1645],
    ["ORE", "Oregon", "Big Ten", 1640],
    ["FSU", "Florida State", "ACC", 1585],
    ["KSU", "Kansas State", "Big 12", 1565]
  ],
  NCAAB: [
    ["HOU", "Houston", "Big 12", 1705],
    ["KU", "Kansas", "Big 12", 1655],
    ["DUKE", "Duke", "ACC", 1665],
    ["UNC", "North Carolina", "ACC", 1620],
    ["UK", "Kentucky", "SEC", 1605],
    ["BAMA", "Alabama", "SEC", 1585],
    ["PUR", "Purdue", "Big Ten", 1645],
    ["UCONN", "UConn", "Big East", 1685]
  ]
};

export function getLeague(leagueId) {
  return leagues.find((league) => league.id === leagueId);
}

export function getTeam(leagueId, teamId) {
  const team = (teamsByLeague[leagueId] || []).find(([id]) => id === teamId);
  if (!team) return null;
  return {
    id: team[0],
    name: team[1],
    conference: team[2],
    baseRating: team[3]
  };
}

function scoreFor(league, rawValue) {
  if (league.id === "MLB" || league.id === "NHL" || league.id === "MLS") {
    return Math.max(0, Math.round(rawValue));
  }
  return Math.max(0, Math.round(rawValue));
}

function generateGame({ league, season, round, home, away, date }) {
  const [homeId, homeName, homeConference, homeRating] = home;
  const [awayId, awayName, awayConference, awayRating] = away;
  const matchupKey = `${league.id}-${season}-${round}-${homeId}-${awayId}`;
  const ratingDiff = homeRating - awayRating + league.homeAdvantagePoints * 14;
  const noise = deterministicNoise(matchupKey, league.scoreVolatility);
  const expectedMargin = ratingDiff / 28 + deterministicNoise(`${matchupKey}-margin`, league.marginScale * 0.35);
  const homeRaw = league.baseScore + expectedMargin / 2 + noise / 3;
  const awayRaw = league.baseScore - expectedMargin / 2 - noise / 3 + deterministicNoise(`${matchupKey}-away`, league.scoreVolatility / 4);
  const homeScore = scoreFor(league, homeRaw);
  const awayScore = scoreFor(league, awayRaw);
  const trueHomeProb = clamp(sigmoid((ratingDiff / 35 + deterministicNoise(`${matchupKey}-price`, 0.7)) / league.marginScale), 0.18, 0.82);
  const bookHomeProb = clamp(trueHomeProb + deterministicNoise(`${matchupKey}-market`, 0.035), 0.16, 0.84);
  const hold = 0.045;
  const homeMoneyline = probToAmerican(bookHomeProb * (1 + hold));
  const awayMoneyline = probToAmerican((1 - bookHomeProb) * (1 + hold));
  const closeMove = deterministicNoise(`${matchupKey}-close`, 18);
  return {
    id: matchupKey,
    league: league.id,
    sport: league.sport,
    season,
    seasonType: "regular",
    gameTime: date,
    status: "final",
    homeTeamId: homeId,
    awayTeamId: awayId,
    homeTeam: homeName,
    awayTeam: awayName,
    homeConference,
    awayConference,
    homeScore,
    awayScore,
    homeMoneyline,
    awayMoneyline,
    closingHomeMoneyline: Math.round(homeMoneyline + closeMove),
    closingAwayMoneyline: Math.round(awayMoneyline - closeMove),
    total: Math.round((league.baseScore * 2 + deterministicNoise(`${matchupKey}-total`, league.scoreVolatility)) * 10) / 10,
    spread: Math.round((-expectedMargin + deterministicNoise(`${matchupKey}-spread`, 1.2)) * 2) / 2,
    restDaysHome: 2 + Math.abs(Math.round(deterministicNoise(`${matchupKey}-rest-h`, 3))),
    restDaysAway: 2 + Math.abs(Math.round(deterministicNoise(`${matchupKey}-rest-a`, 3))),
    injurySignalHome: clamp(0.08 + Math.abs(deterministicNoise(`${matchupKey}-inj-h`, 0.12)), 0, 0.35),
    injurySignalAway: clamp(0.08 + Math.abs(deterministicNoise(`${matchupKey}-inj-a`, 0.12)), 0, 0.35),
    source: "seed-historical"
  };
}

export function generateHistoricalGames() {
  const games = [];
  const seasons = [2022, 2023, 2024, 2025];
  for (const season of seasons) {
    for (const league of leagues) {
      const teams = teamsByLeague[league.id];
      const rounds = league.id === "MLB" ? 10 : 8;
      for (let round = 0; round < rounds; round += 1) {
        const rotated = teams.map((team, idx) => teams[(idx + round) % teams.length]);
        for (let idx = 0; idx < teams.length / 2; idx += 1) {
          const home = round % 2 === 0 ? rotated[idx] : rotated[teams.length - 1 - idx];
          const away = round % 2 === 0 ? rotated[teams.length - 1 - idx] : rotated[idx];
          if (home[0] === away[0]) continue;
          const month = league.id === "MLB" || league.id === "MLS" ? 5 + (round % 5) : 10 + (round % 3);
          const day = 3 + idx * 4 + round;
          games.push(generateGame({
            league,
            season,
            round: round * 10 + idx,
            home,
            away,
            date: `${season}-${String(month).padStart(2, "0")}-${String(Math.min(day, 27)).padStart(2, "0")}T19:00:00-05:00`
          }));
        }
      }
    }
  }
  return games.sort((a, b) => new Date(a.gameTime) - new Date(b.gameTime));
}

export const currentSlate = [
  {
    id: "NBA-2026-OKC-BOS",
    league: "NBA",
    sport: "Basketball",
    season: 2026,
    gameTime: "2026-06-08T20:30:00-05:00",
    status: "scheduled",
    awayTeamId: "BOS",
    awayTeam: "Boston Celtics",
    awayConference: "East",
    homeTeamId: "OKC",
    homeTeam: "Oklahoma City Thunder",
    homeConference: "West",
    homeMoneyline: -118,
    awayMoneyline: +102,
    total: 221.5,
    spread: -1.5,
    restDaysHome: 2,
    restDaysAway: 2,
    injurySignalHome: 0.11,
    injurySignalAway: 0.14,
    source: "seed-current"
  },
  {
    id: "NHL-2026-EDM-FLA",
    league: "NHL",
    sport: "Hockey",
    season: 2026,
    gameTime: "2026-06-08T19:00:00-05:00",
    status: "scheduled",
    awayTeamId: "EDM",
    awayTeam: "Edmonton Oilers",
    awayConference: "West",
    homeTeamId: "FLA",
    homeTeam: "Florida Panthers",
    homeConference: "East",
    homeMoneyline: -112,
    awayMoneyline: -102,
    total: 6,
    spread: -1.5,
    restDaysHome: 1,
    restDaysAway: 1,
    injurySignalHome: 0.08,
    injurySignalAway: 0.12,
    source: "seed-current"
  },
  {
    id: "MLB-2026-TEX-NYY",
    league: "MLB",
    sport: "Baseball",
    season: 2026,
    gameTime: "2026-06-08T18:05:00-05:00",
    status: "scheduled",
    awayTeamId: "TEX",
    awayTeam: "Texas Rangers",
    awayConference: "AL",
    homeTeamId: "NYY",
    homeTeam: "New York Yankees",
    homeConference: "AL",
    homeMoneyline: -136,
    awayMoneyline: +118,
    total: 8.5,
    spread: -1.5,
    restDaysHome: 1,
    restDaysAway: 1,
    injurySignalHome: 0.1,
    injurySignalAway: 0.19,
    source: "seed-current"
  },
  {
    id: "MLS-2026-DAL-MIA",
    league: "MLS",
    sport: "Soccer",
    season: 2026,
    gameTime: "2026-06-09T19:30:00-05:00",
    status: "scheduled",
    awayTeamId: "MIA",
    awayTeam: "Inter Miami CF",
    awayConference: "East",
    homeTeamId: "DAL",
    homeTeam: "FC Dallas",
    homeConference: "West",
    homeMoneyline: +152,
    awayMoneyline: +164,
    total: 2.5,
    spread: +0.5,
    restDaysHome: 5,
    restDaysAway: 4,
    injurySignalHome: 0.16,
    injurySignalAway: 0.1,
    source: "seed-current"
  },
  {
    id: "NFL-2026-KC-BUF",
    league: "NFL",
    sport: "Football",
    season: 2026,
    gameTime: "2026-09-10T19:20:00-05:00",
    status: "scheduled",
    awayTeamId: "KC",
    awayTeam: "Kansas City Chiefs",
    awayConference: "AFC",
    homeTeamId: "BUF",
    homeTeam: "Buffalo Bills",
    homeConference: "AFC",
    homeMoneyline: -108,
    awayMoneyline: -104,
    total: 48.5,
    spread: -1,
    restDaysHome: 7,
    restDaysAway: 7,
    injurySignalHome: 0.1,
    injurySignalAway: 0.09,
    source: "seed-current"
  },
  {
    id: "NCAAF-2026-TEX-UGA",
    league: "NCAAF",
    sport: "Football",
    season: 2026,
    gameTime: "2026-09-19T18:30:00-05:00",
    status: "scheduled",
    awayTeamId: "TEX",
    awayTeam: "Texas",
    awayConference: "SEC",
    homeTeamId: "UGA",
    homeTeam: "Georgia",
    homeConference: "SEC",
    homeMoneyline: -132,
    awayMoneyline: +112,
    total: 54.5,
    spread: -2.5,
    restDaysHome: 7,
    restDaysAway: 7,
    injurySignalHome: 0.12,
    injurySignalAway: 0.13,
    source: "seed-current"
  },
  {
    id: "NCAAB-2026-HOU-DUKE",
    league: "NCAAB",
    sport: "Basketball",
    season: 2026,
    gameTime: "2026-11-17T20:00:00-06:00",
    status: "scheduled",
    awayTeamId: "DUKE",
    awayTeam: "Duke",
    awayConference: "ACC",
    homeTeamId: "HOU",
    homeTeam: "Houston",
    homeConference: "Big 12",
    homeMoneyline: -146,
    awayMoneyline: +124,
    total: 146.5,
    spread: -3.5,
    restDaysHome: 4,
    restDaysAway: 4,
    injurySignalHome: 0.08,
    injurySignalAway: 0.11,
    source: "seed-current"
  }
];

export const historicalGames = generateHistoricalGames();

export function leagueCoverageSummary() {
  return leagues.map((league) => ({
    ...league,
    teams: teamsByLeague[league.id].length,
    historicalGames: historicalGames.filter((game) => game.league === league.id).length,
    currentGames: currentSlate.filter((game) => game.league === league.id).length
  }));
}
