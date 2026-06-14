import test from "node:test";
import assert from "node:assert/strict";
import { worldCupMatches } from "../src/data/worldCup2026Data.mjs";

test("World Cup seed keeps complete match numbers and current settled results", () => {
  const matchNos = worldCupMatches.map((match) => match.matchNo).sort((a, b) => a - b);
  assert.equal(matchNos.length, 104);
  assert.deepEqual(matchNos, Array.from({ length: 104 }, (_, index) => index + 1));

  const usaParaguay = worldCupMatches.find((match) => match.matchNo === 4);
  assert.equal(usaParaguay?.homeTeam, "United States");
  assert.equal(usaParaguay?.awayTeam, "Paraguay");
  assert.equal(usaParaguay?.status, "final");
  assert.match(usaParaguay?.score ?? "", /^4.+1$/);
});
