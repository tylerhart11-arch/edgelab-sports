const GROUPS = "ABCDEFGHIJKL".split("");
const WIKI_RAW_BASE = "https://en.wikipedia.org/w/index.php";

const PAGE_TITLES = [
  ...GROUPS.map((group) => [`Group ${group}`, `2026_FIFA_World_Cup_Group_${group}`]),
  ["Knockout", "2026_FIFA_World_Cup_knockout_stage"],
  ["Final", "2026_FIFA_World_Cup_final"]
];

export const worldCupSourceLinks = [
  {
    title: "FIFA World Cup 26 fixtures",
    url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/fixtures",
    role: "Official live fixture and match-centre source"
  },
  {
    title: "FIFA World Cup 26 match schedule PDF",
    url: "https://digitalhub.fifa.com/m/1be9ce37eb98fcc5/original/FWC26-Match-Schedule_English.pdf",
    role: "Official fixture schedule reference"
  },
  {
    title: "FIFA/Coca-Cola Men's World Ranking",
    url: "https://inside.fifa.com/fifa-world-ranking/men",
    role: "Team-strength ranking input"
  },
  {
    title: "Wikipedia normalized fixture pages",
    url: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
    role: "Text-friendly schedule normalization with FIFA citations"
  }
];

function pageUrl(title) {
  return `${WIKI_RAW_BASE}?title=${encodeURIComponent(title)}&action=raw`;
}

