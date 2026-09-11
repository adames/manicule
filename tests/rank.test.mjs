import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const M = require("../site/rank.js");
const FIX = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url)));

test("fixture order and scores match Python", () => {
  const byId = Object.fromEntries(FIX.posts.map((e) => [e.id, e.vector]));
  const picked = M.tasteOf(FIX.picked.map((i) => byId[i]));
  const passed = M.tasteOf(FIX.passed.map((i) => byId[i]));
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
  assert.equal(M.rank(FIX.posts, [], M.tasteOf([[0, 1, 0, 0]])), null);
});

test("dequantize round-trips cosine", () => {
  const v = [0.31, -0.02, 0.77, -0.55, 0.1];
  const s = Math.max(...v.map(Math.abs));
  const q = v.map((x) => Math.round(x / s * 127));
  assert.ok(M.cosine(v, M.dequantize(q, s)) > 0.999);
});

test("a taste blob is written and read the same in both languages", () => {
  const T = FIX.taste;
  assert.equal(M.tasteBlob([{ vector: T.vector, count: T.count }]), T.blob);
  const back = M.readTasteBlob(T.blob, T.vector.length);
  assert.equal(back.length, 1);
  assert.equal(back[0].count, T.count);
  assert.ok(M.cosine(back[0].vector, T.vector) > 0.9999);

  const built = M.tasteOf(T.presses);
  assert.deepEqual(built.map((one) => one.count), T.pressed_counts);
  built.forEach((one, k) => one.vector.forEach((x, i) =>
    assert.ok(Math.abs(x - T.pressed_vectors[k][i]) < 1e-9, `average ${k} dim ${i}`)));
});

test("a hand-edited taste reads as no taste, never as a crash", () => {
  for (const bad of ["", "garbage", "a~b~c", "AAAA~1~0", "AAAA~0~5", "!!", null, undefined]) {
    assert.deepEqual(M.readTasteBlob(bad, 8), [], String(bad));
  }
  // One readable average beside one ruined one keeps the readable one.
  const good = M.tasteBlob([{ vector: new Array(8).fill(1), count: 3 }]);
  assert.equal(M.readTasteBlob(good + "!wrecked", 8).length, 1);
  assert.deepEqual(M.unpress(null, [1, 0]), []);
  assert.deepEqual(M.unpress([{ vector: [1, 0], count: 1 }], [1, 0]), []);
});

test("unpressing puts the taste back", () => {
  const posts = Array.from({ length: 30 }, (_, k) => Array.from({ length: 8 }, (_, i) => Math.sin(k * 3 + i)));
  const taste = M.tasteOf(posts);
  let undone = taste;
  for (const v of [...posts.slice(-5)].reverse()) undone = M.unpress(undone, v);
  let again = undone;
  for (const v of posts.slice(-5)) again = M.press(again, v);
  assert.deepEqual(again.map((o) => o.count), taste.map((o) => o.count));
  again.forEach((one, k) => one.vector.forEach((x, i) =>
    assert.ok(Math.abs(x - taste[k].vector[i]) < 1e-9, `average ${k} dim ${i}`)));
});

test("two unrelated tastes do not average into neither", () => {
  const a = [1, 0, 0], b = [0, 1, 0];
  const taste = M.tasteOf([a, [0.98, 0.2, 0], b]);
  assert.equal(taste.length, 2);
  assert.ok(M.nearness(taste, b) > 0.99);
  assert.ok(M.cosine(M.meanVector([a, [0.98, 0.2, 0], b]), b) < 0.7);
  const many = M.tasteOf([[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0]]);
  assert.equal(many.length, M.MOST);
});
