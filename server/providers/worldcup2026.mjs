import { fetchWorldCup2026SourceData } from "../../src/data/worldCup2026Source.mjs";
import { buildWorldCupDashboard } from "../../src/model/worldCupModel.mjs";

const REFRESH_CACHE_MS = 120_000;

let cachedDashboard = null;
let cachedAt = 0;

export async function worldCupDashboard({ refresh = false } = {}) {
  const now = Date.now();
  if (refresh && cachedDashboard && now - cachedAt < REFRESH_CACHE_MS) {
    return cachedDashboard;
  }

  if (!refresh) {
    return cachedDashboard ?? buildWorldCupDashboard();
  }

  try {
    const sourceData = await fetchWorldCup2026SourceData();
    cachedDashboard = buildWorldCupDashboard({
      ...sourceData,
      sourceMeta: {
        generatedAt: sourceData.generatedAt,
        sourceAccessedAt: sourceData.sourceAccessedAt,
        sourceCount: sourceData.sources.length,
        warnings: sourceData.warnings
      }
    });
    cachedAt = now;
    return cachedDashboard;
  } catch (error) {
    return buildWorldCupDashboard({}, { refreshError: error.message });
  }
}
