// shell.js: what every page shares: the theme, the rail, the hand, the
// toast, the printed link. Loads before the page script; exposes window.Shell.
(function () {
  const root = document.documentElement;
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  // ---- the hand. point = pointing left, at the entry beside it. rest = the
  // classic ☞. bird = the same fist with the middle digit up, its own drawing
  // because that is not a rotation of a hand pointing sideways, and with no
  // thumb, because nobody sticks a thumb out to flip the bird.
  const PATHS =
    '<path d="M7.6 11.5 V6 a1.3 1.3 0 0 1 2.6 0 V11"/>' +
    '<path d="M10.2 11 a1.1 1.1 0 0 1 2.2 0 a1.05 1.05 0 0 1 2.1 0 a1 1 0 0 1 1.7 0.5 V17.8 a2.2 2.2 0 0 1 -2.2 2.2 H9.4 a2 2 0 0 1 -2 -2 V11.5"/>' +
    '<path d="M7.4 13.8 a1.4 1.4 0 0 1 -1.7 -0.5"/>';
  const POSE = { rest: "rotate(90 12 12)", point: "rotate(-90 12 12)" };
  const BIRD =
    '<path d="M10.6 12 V7.6 a1.3 1.3 0 0 1 2.6 0 V12"/>' +
    '<path d="M7.4 12 a1.1 1.1 0 0 1 2.2 0"/>' +
    '<path d="M14 12 a1.05 1.05 0 0 1 2.1 0"/>' +
    '<path d="M7.4 12 V17.8 a2.2 2.2 0 0 0 2.2 2.2 H14 a2.1 2.1 0 0 0 2.1 -2.1 V12"/>';
  function hand(pose = "rest", size) {
    const inner = pose === "bird" ? BIRD
      : POSE[pose] ? `<g transform="${POSE[pose]}">${PATHS}</g>` : PATHS;
    const dim = size ? ` width="${size}" height="${size}"` : "";
    return `<svg class="hand-svg" viewBox="0 0 24 24"${dim} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
  }
  // Any element marked data-hand="rest|point|bird" gets the drawing at load.
  for (const el of $$("[data-hand]")) el.innerHTML = hand(el.dataset.hand);

  // ---- theme: a stamped choice wins; otherwise the OS decides. ?theme=dark
  // in the query stamps without persisting (screenshots, links).
  const q = new URLSearchParams(location.search).get("theme");
  if (q === "dark" || q === "light") root.dataset.theme = q;
  function isDark() {
    return root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  }
  // the button is named by the theme a press gives (the rail word says the same)
  function labelTheme() { for (const b of $$(".theme")) b.setAttribute("aria-label", isDark() ? "light" : "dark"); }
  function toggleTheme() {
    root.dataset.theme = isDark() ? "light" : "dark";
    try { localStorage.setItem("manicule-theme", root.dataset.theme); } catch (_) {}
    labelTheme();
  }
  for (const b of $$(".theme")) b.addEventListener("click", toggleTheme);
  labelTheme();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", labelTheme);

  // ---- active nav: the page word from the path. "" and index.html are the feed.
  const file = location.pathname.split("/").pop() || "index.html";
  const page = file.replace(/\.html$/, "").replace(/^index$/, "feed");
  for (const a of $$("[data-page]")) {
    const on = a.dataset.page === page;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }

  // ---- the marks. A hash reads as {m, d, l}; the mirror is this browser's
  // copy of its own marks (localStorage "manicule"); hashOf prints them back
  // as the feed's hash, ids comma-separated so the link stays readable.
  // A feed's key in the url: readable, short, and stable while the feed keeps
  // its name. Sources belong in the link for the same reason marks do: a page
  // narrowed to the four feeds you care about is the whole point, and it
  // should survive a reload and a paste into a message.
  const feedKey = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12);
  function marksIn(hash) {
    const h = new URLSearchParams((hash || "").replace(/^#/, ""));
    return {
      m: (h.get("m") || "").split(",").filter(Boolean),
      d: (h.get("d") || "").split(",").filter(Boolean),
      s: (h.get("s") || "").split(",").filter(Boolean),
      l: h.get("l"),
    };
  }
  function mirror() {
    try { return JSON.parse(localStorage.getItem("manicule") || "null"); } catch (_) { return null; }
  }
  function hashOf(m, d, l, srcKeys) {
    const parts = [];
    if (m.length) parts.push("m=" + m.join(","));
    if (d.length) parts.push("d=" + d.join(","));
    if (srcKeys && srcKeys.length) parts.push("s=" + srcKeys.join(","));
    if (l != null) parts.push("l=" + l);
    return parts.length ? "#" + parts.join("&") : "";
  }
  // the hash is the marks: empty, or #m=…&d=…&l=…. anything else (#main,
  // #list) is a fragment, never a state.
  const isMarks = (h) => h === "" || /^#[mdsl]=/.test(h);
  // a typed address carries no hash; a bookmark may carry only a λ. if this
  // browser has marks, the mirror supplies them before anything reads
  // location.hash (a λ in the hash wins over the mirror's), so the printed
  // link, share and the rail links agree with the feed on every page.
  const here = marksIn(location.hash);
  if (isMarks(location.hash) && !here.m.length && !here.d.length) {
    const saved = mirror() || {}, m = saved.m || [], d = saved.d || [];
    const l = isNaN(lam(here.l)) ? lam(saved.l) : lam(here.l);
    if (m.length || d.length) history.replaceState(null, "", hashOf(m, d, isNaN(l) ? null : l));
  }

  // ---- hash carry-along: marks travel between pages. Every same-site link
  // without a hash of its own gets location.hash appended, now and whenever
  // the hash changes (the feed calls carry() after it rewrites the hash).
  function carry() {
    for (const a of $$("a[href]")) {
      const raw = a.dataset.href || a.getAttribute("href");
      if (/^(https?:|mailto:|#)/.test(raw) || raw.includes("#")) continue;
      a.dataset.href = raw;
      a.setAttribute("href", raw + location.hash);
    }
  }
  carry();
  addEventListener("hashchange", () => { if (isMarks(location.hash)) { carry(); renderAddrs(); } });
  // same-page links (the skip link, "fork it, above") scroll and focus by
  // hand: a fragment in the address bar would replace the marks, read as a
  // new state, and push a history entry with every press.
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest('a[href^="#"]');
    if (!a || ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const el = document.getElementById(a.getAttribute("href").slice(1));
    if (!el) return;
    ev.preventDefault();
    if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
    el.scrollIntoView();
    el.focus({ preventScroll: true });
  });

  // ---- the rail count: the feed page writes it after loading corpus.json;
  // the other pages show the last number seen.
  try {
    const n = localStorage.getItem("manicule-count");
    if (n) for (const el of $$("[data-count]")) el.textContent = n;
  } catch (_) {}

  // ---- toast: one line, role=status, gone in 1.8s. The element is always
  // in the page and empty (a live region has to exist before it speaks);
  // the stylesheet hides it while empty.
  let timer;
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = msg;
    clearTimeout(timer); timer = setTimeout(() => { t.textContent = ""; }, 1800);
  }

  // ---- λ from a hash or a mirror: clamped to 0..1 and snapped to the
  // ruler's 0.05 step so the thumb, the readout and the receipts agree.
  function lam(x) {
    const v = parseFloat(x);
    return isNaN(v) ? NaN : Math.round(Math.min(1, Math.max(0, v)) * 20) / 20;
  }

  // ---- copy: clipboard, true on success
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
  }

  // ---- the address the share button copies, printed on one line in the
  // save door. Same string as share, so the page never shows a link it
  // would not hand you.
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dir = () => location.pathname.replace(/[^/]*$/, "");
  const feedUrl = () => location.origin + dir() + location.hash;
  const address = (hash = location.hash) => location.host + dir() + (hash || "");
  function renderAddrs(hash = location.hash) {
    for (const el of $$("[data-addr]")) el.textContent = address(hash);
  }
  renderAddrs();

  // ---- shared actions: share copies the address (it carries the marks);
  // data-copy copies its own text.
  document.addEventListener("click", async (ev) => {
    const share = ev.target.closest('[data-act="share"]');
    if (share) {
      const { m, d } = marksIn(location.hash);
      if (!m.length && !d.length) return toast("mark something first");
      toast((await copy(feedUrl())) ? "link copied, it carries your marks" : "copy the address bar, it carries your marks");
      return;
    }
    const c = ev.target.closest("[data-copy]");
    if (c) toast((await copy(c.dataset.copy)) ? "copied" : "couldn't copy");
  });

  window.Shell = { hand, toast, carry, renderAddrs, marksIn, mirror, hashOf, lam, isMarks, esc, feedKey };
})();
