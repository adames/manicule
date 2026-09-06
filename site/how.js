// how.js: the method page. Fetches rank() from the repo and prints it as
// a listing with five margin notes, then works one row from the visitor's
// own marks with the same rank.js the feed uses. Nothing leaves the page
// but the two fetches.
(function () {
  const $ = (id) => document.getElementById(id);
  const { hand, esc } = Shell;
  const CANON = "adames"; // the upstream repo; forks derive their own owner from the host
  const raw = (owner) => `https://raw.githubusercontent.com/${owner}/manicule/main/manicule.py`;

  // ---- the listing. Notes are keyed by a substring of the code line so
  // they survive edits; each fires once, on the first line that matches.
  const NOTES = [
    ["return None", "nothing kept: newest first"],
    ['float("-inf")', "no text: sinks, never dropped"],
    ["p - lam * n", "the whole method", true],
    ["out.sort(", "best first"],
    ["cosine(e.vector, kept_ids[k])", "the near line"],
  ];
  function owner() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    return m ? m[1].toLowerCase() : null;
  }
  // own raw file on a github host, else a local copy, else upstream
  async function fetchSource() {
    const o = owner();
    const tries = [];
    if (o) tries.push({ url: raw(o), from: "main" });
    tries.push({ url: "./manicule.py", from: "local copy" });
    if (o !== CANON) tries.push({ url: raw(CANON), from: "main" });
    for (const t of tries) {
      try {
        const r = await fetch(t.url, { cache: "no-cache" });
        if (!r.ok) continue;
        const text = await r.text();
        if (text.includes("def rank(")) return { ...t, text, owner: t.url.startsWith("http") ? (o && t.url === raw(o) ? o : CANON) : null };
      } catch (_) {}
    }
    return null;
  }
  function renderListing(src) {
    const box = $("listing"), cap = $("listing-cap");
    if (!src) {
      box.innerHTML = `<div class="cap"><span><b>manicule.py</b> · rank()</span></div><div class="grp"><pre>couldn't load</pre></div>`;
      cap.textContent = "";
      return;
    }
    const lines = src.text.split("\n");
    const start = lines.findIndex((l) => l.startsWith("def rank("));
    let end = start < 0 ? -1 : lines.findIndex((l, i) => i > start && l === "    return out");
    if (start < 0 || end < 0) return renderListing(null);
    const used = new Set();
    const rows = [];
    for (let i = start; i <= end; i++) {
      const line = lines[i];
      let note = null;
      for (const n of NOTES) if (!used.has(n) && line.includes(n[0])) { used.add(n); note = n; break; }
      let code = esc(line);
      if (note && note[2]) code = code.replace(esc(note[0]), `<span class="hi">${esc(note[0])}</span>`);
      rows.push(`<div class="grp${note && note[2] ? " key" : ""}"><pre><span class="ln">${i + 1}</span>${code}</pre>${note ? `<p class="note">${note[2] ? hand("rest") : ""}<span>${esc(note[1])}</span></p>` : ""}</div>`);
    }
    box.innerHTML = `<div class="cap"><span><b>manicule.py</b> · rank()</span><span>${end - start + 1} lines</span></div>` + rows.join("");
    cap.textContent = `lines ${start + 1}–${end + 1} · ${src.from === "main" ? "fetched from main" : src.from}`;
    if (src.owner) $("listing-github").href = `https://github.com/${src.owner}/manicule/blob/main/manicule.py#L${start + 1}-L${end + 1}`;
  }

  // ---- the visitor's taste: the hash first, else this browser's mirror.
  // Cold (nothing kept with text) uses a pretend taste so the arithmetic
  // still has numbers: the newest row kept, the next newest dismissed.
  let corpus = null, byId = {};
  function taste() {
    const h = Shell.marksIn(location.hash);
    let m = h.m, d = h.d, lam = Shell.lam(h.l);
    // no marks in the hash (a bare λ counts as none): this browser's own, the hash's λ first
    if (!m.length && !d.length) {
      const saved = Shell.mirror();
      if (saved) { m = saved.m || []; d = saved.d || []; if (isNaN(lam)) lam = Shell.lam(saved.l); }
    }
    if (isNaN(lam)) lam = Manicule.LAMBDA;
    const has = (id) => byId[id] && byId[id].vector;
    m = m.filter(has); d = d.filter(has);
    const pretend = !m.length;
    if (pretend) {
      const text = corpus.entries.filter((e) => e.vector);
      m = [text[0].id]; d = text[1] ? [text[1].id] : [];
    }
    return { m, d, lam, pretend };
  }
  // the taste as a feed hash, so links from here open the feed in this state
  const hashOf = (t) => Shell.hashOf(t.m, t.d, t.lam);
  function rankAt(t, lam) {
    const vec = (ids) => ids.map((i) => byId[i].vector);
    const keptById = {}; for (const i of t.m) keptById[i] = byId[i].vector;
    return Manicule.rank(corpus.entries, vec(t.m), vec(t.d), lam, keptById);
  }
  const fmt = (x) => (x < 0 ? "−" : "+") + Math.abs(x).toFixed(2);
  const num = (x) => (x < 0 ? "−" : "") + Math.abs(x).toFixed(2);
  const pct = (x) => (Math.min(1, Math.max(0, x)) * 100).toFixed(1) + "%";
  const dateOf = (iso) => iso ? iso.slice(0, 10) : "undated";
  const READS = { 0: "dismissals ignored", 0.25: "a nudge, not a veto", 0.5: "half a veto", 1: "a dismissal can overrule" };

  function renderWorked() {
    const t = taste();
    const rows = rankAt(t, t.lam);
    // the top row with text the visitor has not marked
    const at = rows.findIndex((r) => r.score !== -Infinity && !t.m.includes(r.entry.id) && !t.d.includes(r.entry.id));
    const r = rows[at], e = r.entry;
    const t2 = t.d.length ? ` <span class="t2">− ${t.lam.toFixed(2)} × ${num(r.neg)}</span> <span class="eq sr-only">=</span> ` : " ";
    const lo = Math.min(r.pos, r.score), hi = Math.max(r.pos, r.score);
    const bar = `<span class="sbar" role="img" aria-label="score ${fmt(r.score)} of ${fmt(r.pos)} kept, the rest is what λ took"><i class="fill" style="width:${pct(r.score)}"></i><i class="hollow" style="left:${pct(lo)};width:${pct(hi - lo)}"></i></span>`;
    const near = r.nearest && byId[r.nearest];
    $("worked").innerHTML = `
      <dt>entry</dt><dd><span class="t">${esc(e.title || e.link)}</span> <span class="sub mono muted">${esc(e.feed)} · ${dateOf(e.published)}</span></dd>
      <dt>cos(entry, kept)</dt><dd class="mono">${fmt(r.pos)}</dd>
      <dt>cos(entry, dismissed)</dt><dd class="mono">${t.d.length ? num(r.neg) : `0.00 <span class="muted">· nothing waved off</span>`}</dd>
      <dt>λ</dt><dd class="mono">${t.lam.toFixed(2)}</dd>
      <dt>score</dt><dd><div class="worked-score"><div class="calc">${t.d.length ? `<span class="t1">${fmt(r.pos)}</span>` : ""}${t2}<span class="tot">${fmt(r.score)}</span></div>${bar}</div></dd>
      <dt>nearest</dt><dd>${near ? `${hand("rest")}<span class="t">${esc(near.title)}</span> <span class="mono muted">${fmt(Manicule.cosine(e.vector, near.vector))}</span>` : ""}</dd>`;
    // the link opens the feed in the same taste, so its row number is true even when the taste is pretend
    $("worked-link").textContent = `row ${at + 1} on the feed`;
    $("worked-link").href = "./" + hashOf(t);
    $("worked-link").hidden = false; // an empty link is a nameless tab stop, so it stays hidden until it has words
    $("worked-note").hidden = !t.pretend;
    // the pretend rows are picked newest-first; "row 2" would collide with the ranked row number in the link
    $("worked-note").textContent = t.pretend ? "pretend taste · newest kept, next newest dismissed" : "";

    // the same row at other λ, the visitor's own λ among them
    const lams = [...new Set([0, 0.25, 0.5, 1, t.lam])].sort((a, b) => a - b);
    $("lam-rows").innerHTML = lams.map((l) => {
      const rs = rankAt(t, l);
      const i = rs.findIndex((x) => x.entry.id === e.id);
      const now = l === t.lam;
      // the visitor's row is bold on screen; a hidden "your λ" says so when the preset phrase is showing
      const reads = READS[l] ? READS[l] + (now ? '<span class="sr-only"> · your λ</span>' : "") : "your λ";
      return `<tr${now ? ' class="now"' : ""}><td class="mono">${num(l)}</td><td class="num">${fmt(rs[i].score)}</td><td class="num">${i + 1}</td><td class="lc">${reads}</td></tr>`;
    }).join("");
    $("lam-cap").textContent = t.pretend ? "on the pretend taste, live" : "on your marks, live";
    $("hash").textContent = t.pretend ? "#m=…&d=…&l=0.25" : hashOf(t);
  }

  // ---- boot
  fetchSource().then(renderListing);
  fetch("corpus.json", { cache: "no-cache" }).then((r) => r.json()).then((c) => {
    corpus = c;
    for (const e of c.entries) { e.vector = e.q ? Manicule.dequantize(e.q, e.s) : null; delete e.q; byId[e.id] = e; }
    $("dims").textContent = `${c.entries.length} × ${c.dim}`;
    for (const el of document.querySelectorAll("[data-count]")) el.textContent = c.entries.length;
    try { localStorage.setItem("manicule-count", c.entries.length); } catch (_) {}
    renderWorked();
    addEventListener("hashchange", () => { if (Shell.isMarks(location.hash)) renderWorked(); }); // a fragment is not a state
  }).catch(() => {
    $("worked").innerHTML = `<dt>entry</dt><dd>couldn't load</dd>`;
    $("lam-cap").textContent = "couldn't load";
  });
})();
