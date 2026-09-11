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

test("describe reads a taste off the pool, in source names", () => {
  const a = [1, 0, 0], b = [0, 1, 0];
  const taste = M.tasteOf([a, b]);
  const posts = [
    { id: "1", source: "apples", vector: [0.95, 0.05, 0] },
    { id: "2", source: "apples", vector: [0.9, 0.1, 0] },
    { id: "3", source: "pears", vector: [0.8, 0.2, 0] },
    { id: "4", source: "boats", vector: [0.1, 0.9, 0] },
    { id: "5", source: "boats", vector: [0, 1, 0.1] },
    { id: "6", source: "boats", vector: [0.05, 0.95, 0] },
    { id: "7", source: "nowords", vector: null },
  ];
  const about = M.describe(taste, posts, [], 3);
  assert.equal(about.length, 2);
  assert.deepEqual(about[0].sources, ["apples", "pears"]);
  assert.equal(about[0].nearest.id, "1");
  assert.deepEqual(about[1].sources, ["boats"]);
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
    { id: "1", source: "a", title: "Sourdough starter hydration explained", vector: [0.95, 0.05, 0] },
    { id: "2", source: "a", title: "A sourdough loaf for beginners", vector: [0.9, 0.1, 0] },
    { id: "3", source: "b", title: "Why sourdough needs a long rise", vector: [0.85, 0.15, 0] },
    { id: "4", source: "c", title: "Lanterns episode 3 recap", vector: [0.05, 0.95, 0] },
    { id: "5", source: "c", title: "Lanterns finale review", vector: [0, 1, 0.05] },
    { id: "6", source: "d", title: "Lanterns renewed for season two", vector: [0.1, 0.9, 0] },
    { id: "7", source: "e", title: "The transfer window closes", vector: [0, 0, 1] },
  ];
  const about = M.describe(M.tasteOf([cook, tv]), posts, labels, 3);
  assert.equal(about[0].labels[0].text, "cooking");
  assert.ok(about[0].words.includes("sourdough"), about[0].words.join());
  assert.equal(about[1].labels[0].text, "tv shows");
  assert.ok(about[1].words.includes("lanterns"), about[1].words.join());
  // "lanterns" is in every one of the nearest headlines: the taste is about
  // lanterns, and "tv shows" is the category it sits in.
  assert.equal(about[1].focus, "lanterns");
  assert.equal(about[0].focus, "sourdough");
  // A word in one headline only is not "what the taste is about".
  assert.ok(!about[1].words.includes("finale"));
  // And a word the label already says is not the specific thing.
  const cooked = M.describe(M.tasteOf([cook]), posts, [{ text: "sourdough baking", vector: [0.9, 0.1, 0] }], 3);
  assert.equal(cooked[0].labels[0].text, "sourdough baking");
  assert.ok(!cooked[0].words.includes("sourdough"), cooked[0].words.join());
  // No labels shipped (an older build) is not an error.
  assert.deepEqual(M.describe(M.tasteOf([cook]), posts)[0].labels, []);
});

test("a phrase beats its own words, and a focus needs half the headlines", () => {
  const posts = [
    { id: "1", source: "a", title: "The iPhone Air and iPhone 17 Pro", vector: [1, 0] },
    { id: "2", source: "b", title: "iPhone 17 Pro review roundup", vector: [0.98, 0.1] },
    { id: "3", source: "c", title: "Everything Apple announced: iPhone 17 Pro, iPhone Air", vector: [0.97, 0.2] },
    { id: "4", source: "d", title: "Apple's surprise and shine event", vector: [0.9, 0.3] },
    { id: "5", source: "e", title: "Why the iPhone Air is so thin", vector: [0.95, 0.1] },
    { id: "6", source: "f", title: "A cheaper way to buy an old iPhone", vector: [0.8, 0.5] },
  ];
  const labels = [{ text: "apple and iphone", vector: [1, 0] }, { text: "sport", vector: [0, 1] }];
  const [about] = M.describe(M.tasteOf([[1, 0]]), posts, labels, 6);
  assert.equal(about.labels[0].text, "apple and iphone");
  assert.ok(about.words.includes("iphone 17 pro"), about.words.join(" | "));
  assert.ok(!about.words.includes("iphone 17"), "the shorter phrase says nothing new");
  assert.equal(about.focus, "iphone 17 pro");
  // Spread the headlines out and nothing dominates: a category, not a thing.
  const spread = posts.map((p, i) => ({ ...p, title: ["Apple earnings beat", "New MacBook rumours", "iOS bug fixed", "Vision Pro sales", "Tim Cook interview", "AirPods teardown"][i] }));
  assert.equal(M.describe(M.tasteOf([[1, 0]]), spread, labels, 6)[0].focus, null);
});

test("posts bunched in time are something happening; spread out, a field", () => {
  const day = 86400000, now = Date.now();
  const at = (d) => new Date(now - d * day).toISOString();
  const mk = (ages) => ages.map((d, i) => ({ id: String(i), source: "f" + (i % 4), title: "headline " + i, published: at(d), vector: [1, 0.01 * i] }));
  const taste = M.tasteOf([[1, 0]]);
  const launch = M.describe(taste, mk([0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 9, 40]), [], 12)[0];
  assert.equal(launch.happening, "today");
  const lastWeek = M.describe(taste, mk([5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 30, 60]), [], 12)[0];
  assert.equal(lastWeek.happening, "this week");
  const field = M.describe(taste, mk([0, 0, 1, 3, 8, 9, 13, 15, 22, 38, 60, 86]), [], 12)[0];
  assert.equal(field.happening, null);
  // One source shouting is not an announcement.
  const oneFeed = mk([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]).map((p) => ({ ...p, source: "solo" }));
  assert.equal(M.describe(taste, oneFeed, [], 12)[0].happening, null);
  // Undated posts do not count either way.
  const undated = mk([0, 0, 0, 0, 0, 0]).map((p) => ({ ...p, published: "" }));
  assert.equal(M.describe(taste, undated, [], 12)[0].happening, null);
});
