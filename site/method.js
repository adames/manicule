// method.js — the method page. Fetches rank() from the repo and prints it as
// a listing with margin notes, then works one row from the visitor's own
// marks using the same rank.js the feed uses.
(function () {
  const el = (id) => document.getElementById(id);
  const { hand, esc, signed, plain } = Shell;

  const UPSTREAM = "adames"; // a fork derives its own owner from the host
  const sourceUrl = (owner) => `https://raw.githubusercontent.com/${owner}/manicule/main/manicule.py`;

  // ── the listing ──────────────────────────────────────────────────────────
  // Each note is keyed by a substring of the line it belongs to, so it finds
  // its line again after the file is edited. Each fires once, on the first
  // line that matches.

  const NOTES = [
    { matches: "return None", says: "nothing picked: newest first" },
    { matches: 'float("-inf")', says: "no words: sinks, never dropped" },
    { matches: "towards - lam * away", says: "the whole method", key: true },
    { matches: "scored.sort(", says: "best first" },
    { matches: "cosine(entry.vector, picked_ids[id])", says: "the near line" },
  ];

  // The page is served from <owner>.github.io on a fork, so a fork shows its
  // own file. Anywhere else, including this site's own domain, shows upstream.
  function ownerFromHost() {
    const match = location.hostname.match(/^([^.]+)\.github\.io$/i);
    return match ? match[1].toLowerCase() : null;
  }

  async function fetchSource() {
    const owner = ownerFromHost();
    const owners = owner && owner !== UPSTREAM ? [owner, UPSTREAM] : [UPSTREAM];
    for (const who of owners) {
      try {
        const response = await fetch(sourceUrl(who), { cache: "no-cache" });
        if (!response.ok) continue;
        const text = await response.text();
        if (text.includes("def rank(")) return { text, owner: who };
      } catch (_) {}
    }
    return null;
  }

  function showNothing() {
    el("listing").innerHTML =
      `<div class="cap"><span><b>manicule.py</b> · rank()</span></div><div class="grp"><pre>couldn't load</pre></div>`;
    el("listing-cap").textContent = "";
  }

  function renderListing(source) {
    if (!source) return showNothing();
    const lines = source.text.split("\n");
    const first = lines.findIndex((line) => line.startsWith("def rank("));
    const last = first < 0 ? -1 : lines.findIndex((line, i) => i > first && line === "    return scored");
    if (first < 0 || last < 0) return showNothing();

    const spoken = new Set();
    const rows = [];
    for (let i = first; i <= last; i++) {
      const line = lines[i];
      const note = NOTES.find((n) => !spoken.has(n) && line.includes(n.matches));
      if (note) spoken.add(note);

      let code = esc(line);
      if (note && note.key) code = code.replace(esc(note.matches), `<span class="hi">${esc(note.matches)}</span>`);
      const margin = note
        ? `<p class="note">${note.key ? hand("rest") : ""}<span>${esc(note.says)}</span></p>`
        : "";
      rows.push(`<div class="grp${note && note.key ? " key" : ""}"><pre><span class="ln">${i + 1}</span>${code}</pre>${margin}</div>`);
    }

    el("listing").innerHTML =
      `<div class="cap"><span><b>manicule.py</b> · rank()</span><span>${last - first + 1} lines</span></div>` + rows.join("");
    el("listing-cap").textContent = `lines ${first + 1}–${last + 1} · fetched from main`;
    el("listing-github").href =
      `https://github.com/${source.owner}/manicule/blob/main/manicule.py#L${first + 1}-L${last + 1}`;
  }

  // ── the proof ────────────────────────────────────────────────────────────
  // evaluate() in manicule.py, run at every build; the numbers are today's.

  const nth = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  const mono = (words) => `<span class="mono">${esc(words)}</span>`;

  function renderProof(proof) {
    if (!proof) {
      el("proof-rows").innerHTML = `<tr><td colspan="5">too few entries to say</td></tr>`;
      return;
    }
    el("proof-n").textContent = proof.entries;
    el("proof-rows").innerHTML = Object.entries(proof.median_rank).map(([picks, row]) =>
      `<tr><td class="mono">${picks}</td><td class="num">${row.ranker}</td><td class="num">${row.words}</td><td class="num">${row.newest}</td><td class="num">${row.shuffled}</td></tr>`).join("");
    el("proof-cap").textContent =
      `where the rest of that feed lands, the median, out of ${proof.entries} · ${proof.trials} trials at 2 picks · recomputed each morning`;

    const two = proof.median_rank["2"] || {};
    const lam = proof.lambda || {};
    const sweep = Object.entries(lam).map(([l, place]) => `${mono(nth(place))} at λ ${String(parseFloat(l))}`).join(", ");
    el("proof-notes").innerHTML = [
      ["newest first", `${mono(nth(two.newest))}, against ${mono(nth(two.shuffled))} shuffled. date order is a shuffle`],
      ["the vectors", `${mono(nth(two.ranker))}, against ${mono(nth(two.words))} from shared words alone. blog posts only, no video or podcast blurbs: ${mono(nth(proof.written.ranker))} against ${mono(nth(proof.written.words))}`],
      ["λ", `pass on two from a feed and the rest of it sinks: ${sweep}. the default counts a little`],
      ["the catch", "same feed only stands in for same taste, so read it as necessary, not sufficient"],
    ].map(([key, words]) => `<dt>${key}</dt><dd>${words}</dd>`).join("");
  }

  // ── the visitor's own taste ──────────────────────────────────────────────

  let corpus = null;
  let entryById = {};

  // The link first, then this browser's mirror. With nothing picked there are
  // no numbers to show, so a pretend taste stands in: the newest entry picked,
  // the next newest passed.
  function tasteNow() {
    const link = Shell.marksIn(location.hash);
    let picked = link.m;
    let passed = link.d;
    let lambda = Shell.lam(link.l);

    if (!picked.length && !passed.length) {
      const saved = Shell.mirror();
      if (saved) {
        picked = saved.m || [];
        passed = saved.d || [];
        if (isNaN(lambda)) lambda = Shell.lam(saved.l);
      }
    }
    if (isNaN(lambda)) lambda = Manicule.LAMBDA;

    const hasWords = (id) => entryById[id] && entryById[id].vector;
    picked = picked.filter(hasWords);
    passed = passed.filter(hasWords);

    const pretend = !picked.length;
    if (pretend) {
      const withWords = corpus.entries.filter((entry) => entry.vector);
      picked = [withWords[0].id];
      passed = withWords[1] ? [withWords[1].id] : [];
    }
    return { picked, passed, lambda, pretend };
  }

  function rankAt(taste, lambda) {
    const vectors = (ids) => ids.map((id) => entryById[id].vector);
    const pickedVectors = {};
    for (const id of taste.picked) pickedVectors[id] = entryById[id].vector;
    return Manicule.rank(corpus.entries, vectors(taste.picked), vectors(taste.passed), lambda, pickedVectors);
  }

  // Links from here open the feed in the same taste, so the row number they
  // quote is true even when the taste is pretend.
  const linkTo = (taste) => Shell.hashOf(taste.picked, taste.passed, taste.lambda);

  const percent = (x) => (Math.min(1, Math.max(0, x)) * 100).toFixed(1) + "%";
  const dayOf = (iso) => (iso ? iso.slice(0, 10) : "undated");
  const READS = { 0: "ignored", 0.25: "a little, the default", 0.5: "half a pick", 1: "as much as a pick" };

  // Solid ink runs to the score; the dashed hollow runs from there to the
  // first term, so the gap is exactly what λ took away.
  function scoreBar(scored) {
    const low = Math.min(scored.pos, scored.score);
    const high = Math.max(scored.pos, scored.score);
    const reads = `score ${signed(scored.score)} of ${signed(scored.pos)} picked, the rest is what λ took`;
    return `<span class="sbar" role="img" aria-label="${reads}"><i class="fill" style="width:${percent(scored.score)}"></i><i class="hollow" style="left:${percent(low)};width:${percent(high - low)}"></i></span>`;
  }

  function renderWorkedRow(taste, scored, place) {
    const entry = scored.entry;
    const nearest = scored.nearest && entryById[scored.nearest];
    const subtraction = taste.passed.length
      ? ` <span class="t2">− ${taste.lambda.toFixed(2)} × ${plain(scored.neg)}</span> <span class="eq sr-only">=</span> `
      : " ";
    const firstTerm = taste.passed.length ? `<span class="t1">${signed(scored.pos)}</span>` : "";

    el("worked").innerHTML = `
      <dt>entry</dt><dd><span class="t">${esc(entry.title || entry.link)}</span> <span class="sub mono muted">${esc(entry.feed)} · ${dayOf(entry.published)}</span></dd>
      <dt>cos(entry, picked)</dt><dd><span class="mono">${signed(scored.pos)}</span> <span class="muted">· how close it sits to the average of your picks</span></dd>
      <dt>cos(entry, passed)</dt><dd>${taste.passed.length ? `<span class="mono">${plain(scored.neg)}</span> <span class="muted">· how close it sits to the average of your passes</span>` : `<span class="mono">0.00</span> <span class="muted">· nothing passed</span>`}</dd>
      <dt>λ</dt><dd><span class="mono">${taste.lambda.toFixed(2)}</span> <span class="muted">· how much of that comes off</span></dd>
      <dt>score</dt><dd><div class="worked-score"><div class="calc">${firstTerm}${subtraction}<span class="tot">${signed(scored.score)}</span></div>${scoreBar(scored)}</div></dd>
      <dt>closest pick</dt><dd>${nearest ? `${hand("rest")}<span class="t">${esc(nearest.title)}</span> <span class="mono muted">${signed(Manicule.cosine(entry.vector, nearest.vector))}</span> <span class="muted">· of everything you picked, this is the one it sits nearest. the feed prints it as the near line</span>` : ""}</dd>`;

    // The formula with this entry's own numbers in it, in the same shape the
    // formula band on the feed used to have.
    el("worked-sum").innerHTML = taste.passed.length
      ? `<span class="side"><span>${signed(scored.score)}</span><span class="op">=</span><span class="term"><span>${signed(scored.pos)}</span><span class="lbl">near your picks</span></span></span>` +
        `<span class="side"><span class="op">−</span><span class="term"><span>${plain(taste.lambda)} · ${plain(scored.neg)}</span><span class="lbl">near your passes, times λ</span></span></span>`
      : `<span class="side"><span>${signed(scored.score)}</span><span class="op">=</span><span class="term"><span>${signed(scored.pos)}</span><span class="lbl">near your picks</span></span></span>` +
        `<span class="side"><span class="op">−</span><span class="term"><span>0.00</span><span class="lbl">nothing passed</span></span></span>`;

    // An empty link is a nameless tab stop, so it stays hidden until it has words.
    el("worked-link").textContent = `row ${place} on the feed`;
    el("worked-link").href = "./" + linkTo(taste);
    el("worked-link").hidden = false;
    el("worked-note").hidden = !taste.pretend;
    el("worked-note").textContent = taste.pretend ? "pretend taste · newest picked, next newest passed" : "";
  }

  function renderLambdaTable(taste, entry) {
    const settings = [...new Set([0, 0.25, 0.5, 1, taste.lambda])].sort((a, b) => a - b);
    el("lam-rows").innerHTML = settings.map((lambda) => {
      const ranked = rankAt(taste, lambda);
      const place = ranked.findIndex((row) => row.entry.id === entry.id);
      const theirs = lambda === taste.lambda;
      // Their row is bold on screen; a hidden phrase says so out loud.
      const reads = READS[lambda]
        ? READS[lambda] + (theirs ? '<span class="sr-only"> · your λ</span>' : "")
        : "your λ";
      return `<tr${theirs ? ' class="now"' : ""}><td class="mono">${plain(lambda)}</td><td class="num">${signed(ranked[place].score)}</td><td class="num">${place + 1}</td><td class="lc">${reads}</td></tr>`;
    }).join("");
    el("lam-cap").textContent = taste.pretend ? "on the pretend taste, live" : "on your marks, live";
    el("hash").textContent = taste.pretend ? "#m=…&d=…&l=0.25" : linkTo(taste);
  }

  // ── the picture of the formula ───────────────────────────────────────────
  // Both axes are real numbers the ranker computes: across is how near an
  // entry sits to your picks, up is how near it sits to your passes. No
  // squashing, nothing thrown away. The score is one minus λ times the other,
  // so entries that score the same sit on one straight line, and λ is that
  // line's slope. Sorting the feed is sweeping that line across the page.

  function renderChart(taste, ranked) {
    const rows = ranked.filter((row) => row.score !== -Infinity);
    const W = 560, H = 460, L = 56, R = 18, T = 28, B = 52;

    // One scale for both axes, or the line's slope would be a lie. Your own
    // marks sit at 1.00 against themselves and would flatten everything else,
    // so the frame is drawn around the entries you have not marked.
    const marked = new Set([...taste.picked, ...taste.passed]);
    const plain_ = rows.filter((row) => !marked.has(row.entry.id));
    const all = (plain_.length ? plain_ : rows).flatMap((row) => [row.pos, row.neg]);
    const gap = (Math.max(...all) - Math.min(...all)) || 0.1;
    const lo = Math.min(...all) - gap * 0.08;
    const hi = Math.max(...all) + gap * 0.08;
    const sx = (x) => L + ((x - lo) / (hi - lo)) * (W - L - R);
    const sy = (y) => H - B - ((y - lo) / (hi - lo)) * (H - T - B);

    const picked = new Set(taste.picked);
    const passed = new Set(taste.passed);
    const dots = rows.map((row) => {
      const mark = picked.has(row.entry.id) ? " pick" : passed.has(row.entry.id) ? " pass" : "";
      return `<circle class="dot${mark}" cx="${sx(row.pos).toFixed(1)}" cy="${sy(row.neg).toFixed(1)}" r="${mark ? 5 : 3}"><title>${esc(row.entry.title)} · ${signed(row.score)}</title></circle>`;
    });

    // Entries that score the same sit on one line: pos = score + λ · neg.
    const top = plain_[0] || rows[0];
    const isoAt = (score) =>
      `M ${sx(score + taste.lambda * lo).toFixed(1)} ${sy(lo).toFixed(1)} L ${sx(score + taste.lambda * hi).toFixed(1)} ${sy(hi).toFixed(1)}`;
    const lines = [
      `<path class="iso faint" d="${isoAt(top.score - 0.15)}"/>`,
      `<path class="iso faint" d="${isoAt(top.score - 0.3)}"/>`,
      `<path class="iso" d="${isoAt(top.score)}"/>`,
    ];

    const ticks = [];
    for (let i = 0; i <= 2; i++) {
      const v = lo + ((hi - lo) * i) / 2;
      ticks.push(`<text class="tick" x="${sx(v).toFixed(1)}" y="${H - B + 16}" text-anchor="middle">${plain(v)}</text>`);
      ticks.push(`<text class="tick" x="${L - 8}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${plain(v)}</text>`);
    }

    el("chart").innerHTML =
      `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="every entry plotted by how near it sits to your picks and to your passes; entries that score the same sit on one line">` +
      `<clipPath id="plot"><rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></clipPath>` +
      `<line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/>` +
      `<line class="axis" x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}"/>` +
      `<g clip-path="url(#plot)">${lines.join("")}${dots.join("")}</g>` +
      ticks.join("") +
      `<text class="axlab" x="${W - R}" y="${H - 14}" text-anchor="end">near what you picked →</text>` +
      `<text class="axlab" x="${L}" y="${T - 10}">↑ near what you passed</text>` +
      `</svg>`;

    el("chart-cap").innerHTML = taste.passed.length
      ? `the ember line runs through the top entry you have not marked. everything on it scores the same, ${signed(top.score)}, ` +
        `and the two dashed lines are scores below it. the lines lean by exactly λ, ${plain(taste.lambda)} right now: ` +
        `steep means a pass barely moves anything, and at λ 1 they stand at 45 degrees and a pass counts as much as a pick. ` +
        `sorting your feed is sweeping that line across the page from the right and taking entries as it reaches them`
      : `you have passed on nothing, so the up axis is nought for every entry and they all sit on the floor of the chart. ` +
        `the score is just how far right a dot is. pass on something and the entries near it lift off the floor, and the ` +
        `ember line tilts by λ to take that off their score`;
  }

  // ── the numbers behind the map ───────────────────────────────────────────

  function renderNeighbours(taste, scored) {
    const entry = scored.entry;
    const others = corpus.entries
      .filter((other) => other.vector && other.id !== entry.id)
      .map((other) => ({ other, cos: Manicule.cosine(entry.vector, other.vector) }))
      .sort((a, b) => b.cos - a.cos);
    const rows = [...others.slice(0, 3), ...others.slice(-3)];
    const row = ({ other, cos }) =>
      `<tr><td><span class="t">${esc(other.title)}</span></td><td class="lc">${esc(other.feed)}</td><td class="num">${signed(cos)}</td></tr>`;
    el("neighbours").innerHTML = rows.map(row).join("");
    el("neighbours-cap").textContent =
      `“${entry.title}” against the three nearest and the three farthest. +1 would be the same words; near 0 is nothing in common`;
  }

  function renderPicks(taste) {
    const average = Manicule.centroid(taste.picked.map((id) => entryById[id].vector));
    el("picks").innerHTML = taste.picked.map((id) => {
      const pick = entryById[id];
      return `<tr><td><span class="t">${esc(pick.title)}</span></td><td class="lc">${esc(pick.feed)}</td><td class="num">${signed(Manicule.cosine(pick.vector, average))}</td></tr>`;
    }).join("");
    el("picks-cap").textContent = taste.pretend
      ? "on the pretend taste. pick a few things on the feed and this table is yours"
      : "each pick against the average of all of them. close together and every number is high; a pick from left field pulls the average away from the rest";
  }

  function renderWorked() {
    const taste = tasteNow();
    const ranked = rankAt(taste, taste.lambda);
    // The top entry with words that the visitor has neither picked nor passed.
    const place = ranked.findIndex((row) =>
      row.score !== -Infinity && !taste.picked.includes(row.entry.id) && !taste.passed.includes(row.entry.id));
    const scored = ranked[place];

    renderWorkedRow(taste, scored, place + 1);
    renderLambdaTable(taste, scored.entry);
    renderChart(taste, ranked);
    renderNeighbours(taste, scored);
    renderPicks(taste);
  }

  // ── boot ─────────────────────────────────────────────────────────────────

  fetchSource().then(renderListing);

  fetch("corpus.json", { cache: "no-cache" })
    .then((response) => response.json())
    .then((loaded) => {
      corpus = loaded;
      for (const entry of corpus.entries) {
        entry.vector = entry.q ? Manicule.dequantize(entry.q, entry.s) : null;
        delete entry.q;
        entryById[entry.id] = entry;
      }
      el("dims").textContent = `${corpus.entries.length} × ${corpus.dim}`;
      for (const slot of document.querySelectorAll("[data-count]")) slot.textContent = corpus.entries.length;
      try { localStorage.setItem("manicule-count", corpus.entries.length); } catch (_) {}

      renderProof(corpus.proof);
      renderWorked();
      addEventListener("hashchange", () => { if (Shell.isMarks(location.hash)) renderWorked(); });
    })
    .catch(() => {
      el("worked").innerHTML = `<dt>entry</dt><dd>couldn't load</dd>`;
      el("lam-cap").textContent = "couldn't load";
      el("proof-rows").innerHTML = `<tr><td colspan="5">couldn't load</td></tr>`;
    });
})();
