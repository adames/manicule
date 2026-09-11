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
  const CAP = 20;   // how many picks an inherited average may claim

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

  // posts: [{id, vector|null, ...}]; picked/passed: arrays of vectors;
  // pickedById: {id: vector} for the "nearest picked" explanation.
  // Returns null on cold start (nothing picked) — caller keeps recency order.
  function rank(posts, picked, passed, lam = LAMBDA, pickedById = null) {
    const pos = meanVector(picked);
    if (!pos) return null;
    const neg = meanVector(passed);
    const out = posts.map((e) => {
      if (!e.vector) return { post: e, score: -Infinity, pos: 0, neg: 0, nearest: null };
      const p = cosine(e.vector, pos);
      const n = neg ? cosine(e.vector, neg) : 0;
      let nearest = null;
      if (pickedById) {
        let best = -Infinity;
        for (const id in pickedById) { const c = cosine(e.vector, pickedById[id]); if (c > best) { best = c; nearest = id; } }
      }
      return { post: e, score: p - lam * n, pos: p, neg: n, nearest };
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

  function tasteBlob(taste) {
    if (!taste || !taste.vector) return "";
    let scale = 0;
    for (const x of taste.vector) scale = Math.max(scale, Math.abs(x));
    scale = scale || 1;
    const bytes = taste.vector.map((x) => (Math.max(-127, Math.min(127, Math.round(x / scale * 127))) + 256) & 255);
    return `${toBase64(bytes)}~${Number(scale.toPrecision(6))}~${taste.count}`;
  }

  function readTasteBlob(text, dim = 384) {
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

  // A taste is an average you press things into. A press folds one post in;
  // un-pressing takes exactly the same post back out, so a box can be ticked
  // and unticked all day and the average lands where it started.
  //
  // CAP bounds how much an established average may outweigh a new press. Below
  // it, every press counts the same, which is what a plain mean does. Above it,
  // the two-hundredth press still turns the average by a twentieth instead of a
  // two-hundredth — a taste that cannot set.
  const weightOf = (count) => Math.min(count, CAP);

  function press(taste, vector) {
    if (!taste || !taste.count) return { vector: vector.slice(), count: 1 };
    const w = weightOf(taste.count), out = new Array(vector.length);
    for (let i = 0; i < vector.length; i++) out[i] = (taste.vector[i] * w + vector[i]) / (w + 1);
    return { vector: out, count: taste.count + 1 };
  }

  function unpress(taste, vector) {
    if (!taste || taste.count <= 1) return null;
    const w = weightOf(taste.count - 1), out = new Array(vector.length);
    for (let i = 0; i < vector.length; i++) out[i] = (taste.vector[i] * (w + 1) - vector[i]) / w;
    return { vector: out, count: taste.count - 1 };
  }

  return { LAMBDA, CAP, cosine, meanVector, dequantize, rank, tasteBlob, readTasteBlob, press, unpress };
});