function cleanMarkup(value = "") {
  return value
    .replace(/\{\{nbsp\}\}/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/<includeonly>/g, "")
    .replace(/<\/includeonly>/g, "")
    .replace(/<!--.*?-->/gs, "")
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\{\{nowrap\|([^}]+)\}\}/g, "$1")
    .replace(/\{\{[^{}]*\}\}/g, "")
    .replace(/<ref[\s\S]*?<\/ref>/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getField(block, name) {
  const regex = new RegExp(`\\n\\|${name}=([\\s\\S]*?)(?=\\n\\|[a-zA-Z0-9_]+=|\\n}})`, "m");
  const match = block.match(regex);
  return match ? match[1].trim() : "";
}

function extractScore(rawScore, block) {
  const scoreLink = rawScore.match(/\{\{score link\|([\s\S]*?)\}\}/);
  const scoreDisplay = scoreLink ? scoreLink[1].split("|")[1] : cleanMarkup(rawScore);
  const matchNo =
    scoreDisplay.match(/Match (\d+)/i)?.[1] ??
    block.match(/PMSR-M(\d+)/i)?.[1] ??
    block.match(/\bM(\d{2})\b/i)?.[1];
  const score = scoreDisplay && !/Match \d+/i.test(scoreDisplay) && /\d/.test(scoreDisplay)
    ? cleanMarkup(scoreDisplay)
    : "";
  return {
    matchNo: matchNo ? Number(matchNo) : null,
    score
  };
}

function extractDate(rawDate) {
  const match = rawDate.match(/Start date\|(\d{4})\|(\d{1,2})\|(\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function extractTeamCode(rawTeam) {
  return rawTeam.match(/\|fb(?:-rt)?\|([A-Z0-9]{2,4})/)?.[1] ?? null;
}

function cleanTeam(rawTeam, fallback = "") {
  const cleaned = cleanMarkup(rawTeam);
  return cleaned || fallback;
}

function parseVenue(rawVenue) {
  const cleaned = cleanMarkup(rawVenue);
  const [venue, ...cityParts] = cleaned.split(",").map((part) => part.trim()).filter(Boolean);
  return {
    venue: venue || "",
    city: cityParts.join(", ")
  };
}

function stageFromMatchNo(matchNo, group) {
  if (group) return "Group Stage";
  if (matchNo === 104) return "Final";
  if (matchNo === 103) return "Third Place";
  if (matchNo >= 101) return "Semifinal";
  if (matchNo >= 97) return "Quarterfinal";
  if (matchNo >= 89) return "Round of 16";
  return "Round of 32";
}

function parseTeamRows(wikitext, group) {
  const rows = [...wikitext.matchAll(new RegExp(`\\| ${group}[1-4] \\|\\|([\\s\\S]*?)(?=\\n\\|-)`, "g"))];
  return rows.map((row) => {
    const cells = row[0].split("||").map(cleanMarkup);
    const drawPosition = cleanMarkup(cells[0].replace("|", ""));
    const code = row[0].match(/\|fb\|([A-Z0-9]{2,4})/)?.[1] ?? null;
    return {
      group,
      drawPosition,
      code,
      name: code,
      fifaRank: Number(cells.at(-2)) || null,
      fifaRankDraw: Number(cells.at(-1)) || null
    };
  });
}

function parseFootballBoxes(wikitext, group = null) {
  const boxes = [...wikitext.matchAll(
    /===([^=\n]+?)===\s*(?:\n[\s\S]*?)?<section begin=\"?([^\s\/>\"]+)\"? \/>\{\{#invoke:football box\|main([\s\S]*?)\n\}\}<section end/g
  )];
  return boxes.map((match) => {
    const title = cleanMarkup(match[1]);
    const headingTeams = title.split(/\s+vs\s+/);
    const block = match[3];
    const rawTeam1 = getField(block, "team1");
    const rawTeam2 = getField(block, "team2");
    const homeCode = extractTeamCode(rawTeam1);
    const awayCode = extractTeamCode(rawTeam2);
    const { matchNo, score } = extractScore(getField(block, "score"), block);
    const { venue, city } = parseVenue(getField(block, "stadium"));
    const homeTeam = cleanTeam(rawTeam1, headingTeams[0] || title);
    const awayTeam = cleanTeam(rawTeam2, headingTeams[1] || "");

    return {
      id: matchNo ? `wc26-${matchNo}` : `wc26-${group || "ko"}-${match[2]}`,
      matchNo,
      group,
      stage: stageFromMatchNo(matchNo ?? 0, group),
      section: match[2],
      date: extractDate(getField(block, "date")),
      timeLocal: cleanMarkup(getField(block, "time")),
      homeTeam,
      awayTeam,
      homeCode,
      awayCode,
      score,
      venue,
      city,
      status: score ? "final" : "scheduled",
      participantStatus: /Group|Match|3rd|Runner-up|Winner|Loser/.test(`${homeTeam} ${awayTeam}`) ? "placeholder" : "known",
      dataQuality: score ? "settled-score" : group ? "source-backed-fixture" : "bracket-placeholder"
    };
  });
}

function normalizeThirdPlaceBlock(wikitext) {
  const blockMatch = wikitext.match(/<section begin="3rd" \/>\{\{#invoke:football box\|main([\s\S]*?)\n\}\}<section end="3rd" \/>/);
  if (!blockMatch) return [];
  const block = blockMatch[1];
  const rawTeam1 = getField(block, "team1");
  const rawTeam2 = getField(block, "team2");
  const { matchNo, score } = extractScore(getField(block, "score"), block);
  const { venue, city } = parseVenue(getField(block, "stadium"));
  return [{
    id: `wc26-${matchNo || 103}`,
    matchNo: matchNo || 103,
    group: null,
    stage: "Third Place",
    section: "3rd",
    date: extractDate(getField(block, "date")),
    timeLocal: cleanMarkup(getField(block, "time")),
    homeTeam: cleanTeam(rawTeam1, "Loser Match 101"),
    awayTeam: cleanTeam(rawTeam2, "Loser Match 102"),
    homeCode: extractTeamCode(rawTeam1),
    awayCode: extractTeamCode(rawTeam2),
    score,
    venue,
    city,
    status: score ? "final" : "scheduled",
    participantStatus: "placeholder",
    dataQuality: "bracket-placeholder"
  }];
}

function normalizeFinalBlock(wikitext) {
  const blockMatch = wikitext.match(/<section begin="Final" \/>\{\{#invoke:football box\|main([\s\S]*?)\n\}\}<section end="Final" \/>/);
  if (!blockMatch) return [];
  const block = blockMatch[1];
  const rawTeam1 = getField(block, "team1");
  const rawTeam2 = getField(block, "team2");
  const { matchNo, score } = extractScore(getField(block, "score"), block);
  const { venue, city } = parseVenue(getField(block, "stadium"));
  return [{
    id: `wc26-${matchNo || 104}`,
    matchNo: matchNo || 104,
    group: null,
    stage: "Final",
    section: "Final",
    date: extractDate(getField(block, "date")),
    timeLocal: cleanMarkup(getField(block, "time")),
    homeTeam: cleanTeam(rawTeam1, "Winner Match 101"),
    awayTeam: cleanTeam(rawTeam2, "Winner Match 102"),
    homeCode: extractTeamCode(rawTeam1),
    awayCode: extractTeamCode(rawTeam2),
    score,
    venue,
    city,
    status: score ? "final" : "scheduled",
    participantStatus: "placeholder",
    dataQuality: "bracket-placeholder"
  }];
}

function applyTeamNames(teams, matches) {
  const codeNames = new Map();
  for (const match of matches.filter((item) => item.group)) {
    if (match.homeCode && match.homeTeam) codeNames.set(match.homeCode, match.homeTeam);
    if (match.awayCode && match.awayTeam) codeNames.set(match.awayCode, match.awayTeam);
  }
  return teams.map((team) => ({
    ...team,
    name: codeNames.get(team.code) || team.code,
    ratingSeed: team.fifaRank ? Math.round(2075 - Math.log2(team.fifaRank) * 95) : 1500,
    host: ["CAN", "MEX", "USA"].includes(team.code)
  }));
}

export async function fetchWorldCup2026SourceData({ fetchImpl = fetch } = {}) {
  const teams = [];
  const matches = [];
  const warnings = [];

  for (const [label, title] of PAGE_TITLES) {
    const response = await fetchImpl(pageUrl(title), {
      headers: { "user-agent": "EdgeLabSports/0.1 local analytics refresh" }
    });
    const text = await response.text();
    if (!response.ok || !text.startsWith("{{")) {
      throw new Error(`${title} returned ${response.status}: ${text.slice(0, 90)}`);
    }

    if (label.startsWith("Group ")) {
      const group = label.at(-1);
      teams.push(...parseTeamRows(text, group));
      matches.push(...parseFootballBoxes(text, group));
    } else if (label === "Knockout") {
      matches.push(...parseFootballBoxes(text, null));
      matches.push(...normalizeThirdPlaceBlock(text));
    } else if (label === "Final") {
      matches.push(...normalizeFinalBlock(text));
    }
  }

  const namedTeams = applyTeamNames(teams, matches);
  const seenMatchNos = new Set();
  const dedupedMatches = matches
    .filter((match) => {
      if (!match.matchNo) warnings.push(`Missing match number for ${match.section}`);
      if (match.matchNo && seenMatchNos.has(match.matchNo)) return false;
      if (match.matchNo) seenMatchNos.add(match.matchNo);
      return true;
    })
    .sort((a, b) => (a.matchNo ?? 999) - (b.matchNo ?? 999));

  return {
    generatedAt: new Date().toISOString(),
    sourceAccessedAt: new Date().toISOString(),
    sources: worldCupSourceLinks,
    teams: namedTeams,
    groups: GROUPS.map((group) => ({
      id: group,
      teams: namedTeams.filter((team) => team.group === group).map((team) => team.code)
    })),
    matches: dedupedMatches,
    warnings
  };
}

export function toWorldCupDataModule(data) {
  const header = `// Generated by scripts/refresh-worldcup2026.mjs.\n// Source-backed seed for local/offline use; the API can refresh from public sources when network is available.\n`;
  return `${header}\nexport const worldCupSourceMeta = ${JSON.stringify({
    generatedAt: data.generatedAt,
    sourceAccessedAt: data.sourceAccessedAt,
    sourceCount: data.sources.length,
    warnings: data.warnings
  }, null, 2)};\n\nexport const worldCupSources = ${JSON.stringify(data.sources, null, 2)};\n\nexport const worldCupTeams = ${JSON.stringify(data.teams, null, 2)};\n\nexport const worldCupGroups = ${JSON.stringify(data.groups, null, 2)};\n\nexport const worldCupMatches = ${JSON.stringify(data.matches, null, 2)};\n`;
}
