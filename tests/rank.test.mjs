import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const M = require("../site/rank.js");
const FIX = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));

test("fixture order and scores match Python", () => {
  const byId = Object.fromEntries(FIX.posts.map((e) => [e.id, e.vector]));
  const picked = FIX.picked.map((i) => byId[i]);
  const passed = FIX.passed.map((i) => byId[i]);
  const pickedById = Object.fromEntries(FIX.picked.map((i) => [i, byId[i]]));
  const ranked = M.rank(FIX.posts, picked, passed, FIX.lambda, pickedById);
  assert.deepEqual(ranked.map((s) => s.post.id), FIX.expected_order);
  for (const s of ranked) {
    if (s.post.id in FIX.expected_scores) assert.ok(Math.abs(s.score - FIX.expected_scores[s.post.id]) < 1e-3, s.post.id);
    if (s.post.id in FIX.expected_nearest) assert.equal(s.nearest, FIX.expected_nearest[s.post.id]);
  }
  assert.equal(ranked.at(-1).score, -Infinity);
});

test("cold start returns null", () => {
  assert.equal(M.rank(FIX.posts, [], [[0, 1, 0, 0]]), null);
});

test("dequantize round-trips cosine", () => {
  const v = [0.31, -0.02, 0.77, -0.55, 0.1];
  const s = Math.max(...v.map(Math.abs));
  const q = v.map((x) => Math.round(x / s * 127));
  assert.ok(M.cosine(v, M.dequantize(q, s)) > 0.999);
});

test("a taste blob is written and read the same in both languages", () => {
  const T = FIX.taste;
  assert.equal(M.tasteBlob({ vector: T.vector, count: T.count }), T.blob);
  const back = M.readTasteBlob(T.blob, T.vector.length);
  assert.equal(back.count, T.count);
  assert.ok(M.cosine(back.vector, T.vector) > 0.9999);

  let step = null;
  for (const vector of T.presses) step = M.press(step, vector);
  assert.equal(step.count, T.pressed_count);
  step.vector.forEach((x, i) => assert.ok(Math.abs(x - T.pressed_vector[i]) < 1e-9, `dim ${i}`));
});

test("a hand-edited taste reads as no taste, never as a crash", () => {
  for (const bad of ["", "garbage", "a~b~c", "AAAA~1~0", "AAAA~0~5", null, undefined]) {
    assert.equal(M.readTasteBlob(bad, 8), null, String(bad));
  }
  assert.equal(M.unpress(null, [1, 0]), null);
  assert.equal(M.unpress({ vector: [1, 0], count: 1 }, [1, 0]), null);
});

test("unpressing puts the average back", () => {
  const posts = Array.from({ length: 30 }, (_, k) => Array.from({ length: 8 }, (_, i) => Math.sin(k * 3 + i)));
  let taste = null;
  for (const v of posts) taste = M.press(taste, v);
  let undone = taste;
  for (const v of [...posts.slice(-5)].reverse()) undone = M.unpress(undone, v);
  assert.equal(undone.count, 25);
  let again = undone;
  for (const v of posts.slice(-5)) again = M.press(again, v);
  assert.equal(again.count, taste.count);
  again.vector.forEach((x, i) => assert.ok(Math.abs(x - taste.vector[i]) < 1e-9, `dim ${i}`));
});
