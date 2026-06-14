import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { historicalGames, leagueCoverageSummary, leagues } from "../src/data/sportsData.mjs";
import { buildAccuracyReport, buildRecommendedPicks } from "../src/model/picks.mjs";
import { runModelLab } from "../src/model/trainTest.mjs";
import { LiveScoreService } from "./liveState.mjs";
import { worldCupDashboard } from "./providers/worldcup2026.mjs";
import { worldCupOddsBoard } from "./providers/worldcupOdds.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 4317);
const host = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
const enableLive = process.env.ENABLE_LIVE !== "false";
const pollSeconds = Number(process.env.LIVE_POLL_SECONDS || 60);
const appBuild = "20260614-refresh";

const modelLab = runModelLab(historicalGames, leagues.map((league) => league.id));
const liveScores = new LiveScoreService({ enabled: enableLive, pollSeconds });
await liveScores.start();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(url, res);
      return;
    }
    await serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

async function handleApi(url, res) {
  if (url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      app: "EdgeLab Sports",
      build: appBuild,
      generatedAt: new Date().toISOString(),
      live: liveScores.snapshot(),
      model: {
        leagues: leagues.length,
        aggregateBestModel: modelLab.aggregate[0]?.name,
        trainTest: "prior seasons train, latest completed season holdout test"
      }
    });
    return;
  }
  if (url.pathname === "/api/snapshot") {
    const slate = liveScores.mergedSlate();
    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      leagues: leagueCoverageSummary(),
      slate,
      live: liveScores.snapshot(),
      modelSummary: modelLab.aggregate
    });
    return;
  }
  if (url.pathname === "/api/picks") {
    const sport = url.searchParams.get("sport");
    const slate = liveScores.mergedSlate().filter((game) => !sport || game.sport === sport || game.league === sport);
    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      picks: buildRecommendedPicks(modelLab, slate),
      live: liveScores.snapshot()
    });
    return;
  }
  if (url.pathname === "/api/accuracy") {
    sendJson(res, 200, {
      generatedAt: new Date().toISOString(),
      accuracy: buildAccuracyReport(modelLab)
    });
    return;
  }
  if (url.pathname === "/api/model-lab") {
    sendJson(res, 200, modelLab);
    return;
  }
  if (url.pathname === "/api/world-cup-2026") {
    const refresh = url.searchParams.get("refresh") !== "false";
    sendJson(res, 200, await worldCupDashboard({ refresh }));
    return;
  }
  if (url.pathname === "/api/odds/world-cup-2026") {
    const refresh = url.searchParams.get("refresh") !== "false";
    sendJson(res, 200, await worldCupOddsBoard({
      refresh,
      persist: url.searchParams.get("persist") === "true"
    }));
    return;
  }
  if (url.pathname === "/api/live/scoreboard") {
    if (url.searchParams.get("refresh") === "true") await liveScores.refresh();
    sendJson(res, 200, liveScores.snapshot());
    return;
  }
  sendJson(res, 404, { error: "Unknown API route" });
}

async function serveStatic(pathname, res) {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicDir, requestPath));
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const body = await readFile(filePath);
  const headers = {
    "content-type": mimeTypes[extname(filePath)] || "application/octet-stream"
  };
  if ([".html", ".js", ".css", ".webmanifest"].includes(extname(filePath))) {
    headers["cache-control"] = "no-store";
  }
  res.writeHead(200, headers);
  res.end(body);
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendText(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

server.listen(port, host, () => {
  const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`EdgeLab Sports running at http://${displayHost}:${port}`);
});
