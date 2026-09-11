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

test("rank says which average a post sits nearest", () => {
  const a = [1, 0, 0], b = [0, 1, 0];
  const taste = M.tasteOf([a, [0.98, 0.2, 0], b]);
  const posts = [
    { id: "pa", vector: [0.9, 0.1, 0] }, { id: "pb", vector: [0.1, 0.9, 0] }, { id: "none", vector: null },
  ];
  const byId = Object.fromEntries(M.rank(posts, taste, []).map((s) => [s.post.id, s]));
  assert.equal(byId.pa.which, 0);
  assert.equal(byId.pb.which, 1);
  assert.equal(byId.none.which, -1);
});

test("describe reads a taste off the pool, in feed names", () => {
  const a = [1, 0, 0], b = [0, 1, 0];
  const taste = M.tasteOf([a, b]);
  const posts = [
    { id: "1", feed: "apples", vector: [0.95, 0.05, 0] },
    { id: "2", feed: "apples", vector: [0.9, 0.1, 0] },
    { id: "3", feed: "pears", vector: [0.8, 0.2, 0] },
    { id: "4", feed: "boats", vector: [0.1, 0.9, 0] },
    { id: "5", feed: "boats", vector: [0, 1, 0.1] },
    { id: "6", feed: "boats", vector: [0.05, 0.95, 0] },
    { id: "7", feed: "nowords", vector: null },
  ];
  const about = M.describe(taste, posts, [], 3);
  assert.equal(about.length, 2);
  assert.deepEqual(about[0].feeds, ["apples", "pears"]);
  assert.equal(about[0].nearest.id, "1");
  assert.deepEqual(about[1].feeds, ["boats"]);
  assert.equal(about[1].count, 1);
  assert.deepEqual(M.describe([], posts), []);
});

test("describe says what a taste is about: a label and the specific words", () => {
  const cook = [1, 0, 0], tv = [0, 1, 0];
  const labels = [
    { text: "cooking", vector: [0.9, 0.1, 0] },
    { text: "tv shows", vector: [0.1, 0.9, 0] },
    { text: "sport", vector: [0, 0, 1] },
  ];
  const posts = [
    { id: "1", feed: "a", title: "Sourdough starter hydration explained", vector: [0.95, 0.05, 0] },
    { id: "2", feed: "a", title: "A sourdough loaf for beginners", vector: [0.9, 0.1, 0] },
    { id: "3", feed: "b", title: "Why sourdough needs a long rise", vector: [0.85, 0.15, 0] },
    { id: "4", feed: "c", title: "Lanterns episode 3 recap", vector: [0.05, 0.95, 0] },
    { id: "5", feed: "c", title: "Lanterns finale review", vector: [0, 1, 0.05] },
    { id: "6", feed: "d", title: "Lanterns renewed for season two", vector: [0.1, 0.9, 0] },
    { id: "7", feed: "e", title: "The transfer window closes", vector: [0, 0, 1] },
  ];
  const about = M.describe(M.tasteOf([cook, tv]), posts, labels, 3);
  assert.equal(about[0].labels[0].text, "cooking");
  assert.ok(about[0].words.includes("sourdough"), about[0].words.join());
  assert.equal(about[1].labels[0].text, "tv shows");
  assert.ok(about[1].words.includes("lanterns"), about[1].words.join());
  // A word in one headline only is not "what the taste is about".
  assert.ok(!about[1].words.includes("finale"));
  // And a word the label already says is not the specific thing.
  const cooked = M.describe(M.tasteOf([cook]), posts, [{ text: "sourdough baking", vector: [0.9, 0.1, 0] }], 3);
  assert.equal(cooked[0].labels[0].text, "sourdough baking");
  assert.ok(!cooked[0].words.includes("sourdough"), cooked[0].words.join());
  // No labels shipped (an older build) is not an error.
  assert.deepEqual(M.describe(M.tasteOf([cook]), posts)[0].labels, []);
});
