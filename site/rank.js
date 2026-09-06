// manicule — the ranking, in the browser. Mirrors manicule.py exactly; the
// shared fixture in tests/ keeps the two honest.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Manicule = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const LAMBDA = 0.25;

  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  function centroid(vectors) {
    if (!vectors.length) return null;
    const dim = vectors[0].length, out = new Array(dim).fill(0);
    for (const v of vectors) for (let i = 0; i < dim; i++) out[i] += v[i];
    for (let i = 0; i < dim; i++) out[i] /= vectors.length;
    return out;
  }

  // int8 + one scale per vector, as written by manicule.py's quantize().
  function dequantize(q, s) { const v = new Array(q.length); for (let i = 0; i < q.length; i++) v[i] = q[i] / 127 * s; return v; }

  // entries: [{id, vector|null, ...}]; picked/passed: arrays of vectors;
  // pickedById: {id: vector} for the "nearest picked" explanation.
  // Returns null on cold start (nothing picked) — caller keeps recency order.
  function rank(entries, picked, passed, lam = LAMBDA, pickedById = null) {
    const pos = centroid(picked);
    if (!pos) return null;
    const neg = centroid(passed);
    const out = entries.map((e) => {
      if (!e.vector) return { entry: e, score: -Infinity, pos: 0, neg: 0, nearest: null };
      const p = cosine(e.vector, pos);
      const n = neg ? cosine(e.vector, neg) : 0;
      let nearest = null;
      if (pickedById) {
        let best = -Infinity;
        for (const id in pickedById) { const c = cosine(e.vector, pickedById[id]); if (c > best) { best = c; nearest = id; } }
      }
      return { entry: e, score: p - lam * n, pos: p, neg: n, nearest };
    });
    out.sort((a, b) => b.score - a.score);
    return out;
  }

  return { LAMBDA, cosine, centroid, dequantize, rank };
});
