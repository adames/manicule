// manicule — the ranking, in the browser. Mirrors manicule.py exactly; the
// shared fixture in tests/ keeps the two honest.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Manicule = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LAMBDA = 0.25;

  // A taste is two averages, so a link that carries the averages carries the
  // whole taste — on any day, against any pool, on anyone's fork. Ids cannot:
  // the pool turns over and they stop pointing at anything.
  //
  // A blob is <base64 of 384 int8>~<scale>~<count>: the direction, the size
  // that was quantized away, and how many picks are behind it.
  const CAP = 20;   // how many presses an average may claim against a new one
  const NEAR = 0.55;// a post this close to an average joins it
  const MOST = 3;   // how many averages one taste may have

  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function meanVector(vectors) {
    if (!vectors.length) return null;
    const dim = vectors[0].length, out = new Array(dim).fill(0);
    for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
    for (let i = 0; i < dim; i++) out[i] /= vectors.length;
    return out;
  }

  // int8 + one scale per vector, as written by manicule.py's quantize().
  function dequantize(q, s) { const v = new Array(q.length); for (let i = 0; i < q.length; i++) v[i] = q[i] / 127 * s; return v; }

  // How near a post sits to a taste: the closest of its averages, because a
  // reader who likes two unrelated things is near one of them, never the
  // midpoint. With one average this is the plain cosine it always was.
  function whichOne(taste, vector) {
    let best = -1, near = -Infinity;
    for (let i = 0; i < taste.length; i++) {
      const c = cosine(vector, taste[i].vector);
      if (c > near) { near = c; best = i; }
    }
    return { best, near };
  }
  const nearness = (taste, vector) => whichOne(taste, vector).near;

  // What a taste is about. Nothing is invented and nobody chose it:
  //   labels — the vocabulary in labels.txt, embedded at build time. A taste is
  //            about whichever label its average sits nearest: "cooking",
  //            "tv shows and streaming series". Same model, same cosine.
  //   words  — the uncommon words in the headlines nearest the average, which
  //            is where "lanterns" comes from when the label says "tv shows".
  //   feeds  — where those nearest posts came from.
  // All of it is read off today's pool, so it is as true of a taste carried
  // in by a link as of one pressed just now.
  const STOP = new Set(("about after again also among another because before being between both " +
    "could does doing down during each even every first from have here into just like made make many " +
    "more most much must never only other over same should since some still such than that their them " +
    "then there these they this those through under until very were what when where which while whose " +
    "will with without would your years year week today says said show shows watch look best good new " +
    "news review reviews guide things thing world time people").split(" "));
  const tokens = (text) => (String(text || "").toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []);

  // How many headlines each word is in, once per pool.
  const dfOf = new WeakMap();
  function documentFrequency(posts) {
    if (dfOf.has(posts)) return dfOf.get(posts);
    const df = {};
    for (const post of posts) for (const w of new Set(tokens(post.title))) df[w] = (df[w] || 0) + 1;
    dfOf.set(posts, df);
    return df;
  }

  function describe(taste, posts, labels = [], k = 12) {
    const df = documentFrequency(posts);
    const N = posts.length + 1;
    return (taste || []).map((one) => {
      const near = [];
      for (const post of posts) {
        if (!post.vector) continue;
        const c = cosine(post.vector, one.vector);
        if (near.length < k) { near.push({ post, c }); if (near.length === k) near.sort((a, b) => b.c - a.c); }
        else if (c > near[k - 1].c) { near[k - 1] = { post, c }; near.sort((a, b) => b.c - a.c); }
      }
      if (near.length < k) near.sort((a, b) => b.c - a.c);

      const counts = {};
      for (const { post } of near) counts[post.feed] = (counts[post.feed] || 0) + 1;
      const feeds = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b)).slice(0, 3);

      // A word scores by how many of the nearest headlines it is in, weighed by
      // how rare it is in the pool. "the" is everywhere and scores nothing;
      // "lanterns" in three of twelve headlines is the whole story.
      const score = {};
      for (const { post } of near) {
        for (const w of new Set(tokens(post.title))) {
          if (STOP.has(w)) continue;
          score[w] = (score[w] || 0) + Math.log(N / ((df[w] || 0) + 1));
        }
      }
      // A word in one headline only is that headline's, not the taste's.
      const inHow = {};
      for (const { post } of near) for (const w of new Set(tokens(post.title))) inHow[w] = (inHow[w] || 0) + 1;
      const about = labels
        .map((label) => ({ text: label.text, cos: cosine(one.vector, label.vector) }))
        .sort((a, b) => b.cos - a.cos).slice(0, 3);

      // "about recipes · recipes, chicken" says recipes twice. A word the
      // label already says is not the specific thing.
      const saidByLabel = new Set(about.length ? tokens(about[0].text) : []);
      const words = Object.keys(score)
        .filter((w) => inHow[w] >= 2 && !saidByLabel.has(w))
        .sort((a, b) => score[b] - score[a] || a.localeCompare(b)).slice(0, 3);

      return { count: one.count, labels: about, words, feeds, nearest: near.length ? near[0].post : null };
    });
  }

  // posts: [{id, vector|null, ...}]; picked/passed: tastes, each an array of
  // {vector, count}; pickedById: {id: vector} for the "nearest picked" line.
  // Returns null on cold start (nothing picked) — caller keeps recency order.
  function rank(posts, picked, passed, lam = LAMBDA, pickedById = null) {
    picked = picked || [];
    passed = passed || [];
    if (!picked.length) return null;
    const out = posts.map((e) => {
      if (!e.vector) return { post: e, score: -Infinity, pos: 0, neg: 0, nearest: null, which: -1 };
      const { best: which, near: p } = whichOne(picked, e.vector);
      const n = passed.length ? nearness(passed, e.vector) : 0;
      let nearest = null;
      if (pickedById) {
        let best = -Infinity;
        for (const id in pickedById) { const c = cosine(e.vector, pickedById[id]); if (c > best) { best = c; nearest = id; } }
      }
      return { post: e, score: p - lam * n, pos: p, neg: n, nearest, which };
    });
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  // ── a taste, written down ────────────────────────────────────────────────

  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  function toBase64(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      const have = bytes.length - i;
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
      if (have > 1) out += B64[(n >> 6) & 63];
      if (have > 2) out += B64[n & 63];
    }
    return out;
  }

  function fromBase64(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i += 4) {
      const have = Math.min(4, text.length - i);
      let n = 0;
      for (let k = 0; k < 4; k++) n = (n << 6) | (k < have ? B64.indexOf(text[i + k]) : 0);
      bytes.push((n >> 16) & 255);
      if (have > 2) bytes.push((n >> 8) & 255);
      if (have > 3) bytes.push(n & 255);
    }
    return bytes;
  }

  const signedByte = (b) => (b > 127 ? b - 256 : b);

  function oneBlob(one) {
    let scale = 0;
    for (const x of one.vector) scale = Math.max(scale, Math.abs(x));
    scale = scale || 1;
    const bytes = one.vector.map((x) => (Math.max(-127, Math.min(127, Math.round(x / scale * 127))) + 256) & 255);
    return `${toBase64(bytes)}~${Number(scale.toPrecision(6))}~${one.count}`;
  }

  function readOne(text, dim) {
    const parts = String(text || "").split("~");
    if (parts.length !== 3) return null;
    const scale = parseFloat(parts[1]), count = parseInt(parts[2], 10);
    if (!(scale > 0) || !(count > 0)) return null;
    const bytes = fromBase64(parts[0]);
    if (bytes.length < dim) return null;
    const vector = new Array(dim);
    for (let i = 0; i < dim; i++) vector[i] = signedByte(bytes[i]) / 127 * scale;
    return { vector, count };
  }

  // Several averages, so several blobs, separated by "!" — which a fragment
  // carries as itself and never percent-encodes.
  const tasteBlob = (taste) => (taste || []).map(oneBlob).join("!");

  function readTasteBlob(text, dim = 384) {
    const out = [];
    for (const part of String(text || "").split("!")) {
      const one = readOne(part, dim);
      if (one) out.push(one);
    }
    return out;
  }

  // A taste is an average you press things into. A press folds one post in;
  // un-pressing takes exactly the same post back out, so a box can be ticked
  // and unticked all day and the average lands where it started.
  //
  // CAP bounds how much an established average may outweigh a new press. Below
  // it, every press counts the same, which is what a plain mean does. Above it,
  // the two-hundredth press still turns the average by a twentieth instead of a
  // two-hundredth — a taste that cannot set.
  const weightOf = (count) => Math.min(count, CAP);

  function foldIn(one, vector) {
    const w = weightOf(one.count), out = new Array(vector.length);
    for (let i = 0; i < vector.length; i++) out[i] = (one.vector[i] * w + vector[i]) / (w + 1);
    return { vector: out, count: one.count + 1 };
  }

  function foldOut(one, vector) {
    if (one.count <= 1) return null;
    const w = weightOf(one.count - 1), out = new Array(vector.length);
    for (let i = 0; i < vector.length; i++) out[i] = (one.vector[i] * (w + 1) - vector[i]) / w;
    return { vector: out, count: one.count - 1 };
  }

  function press(taste, vector) {
    const out = (taste || []).slice();
    const { best, near } = whichOne(out, vector);
    if (best >= 0 && (near >= NEAR || out.length >= MOST)) out[best] = foldIn(out[best], vector);
    else out.push({ vector: vector.slice(), count: 1 });
    return out;
  }

  // The same post back out of the same average, so a box can be ticked and
  // unticked all day and the taste lands where it started.
  function unpress(taste, vector) {
    const out = (taste || []).slice();
    const { best } = whichOne(out, vector);
    if (best < 0) return out;
    const left = foldOut(out[best], vector);
    if (left) out[best] = left;
    else out.splice(best, 1);
    return out;
  }

  const tasteOf = (vectors) => vectors.reduce(press, []);
  const pressesIn = (taste) => (taste || []).reduce((n, one) => n + one.count, 0);

  return { LAMBDA, CAP, NEAR, MOST, cosine, meanVector, dequantize, rank, nearness, whichOne, describe,
           tasteBlob, readTasteBlob, press, unpress, tasteOf, pressesIn };
});
