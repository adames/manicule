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

  let today = null;
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
      const withWords = today.entries.filter((entry) => entry.vector);
      picked = [withWords[0].id];
      passed = withWords[1] ? [withWords[1].id] : [];
    }
    return { picked, passed, lambda, pretend };
  }

  function rankAt(taste, lambda) {
    const vectors = (ids) => ids.map((id) => entryById[id].vector);
    const pickedVectors = {};
    for (const id of taste.picked) pickedVectors[id] = entryById[id].vector;
    return Manicule.rank(today.entries, vectors(taste.picked), vectors(taste.passed), lambda, pickedVectors);
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

  // ── what picking does ────────────────────────────────────────────────────
  // The evaluation, drawn, on today's entries. Take a real feed. Pick two of
  // its entries. Where does the rest of that feed sit before and after? The
  // ranker never sees which feed anything came from, so this is the test the
  // numbers in the table below run 1290 times.

  // One feed at a time, so a reader can watch a single case, or all of them
  // pooled. The button cycles; the picture is the same test either way.
  let trialFeeds = null;
  let showing = "all";

  function trials() {
    if (trialFeeds) return trialFeeds;
    const withWords = today.entries.filter((entry) => entry.vector);
    const byFeed = {};
    for (const entry of withWords) (byFeed[entry.feed] = byFeed[entry.feed] || []).push(entry);
    const newestFirst = (list) => [...list].sort((a, b) => (b.published || "").localeCompare(a.published || ""));

    trialFeeds = [];
    for (const name of Object.keys(byFeed).sort()) {
      const members = newestFirst(byFeed[name]);
      if (members.length < 4) continue;
      const picks = members.slice(0, 2);
      const held = members.slice(2);
      const rest = withWords.filter((entry) => !picks.includes(entry));
      const ranked = Manicule.rank(rest, picks.map((entry) => entry.vector), [], Manicule.LAMBDA, {});
      const after = {};
      ranked.forEach((row, i) => { after[row.entry.id] = (i + 1) / ranked.length; });
      const before = {};
      newestFirst(rest).forEach((entry, i) => { before[entry.id] = (i + 1) / rest.length; });
      trialFeeds.push({
        feed: name,
        picks: picks.map((entry) => entry.title),
        moves: held.map((entry) => ({ title: entry.title, was: before[entry.id], now: after[entry.id] })),
      });
    }
    return trialFeeds;
  }

  function renderPicking() {
    const runs = trials();
    if (!runs.length) return;
    const one = showing === "all" ? null : runs[showing];
    const moves = one ? one.moves : runs.flatMap((run) => run.moves);

    const W = 640, H = 210, L = 16, R = 16, TOP = 58, BOT = 158;
    const sx = (frac) => L + frac * (W - L - R);
    const outOf = today.entries.filter((entry) => entry.vector).length;
    const place = (frac) => Math.max(1, Math.round(frac * outOf));
    const mid = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    const wasMid = mid(moves.map((m) => m.was));
    const nowMid = mid(moves.map((m) => m.now));

    const tick = (frac, y, cls, title) =>
      `<line class="${cls}" x1="${sx(frac).toFixed(1)}" y1="${y - 9}" x2="${sx(frac).toFixed(1)}" y2="${y + 9}">` +
      (title ? `<title>${esc(title)}</title>` : "") + `</line>`;
    // With one feed on show there are few enough entries to join up.
    const ties = one
      ? moves.map((m) => `<line class="pick-tie" x1="${sx(m.was).toFixed(1)}" y1="${TOP + 9}" x2="${sx(m.now).toFixed(1)}" y2="${BOT - 9}"/>`)
      : [];

    el("chart").innerHTML =
      `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${moves.length} held-out entries: where date order puts them, and where two picks put them">` +
      `<text class="axlab" x="${L}" y="${TOP - 22}">newest first</text>` +
      `<text class="tick" x="${W - R}" y="${TOP - 22}" text-anchor="end">middle one: ${place(wasMid)} of ${outOf}</text>` +
      `<line class="track" x1="${L}" y1="${TOP}" x2="${W - R}" y2="${TOP}"/>` +
      ties.join("") +
      moves.map((m) => tick(m.was, TOP, "pick-tick", m.title)).join("") + tick(wasMid, TOP, "pick-mid") +
      `<line class="track" x1="${L}" y1="${BOT}" x2="${W - R}" y2="${BOT}"/>` +
      moves.map((m) => tick(m.now, BOT, "pick-tick", m.title)).join("") + tick(nowMid, BOT, "pick-mid") +
      `<text class="axlab" x="${L}" y="${BOT + 32}">after two picks</text>` +
      `<text class="tick" x="${W - R}" y="${BOT + 32}" text-anchor="end">middle one: ${place(nowMid)} of ${outOf}</text>` +
      `</svg>`;

    el("chart-cap").innerHTML = one
      ? `<b>${esc(one.feed)}</b> gave up two entries to be the taste: ${one.picks.map((t) => `“${esc(t)}”`).join(" and ")}. ` +
        `its other ${moves.length} went back in the pile. the lines show where each one moved, ` +
        `the middle of them from ${place(wasMid)} to ${place(nowMid)} of ${outOf}. hover a tick for its title`
      : `${runs.length} feeds each gave up two entries to be the taste. their other ${moves.length} entries went back in the pile. ` +
        `date order leaves them spread over the whole feed; two picks pull them to the front. the tall tick is the middle one, ` +
        `${place(wasMid)} then ${place(nowMid)} of ${outOf}. the ranker was never told which feed anything came from`;

    // Eight feeds to try, taken evenly across the list so the subjects differ,
    // plus the pool. Every feed is in the pool either way.
    const step = Math.max(1, Math.floor(runs.length / 8));
    const offered = runs.map((run, i) => [i, run]).filter((_, i) => i % step === 0).slice(0, 8);
    const chip = (value, words, on) =>
      `<button class="btn quiet" type="button" data-show="${value}"${on ? ' aria-current="true"' : ""}>${words}</button>`;
    el("chart-pick").innerHTML =
      chip("all", `all ${runs.length} feeds`, showing === "all") +
      offered.map(([i, run]) => chip(i, esc(run.feed), showing === i)).join("");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-show]");
    if (!button) return;
    showing = button.dataset.show === "all" ? "all" : Number(button.dataset.show);
    renderPicking();
  });

  // ── the numbers behind the map ───────────────────────────────────────────

  function renderNeighbours(taste, scored) {
    const entry = scored.entry;
    const others = today.entries
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
    renderPicking();
    renderNeighbours(taste, scored);
    renderPicks(taste);
  }

  // ── boot ─────────────────────────────────────────────────────────────────

  fetchSource().then(renderListing);

  fetch("entries.json", { cache: "no-cache" })
    .then((response) => response.json())
    .then((loaded) => {
      today = loaded;
      for (const entry of today.entries) {
        entry.vector = entry.q ? Manicule.dequantize(entry.q, entry.s) : null;
        delete entry.q;
        entryById[entry.id] = entry;
      }
      el("dims").textContent = `${today.entries.length} × ${today.dim}`;
      for (const slot of document.querySelectorAll("[data-count]")) slot.textContent = today.entries.length;
      try { localStorage.setItem("manicule-count", today.entries.length); } catch (_) {}

      renderProof(today.proof);
      renderWorked();
      addEventListener("hashchange", () => { if (Shell.isMarks(location.hash)) renderWorked(); });
    })
    .catch(() => {
      el("worked").innerHTML = `<dt>entry</dt><dd>couldn't load</dd>`;
      el("lam-cap").textContent = "couldn't load";
      el("proof-rows").innerHTML = `<tr><td colspan="5">couldn't load</td></tr>`;
    });
})();
