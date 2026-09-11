// method.js — the method page. Fetches rank() from the repo and prints it as
// a listing with margin notes, then works one row from the visitor's own
// taste using the same rank.js the feed uses.
(function () {
  const el = (id) => document.getElementById(id);
  const { hand, esc, signed, plain } = Shell;

  const UPSTREAM = "adames"; // a fork derives its own owner from the host
  const listingUrl = (owner) => `https://raw.githubusercontent.com/${owner}/manicule/main/manicule.py`;

  // ── the listing ──────────────────────────────────────────────────────────
  // Each note is keyed by a substring of the line it belongs to, so it finds
  // its line again after the file is edited. Each fires once, on the first
  // line that matches.

  const NOTES = [
    { matches: "return None", says: "nothing picked: newest first" },
    { matches: 'float("-inf")', says: "no words: sinks, never dropped" },
    { matches: "towards - lam * away", says: "the whole method", key: true },
    { matches: "scored.sort(", says: "best first" },
    { matches: "cosine(post.vector, picked_ids[id])", says: "the near line" },
  ];

  // The page is served from <owner>.github.io on a fork, so a fork shows its
  // own file. Anywhere else, including this site's own domain, shows upstream.
  function ownerFromHost() {
    const match = location.hostname.match(/^([^.]+)\.github\.io$/i);
    return match ? match[1].toLowerCase() : null;
  }

  async function fetchListing() {
    const owner = ownerFromHost();
    const owners = owner && owner !== UPSTREAM ? [owner, UPSTREAM] : [UPSTREAM];
    for (const who of owners) {
      try {
        const response = await fetch(listingUrl(who), { cache: "no-cache" });
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

  function renderListing(listing) {
    if (!listing) return showNothing();
    const lines = listing.text.split("\n");
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
      `https://github.com/${listing.owner}/manicule/blob/main/manicule.py#L${first + 1}-L${last + 1}`;
  }

  // ── the proof ────────────────────────────────────────────────────────────
  // evaluate() in manicule.py, run at every build; the numbers are today's.

  const nth = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
  const mono = (words) => `<span class="mono">${esc(words)}</span>`;

  function renderProof(proof) {
    if (!proof) {
      el("proof-rows").innerHTML = `<tr><td colspan="5">too few posts to say</td></tr>`;
      return;
    }
    el("proof-n").textContent = proof.posts;
    el("proof-rows").innerHTML = Object.entries(proof.median_rank).map(([picks, row]) =>
      `<tr><td class="mono">${picks}</td><td class="num">${row.ranker}</td><td class="num">${row.words}</td><td class="num">${row.newest}</td><td class="num">${row.shuffled}</td></tr>`).join("");
    el("proof-cap").textContent =
      `where the rest of that source lands, the median, out of ${proof.posts} · ${proof.trials} trials at 2 picks · recomputed each morning`;

    const two = proof.median_rank["2"] || {};
    const lam = proof.lambda || {};
    const sweep = Object.entries(lam).map(([l, place]) => `${mono(nth(place))} at λ ${String(parseFloat(l))}`).join(", ");
    el("proof-notes").innerHTML = [
      ["newest first", `${mono(nth(two.newest))}, against ${mono(nth(two.shuffled))} shuffled. date order is a shuffle`],
      ["the vectors", `${mono(nth(two.ranker))}, against ${mono(nth(two.words))} from shared words alone. blog posts only, no video or podcast blurbs: ${mono(nth(proof.written.ranker))} against ${mono(nth(proof.written.words))}`],
      ["λ", `pass on two from a source and the rest of it sinks: ${sweep}. the default counts a little`],
      ["the catch", "same source only stands in for same taste, so read it as necessary, not sufficient"],
    ].map(([key, words]) => `<dt>${key}</dt><dd>${words}</dd>`).join("");
  }

  // ── the visitor's own taste ──────────────────────────────────────────────

  let today = null;
  let postById = {};

  // The link first, then this browser's mirror. With nothing picked there are
  // no numbers to show, so a pretend taste stands in: the newest post picked,
  // the next newest passed.
  function tasteNow() {
    const link = Shell.tasteIn(location.hash);
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

    const hasWords = (id) => postById[id] && postById[id].vector;
    picked = picked.filter(hasWords);
    passed = passed.filter(hasWords);

    const pretend = !picked.length;
    if (pretend) {
      const withWords = today.posts.filter((post) => post.vector);
      picked = [withWords[0].id];
      passed = withWords[1] ? [withWords[1].id] : [];
    }
    return { picked, passed, lambda, pretend };
  }

  function rankAt(taste, lambda) {
    const vectors = (ids) => ids.map((id) => postById[id].vector);
    const pickedVectors = {};
    for (const id of taste.picked) pickedVectors[id] = postById[id].vector;
    return Manicule.rank(today.posts, Manicule.tasteOf(vectors(taste.picked)),
                         Manicule.tasteOf(vectors(taste.passed)), lambda, pickedVectors);
  }

  // Links from here open the feed in the same taste, so the row number they
  // quote is true even when the taste is pretend.
  const linkTo = (taste) => Shell.hashOf({ m: taste.picked, d: taste.passed, l: taste.lambda });

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
    const post = scored.post;
    const built = Manicule.tasteOf(taste.picked.map((id) => postById[id].vector));
    const nearest = scored.nearest && postById[scored.nearest];
    const subtraction = taste.passed.length
      ? ` <span class="t2">− ${taste.lambda.toFixed(2)} × ${plain(scored.neg)}</span> <span class="eq sr-only">=</span> `
      : " ";
    const firstTerm = taste.passed.length ? `<span class="t1">${signed(scored.pos)}</span>` : "";

    el("worked").innerHTML = `
      <dt>post</dt><dd><span class="t">${esc(post.title || post.link)}</span> <span class="sub mono muted">${esc(post.source)} · ${dayOf(post.published)}</span></dd>
      <dt>cos(post, picked)</dt><dd><span class="mono">${signed(scored.pos)}</span> <span class="muted">· how close it sits to ${built.length > 1 ? `taste ${scored.which + 1}, the nearest of your ${built.length} averages` : "the average of your picks"}</span></dd>
      <dt>cos(post, passed)</dt><dd>${taste.passed.length ? `<span class="mono">${plain(scored.neg)}</span> <span class="muted">· how close it sits to the average of your passes</span>` : `<span class="mono">0.00</span> <span class="muted">· nothing passed</span>`}</dd>
      <dt>λ</dt><dd><span class="mono">${taste.lambda.toFixed(2)}</span> <span class="muted">· how much of that comes off</span></dd>
      <dt>score</dt><dd><div class="worked-score"><div class="calc">${firstTerm}${subtraction}<span class="tot">${signed(scored.score)}</span></div>${scoreBar(scored)}</div></dd>
      <dt>closest pick</dt><dd>${nearest ? `${hand("rest")}<span class="t">${esc(nearest.title)}</span> <span class="mono muted">${signed(Manicule.cosine(post.vector, nearest.vector))}</span> <span class="muted">· of everything you picked, this is the one it sits nearest. the feed prints it as the near line</span>` : ""}</dd>`;

    // The formula with this post's own numbers in it, in the same shape the
    // formula band on the feed used to have.
    const term = (value, name) =>
      `<span class="term"><span>${value}</span><span class="lbl">${name}</span></span>`;
    el("worked-sum").innerHTML =
      `<span class="side"><span>${signed(scored.score)}</span><span class="op">=</span>${term(signed(scored.pos), "picked")}</span>` +
      `<span class="side"><span class="op">−</span>${term(
        taste.passed.length ? `${plain(taste.lambda)} · ${plain(scored.neg)}` : "0.00",
        taste.passed.length ? "passed" : "nothing passed",
      )}</span>`;

    // An empty link is a nameless tab stop, so it stays hidden until it has words.
    el("worked-link").textContent = `row ${place} on the feed`;
    el("worked-link").href = "./" + linkTo(taste);
    el("worked-link").hidden = false;
    el("worked-note").hidden = !taste.pretend;
    el("worked-note").textContent = taste.pretend ? "pretend taste · newest picked, next newest passed" : "";
  }

  function renderLambdaTable(taste, post) {
    const settings = [...new Set([0, 0.25, 0.5, 1, taste.lambda])].sort((a, b) => a - b);
    el("lam-rows").innerHTML = settings.map((lambda) => {
      const ranked = rankAt(taste, lambda);
      const place = ranked.findIndex((row) => row.post.id === post.id);
      const theirs = lambda === taste.lambda;
      // Their row is bold on screen; a hidden phrase says so out loud.
      const reads = READS[lambda]
        ? READS[lambda] + (theirs ? '<span class="sr-only"> · your λ</span>' : "")
        : "your λ";
      return `<tr${theirs ? ' class="now"' : ""}><td class="mono">${plain(lambda)}</td><td class="num">${signed(ranked[place].score)}</td><td class="num">${place + 1}</td><td class="lc">${reads}</td></tr>`;
    }).join("");
    el("lam-cap").textContent = taste.pretend ? "on the pretend taste, live" : "on your taste, live";
    // The real link is a kilobyte of base64; the shape is what is worth showing.
    const shape = (hash) => hash.replace(/=[A-Za-z0-9_\-]{40,}[^&]*/g, "=…");
    el("hash").textContent = taste.pretend ? "#m=…&v=…&k=…&l=0.25" : shape(location.hash || linkTo(taste));
  }

  // ── what picking does ────────────────────────────────────────────────────
  // The evaluation, drawn, on today's posts. Take a real source. Pick two of
  // its posts. Where does the rest of that source sit before and after? The
  // ranker never sees which source anything came from, so this is the test the
  // numbers in the table below run 1290 times.

  // One source at a time, so a reader can watch a single case, or all of them
  // pooled. The button cycles; the picture is the same test either way.
  let trialFeeds = null;
  let showing = "all";

  function trials() {
    if (trialFeeds) return trialFeeds;
    const withWords = today.posts.filter((post) => post.vector);
    const bySource = {};
    for (const post of withWords) (bySource[post.source] = bySource[post.source] || []).push(post);
    const newestFirst = (list) => [...list].sort((a, b) => (b.published || "").localeCompare(a.published || ""));

    trialFeeds = [];
    for (const name of Object.keys(bySource).sort()) {
      const members = newestFirst(bySource[name]);
      if (members.length < 4) continue;
      const picks = members.slice(0, 2);
      const held = members.slice(2);
      const rest = withWords.filter((post) => !picks.includes(post));
      const ranked = Manicule.rank(rest, Manicule.tasteOf(picks.map((post) => post.vector)), [], Manicule.LAMBDA, {});
      const after = {};
      ranked.forEach((row, i) => { after[row.post.id] = (i + 1) / ranked.length; });
      const before = {};
      newestFirst(rest).forEach((post, i) => { before[post.id] = (i + 1) / rest.length; });
      trialFeeds.push({
        source: name,
        picks: picks.map((post) => post.title),
        moves: held.map((post) => ({ title: post.title, was: before[post.id], now: after[post.id] })),
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
    const outOf = today.posts.filter((post) => post.vector).length;
    const place = (frac) => Math.max(1, Math.round(frac * outOf));
    const mid = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
    const wasMid = mid(moves.map((m) => m.was));
    const nowMid = mid(moves.map((m) => m.now));

    const tick = (frac, y, cls, title) =>
      `<line class="${cls}" x1="${sx(frac).toFixed(1)}" y1="${y - 9}" x2="${sx(frac).toFixed(1)}" y2="${y + 9}">` +
      (title ? `<title>${esc(title)}</title>` : "") + `</line>`;
    // With one source on show there are few enough posts to join up.
    const ties = one
      ? moves.map((m) => `<line class="pick-tie" x1="${sx(m.was).toFixed(1)}" y1="${TOP + 9}" x2="${sx(m.now).toFixed(1)}" y2="${BOT - 9}"/>`)
      : [];

    el("chart").innerHTML =
      `<svg class="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="${moves.length} held-out posts: where date order puts them, and where two picks put them">` +
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
      ? `<b>${esc(one.source)}</b> gave up two posts to be the taste: ${one.picks.map((t) => `“${esc(t)}”`).join(" and ")}. ` +
        `its other ${moves.length} went back in the pile. the lines show where each one moved, ` +
        `the middle of them from ${place(wasMid)} to ${place(nowMid)} of ${outOf}. hover a tick for its title`
      : `${runs.length} sources each gave up two posts to be the taste. their other ${moves.length} posts went back in the pile. ` +
        `date order leaves them spread over the whole feed; two picks pull them to the front. the tall tick is the middle one, ` +
        `${place(wasMid)} then ${place(nowMid)} of ${outOf}. the ranker was never told which source anything came from`;

    // Eight sources to try, taken evenly across the list so the subjects differ,
    // plus the feed. Every source is in the feed either way.
    const step = Math.max(1, Math.floor(runs.length / 8));
    const offered = runs.map((run, i) => [i, run]).filter((_, i) => i % step === 0).slice(0, 8);
    const choice = (value, words, on) =>
      `<button class="btn quiet" type="button" data-show="${value}"${on ? ' aria-current="true"' : ""}>${words}</button>`;
    el("chart-pick").innerHTML =
      choice("all", `all ${runs.length} sources`, showing === "all") +
      offered.map(([i, run]) => choice(i, esc(run.source), showing === i)).join("");
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-show]");
    if (!button) return;
    showing = button.dataset.show === "all" ? "all" : Number(button.dataset.show);
    renderPicking();
  });

  // ── the numbers behind the map ───────────────────────────────────────────

  function renderNeighbours(taste, scored) {
    const post = scored.post;
    const others = today.posts
      .filter((other) => other.vector && other.id !== post.id)
      .map((other) => ({ other, cos: Manicule.cosine(post.vector, other.vector) }))
      .sort((a, b) => b.cos - a.cos);
    const rows = [...others.slice(0, 3), ...others.slice(-3)];
    const row = ({ other, cos }) =>
      `<tr><td><span class="t">${esc(other.title)}</span></td><td class="lc">${esc(other.source)}</td><td class="num">${signed(cos)}</td></tr>`;
    el("neighbours").innerHTML = rows.map(row).join("");
    // The cosine scale is defined in the paragraph directly above this table;
    // saying it twice made the second one read as a different scale.
    el("neighbours-cap").textContent =
      `“${post.title}” against the three nearest and the three farthest`;
  }

  // Each pick against the taste it belongs to. Which average that is, is the
  // whole of the clustering: nothing is labelled and nobody chose it.
  // The same lines as the feed, with the working shown: the three nearest
  // labels and their cosines, then the words, then the sources.
  function renderTastes(built, pretend) {
    const several = built.length > 1;
    el("tastes").innerHTML = Manicule.describe(built, today.posts, today.labels).map((about, i) => {
      const k = several ? `<span class="k">taste ${i + 1}</span>` : "";
      const n = `<span class="n">${about.count} ${about.count === 1 ? "pick" : "picks"}${pretend ? ", pretend" : ""}</span>`;
      const labels = about.labels.map((l, j) => `${j ? "" : "about "}<b>${esc(l.text)}</b> <span class="mono">${signed(l.cos)}</span>`).join(", ");
      const focus = about.focus ? `<b>${esc(about.focus)}</b> is in half the nearest headlines, so it leads` : "";
      const when = about.happening ? `<b>${about.happening}</b>: three quarters of the nearest posts are within three days of each other, so this is something happening, not a field` : "";
      const parts = [focus, when, labels, about.words.length ? esc(about.words.join(", ")) : "", about.sources.length ? `near ${esc(about.sources.join(", "))}` : ""];
      return `<li>${hand("rest")}${k}${n}<span class="sources">${parts.filter(Boolean).join(" · ")}</span></li>`;
    }).join("");
  }

  function renderPicks(taste) {
    const built = Manicule.tasteOf(taste.picked.map((id) => postById[id].vector));
    renderTastes(built, taste.pretend);
    const whichOne = (vector) => {
      let best = 0, near = -Infinity;
      built.forEach((one, i) => {
        const c = Manicule.cosine(vector, one.vector);
        if (c > near) { near = c; best = i; }
      });
      return { best, near };
    };
    el("picks-head").innerHTML = built.length > 1
      ? `<tr><th scope="col" class="grow">what you picked</th><th scope="col">source</th><th scope="col" class="lc">which average</th><th scope="col" class="num">cos to it</th></tr>`
      : `<tr><th scope="col" class="grow">what you picked</th><th scope="col">source</th><th scope="col" class="num">cos to the average</th></tr>`;
    el("picks").innerHTML = taste.picked.map((id) => {
      const pick = postById[id];
      const { best, near } = whichOne(pick.vector);
      const label = built.length > 1 ? `<td class="lc">${best + 1} of ${built.length}</td>` : "";
      return `<tr><td><span class="t">${esc(pick.title)}</span></td><td class="lc">${esc(pick.source)}</td>${label}<td class="num">${signed(near)}</td></tr>`;
    }).join("");
    el("picks-cap").textContent = taste.pretend
      ? "on the pretend taste. pick a few things on the feed and this table is yours"
      : built.length > 1
        ? `each pick against its own average. these picks made ${built.length} of them: a pick that sits near none of the averages starts another rather than dragging one off its subject`
        : "each pick against the average of all of them. these picks all sit together, so they made one average";
  }

  function renderWorked() {
    const taste = tasteNow();
    const ranked = rankAt(taste, taste.lambda);
    // The top post with words that the visitor has neither picked nor passed.
    const place = ranked.findIndex((row) =>
      row.score !== -Infinity && !taste.picked.includes(row.post.id) && !taste.passed.includes(row.post.id));
    const scored = ranked[place];

    renderWorkedRow(taste, scored, place + 1);
    renderLambdaTable(taste, scored.post);
    renderPicking();
    renderNeighbours(taste, scored);
    renderPicks(taste);
  }

  // ── the ruler ────────────────────────────────────────────────────────────
  // λ is a preference, not a pick, so moving it only ever changes λ. It rides
  // in the link with the rest of the taste, which is how the feed hears about it.

  function setRuler(value) {
    el("lam").value = value;
    el("lamv").value = value.toFixed(2);
    el("lam").setAttribute("aria-valuetext", "λ " + value.toFixed(2));
  }

  el("lam").addEventListener("input", (event) => {
    const lambda = Shell.lam(event.target.value);
    setRuler(lambda);
    const now = Shell.tasteIn(location.hash);
    history.replaceState(null, "", Shell.hashOf({ ...now, l: lambda }));
    Shell.carry();
    const saved = Shell.mirror();
    if (saved) {
      try { localStorage.setItem("manicule", JSON.stringify({ ...saved, l: lambda })); } catch (_) {}
    }
    renderWorked();
  });

  // ── boot ─────────────────────────────────────────────────────────────────

  fetchListing().then(renderListing);

  Shell.loadPosts()
    .then((loaded) => {
      today = loaded;
      for (const post of today.posts) postById[post.id] = post;
      el("dims").textContent = `${today.posts.length} × ${today.dim}`;

      renderProof(today.proof);
      setRuler(tasteNow().lambda);
      renderWorked();
      addEventListener("hashchange", () => { if (Shell.isTaste(location.hash)) renderWorked(); });
    })
    .catch(() => {
      el("worked").innerHTML = `<dt>post</dt><dd>couldn't load</dd>`;
      el("lam-cap").textContent = "couldn't load";
      el("proof-rows").innerHTML = `<tr><td colspan="5">couldn't load</td></tr>`;
    });
})();
