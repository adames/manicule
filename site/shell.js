// shell.js — what every page shares: the hand, the theme, the active tab,
// the toast, and the link that carries your marks from page to page.
// Loads before the page's own script and hands it window.Shell.
(function () {
  const root = document.documentElement;
  const all = (selector, within = document) => [...within.querySelectorAll(selector)];

  // ── the hand ─────────────────────────────────────────────────────────────
  // Commonplace's manicule. rest is the classic ☞; point turns it to face the
  // entry beside it. The bird is its own drawing, because a fist with the
  // middle digit up is not a rotation of a fist pointing sideways, and it has
  // no thumb, because nobody sticks a thumb out to flip the bird.

  const MANICULE =
    '<path d="M7.6 11.5 V6 a1.3 1.3 0 0 1 2.6 0 V11"/>' +
    '<path d="M10.2 11 a1.1 1.1 0 0 1 2.2 0 a1.05 1.05 0 0 1 2.1 0 a1 1 0 0 1 1.7 0.5 V17.8 a2.2 2.2 0 0 1 -2.2 2.2 H9.4 a2 2 0 0 1 -2 -2 V11.5"/>' +
    '<path d="M7.4 13.8 a1.4 1.4 0 0 1 -1.7 -0.5"/>';
  const BIRD =
    '<path d="M10.6 12 V7.6 a1.3 1.3 0 0 1 2.6 0 V12"/>' +
    '<path d="M7.4 12 a1.1 1.1 0 0 1 2.2 0"/>' +
    '<path d="M14 12 a1.05 1.05 0 0 1 2.1 0"/>' +
    '<path d="M7.4 12 V17.8 a2.2 2.2 0 0 0 2.2 2.2 H14 a2.1 2.1 0 0 0 2.1 -2.1 V12"/>';
  const TURN = { rest: "rotate(90 12 12)", point: "rotate(-90 12 12)" };

  function hand(pose = "rest", size) {
    const drawing = pose === "bird" ? BIRD : `<g transform="${TURN[pose]}">${MANICULE}</g>`;
    const dimensions = size ? ` width="${size}" height="${size}"` : "";
    return `<svg class="hand-svg" viewBox="0 0 24 24"${dimensions} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawing}</svg>`;
  }
  for (const slot of all("[data-hand]")) slot.innerHTML = hand(slot.dataset.hand);

  // ── the theme ────────────────────────────────────────────────────────────
  // A stamped choice wins; otherwise the reader's system decides. ?theme= in
  // the query stamps without persisting, for screenshots and shared links.

  const asked = new URLSearchParams(location.search).get("theme");
  if (asked === "dark" || asked === "light") root.dataset.theme = asked;

  const isDark = () =>
    root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;

  // Each button is named for the theme a press gives you, not the one you are in.
  function nameThemeButtons() {
    for (const button of all(".theme")) button.setAttribute("aria-label", isDark() ? "light" : "dark");
  }
  for (const button of all(".theme")) {
    button.addEventListener("click", () => {
      root.dataset.theme = isDark() ? "light" : "dark";
      try { localStorage.setItem("manicule-theme", root.dataset.theme); } catch (_) {}
      nameThemeButtons();
    });
  }
  nameThemeButtons();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", nameThemeButtons);

  // ── the active tab ───────────────────────────────────────────────────────

  const file = location.pathname.split("/").pop() || "index.html";
  const thisPage = file.replace(/\.html$/, "").replace(/^index$/, "feed");
  for (const link of all("[data-page]")) {
    const here = link.dataset.page === thisPage;
    link.classList.toggle("active", here);
    if (here) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  // ── the link is the state ────────────────────────────────────────────────
  // A hash reads as {m, d, s, l}: picked ids, passed ids, source keys, λ. The
  // mirror is this browser's own copy of the same thing, so a bare visit comes
  // back to where you were. A feed's key is short and readable, and stays put
  // as long as the feed keeps its name.

  const feedKey = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12);

  function marksIn(hash) {
    const parts = new URLSearchParams((hash || "").replace(/^#/, ""));
    const list = (key) => (parts.get(key) || "").split(",").filter(Boolean);
    return { m: list("m"), d: list("d"), s: list("s"), l: parts.get("l") };
  }

  function hashOf(picked, passed, lambda, sourceKeys) {
    const parts = [];
    if (picked.length) parts.push("m=" + picked.join(","));
    if (passed.length) parts.push("d=" + passed.join(","));
    if (sourceKeys && sourceKeys.length) parts.push("s=" + sourceKeys.join(","));
    if (lambda != null) parts.push("l=" + lambda);
    return parts.length ? "#" + parts.join("&") : "";
  }

  function mirror() {
    try { return JSON.parse(localStorage.getItem("manicule") || "null"); } catch (_) { return null; }
  }

  // λ is clamped to 0..1 and snapped to the ruler's step, so the thumb, the
  // readout and the receipts always agree.
  function lam(value) {
    const n = parseFloat(value);
    return isNaN(n) ? NaN : Math.round(Math.min(1, Math.max(0, n)) * 20) / 20;
  }

  // A hash is either marks or nothing. Anything else (#list, from the skip
  // link) is a fragment, and must never be read as a state.
  const isMarks = (hash) => hash === "" || /^#[mdsl]=/.test(hash);

  // A typed address carries no hash, but this browser may still have marks.
  // Put them back before anything reads location.hash, so the printed address,
  // share, and the links to the other pages all agree with the feed.
  const arriving = marksIn(location.hash);
  if (isMarks(location.hash) && !arriving.m.length && !arriving.d.length) {
    const saved = mirror() || {};
    const picked = saved.m || [], passed = saved.d || [];
    const lambda = isNaN(lam(arriving.l)) ? lam(saved.l) : lam(arriving.l);
    if (picked.length || passed.length) {
      history.replaceState(null, "", hashOf(picked, passed, isNaN(lambda) ? null : lambda));
    }
  }

  // Marks travel between pages: every same-site link picks up the current
  // hash, now and whenever it changes.
  function carry() {
    for (const link of all("a[href]")) {
      const href = link.dataset.href || link.getAttribute("href");
      if (/^(https?:|mailto:|#)/.test(href) || href.includes("#")) continue;
      link.dataset.href = href;
      link.setAttribute("href", href + location.hash);
    }
  }
  carry();

  // The address the share button copies, printed in the first door. It is the
  // same string share hands you, so the page never shows a link it would not.
  const folder = () => location.pathname.replace(/[^/]*$/, "");
  const shareUrl = () => location.origin + folder() + location.hash;
  const address = (hash = location.hash) => location.host + folder() + (hash || "");
  function renderAddrs(hash = location.hash) {
    for (const slot of all("[data-addr]")) slot.textContent = address(hash);
  }
  renderAddrs();

  addEventListener("hashchange", () => {
    if (isMarks(location.hash)) { carry(); renderAddrs(); }
  });

  // Same-page links scroll and focus by hand. Letting the browser do it would
  // put a fragment in the address bar, replacing the marks and pushing a
  // history entry on every press.
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(link.getAttribute("href").slice(1));
    if (!target) return;
    event.preventDefault();
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.scrollIntoView();
    target.focus({ preventScroll: true });
  });

  // ── the entry count in the rail ──────────────────────────────────────────
  // The feed writes it after loading; the other pages show the last one seen.

  try {
    const counted = localStorage.getItem("manicule-count");
    if (counted) for (const slot of all("[data-count]")) slot.textContent = counted;
  } catch (_) {}

  // ── the toast ────────────────────────────────────────────────────────────
  // One line, gone in 1.8 seconds. It lives in the page empty, because a live
  // region has to exist before it can speak; the stylesheet hides it while
  // there is nothing in it.

  let clearToast;
  function toast(words) {
    let box = document.getElementById("toast");
    if (!box) {
      box = document.createElement("div");
      box.id = "toast";
      box.className = "toast";
      box.setAttribute("role", "status");
      document.body.appendChild(box);
    }
    box.textContent = words;
    clearTimeout(clearToast);
    clearToast = setTimeout(() => { box.textContent = ""; }, 1800);
  }

  // ── share and copy ───────────────────────────────────────────────────────

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
  }

  document.addEventListener("click", async (event) => {
    if (event.target.closest('[data-act="share"]')) {
      const { m, d } = marksIn(location.hash);
      if (!m.length && !d.length) return toast("mark something first");
      const copied = await copy(shareUrl());
      toast(copied ? "link copied, it carries your marks" : "copy the address bar, it carries your marks");
      return;
    }
    const button = event.target.closest("[data-copy]");
    if (button) toast((await copy(button.dataset.copy)) ? "copied" : "couldn't copy");
  });

  // Numbers on this site are always signed and always two places, so the
  // receipts line up in a column.
  const signed = (x) => (x < 0 ? "−" : "+") + Math.abs(x).toFixed(2);
  const plain = (x) => (x < 0 ? "−" : "") + Math.abs(x).toFixed(2);

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  window.Shell = { hand, toast, carry, renderAddrs, marksIn, mirror, hashOf, lam, isMarks, esc, feedKey, signed, plain };
})();
