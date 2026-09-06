import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const M = require("../site/rank.js");
const FIX = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));

test("fixture order and scores match Python", () => {
  const byId = Object.fromEntries(FIX.entries.map((e) => [e.id, e.vector]));
  const kept = FIX.kept.map((i) => byId[i]);
  const dismissed = FIX.dismissed.map((i) => byId[i]);
  const keptById = Object.fromEntries(FIX.kept.map((i) => [i, byId[i]]));
  const ranked = M.rank(FIX.entries, kept, dismissed, FIX.lambda, keptById);
  assert.deepEqual(ranked.map((s) => s.entry.id), FIX.expected_order);
  for (const s of ranked) {
    if (s.entry.id in FIX.expected_scores) assert.ok(Math.abs(s.score - FIX.expected_scores[s.entry.id]) < 1e-3, s.entry.id);
    if (s.entry.id in FIX.expected_nearest) assert.equal(s.nearest, FIX.expected_nearest[s.entry.id]);
  }
  assert.equal(ranked.at(-1).score, -Infinity);
});

test("cold start returns null", () => {
  assert.equal(M.rank(FIX.entries, [], [[0, 1, 0, 0]]), null);
});

test("dequantize round-trips cosine", () => {
  const v = [0.31, -0.02, 0.77, -0.55, 0.1];
  const s = Math.max(...v.map(Math.abs));
  const q = v.map((x) => Math.round(x / s * 127));
  assert.ok(M.cosine(v, M.dequantize(q, s)) > 0.999);
});
