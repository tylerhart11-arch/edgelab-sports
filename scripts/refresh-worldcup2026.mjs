import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWorldCup2026SourceData, toWorldCupDataModule } from "../src/data/worldCup2026Source.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = join(root, "src", "data", "worldCup2026Data.mjs");

const data = await fetchWorldCup2026SourceData();
await writeFile(target, toWorldCupDataModule(data), "utf8");

const groupMatches = data.matches.filter((match) => match.group).length;
const knockoutMatches = data.matches.length - groupMatches;
console.log(`Wrote ${target}`);
console.log(`${data.teams.length} teams, ${data.matches.length} matches (${groupMatches} group, ${knockoutMatches} knockout)`);
if (data.warnings.length) {
  console.warn(`Warnings: ${data.warnings.join("; ")}`);
}
