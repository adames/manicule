// app.js: the feed. Loads corpus.json, ranks it in the browser with
// rank.js, and prints every score as a receipt. State lives in the URL
// hash (#m=…&d=…&l=…) with a localStorage mirror; nothing leaves the page.
(function () {
  const PAGE = 20;   // 20 rows a page: the doors strip lands within three screens; "below the fold" carries the rest
  const NEXT_REFRESH_UTC = "06:17"; // the Action's cron: "17 6 * * *"
  const $ = (id) => document.getElementById(id);
  const { hand, toast, esc } = Shell;
  const KIND = { article: "web", video: "vid", podcast: "pod" };
  const state = {
    marked: new Set(), dismissed: new Set(), lam: Manicule.LAMBDA,
    sources: new Set(), shown: PAGE,
    tab: "taste",     // taste | date. not persisted
    borrowed: false,  // the hash carries someone else's marks
  };
  let corpus = null, byId = {};

  // ---- state <-> hash. The hash is the only persistence; the mirror is a
  // per-browser convenience so the feed remembers you without a link.
  function same(a, b) { return a.length === b.length && a.every((x) => b.includes(x)); }
  function readHash() {
    const raw = Shell.marksIn(location.hash), lam = Shell.lam(raw.l);
    // ids the daily rebuild has since dropped are ignored on both sides, so
    // an own link gone stale still reads as your own, and a friend's link
    // gone wholly stale reads as no marks at all (your own come back)
    const live = (ids) => (ids || []).filter((i) => byId[i]);
    const saved = Shell.mirror() || {}, own = { m: live(saved.m), d: live(saved.d) };
    const m = live(raw.m), d = live(raw.d);
    if (m.length || d.length) {
      // marks in the hash are the state; borrowed when this browser did not make them
      state.marked = new Set(m); state.dismissed = new Set(d);
      state.borrowed = !(same(m, own.m) && same(d, own.d));
    } else {
      // no marks in the hash: this browser's own, if any
      state.marked = new Set(own.m); state.dismissed = new Set(own.d); state.borrowed = false;
    }
    // λ is this browser's preference, not a mark: the saved one applies to any
    // link that carries none. λ in the hash wins either way: a bare #l=0.5
    // moves the ruler, it does not clear the marks
    const sl = Shell.lam(saved.l);
    if (isNaN(lam) && !isNaN(sl)) state.lam = sl;
    if (!isNaN(lam)) state.lam = lam;
  }
  function writeHash() {
    // λ prints when there are marks, or when it was moved off the default
    const any = state.marked.size || state.dismissed.size;
    const s = Shell.hashOf([...state.marked], [...state.dismissed], any || state.lam !== Manicule.LAMBDA ? state.lam : null);
    history.replaceState(null, "", s || location.pathname + location.search);
    // A borrowed link does not overwrite this browser's own marks until the
    // first press adopts it.
    if (!state.borrowed) try { localStorage.setItem("manicule", JSON.stringify({ m: [...state.marked], d: [...state.dismissed], l: state.lam })); } catch (_) {}
    Shell.carry(); Shell.renderAddrs();
  }

  // ---- ranking
  function vecs(ids) { return [...ids].map((i) => byId[i] && byId[i].vector).filter(Boolean); }
  function ranked(lam) {
    const keptById = {}; for (const i of state.marked) if (byId[i] && byId[i].vector) keptById[i] = byId[i].vector;
    return Manicule.rank(corpus.entries, vecs(state.marked), vecs(state.dismissed), lam, keptById);
  }

  // ---- render
  const fmt = (x) => (x < 0 ? "−" : "+") + Math.abs(x).toFixed(2);
  const num = (x) => (x < 0 ? "−" : "") + Math.abs(x).toFixed(2);
  const dateOf = (iso) => iso ? iso.slice(0, 10) : "undated";
  const cut = (s, n) => s.length > n ? s.slice(0, n - 1) + "…" : s;
  // the ruler, its readout, and what a screen reader calls the value
  function setLam() {
    $("lam").value = state.lam; $("lamv").value = state.lam.toFixed(2);
    $("lam").setAttribute("aria-valuetext", "λ " + state.lam.toFixed(2));
  }
  // a rebuild with innerHTML would drop keyboard focus; remember which hand
  // or chip had it and give it back after (without scrolling: the row moved)
  function keepFocus(rebuild) {
    const a = document.activeElement, row = a && a.closest(".row");
    const sel = row ? `.row[data-id="${CSS.escape(row.dataset.id)}"] [data-act="${a.dataset.act}"]`
      : a && a.classList.contains("chip") ? `.chip[data-src="${CSS.escape(a.dataset.src)}"]` : null;
    rebuild();
    const el = sel && document.querySelector(sel);
    if (el) el.focus({ preventScroll: true });
  }

  // the receipt: two terms, a rule (the equals), the total. with nothing
  // dismissed there is no subtraction, so only the total prints
  function receipt(r) {
    if (r.score === -Infinity) return `<div class="calc"><span class="notext">no words, sinks</span></div>`;
    // a hidden "score" names the arithmetic for screen readers (the column legend is decoration)
    if (!state.dismissed.size) return `<div class="calc"><span class="sr-only">score</span> <span class="tot">${fmt(r.score)}</span></div>`;
    return `<div class="calc"><span class="sr-only">score</span> <span class="t1">${fmt(r.pos)}</span> <span class="t2">− ${state.lam.toFixed(2)} × ${num(r.neg)}</span> <span class="eq sr-only">=</span> <span class="tot">${fmt(r.score)}</span></div>`;
  }
  // the near line: the kept item this one most resembles; on a kept row
  // just "kept"; on a dismissed row how far the λ term moved it
  function near(r, e, m, d, sank) {
    if (r.score === -Infinity) return "";
    if (m) return `<p class="near">pointed at</p>`;
    if (d) return `<p class="near"><span>${sank > 0 ? `sank ${sank}, still here` : "still here"}</span></p>`;
    const n = r.nearest && byId[r.nearest];
    return n ? `<p class="near">${hand("rest")}<span>near</span><span class="t" title="${esc(n.title)}">“${esc(cut(n.title, 48))}”</span></p>` : "";
  }
  // a feed whose summary is only dots has no snippet
  const snippetOf = (e) => (e.snippet || "").replace(/[.…\s]/g, "") ? e.snippet : "";

  function render() {
    const rows = ranked(state.lam);
    const cold = rows === null;
    let list = cold ? corpus.entries.map((e) => ({ entry: e })) : rows;
    // how far each dismissed row sank: its place without the λ term vs with it
    const sank = {};
    if (!cold && state.dismissed.size) {
      const at = (rs) => { const p = {}; rs.forEach((r, i) => { p[r.entry.id] = i; }); return p; };
      const with0 = at(ranked(0)), withL = at(rows);
      for (const id of state.dismissed) if (withL[id] !== undefined) sank[id] = withL[id] - with0[id];
    }
    if (!cold && state.tab === "date") list = [...rows].sort((a, b) => (b.entry.published || "").localeCompare(a.entry.published || ""));
    const visible = list.filter((r) => !state.sources.size || state.sources.has(r.entry.feed));

    $("ledger").classList.toggle("cold", cold);
    $("ledger").classList.toggle("nodis", !state.dismissed.size); // no second line to legend
    $("ledger").classList.toggle("borrowed", state.borrowed);
    // the spaces between the spans are for screen readers (the dots are CSS)
    $("status").innerHTML = cold
      ? `<b>newest first</b>`
      : `<b>ranked</b> <span class="n">${state.marked.size} pointed at</span> <span class="n">${state.dismissed.size} passed on</span> <span class="n">λ ${state.lam.toFixed(2)}</span>`;
    // taste stays focusable while cold (aria-disabled), so a press can say why
    $("tab-taste").setAttribute("aria-disabled", cold);
    $("tab-taste").title = cold ? "mark something first" : "";
    $("tab-taste").setAttribute("aria-pressed", !cold && state.tab === "taste");
    $("tab-date").setAttribute("aria-pressed", cold || state.tab === "date");
    $("banner").hidden = !state.borrowed;

    keepFocus(() => {
      $("list").innerHTML = visible.slice(0, state.shown).map((r, i) => {
        const e = r.entry, m = state.marked.has(e.id), d = state.dismissed.has(e.id), snip = snippetOf(e);
        return `<li class="row${m ? " kept" : ""}${d ? " dismissed" : ""}" data-id="${esc(e.id)}">
          <span class="n" aria-hidden="true">${i + 1}</span>
          <div class="body">
            <div class="meta"><span class="kind">${KIND[e.kind] || "web"}</span><span class="feed" title="${esc(e.feed)}">${esc(e.feed)}</span><time datetime="${esc(e.published)}">${dateOf(e.published)}</time></div>
            <h2 class="title" id="t-${esc(e.id)}"><a href="${esc(e.link)}" rel="noopener" target="_blank" aria-describedby="newtab">${esc(e.title || e.link)}</a></h2>
            ${snip ? `<p class="snip">${esc(snip)}</p>` : ""}
            ${cold ? "" : near(r, e, m, d, sank[e.id])}
          </div>
          ${cold ? "" : receipt(r)}
          <div class="hands">
            <!-- one control, three states: empty, pointed at, passed on. A click
                 advances it. Described by its row's title, so a page of them
                 still tells them apart. -->
            <button class="mk ${m ? "point" : d ? "pass" : ""}" type="button" data-act="cycle" aria-label="${m ? "pointed at, press to pass on" : d ? "passed on, press to clear" : "point at this"}" title="${m ? "pointed at" : d ? "passed on" : "point at this"}" aria-describedby="t-${esc(e.id)}">${m ? hand("point") : d ? hand("bird") : hand("point")}</button>
          </div>
        </li>`;
      }).join("");
    });
    const left = Math.max(0, visible.length - state.shown);
    $("more").hidden = !left;
    $("morebtn").innerHTML = `below the fold · <span class="n">${left}</span> more`;
    $("empty").hidden = visible.length > 0;
    writeHash();
  }

  function renderChips() {
    const counts = {}; for (const e of corpus.entries) counts[e.feed] = (counts[e.feed] || 0) + 1;
    keepFocus(() => {
      $("chips").innerHTML = corpus.feeds.map((f) => `<button class="chip" type="button" data-src="${esc(f)}" aria-pressed="${state.sources.has(f)}">${esc(f)}<span class="n">${counts[f] || 0}</span></button>`).join("");
    });
    $("srccount").textContent = state.sources.size ? `${state.sources.size} of ${corpus.feeds.length}` : `all ${corpus.feeds.length}`;
  }

  // ---- events
  // the first press on a hand adopts a borrowed link's marks as this browser's
  function adopt() { if (state.borrowed) { state.borrowed = false; } }
  $("list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-act]"); if (!b) return;
    const id = b.closest(".row").dataset.id;
    // a mark clears a dismissal and vice versa; pressing again undoes
    // one control, so a press advances: nothing -> pointed at -> passed on -> nothing
    if (state.marked.has(id)) { state.marked.delete(id); state.dismissed.add(id); }
    else if (state.dismissed.has(id)) { state.dismissed.delete(id); }
    else { state.marked.add(id); }
    adopt(); render();
  });
  $("chips").addEventListener("click", (ev) => {
    const b = ev.target.closest(".chip"); if (!b) return;
    const f = b.dataset.src; state.sources.has(f) ? state.sources.delete(f) : state.sources.add(f);
    state.shown = PAGE; renderChips(); render();
  });
  // moving the ruler re-ranks but does not adopt a borrowed link
  $("lam").addEventListener("input", (ev) => { state.lam = parseFloat(ev.target.value); setLam(); render(); });
  $("tab-taste").addEventListener("click", () => {
    if (ranked(state.lam)) { state.tab = "taste"; render(); return; }
    // cold with a mark means the only kept row has no vector: say so, not "mark something"
    toast(state.marked.size ? "no words, sinks" : "mark something first");
  });
  $("tab-date").addEventListener("click", () => { if (ranked(state.lam)) { state.tab = "date"; render(); } });
  $("morebtn").addEventListener("click", () => {
    const first = state.shown;
    state.shown += PAGE; render();
    // the last page hides the button under the focus; move it to the first new row
    if ($("more").hidden) { const row = $("list").children[first]; if (row) row.querySelector(".hand").focus(); }
  });
  function forget() {
    state.marked.clear(); state.dismissed.clear(); state.lam = Manicule.LAMBDA; state.tab = "taste"; state.borrowed = false;
    setLam(); state.shown = PAGE; render();
    // the pressed button may be gone now (the banner hides, the toolbar acts fold
    // away when cold): keep keyboard focus in the page, on the list
    const a = document.activeElement;
    if (!a || a === document.body || !a.offsetParent) $("list").focus({ preventScroll: true });
  }
  document.addEventListener("click", (ev) => {
    if (ev.target.closest('[data-act="forget"]')) { forget(); toast("forgotten"); }
    else if (ev.target.closest('[data-act="fresh"]')) forget();
  });
  // a fragment (#list from the skip link, typed or from history) is not a state
  addEventListener("hashchange", () => { if (Shell.isMarks(location.hash)) load(); });

  // ---- boot
  function load() { readHash(); setLam(); render(); }
  const stamp = (iso) => iso.slice(0, 10) + " " + iso.slice(11, 16) + " utc";
  fetch("corpus.json", { cache: "no-cache" }).then((r) => r.json()).then((c) => {
    corpus = c;
    for (const e of c.entries) { e.vector = e.q ? Manicule.dequantize(e.q, e.s) : null; delete e.q; byId[e.id] = e; }
    $("spec").innerHTML = [`refreshed ${esc(stamp(c.generated))}`, `next ${NEXT_REFRESH_UTC} utc`, `${c.entries.length} entries`, `${c.feeds.length} feeds`, "no accounts"].map((s) => `<span>${s}</span>`).join(" ");
    for (const el of document.querySelectorAll("[data-count]")) el.textContent = c.entries.length;
    try { localStorage.setItem("manicule-count", c.entries.length); } catch (_) {}
    renderChips(); load();
    // how it works: open on a cold desktop, closed once there are marks and always on a phone
    const cold = !state.marked.size;
    $("how").open = cold && !matchMedia("(max-width: 719.98px)").matches;
  }).catch(() => {
    // nothing behind the controls, so only the status line stays
    $("status").textContent = "couldn't load"; $("spec").textContent = "";
    $("ledger").classList.add("cold", "dead");
  });
})();
