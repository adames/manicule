// manicule — the ranking, in the browser. Mirrors manicule.py exactly; the
// shared fixture in tests/ keeps the two honest.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Manicule = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LAMBDA = 0.25;

  // A taste is a few averages a side. The page calls each average a taste
  // ("taste 1 · 3 picks · about cooking"); in here one side is a Taste and
  // each entry is `one`. A link that carries the averages carries all of it —
  // on any day, against any feed, on anyone's fork. Ids cannot: the feed
  // turns over and they stop pointing at anything.
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
  //   sources  — where those nearest posts came from.
  // All of it is read off today's feed, so it is as true of a taste carried
  // in by a link as of one pressed just now.
  const STOP = new Set(("a an the and or but of to in on at for with from by as is are was were be been " +
    "it its this that these those there here than then so if not no yes about after again also among another " +
    "because before being between both could does doing down during each even every first have into just like " +
    "made make many more most much must never only other over same should since some still such their them " +
    "they through under until very what when where which while whose will without would your you we our my " +
    "years year week today says said show shows watch look best good new news review reviews guide things " +
    "thing world time people how why who what one two three all any can get got has had").split(" "));
  const tokens = (text) => (String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) || [])
    .filter((w) => w.length >= 3 || /\d/.test(w));

  // The phrases in a headline: every run of one to three words with no
  // stopword in it. "iphone 17 pro" and "iphone air" are what an announcement
  // is called in the feed's own words; single words alone gave "shine, event".
  function phrasesOf(text) {
    const words = tokens(text);
    const out = new Set();
    for (let i = 0; i < words.length; i++) {
      if (STOP.has(words[i])) continue;
      out.add(words[i]);
      if (i + 1 < words.length && !STOP.has(words[i + 1])) {
        out.add(words[i] + " " + words[i + 1]);
        if (i + 2 < words.length && !STOP.has(words[i + 2])) out.add(words[i] + " " + words[i + 1] + " " + words[i + 2]);
      }
    }
    return out;
  }

  // How many headlines each phrase is in, once per feed.
  const dfOf = new WeakMap();
  function documentFrequency(posts) {
    if (dfOf.has(posts)) return dfOf.get(posts);
    const df = {};
    for (const post of posts) for (const g of phrasesOf(post.title)) df[g] = (df[g] || 0) + 1;
    dfOf.set(posts, df);
    return df;
  }

  // The k posts nearest an average, nearest first. A running top-k rather than
  // a sort of the whole feed: this runs on every press.
  function nearestTo(one, posts, k) {
    const nearest = [];
    for (const post of posts) {
      if (!post.vector) continue;
      const cos = cosine(post.vector, one.vector);
      if (nearest.length < k) { nearest.push({ post, cos }); if (nearest.length === k) nearest.sort((a, b) => b.cos - a.cos); }
      else if (cos > nearest[k - 1].cos) { nearest[k - 1] = { post, cos }; nearest.sort((a, b) => b.cos - a.cos); }
    }
    if (nearest.length < k) nearest.sort((a, b) => b.cos - a.cos);
    return nearest;
  }

  // Where those nearest posts came from, the most-represented sources first.
  function sourcesOf(nearest, howMany = 3) {
    const howManyFrom = {};
    for (const { post } of nearest) howManyFrom[post.source] = (howManyFrom[post.source] || 0) + 1;
    return Object.keys(howManyFrom)
      .sort((a, b) => howManyFrom[b] - howManyFrom[a] || a.localeCompare(b))
      .slice(0, howMany);
  }

  // The labels the average sits nearest, nearest first.
  function labelsFor(one, labels, howMany = 3) {
    return labels
      .map((label) => ({ text: label.text, cos: cosine(one.vector, label.vector) }))
      .sort((a, b) => b.cos - a.cos).slice(0, howMany);
  }

  // A phrase scores by how many of the nearest headlines it is in, weighed
  // by how rare it is in the feed, with a nod to length: "iphone 17 pro"
  // over "iphone" when both are there. It has to be in two headlines or
  // it is one headline's phrase and not the taste's, and a phrase the
  // label already says is not the specific thing.
  function phraseScores(nearest, df, poolSize, saidByLabel) {
    const inHowManyHeadlines = {};
    for (const { post } of nearest) {
      for (const phrase of phrasesOf(post.title)) inHowManyHeadlines[phrase] = (inHowManyHeadlines[phrase] || 0) + 1;
    }
    return Object.keys(inHowManyHeadlines)
      .filter((phrase) => inHowManyHeadlines[phrase] >= 2 && !saidByLabel.includes(" " + phrase + " "))
      .map((phrase) => ({
        phrase,
        headlines: inHowManyHeadlines[phrase],
        score: inHowManyHeadlines[phrase] * Math.log(poolSize / ((df[phrase] || 0) + 1)) * (1 + 0.35 * (phrase.split(" ").length - 1)),
      }))
      .sort((a, b) => b.score - a.score || b.phrase.length - a.phrase.length || a.phrase.localeCompare(b.phrase));
  }

  // The best few phrases, skipping any that says what one already taken says.
  function pickWords(byScore, howMany = 3) {
    const words = [];
    for (const { phrase } of byScore) {
      if (words.length === howMany) break;
      // "iphone 17" inside "iphone 17 pro" says nothing new, either way round.
      if (words.some((w) => (" " + w + " ").includes(" " + phrase + " ") || (" " + phrase + " ").includes(" " + w + " "))) continue;
      words.push(phrase);
    }
    return words;
  }

  // A category's nearest posts are spread across the feed's ninety days.
  // An announcement's are many sources within days of each other: eleven
  // of the twelve nearest to an iphone launch were two days old, while
  // recipes, wine and an essay on liberalism ran ten to eighty. So: when
  // three quarters of the nearest posts fall within three days of each
  // other, from several sources, the taste is about something happening,
  // and the page says when rather than pretending it is a field.
  function happeningIn(nearest, sourceCount) {
    const dated = nearest.map(({ post }) => Date.parse(post.published)).filter((t) => !isNaN(t)).sort((a, b) => b - a);
    if (dated.length < 6 || sourceCount < 3) return null;
    const newest = dated[0], DAY = 86400000;
    const bunched = dated.filter((t) => newest - t <= 3 * DAY).length;
    if (bunched * 4 < dated.length * 3) return null;
    const age = (Date.now() - newest) / DAY;
    return age <= 2 ? "today" : age <= 7 ? "this week" : "lately";
  }

  function describe(taste, posts, labels = [], k = 12) {
    const df = documentFrequency(posts);
    const poolSize = posts.length + 1;
    return (taste || []).map((one) => {
      const nearest = nearestTo(one, posts, k);
      const sources = sourcesOf(nearest);
      const about = labelsFor(one, labels);

      const saidByLabel = about.length ? " " + tokens(about[0].text).join(" ") + " " : "";
      const byScore = phraseScores(nearest, df, poolSize, saidByLabel);
      const words = pickWords(byScore);

      // When one phrase is in half the nearest headlines, the taste is not
      // about a category with that phrase in it; it is about that thing, and
      // the category is the second clause. This is how "apple and iphone"
      // becomes "the iphone 17 pro", on the day it is.
      const lead = byScore.length && byScore[0].headlines * 2 >= Math.min(k, nearest.length) ? byScore[0].phrase : null;
      const focus = lead && words.includes(lead) ? lead : null;

      return {
        count: one.count,
        labels: about,
        words,
        focus,
        happening: happeningIn(nearest, sources.length),
        sources,
        nearest: nearest.length ? nearest[0].post : null,
      };
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
