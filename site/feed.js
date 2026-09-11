// feed.js — the feed page: load the posts, rank them by what you picked,
// and print every score with its arithmetic. Nothing is stored anywhere: the
// link is the state, and localStorage only remembers it for a bare visit.
//
// The link carries two things, and only one of them ranks. The two averages
// are the taste itself: they mean the same thing on any day, against any pool,
// on anyone's fork. The ids are there to keep the right boxes ticked, and they
// stop meaning anything the moment those posts leave the pool.
(function () {
  const ROWS_PER_PAGE = 20;
  const KIND_LABEL = { article: "web", video: "vid", podcast: "pod" };

  const { hand, toast, esc, signed } = Shell;
  const el = (id) => document.getElementById(id);

  const state = {
    picked: new Set(),
    passed: new Set(),
    // The taste itself: a few averages a side, not one. Cooking and compilers
    // do not average into a direction pointing at neither. A press folds a post
    // into the average it belongs to; un-pressing takes the same post back out.
    // Everything ever pressed is in here, including posts long gone.
    taste: { picked: [], passed: [] },
    lambda: Manicule.LAMBDA,
    borrowed: false,  // the link carries a taste this browser did not make
    unreadable: false,// the link carries an average from a different model
    order: null,      // ids in the order on screen; null is the cold order
    rowsShown: ROWS_PER_PAGE,
  };
  let posts = null;      // posts.json, once it lands
  let postById = {};

  // ── the link is the state ────────────────────────────────────────────────

  const sameIds = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

  // An average is only meaningful to the model that made it. A link from a
  // different one is not wrong, it is unreadable, and reading it anyway would
  // rank by noise while looking like it worked.
  const ourModel = () => Shell.feedKey(posts.model);

  function tasteIn(source) {
    const nothing = { picked: [], passed: [] };
    if (!source.v && !source.w) return nothing;
    if (source.k && source.k !== ourModel()) {
      state.unreadable = true;
      return nothing;
    }
    return { picked: Manicule.readTasteBlob(source.v, posts.dim), passed: Manicule.readTasteBlob(source.w, posts.dim) };
  }

  function readTheLink() {
    state.unreadable = false;
    const link = Shell.tasteIn(location.hash);
    const saved = Shell.mirror() || {};
    // The daily rebuild drops posts, and their ids go with them. Ignoring
    // dead ids on both sides means your own stale link still reads as yours,
    // and a friend's wholly stale link reads as empty rather than as theirs.
    const live = (ids) => (ids || []).filter((id) => postById[id]);
    const mine = { picked: live(saved.m), passed: live(saved.d) };
    const linked = { picked: live(link.m), passed: live(link.d) };

    const linkTaste = tasteIn(link);
    const hasLink = linked.picked.length || linked.passed.length || linkTaste.picked.length || linkTaste.passed.length;

    if (hasLink) {
      state.picked = new Set(linked.picked);
      state.passed = new Set(linked.passed);
      state.taste = linkTaste;
      // A link with no ids still carries a taste, so the averages decide too:
      // a friend's link is borrowed whether or not the posts behind it survive.
      state.borrowed =
        !(sameIds(linked.picked, mine.picked) && sameIds(linked.passed, mine.passed)) ||
        link.v !== (saved.v || "") || link.w !== (saved.w || "");
    } else {
      state.picked = new Set(mine.picked);
      state.passed = new Set(mine.passed);
      state.taste = tasteIn(saved);
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
    const { picked, passed } = state.taste;
    const marked = state.picked.size || state.passed.size || picked.length || passed.length;
    const hash = Shell.hashOf({
      m: [...state.picked],
      d: [...state.passed],
      l: marked || state.lambda !== Manicule.LAMBDA ? state.lambda : null,
      v: Manicule.tasteBlob(picked),
      w: Manicule.tasteBlob(passed),
      k: picked.length || passed.length ? ourModel() : "",
    });
    history.replaceState(null, "", hash || location.pathname + location.search);
    // A borrowed link does not overwrite this browser's own taste until the
    // first press adopts it.
    if (!state.borrowed) remember();
    Shell.carry();
  }

  function remember() {
    const { picked, passed } = state.taste;
    try {
      localStorage.setItem("manicule", JSON.stringify({
        m: [...state.picked], d: [...state.passed], l: state.lambda,
        v: Manicule.tasteBlob(picked), w: Manicule.tasteBlob(passed),
        k: picked.length || passed.length ? ourModel() : "",
      }));
    } catch (_) {}
  }

  // ── ranking ──────────────────────────────────────────────────────────────

  // The taste is already a few averages a side, which is all the ranking ever
  // wanted. Nothing is averaged here: it was averaged as it was pressed.
  function rankBy(lambda) {
    // Only posts still in the pool can be named as the closest pick. An
    // average is not a post, so a carried taste ranks without a near line.
    const pickedVectors = {};
    for (const id of state.picked) {
      if (postById[id] && postById[id].vector) pickedVectors[id] = postById[id].vector;
    }
    const { picked, passed } = state.taste;
    return Manicule.rank(posts.posts, picked, passed, lambda, pickedVectors);
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
    // Some feeds stamp a post a few hours ahead of now, which would read
    // "in 5 hours". Nothing in a feed is from the reader's future.
    const seconds = Math.min(0, Math.round((then - Date.now()) / 1000));
    for (const [unit, size] of AGO) {
      if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
    }
    return "just now";
  }

  // A feed whose summary is only punctuation has no blurb worth printing.
  const blurbOf = (post) => ((post.snippet || "").replace(/[.…\s]/g, "") ? post.snippet : "");

  // ── one row ──────────────────────────────────────────────────────────────

  // The result only. The arithmetic behind it is worked in full on the method
  // page; a feed is for reading, and a column of sums is not.
  // Cold, there is no score to print, but the box is still drawn: a row must
  // be the same height before and after your first press, or the whole page
  // moves under you.
  function receiptHtml(scored, cold) {
    if (cold) return `<div class="calc" aria-hidden="true"><span class="tot">&nbsp;</span></div>`;
    if (scored.score === -Infinity) return `<div class="calc"><span class="notext">no words, sinks</span></div>`;
    return `<div class="calc" title="how near this is to what you picked, less what you passed"><span class="sr-only">score</span> <span class="tot">${signed(scored.score)}</span></div>`;
  }

  // The picked post this one most resembles, printed only when it changes:
  // a run of rows that all sit near the same thing says it once. The line is
  // always in the row, with words or without, and it never mentions the state:
  // pressing a control must not move the words under anyone's eye.
  let lastNear = null;
  const NO_NEAR = `<p class="near"></p>`;
  function nearHtml(scored, isPicked, isPassed) {
    if (scored.score === -Infinity || isPicked || isPassed) return NO_NEAR;
    // With several tastes, the number is the thing worth saying: it is what
    // the lines above the feed are numbered by, and a run of rows from one
    // taste then another is the whole picture. The pick is named when there
    // is one in the pool to name; a taste carried in by a link has none.
    const several = state.taste.picked.length > 1;
    const nearest = scored.nearest && postById[scored.nearest];
    const key = `${several ? scored.which : ""}:${nearest ? scored.nearest : ""}`;
    if ((!nearest && !several) || key === lastNear) return NO_NEAR;
    lastNear = key;
    const taste = several ? `<span class="k">taste ${scored.which + 1}</span>` : "";
    const pick = nearest
      ? `<span>${several ? "· " : ""}near your pick</span><span class="t" title="${esc(nearest.title)}">“${esc(shorten(nearest.title, 48))}”</span>`
      : "";
    return `<p class="near">${hand("rest")}${taste}${pick}</p>`;
  }

  // One control, three states. A press advances it, and its name says what the
  // next press will do. Described by its row's title, so a page of them still
  // tells them apart.
  function controlHtml(post, isPicked, isPassed) {
    const shape = isPicked ? "point" : isPassed ? "pass" : "";
    const says = isPicked ? "picked, press again to pass" : isPassed ? "passed, press again to clear" : "pick this";
    const now = isPicked ? "picked · press again to pass" : isPassed ? "passed · press again to clear" : "pick this";
    const drawing = isPassed ? hand("bird") : hand("point");
    return `<button class="mk ${shape}" type="button" data-act="cycle" aria-label="${says}" title="${now}" aria-describedby="t-${esc(post.id)}">${drawing}</button>`;
  }

  function rowHtml(scored, place, cold) {
    const post = scored.post;
    const isPicked = state.picked.has(post.id);
    const isPassed = state.passed.has(post.id);
    const blurb = blurbOf(post);
    const published = post.published || "";
    return `<li class="row${isPicked ? " picked" : ""}${isPassed ? " passed" : ""}" data-id="${esc(post.id)}">
          <span class="n" aria-hidden="true">${place}</span>
          <div class="body">
            <div class="meta"><span class="kind">${KIND_LABEL[post.kind] || "web"}</span><span class="feed" title="${esc(post.feed)}">${esc(post.feed)}</span><time datetime="${esc(published)}" title="${esc(published.slice(0, 10))}">${timeAgo(published)}</time></div>
            <h2 class="title" id="t-${esc(post.id)}"><a href="${esc(post.link)}" rel="noopener" target="_blank" aria-describedby="newtab">${esc(post.title || post.link)}</a></h2>
            ${blurb ? `<p class="snip">${esc(blurb)}</p>` : ""}
            ${cold ? NO_NEAR : nearHtml(scored, isPicked, isPassed)}
          </div>
          <div class="hands">
            ${controlHtml(post, isPicked, isPassed)}
            ${receiptHtml(scored, cold)}
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

  // The order on screen is a choice, not a consequence: a press changes the
  // scores and nothing moves until the button is pressed.
  // The same shape in every state, so the line never wraps differently and
  // never moves the feed below it.
  function drawStatus(cold) {
    const { picked, passed } = state.taste;
    // Two averages is a fact about your taste worth a word; one is just how
    // averages work, and saying "1 taste" would be noise on every other visit.
    const shape = picked.length > 1 ? ` <span class="n">in ${picked.length} tastes</span>` : "";
    const counts = cold
      ? `<span class="n">nothing picked</span>`
      : `<span class="n">${Manicule.pressesIn(picked)} picked</span>${shape} <span class="n">${Manicule.pressesIn(passed)} passed</span> <a class="n lam" href="method.html">λ ${state.lambda.toFixed(2)}</a>`;
    el("status").innerHTML =
      `<b>${state.order ? "by taste" : cold ? "a spread of what is here" : "newest first"}</b> ${counts} ` +
      `<button class="btn quiet" data-act="order" type="button">order by taste</button>`;
  }

  // Two things can be true of an arriving link, and only one of them is worth
  // a word: someone else's taste can be adopted with a press, but a taste from
  // a different model is not wrong, it is unreadable, and saying nothing would
  // leave a reader thinking their link had been thrown away.
  function drawBanner() {
    const banner = el("banner");
    banner.hidden = !(state.borrowed || state.unreadable);
    if (banner.hidden) return;
    const stillHaveOne = state.taste.picked.length || state.taste.passed.length;
    el("banner-says").innerHTML = state.unreadable
      ? `<b>this link was written for a different model</b> · the numbers in it mean nothing here, so ${stillHaveOne ? "your own taste is showing instead" : "the feed starts cold"}`
      : `<b>this link carries someone else's taste</b> · press the box beside anything you'd read and it becomes yours`;
  }

  // What your taste is about, said in the pool's own words: for each average,
  // the feeds its nearest posts come from. Read off the pool, not stored, so
  // it is as true of a taste carried in by a link as of one pressed just now.
  // This is the see-through view of a vector, and the reason a number in the
  // status line ("in 2 tastes") means something.
  function drawTastes() {
    const box = el("tastes");
    const { picked, passed } = state.taste;
    box.hidden = !picked.length && !passed.length;
    if (box.hidden) { box.innerHTML = ""; return; }
    const several = picked.length > 1;
    // "about cooking · sourdough, starter, hydration". The label is the
    // category; the words are the specific thing. The feeds it sits nearest
    // are in the tooltip, and all three are worked on the method page.
    const line = (about, i, isPass) => {
      const k = several && !isPass ? `<span class="k">taste ${i + 1}</span>` : "";
      const n = `<span class="n">${about.count} ${isPass ? "passed" : about.count === 1 ? "pick" : "picks"}</span>`;
      // "about the iphone 17 pro · apple and iphone" when one thing dominates;
      // "about apple and iphone · iphone air, iphone duo" when it is a field.
      // …and "about apple and iphone · this week: iphone duo, apple surprise"
      // when the nearest posts are bunched in time: an announcement, not a field.
      const label = about.labels.length ? esc(about.labels[0].text) : "";
      const rest = about.words.filter((w) => w !== about.focus);
      const when = about.happening ? `<b>${about.happening}</b>: ` : "";
      const specifics = rest.length ? when + esc(rest.join(", ")) : about.happening ? `<b>${about.happening}</b>` : "";
      const said = about.focus
        ? [`about <b>${esc(about.focus)}</b>`, label, specifics].filter(Boolean).join(" · ")
        : [label ? `about <b>${label}</b>` : "", specifics].filter(Boolean).join(" · ")
          || "near nothing in today's pool";
      const where = about.feeds.length ? ` title="near ${esc(about.feeds.join(", "))}"` : "";
      return `<li>${hand(isPass ? "bird" : "rest")}${k}${n}<span class="feeds"${where}>${said}</span></li>`;
    };
    box.innerHTML =
      Manicule.describe(picked, posts.posts, posts.labels).map((about, i) => line(about, i, false)).join("") +
      Manicule.describe(passed, posts.posts, posts.labels).map((about, i) => line(about, i, true)).join("");
  }

  function draw() {
    const ranked = rankBy(state.lambda);
    const cold = ranked === null;
    if (cold) state.order = null;

    // Scores follow your taste; the order follows state.order.
    const scoredById = {};
    for (const row of ranked || []) scoredById[row.post.id] = row;
    const inOrder = state.order
      ? state.order.map((id) => postById[id]).filter(Boolean)
      : coldOrder();
    const visible = inOrder.map((post) => scoredById[post.id] || { post });

    const ledger = el("ledger");
    ledger.classList.toggle("cold", cold);
    ledger.classList.toggle("borrowed", state.borrowed);
    drawStatus(cold);
    drawTastes();
    drawBanner();

    holdingFocus(() => {
      lastNear = null;
      el("list").innerHTML = visible
        .slice(0, state.rowsShown)
        .map((scored, i) => rowHtml(scored, i + 1, cold))
        .join("");
    });

    const left = Math.max(0, visible.length - state.rowsShown);
    el("more").hidden = !left;
    el("morebtn").innerHTML = `show <span class="n">${left}</span> more`;
    el("empty").hidden = visible.length > 0;
    writeTheLink();
  }

  // A thousand posts and no reason to press any of them is the hard part of a
  // big pool. Newest first answers "what is new", which nobody asked. The
  // spread answers "what is here": posts chosen at build time to sit as far
  // apart as possible, so whatever you are into, something up here is near it.
  // The rest of the pool follows, newest first, and one press ends the whole
  // arrangement.
  function coldOrder() {
    const seats = (posts.spread || []).map((id) => postById[id]).filter(Boolean);
    if (!seats.length) return posts.posts;
    const seated = new Set(seats.map((post) => post.id));
    return seats.concat(posts.posts.filter((post) => !seated.has(post.id)));
  }

  function orderByTaste() {
    const ranked = rankBy(state.lambda);
    state.order = ranked ? ranked.map((row) => row.post.id) : null;
  }

  // A taste that arrives with the page (a link, or this browser's own) lands
  // ordered by taste; that is what it is for.
  function drawEverything() {
    readTheLink();
    orderByTaste();
    draw();
  }

  // ── what a press does ────────────────────────────────────────────────────

  function forget() {
    state.picked.clear();
    state.passed.clear();
    state.taste = { picked: [], passed: [] };
    state.lambda = Manicule.LAMBDA;
    state.borrowed = false;
    state.order = null;
    state.rowsShown = ROWS_PER_PAGE;
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
    const vector = postById[id] && postById[id].vector;
    // nothing → picked → passed → nothing. Every step moves the same post
    // between the two averages, so the ticked box and the taste never disagree.
    if (state.picked.has(id)) {
      state.picked.delete(id); state.passed.add(id);
      if (vector) {
        state.taste.picked = Manicule.unpress(state.taste.picked, vector);
        state.taste.passed = Manicule.press(state.taste.passed, vector);
      }
    } else if (state.passed.has(id)) {
      state.passed.delete(id);
      if (vector) state.taste.passed = Manicule.unpress(state.taste.passed, vector);
    } else {
      state.picked.add(id);
      if (vector) state.taste.picked = Manicule.press(state.taste.picked, vector);
    }
    state.borrowed = false; // the first press makes a borrowed link yours
    draw();                 // the scores change; the order holds
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
    else if (event.target.closest('[data-act="order"]') && posts) {
      orderByTaste();
      state.rowsShown = ROWS_PER_PAGE;
      gliding(() => holdingPlace(null, draw));
      el("list").focus({ preventScroll: true });
    }
  });

  // A plain fragment (#list, from the skip link) is not a state.
  addEventListener("hashchange", () => { if (Shell.isTaste(location.hash)) drawEverything(); });

  // ── boot ─────────────────────────────────────────────────────────────────

  Shell.loadPosts()
    .then((loaded) => {
      posts = loaded;
      for (const post of posts.posts) postById[post.id] = post;

      el("spec").innerHTML = [
        `<span title="${esc(utcStamp(posts.generated))}">updated ${esc(timeAgo(posts.generated))}</span>`,
        `<span>updates once a day</span>`,
        `<span>${posts.feeds.length} feeds, mixed on purpose</span>`,
      ].join(" ");

      drawEverything();
    })
    .catch((why) => {
      // There is nothing behind the controls, so only the status line stays.
      // The reason is printed, because a rendering bug in here used to read
      // exactly like a feed that would not download.
      console.error("manicule:", why);
      el("status").textContent = "couldn't load";
      el("spec").textContent = "";
      el("ledger").classList.add("cold", "dead");
    });
})();
