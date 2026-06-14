import { buildWorldCupDashboard } from "../../src/model/worldCupModel.mjs";
import { buildWorldCupMarketBoard } from "../../src/model/marketEdges.mjs";
import { fetchWorldCupOddsSnapshot } from "./oddsApi.mjs";
import { oddsHistorySummary, recordOddsSnapshot } from "../oddsStore.mjs";

let cachedBoard = null;
let cachedAt = 0;
const CACHE_MS = 60_000;

export async function worldCupOddsBoard({ refresh = false, persist = false } = {}) {
  const now = Date.now();
  if (!refresh && cachedBoard && now - cachedAt < CACHE_MS) return cachedBoard;

  const worldCup = buildWorldCupDashboard();
  const oddsSnapshot = await fetchWorldCupOddsSnapshot(worldCup, { refresh });
  if (refresh || persist) {
    await recordOddsSnapshot(oddsSnapshot);
  }
  const history = await oddsHistorySummary();
  cachedBoard = buildWorldCupMarketBoard(worldCup, oddsSnapshot, history);
  cachedAt = now;
  return cachedBoard;
}
