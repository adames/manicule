// feed.js — the feed page: load the entries, rank them by what you picked,
// and print every score with its arithmetic. Nothing is stored anywhere: the
// link is the state, and localStorage only remembers it for a bare visit.
(function () {
  const ROWS_PER_PAGE = 20;
  const KIND_LABEL = { article: "web", video: "vid", podcast: "pod" };

  const { hand, toast, esc, signed } = Shell;
  const el = (id) => document.getElementById(id);

  const state = {
    picked: new Set(),
    passed: new Set(),
    lambda: Manicule.LAMBDA,
    borrowed: false,  // the link carries a taste this browser did not make
    order: null,      // ids in the order on screen; null is newest first
    rowsShown: ROWS_PER_PAGE,
  };
  let entries = null;      // entries.json, once it lands
  let entryById = {};

  // ── the link is the state ────────────────────────────────────────────────

  const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

  function readTheLink() {
    const link = Shell.tasteIn(location.hash);
    const saved = Shell.mirror() || {};
    // The daily rebuild drops entries, and their ids go with them. Ignoring
    // dead ids on both sides means your own stale link still reads as yours,
    // and a friend's wholly stale link reads as empty rather than as theirs.
    const live = (ids) => (ids || []).filter((id) => entryById[id]);
    const mine = { picked: live(saved.m), passed: live(saved.d) };
    const linked = { picked: live(link.m), passed: live(link.d) };

    if (linked.picked.length || linked.passed.length) {
      state.picked = new Set(linked.picked);
      state.passed = new Set(linked.passed);
      state.borrowed = !(sameIds(linked.picked, mine.picked) && sameIds(linked.passed, mine.passed));
    } else {
      state.picked = new Set(mine.picked);
      state.passed = new Set(mine.passed);
      state.borrowed = false;
    }

    // λ is a preference, not a pick: the saved one applies to any link that
    // carries none, and a bare #l=0.5 moves the ruler without clearing a taste.
    const fromLink = Shell.lam(link.l);
    const fromMirror = Shell.lam(saved.l);
    if (isNaN(fromLink) && !isNaN(fromMirror)) state.lambda = fromMirror;
    if (!isNaN(fromLink)) state.lambda = fromLink;
  }

  function writeTheLink() {
    const marked = state.picked.size || state.passed.size;
    const hash = Shell.hashOf(
      [...state.picked],
      [...state.passed],
      marked || state.lambda !== Manicule.LAMBDA ? state.lambda : null,
    );
    history.replaceState(null, "", hash || location.pathname + location.search);
    // A borrowed link does not overwrite this browser's own taste until the
    // first press adopts it.
    if (!state.borrowed) remember();
    Shell.carry();
    Shell.renderAddrs();
  }

  function remember() {
    try {
      localStorage.setItem("manicule", JSON.stringify({
        m: [...state.picked], d: [...state.passed], l: state.lambda,
      }));
    } catch (_) {}
  }

  // ── ranking ──────────────────────────────────────────────────────────────

  const vectorsOf = (ids) => [...ids].map((id) => entryById[id] && entryById[id].vector).filter(Boolean);

  function rankBy(lambda) {
    const pickedVectors = {};
    for (const id of state.picked) {
      if (entryById[id] && entryById[id].vector) pickedVectors[id] = entryById[id].vector;
    }
    return Manicule.rank(entries.entries, vectorsOf(state.picked), vectorsOf(state.passed), lambda, pickedVectors);
  }

  // ── words and numbers ────────────────────────────────────────────────────

  const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const utcStamp = (iso) => iso.slice(0, 10) + " " + iso.slice(11, 16) + " utc";

  const AGO = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  function timeAgo(iso) {
    if (!iso) return "undated";
    const then = Date.parse(iso);
    if (isNaN(then)) return iso.slice(0, 10);
    // Some feeds stamp an entry a few hours ahead of now, which would read
    // "in 5 hours". Nothing in a feed is from the reader's future.
    const seconds = Math.min(0, Math.round((then - Date.now()) / 1000));
    for (const [unit, size] of AGO) {
      if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    }
    return "just now";
  }

  // A feed whose summary is only punctuation has no blurb worth printing.
  const blurbOf = (entry) => ((entry.snippet || "").replace(/[.…\s]/g, "") ? entry.snippet : "");

  // ── one row ──────────────────────────────────────────────────────────────

  // The result only. The arithmetic behind it is worked in full on the method
  // page; a feed is for reading, and a column of sums is not.
  function receiptHtml(scored) {
    if (scored.score === -Infinity) return `<div class="calc"><span class="notext">no words, sinks</span></div>`;
    return `<div class="calc" title="how near this is to what you picked, less what you passed"><span class="sr-only">score</span> <span class="tot">${signed(scored.score)}</span></div>`;
  }

  // The picked entry this one most resembles, printed only when it changes:
  // a run of rows that all sit near the same thing says it once. The line is
  // always in the row, with words or without, and it never mentions the state:
  // pressing a control must not move the words under anyone's eye.
  let lastNearest = null;
  const NO_NEAR = `<p class="near"></p>`;
  function nearHtml(scored, isPicked, isPassed) {
    if (scored.score === -Infinity || isPicked || isPassed) return NO_NEAR;
    const nearest = scored.nearest && entryById[scored.nearest];
    if (!nearest || scored.nearest === lastNearest) return NO_NEAR;
    lastNearest = scored.nearest;
    return `<p class="near">${hand("rest")}<span>near your pick</span><span class="t" title="${esc(nearest.title)}">“${esc(shorten(nearest.title, 48))}”</span></p>`;
  }

  // One control, three states. A press advances it, and its name says what the
  // next press will do. Described by its row's title, so a page of them still
  // tells them apart.
  function controlHtml(entry, isPicked, isPassed) {
    const shape = isPicked ? "point" : isPassed ? "pass" : "";
    const says = isPicked ? "picked, press again to pass" : isPassed ? "passed, press again to clear" : "pick this";
    const now = isPicked ? "picked · press again to pass" : isPassed ? "passed · press again to clear" : "pick this";
    const drawing = isPassed ? hand("bird") : hand("point");
    return `<button class="mk ${shape}" type="button" data-act="cycle" aria-label="${says}" title="${now}" aria-describedby="t-${esc(entry.id)}">${drawing}</button>`;
  }

  function rowHtml(scored, place, cold) {
    const entry = scored.entry;
    const isPicked = state.picked.has(entry.id);
    const isPassed = state.passed.has(entry.id);
    const blurb = blurbOf(entry);
    const published = entry.published || "";
    return `<li class="row${isPicked ? " picked" : ""}${isPassed ? " passed" : ""}" data-id="${esc(entry.id)}">
          <span class="n" aria-hidden="true">${place}</span>
          <div class="body">
            <div class="meta"><span class="kind">${KIND_LABEL[entry.kind] || "web"}</span><span class="feed" title="${esc(entry.feed)}">${esc(entry.feed)}</span><time datetime="${esc(published)}" title="${esc(published.slice(0, 10))}">${timeAgo(published)}</time></div>
            <h2 class="title" id="t-${esc(entry.id)}"><a href="${esc(entry.link)}" rel="noopener" target="_blank" aria-describedby="newtab">${esc(entry.title || entry.link)}</a></h2>
            ${blurb ? `<p class="snip">${esc(blurb)}</p>` : ""}
            ${cold ? "" : nearHtml(scored, isPicked, isPassed)}
          </div>
          <div class="hands">
            ${controlHtml(entry, isPicked, isPassed)}
            ${cold ? "" : receiptHtml(scored)}
          </div>
        </li>`;
  }

  // ── nothing moves under your finger ──────────────────────────────────────

  // The list re-ranks and re-renders on every press, so measure a row before
  // the rebuild and scroll by the difference after it. Passing on something
  // sinks it off the page, so the rows above it are the fallback anchors.
  function holdingPlace(anchorId, rebuild) {
    const rows = [...document.querySelectorAll(".row")];
    const start = anchorId
      ? rows.findIndex((row) => row.dataset.id === anchorId)
      : rows.findIndex((row) => row.getBoundingClientRect().bottom > 0);
    const anchors = start < 0 ? [] : [rows[start], ...rows.slice(0, start).reverse()];
    const before = anchors.map((row) => [row.dataset.id, row.getBoundingClientRect().top]);

    rebuild();

    for (const [id, top] of before) {
      const row = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
      if (!row) continue;
      const moved = row.getBoundingClientRect().top - top;
      if (moved) scrollBy(0, moved);
      return;
    }
  }

  // ── the reorder, seen ────────────────────────────────────────────────────

  // Every row is measured before the rebuild and slid from there to where it
  // landed, so a press reads as the rest of the list moving around the row
  // that stayed. Runs outside holdingPlace: the scroll that pins the pressed
  // row has to land first, or the slide would start from the wrong place.
  const GLIDE_MS = 150;
  const stillness = matchMedia("(prefers-reduced-motion: reduce)");

  function gliding(rebuild) {
    const rows = () => [...document.querySelectorAll(".row")];
    const before = new Map(rows().map((row) => [row.dataset.id, row.getBoundingClientRect().top]));

    rebuild();

    if (!before.size || stillness.matches) return;
    for (const row of rows()) {
      const was = before.get(row.dataset.id);
      if (was === undefined) {
        row.animate([{ opacity: 0 }, { opacity: 1 }], { duration: GLIDE_MS, easing: "ease" });
        continue;
      }
      const slid = was - row.getBoundingClientRect().top;
      if (Math.abs(slid) < 1) continue;
      row.animate([{ transform: `translateY(${slid}px)` }, { transform: "none" }], { duration: GLIDE_MS, easing: "ease-out" });
    }
  }

  // Rebuilding with innerHTML drops keyboard focus. Remember which control had
  // it and give it back, without scrolling: the row it belongs to has moved.
  function holdingFocus(rebuild) {
    const focused = document.activeElement;
    const row = focused && focused.closest(".row");
    const selector = row
      ? `.row[data-id="${CSS.escape(row.dataset.id)}"] [data-act="${focused.dataset.act}"]`
      : null;

    rebuild();

    const again = selector && document.querySelector(selector);
    if (again) again.focus({ preventScroll: true });
  }

  // ── drawing the page ─────────────────────────────────────────────────────

  function setRuler() {
    el("lam").value = state.lambda;
    el("lamv").value = state.lambda.toFixed(2);
    el("lam").setAttribute("aria-valuetext", "λ " + state.lambda.toFixed(2));
  }

  // The order on screen is a choice, not a consequence: a press changes the
  // scores and nothing moves until the button is pressed.
  // The same shape in every state, so the line never wraps differently and
  // never moves the feed below it.
  function drawStatus(cold) {
    const counts = cold
      ? `<span class="n">nothing picked</span>`
      : `<span class="n">${state.picked.size} picked</span> <span class="n">${state.passed.size} passed</span> <span class="n lam">λ ${state.lambda.toFixed(2)}</span>`;
    el("status").innerHTML =
      `<b>${state.order ? "by taste" : "newest first"}</b> ${counts} ` +
      `<button class="btn quiet" data-act="order" type="button">order by taste</button>`;
  }

  function draw() {
    const ranked = rankBy(state.lambda);
    const cold = ranked === null;
    if (cold) state.order = null;

    // Scores follow your taste; the order follows state.order.
    const scoredById = {};
    for (const row of ranked || []) scoredById[row.entry.id] = row;
    const inOrder = state.order
      ? state.order.map((id) => entryById[id]).filter(Boolean)
      : entries.entries;
    const visible = inOrder.map((entry) => scoredById[entry.id] || { entry });

    const ledger = el("ledger");
    ledger.classList.toggle("cold", cold);
    ledger.classList.toggle("borrowed", state.borrowed);
    drawStatus(cold);
    el("banner").hidden = !state.borrowed;

    holdingFocus(() => {
      lastNearest = null;
      el("list").innerHTML = visible
        .slice(0, state.rowsShown)
        .map((scored, i) => rowHtml(scored, i + 1, cold))
        .join("");
    });

    const left = Math.max(0, visible.length - state.rowsShown);
    el("more").hidden = !left;
    el("morebtn").innerHTML = `below the fold · <span class="n">${left}</span> more`;
    el("empty").hidden = visible.length > 0;
    writeTheLink();
  }

  function orderByTaste() {
    const ranked = rankBy(state.lambda);
    state.order = ranked ? ranked.map((row) => row.entry.id) : null;
  }

  // A taste that arrives with the page (a link, or this browser's own) lands
  // ordered by taste; that is what it is for.
  function drawEverything() {
    readTheLink();
    setRuler();
    orderByTaste();
    draw();
  }

  // ── what a press does ────────────────────────────────────────────────────

  function forget() {
    state.picked.clear();
    state.passed.clear();
    state.lambda = Manicule.LAMBDA;
    state.borrowed = false;
    state.order = null;
    state.rowsShown = ROWS_PER_PAGE;
    setRuler();
    gliding(draw);
    // The button that was pressed may be gone: the banner hides, and the
    // toolbar's actions fold away once there is nothing to share.
    const focused = document.activeElement;
    if (!focused || focused === document.body || !focused.offsetParent) {
      el("list").focus({ preventScroll: true });
    }
  }

  el("list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const id = button.closest(".row").dataset.id;
    // nothing → picked → passed → nothing
    if (state.picked.has(id)) { state.picked.delete(id); state.passed.add(id); }
    else if (state.passed.has(id)) { state.passed.delete(id); }
    else { state.picked.add(id); }
    state.borrowed = false; // the first press makes a borrowed link yours
    draw();                 // the scores change; the order holds
  });

  // Moving the ruler re-ranks, but it is not a pick, so it does not adopt a
  // borrowed link.
  el("lam").addEventListener("input", (event) => {
    state.lambda = parseFloat(event.target.value);
    setRuler();
    draw();
  });

  el("morebtn").addEventListener("click", () => {
    const wasShowing = state.rowsShown;
    state.rowsShown += ROWS_PER_PAGE;
    draw();
    // The last press hides the button out from under the focus, so move it to
    // the first row that just arrived.
    if (el("more").hidden) {
      const firstNew = el("list").children[wasShowing];
      const control = firstNew && firstNew.querySelector(".mk");
      if (control) control.focus();
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-act="forget"]')) { forget(); toast("forgotten"); }
    else if (event.target.closest('[data-act="fresh"]')) forget();
    else if (event.target.closest('[data-act="order"]') && entries) {
      orderByTaste();
      state.rowsShown = ROWS_PER_PAGE;
      gliding(() => holdingPlace(null, draw));
      el("list").focus({ preventScroll: true });
    }
  });

  // A plain fragment (#list, from the skip link) is not a state.
  addEventListener("hashchange", () => { if (Shell.isTaste(location.hash)) drawEverything(); });

  // ── boot ─────────────────────────────────────────────────────────────────

  fetch("entries.json", { cache: "no-cache" })
    .then((response) => response.json())
    .then((loaded) => {
      entries = loaded;
      for (const entry of entries.entries) {
        entry.vector = entry.q ? Manicule.dequantize(entry.q, entry.s) : null;
        delete entry.q;
        entryById[entry.id] = entry;
      }

      el("spec").innerHTML = [
        `<span title="${esc(utcStamp(entries.generated))}">updated ${esc(timeAgo(entries.generated))}</span>`,
        `<span>updates once a day</span>`,
        `<span>${entries.feeds.length} feeds</span>`,
      ].join(" ");

      for (const slot of document.querySelectorAll("[data-count]")) slot.textContent = entries.entries.length;

      try { localStorage.setItem("manicule-count", entries.entries.length); } catch (_) {}

      drawEverything();
    })
    .catch(() => {
      // There is nothing behind the controls, so only the status line stays.
      el("status").textContent = "couldn't load";
      el("spec").textContent = "";
      el("ledger").classList.add("cold", "dead");
    });
})();
