/* =============================================================================
   main.js — site shell only.
   Deliberately small. The Interview My Work workspace is a separate chunk and
   is not fetched until someone asks for it.
   ========================================================================== */

const THEME_KEY = "ba-theme";

/* ---------- theme ------------------------------------------------------- */
(function theme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* private mode */ }
  if (saved === "dark" || saved === "light") {
    document.documentElement.setAttribute("data-theme", saved);
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-toggle]");
    if (!btn) return;
    const cur = document.documentElement.getAttribute("data-theme");
    const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const next = cur ? (cur === "dark" ? "light" : "dark") : (sysDark ? "light" : "dark");
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
  });
})();

/* ---------- ledger counts, read from the evidence db --------------------
   The numbers in the HTML are the correct ones at build time. This reconciles
   them with claims.json at runtime so the page can never drift from the data.
   If the fetch fails the static numbers stand.                              */
(function ledger() {
  const cells = document.querySelectorAll("[data-count]");
  const stamp = document.querySelector('[data-stamp="verified-on"]');
  if (!cells.length && !stamp) return;
  fetch("evidence/claims.json")
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((db) => {
      const tally = {
        verified: db.claims.filter((c) => c.verification_status === "VERIFIED").length,
        repos: Object.keys(db.meta.repos || {}).length,
      };
      for (const el of cells) {
        const v = tally[el.dataset.count];
        if (typeof v === "number") el.textContent = String(v);
      }
      if (stamp && db.meta.last_full_verification) {
        stamp.textContent = db.meta.last_full_verification;
      }
    })
    .catch(() => { /* static values remain */ });
})();

/* ---------- floating control, after the reader has committed ------------- */
(function fab() {
  const el = document.querySelector("[data-imw-fab]");
  if (!el) return;
  const onScroll = () => {
    el.dataset.shown = String(window.scrollY > window.innerHeight * 0.9);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();

/* ---------- lazy-load the workspace -------------------------------------- */
let workspace = null;
let loading = null;

async function openWorkspace(opts = {}) {
  if (!workspace) {
    if (!loading) {
      loading = (async () => {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = "imw/workspace.css";
        document.head.appendChild(css);
        const mod = await import("../../imw/workspace.js");
        workspace = await mod.create(document.getElementById("imw-root"));
        return workspace;
      })();
    }
    try {
      await loading;
    } catch (err) {
      loading = null;
      // Failing to load the AI layer must never break the site.
      console.warn("Interview My Work failed to load:", err);
      window.location.hash = "#work";
      return;
    }
  }
  workspace.open(opts);
}

document.addEventListener("click", (e) => {
  const trigger = e.target.closest("[data-imw-open]");
  if (!trigger) return;
  e.preventDefault();
  openWorkspace({
    tab: trigger.dataset.imwTab || null,
    project: trigger.dataset.imwProject || null,
  });
});

/* ---------- shareable deep links: #imw=role:ai_eval ---------------------- */
function readHash() {
  const h = window.location.hash || "";
  const m = h.match(/^#imw=(?:role:([a-z0-9_]+)|project:([a-z0-9_]+)|([a-z]+))$/i);
  if (!m) return null;
  if (m[1]) return { tab: "rolefit", role: m[1].toLowerCase() };
  if (m[2]) return { tab: "xray", project: m[2].toLowerCase() };
  return { tab: m[3].toLowerCase() };
}

const initial = readHash();
if (initial) openWorkspace(initial);

window.addEventListener("hashchange", () => {
  const h = readHash();
  if (h) openWorkspace(h);
});
