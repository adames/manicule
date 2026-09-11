// shell.js — what every page shares: the hand, the theme, the active tab,
// the toast, and the link that carries your taste from page to page.
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
  const thisPage = file.replace(/\.html$/, "").replace(/^index$/, "pool");
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

  function tasteIn(hash) {
    const parts = new URLSearchParams((hash || "").replace(/^#/, ""));
    const list = (key) => (parts.get(key) || "").split(",").filter(Boolean);
    return {
      m: list("m"), d: list("d"), s: list("s"), l: parts.get("l"),
      v: parts.get("v") || "", w: parts.get("w") || "", k: parts.get("k") || "",
    };
  }

  // Order matters only to the eye: the short readable parts first, then the
  // two long averages, so a glance at the address bar still shows the λ.
  const KEYS = ["m", "d", "s", "l", "v", "w", "k"];

  function hashOf(taste) {
    const parts = [];
    for (const key of KEYS) {
      const value = taste[key];
      if (value == null || value === "" || (Array.isArray(value) && !value.length)) continue;
      parts.push(key + "=" + (Array.isArray(value) ? value.join(",") : value));
    }
    return parts.length ? "#" + parts.join("&") : "";
  }

  // ── the data ─────────────────────────────────────────────────────────────
  // posts.json is the words; vectors.bin is the numbers, int8, 384 per post,
  // in the same order. Both come down, and every post gets a .vector or null.
  function loadPosts() {
    const noCache = { cache: "no-cache" };
    return Promise.all([
      fetch("posts.json", noCache).then((r) => r.json()),
      fetch("vectors.bin", noCache).then((r) => r.arrayBuffer()),
    ]).then(([data, buffer]) => {
      const block = new Int8Array(buffer), dim = data.dim;
      data.posts.forEach((post, i) => {
        post.vector = "s" in post ? Manicule.dequantize(block.subarray(i * dim, (i + 1) * dim), post.s) : null;
      });
      // The labels follow the posts in the same file: what a taste can be about.
      const n = data.posts.length;
      data.labels = (data.labels || []).map((label, i) => ({
        text: label.t, vector: Manicule.dequantize(block.subarray((n + i) * dim, (n + i + 1) * dim), label.s),
      }));
      try { localStorage.setItem("manicule-count", data.posts.length); } catch (_) {}
      for (const slot of all("[data-count]")) slot.textContent = data.posts.length;
      return data;
    });
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

  // A hash is either a taste or nothing. Anything else (#list, from the skip
  // link) is a fragment, and must never be read as a state.
  const isTaste = (hash) => hash === "" || /^#[mdslvwk]=/.test(hash);

  // A typed address carries no hash, but this browser may still hold a taste.
  // Put them back before anything reads location.hash, so the printed address,
  // share, and the links to the other pages all agree with the feed.
  const arriving = tasteIn(location.hash);
  if (isTaste(location.hash) && !arriving.m.length && !arriving.d.length && !arriving.v && !arriving.w) {
    const saved = mirror() || {};
    const lambda = isNaN(lam(arriving.l)) ? lam(saved.l) : lam(arriving.l);
    const back = {
      m: saved.m || [], d: saved.d || [], v: saved.v || "", w: saved.w || "",
      k: saved.k || "", l: isNaN(lambda) ? null : lambda,
    };
    if (back.m.length || back.d.length || back.v || back.w) {
      history.replaceState(null, "", hashOf(back));
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

  addEventListener("hashchange", () => {
    if (isTaste(location.hash)) carry();
  });

  // Same-page links scroll and focus by hand. Letting the browser do it would
  // put a fragment in the address bar, replacing the taste and pushing a
  // history step on every press.
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

  // ── the post count on the feed tab ─────────────────────────────────────
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

  // ── copy ─────────────────────────────────────────────────────────────────

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { return false; }
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (button) toast((await copy(button.dataset.copy)) ? "copied" : "couldn't copy");
  });

  // Numbers on this site are always signed and always two places, so the
  // receipts line up in a column.
  const signed = (x) => (x < 0 ? "−" : "+") + Math.abs(x).toFixed(2);
  const plain = (x) => (x < 0 ? "−" : "") + Math.abs(x).toFixed(2);

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  window.Shell = { hand, toast, carry, loadPosts, tasteIn, mirror, hashOf, lam, isTaste, esc, feedKey, signed, plain };
})();
