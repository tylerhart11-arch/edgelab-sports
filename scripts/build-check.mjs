import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const requiredFiles = [
  "server/index.mjs",
  "server/liveState.mjs",
  "server/providers/espn.mjs",
  "server/providers/oddsApi.mjs",
  "server/providers/worldcupOdds.mjs",
  "server/oddsStore.mjs",
  "scripts/launch-edgelab.ps1",
  "scripts/refresh-worldcup2026.mjs",
  "src/data/sportsData.mjs",
  "src/data/worldCup2026Data.mjs",
  "src/data/worldCup2026Source.mjs",
  "src/model/stats.mjs",
  "src/model/trainTest.mjs",
  "src/model/picks.mjs",
  "src/model/marketEdges.mjs",
  "src/model/worldCupModel.mjs",
  "public/index.html",
  "public/app.js",
  "public/styles.css",
  "public/manifest.webmanifest",
  "public/sw.js",
  "public/icons/icon.svg"
];

for (const file of requiredFiles) {
  await access(join(root, file));
}

const html = await readFile(join(root, "public/index.html"), "utf8");
if (!html.includes("EdgeLab Sports") || !html.includes("app.js")) {
  throw new Error("index.html is missing the expected app shell.");
}
if (!html.includes("manifest.webmanifest") || !html.includes("theme-color")) {
  throw new Error("index.html is missing PWA metadata.");
}

await import("../src/data/sportsData.mjs");
await import("../src/data/worldCup2026Data.mjs");
await import("../src/data/worldCup2026Source.mjs");
await import("../src/model/trainTest.mjs");
await import("../src/model/picks.mjs");
await import("../src/model/marketEdges.mjs");
await import("../src/model/worldCupModel.mjs");
await import("../server/providers/oddsApi.mjs");
await import("../server/providers/worldcupOdds.mjs");

console.log(`Build check passed: ${requiredFiles.length} files present and modules import cleanly.`);
