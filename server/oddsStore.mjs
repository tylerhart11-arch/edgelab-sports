import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dataDir = process.env.EDGELAB_DATA_DIR || join(root, "data");
const storePath = join(dataDir, "odds-snapshots.json");
const MAX_SNAPSHOTS = 160;

async function readSnapshots() {
  try {
    return JSON.parse(await readFile(storePath, "utf8"));
  } catch {
    return [];
  }
}

async function writeSnapshots(snapshots) {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(snapshots.slice(-MAX_SNAPSHOTS), null, 2), "utf8");
}

function compactSnapshot(snapshot) {
  return {
    id: `${Date.now()}-${snapshot.provider}-${snapshot.mode}`,
    provider: snapshot.provider,
    mode: snapshot.mode,
    generatedAt: snapshot.generatedAt,
    eventCount: snapshot.events?.length ?? 0,
    markets: snapshot.markets ?? [],
    regions: snapshot.regions ?? [],
    quota: snapshot.quota ?? null,
    events: (snapshot.events ?? []).map((event) => ({
      id: event.id,
      matchNo: event.matchNo ?? null,
      commenceTime: event.commenceTime,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      bookmakers: (event.bookmakers ?? []).map((bookmaker) => ({
        key: bookmaker.key,
        title: bookmaker.title,
        lastUpdate: bookmaker.lastUpdate,
        markets: (bookmaker.markets ?? []).map((market) => ({
          key: market.key,
          outcomes: (market.outcomes ?? []).map((outcome) => ({
            name: outcome.name,
            price: outcome.price,
            point: outcome.point ?? null
          }))
        }))
      }))
    }))
  };
}

export async function recordOddsSnapshot(snapshot) {
  const snapshots = await readSnapshots();
  const compact = compactSnapshot(snapshot);
  snapshots.push(compact);
  await writeSnapshots(snapshots);
  return compact;
}

export async function oddsHistorySummary() {
  const snapshots = await readSnapshots();
  const latest = snapshots.at(-1) ?? null;
  const previous = snapshots.at(-2) ?? null;
  return {
    storePath,
    snapshotCount: snapshots.length,
    latestAt: latest?.generatedAt ?? null,
    previousAt: previous?.generatedAt ?? null,
    latestEventCount: latest?.eventCount ?? 0,
    providerModes: [...new Set(snapshots.map((snapshot) => `${snapshot.provider}:${snapshot.mode}`))],
    movement: latest && previous && latest.mode !== "seed" && !latest.mode?.includes("fallback")
      ? lineMovement(previous, latest).slice(0, 12)
      : [],
    status: latest?.mode === "seed" || latest?.mode?.includes("fallback")
      ? "seed-demo"
      : snapshots.length >= 2 ? "tracking" : snapshots.length === 1 ? "first-snapshot" : "empty"
  };
}

function lineMovement(previous, latest) {
  const before = flattenPrices(previous);
  const after = flattenPrices(latest);
  return [...after.entries()]
    .map(([key, row]) => {
      const old = before.get(key);
      if (!old || old.price === row.price) return null;
      return {
        key,
        match: row.match,
        bookmaker: row.bookmaker,
        outcome: row.outcome,
        previousPrice: old.price,
        latestPrice: row.price,
        move: row.price - old.price
      };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.move) - Math.abs(a.move));
}

function flattenPrices(snapshot) {
  const rows = new Map();
  for (const event of snapshot.events ?? []) {
    for (const bookmaker of event.bookmakers ?? []) {
      for (const market of bookmaker.markets ?? []) {
        for (const outcome of market.outcomes ?? []) {
          const key = `${event.matchNo ?? event.id}:${bookmaker.key}:${market.key}:${outcome.name}`;
          rows.set(key, {
            match: `${event.homeTeam} vs ${event.awayTeam}`,
            bookmaker: bookmaker.title,
            outcome: outcome.name,
            price: outcome.price
          });
        }
      }
    }
  }
  return rows;
}
