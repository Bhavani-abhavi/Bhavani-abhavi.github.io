/* =============================================================================
   workspace.js: Interview My Work.
   Six tabs over one evidence engine. No chat-bubble styling, no typing
   animation, no hidden reasoning surfaced anywhere.
   ========================================================================== */

import * as E from "./engine.js";
import { ROLES, PERSONAS, XRAY, FAILURES, CONSTRAINTS, ATTACKS } from "./data.js";
import { sanitiseInput, MAX_JD, detectInjection } from "./validators.js";

/* ---------- tiny DOM helpers ------------------------------------------- */
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};
const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

const TABS = [
  ["ask", "Ask"],
  ["rolefit", "Role fit"],
  ["xray", "X-Ray"],
  ["map", "Map"],
  ["prooflab", "Proof Lab"],
  ["brief", "Brief"],
];

const VERDICT_CLASS = {
  "DIRECTLY DEMONSTRATED": "direct",
  "SUPPORTED BY ADJACENT EXPERIENCE": "adjacent",
  "NOT CURRENTLY DEMONSTRATED": "not",
  "INSUFFICIENT EVIDENCE": "none",
};

const STATE_CHIP = {
  VERIFIED: ["chip--ok", "verified"],
  VERIFICATION_REQUIRED: ["chip--review", "needs verification"],
  UNSUPPORTED: ["chip--gap", "unsupported"],
  DEPRECATED: ["chip--gap", "deprecated"],
};

/* =============================================================================
   create()
   ========================================================================== */
export async function create(mount) {
  await E.loadDb("evidence/claims.json").catch(() => E.loadDb("../evidence/claims.json"));

  const state = {
    tab: "ask",
    persona: "recruiter",
    role: null,
    project: "sfd",
    component: null,
    constraint: null,
    focus: null,
    labIdx: 0,
    lab: null,
    thread: [],
    lastFocused: null,
  };

  /* ---------- shell --------------------------------------------------- */
  const body = h("div", { class: "imw__body" });
  const tabBar = h("div", { class: "imw__tabs", role: "tablist", "aria-label": "Interview My Work sections" });
  const foot = h("div", { class: "imw__foot" });

  const panel = h("div", { class: "imw", role: "dialog", "aria-modal": "true", "aria-label": "Interview My Work" },
    h("div", { class: "imw__head" },
      h("div", {},
        h("h2", { class: "imw__title" }, "Interview My Work ", h("span", {}, "✦")),
        h("p", { class: "imw__sub" }, "evidence engine · 44 claims · pinned to commit · last verified 2026-09-25"),
      ),
      h("button", { class: "imw__x", type: "button", "aria-label": "Close", onClick: close }, "✕"),
    ),
    tabBar, body, foot,
  );

  const scrim = h("div", { class: "imw-scrim", hidden: true }, panel);
  scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) close(); });
  mount.append(scrim);

  for (const [id, label] of TABS) {
    tabBar.append(h("button", {
      class: "imw__tab", type: "button", role: "tab", id: `imw-tab-${id}`,
      "aria-selected": String(id === state.tab),
      onClick: () => setTab(id),
    }, label));
  }

  /* ---------- open / close / a11y -------------------------------------- */
  function open(opts = {}) {
    state.lastFocused = document.activeElement;
    scrim.hidden = false;
    requestAnimationFrame(() => { scrim.dataset.open = "true"; });
    document.body.style.overflow = "hidden";
    if (opts.project) { state.project = opts.project; state.component = null; }
    if (opts.role) { state.role = ROLES.find((r) => r.id === opts.role) ? opts.role : state.role; }
    setTab(opts.tab && TABS.some(([t]) => t === opts.tab) ? opts.tab : (opts.project ? "xray" : opts.role ? "rolefit" : state.tab));
    panel.querySelector(".imw__tab[aria-selected='true']")?.focus();
  }

  function close() {
    scrim.dataset.open = "false";
    document.body.style.overflow = "";
    setTimeout(() => { scrim.hidden = true; }, 180);
    state.lastFocused?.focus?.();
  }

  document.addEventListener("keydown", (e) => {
    if (scrim.hidden) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = panel.querySelectorAll('a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  /* ---------- tab routing ---------------------------------------------- */
  function setTab(id) {
    state.tab = id;
    for (const b of tabBar.children) b.setAttribute("aria-selected", String(b.id === `imw-tab-${id}`));
    clear(body); clear(foot);
    ({ ask: renderAsk, rolefit: renderRoleFit, xray: renderXray,
       map: renderMap, prooflab: renderLab, brief: renderBrief }[id])();
    body.scrollTop = 0;
  }

  /* =========================================================================
     Shared renderers
     ====================================================================== */

  function evidenceList(cites, summaryLabel = "Why this answer?") {
    if (!cites.length) return null;
    const items = h("div", { class: "ev__items" });
    for (const c of cites) {
      const [cls, word] = STATE_CHIP[c.verification_status] || ["chip--plain", c.verification_status];
      items.append(h("div", { class: "ev__item" },
        h("div", { class: "ev__top" },
          h("span", { class: `chip ${cls}` }, word),
          h("span", { class: "ev__id" }, c.id),
          c.project_or_experience && h("span", { class: "ev__id" }, `· ${c.project_or_experience}`),
        ),
        h("p", { class: "ev__claim" }, c.claim),
        c.verification_note && h("p", { class: "ev__note" }, c.verification_note),
        h("div", { class: "ev__links" },
          c.exact_code_link && h("a", { href: c.exact_code_link, target: "_blank", rel: "noopener" }, "Show code"),
          c.artifact_link && h("a", { href: c.artifact_link, target: "_blank", rel: "noopener" }, "Artifact"),
          c.commit_sha && h("span", { class: "ev__id" }, `@ ${c.commit_sha.slice(0, 10)}`),
          !c.exact_code_link && !c.commit_sha && h("span", { class: "ev__id" }, "no public artifact, self-reported"),
        ),
      ));
    }
    return h("details", { class: "ev", open: cites.length <= 3 },
      h("summary", {}, `${summaryLabel} (${cites.length} source${cites.length === 1 ? "" : "s"})`), items);
  }

  /* =========================================================================
     ASK
     ====================================================================== */

  const STARTERS = [
    "What has Bhavani actually shipped?",
    "Show me her strongest retrieval work.",
    "What has she done beyond LLM wrappers?",
    "How does she evaluate AI systems?",
    "Show me evidence of her data engineering.",
    "What failure did she identify and fix?",
    "Where has she used vector search?",
    "What are the gaps in this portfolio?",
    "Does she have Kubernetes experience?",
    "Evaluate her for a role.",
  ];

  function renderAsk() {
    const pane = h("div", { class: "imw__pane" });

    if (!state.thread.length) {
      const lenses = h("div", { class: "lenses" });
      for (const [id, p] of Object.entries(PERSONAS)) {
        lenses.append(h("button", {
          class: "lens", type: "button", "aria-pressed": String(state.persona === id),
          title: p.hint,
          onClick: () => { state.persona = id; renderAsk(); },
        }, p.label));
      }
      const starters = h("div", { class: "starters" });
      for (const s of STARTERS) {
        starters.append(h("button", { class: "starter", type: "button", onClick: () => submit(s) }, s));
      }
      pane.append(h("div", { class: "imw-welcome" },
        h("h3", {}, "Interview My Work"),
        h("p", {}, "Ask about projects, engineering decisions, experience, evidence, or how this background maps to a role. Every factual answer carries its sources, and answers that fail their own output checks are replaced with the raw evidence rather than patched."),
        h("h4", {}, "Reading as"),
        lenses,
        h("p", { class: "muted", style: "margin-bottom:var(--s5)" }, "Changes the depth and framing. Never the facts."),
        h("h4", {}, "Start here"),
        starters,
      ));
    } else {
      const thread = h("div", { class: "thread" });
      for (const t of state.thread) thread.append(renderTurn(t));
      pane.append(thread);
    }

    clear(body).append(pane);
    renderComposer();
    if (state.thread.length) body.scrollTop = body.scrollHeight;
  }

  function renderTurn(t) {
    const wrap = h("div", {});
    wrap.append(h("p", { class: "turn--q" }, t.q));
    const a = h("div", { class: "turn--a" });

    if (t.res.injectionNote) {
      a.append(h("div", { class: "banner" }, t.res.injectionNote));
    }

    for (const b of t.res.blocks) {
      if (b.kind === "verdict") {
        a.append(h("span", { class: `verdict verdict--${VERDICT_CLASS[b.verdict] || "none"}` }, b.verdict));
        a.append(h("p", {}, b.text));
      } else if (b.kind === "note") {
        a.append(h("p", { class: "note" }, b.text));
      } else if (b.kind === "failures") {
        for (const f of b.failures) a.append(failureCard(f));
      } else if (b.kind === "open_xray") {
        a.append(h("p", {}, h("button", {
          class: "btn btn--ghost", type: "button",
          onClick: () => { state.project = b.project; state.component = null; setTab("xray"); },
        }, `Open ${XRAY[b.project].title} X-Ray →`)));
      } else if (b.text) {
        a.append(h("p", {}, b.text));
      }
    }

    const ev = evidenceList(t.res.citations);
    if (ev) a.append(ev);

    if (t.res.fellBack) {
      a.append(h("p", { class: "note" }, "This answer was replaced by its evidence because the composed version failed validation. That is the designed behaviour, not an error."));
    }
    wrap.append(a);
    return wrap;
  }

  function failureCard(f) {
    return h("div", { class: "xr-detail", style: "margin-top:var(--s4)" },
      h("h5", {}, f.title),
      h("dl", {},
        h("dt", {}, "Broke"), h("dd", {}, f.broke),
        h("dt", {}, "Detected"), h("dd", {}, f.detected),
        h("dt", {}, "Measured"), h("dd", {}, f.measured),
        h("dt", {}, "Fixed"), h("dd", {}, f.fixed),
        h("dt", {}, "Prevented"), h("dd", {}, f.prevented),
      ),
      evidenceList(E.claims(f.claims), "Evidence"),
    );
  }

  function renderComposer() {
    const ta = h("textarea", {
      id: "imw-q", rows: 1, placeholder: "Ask about the work, or paste a job description…",
      "aria-label": "Your question",
      onInput: (e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; },
      onKeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(ta.value); ta.value = ""; ta.style.height = "auto"; }
      },
    });
    clear(foot).append(
      h("div", { class: "composer" }, ta,
        h("button", { class: "btn btn--primary", type: "button", onClick: () => { submit(ta.value); ta.value = ""; } }, "Ask")),
      h("p", { class: "imw__fine" },
        h("span", {}, `Lens: ${PERSONAS[state.persona].label}`),
        h("span", {}, "Answers run in your browser. Nothing you type is stored or sent."),
        h("a", { href: "#", onClick: (e) => { e.preventDefault(); showMcp(); } }, "Connect your AI →"),
        state.thread.length ? h("a", { href: "#", onClick: (e) => { e.preventDefault(); state.thread = []; renderAsk(); } }, "Clear") : null,
      ),
    );
  }

  function submit(raw) {
    const q = sanitiseInput(raw);
    if (!q) return;
    if (q.length > 400 && /responsibilit|qualificat|requirement|you will|we are looking/i.test(q)) {
      state.jdText = q; setTab("rolefit"); runJD(q); return;
    }
    const res = E.ask(q, state.persona);
    state.thread.push({ q, res });
    renderAsk();
  }

  /* =========================================================================
     ROLE FIT
     ====================================================================== */

  let jdResult = null;

  function renderRoleFit() {
    const list = h("div", { class: "rolelist" });
    for (const r of ROLES) {
      list.append(h("button", {
        type: "button", "aria-pressed": String(state.role === r.id),
        onClick: () => { state.role = r.id; jdResult = null; renderRoleFit(); },
      }, r.label));
    }

    const right = h("div", {});
    const pane = h("div", { class: "imw__pane imw__pane--split" },
      h("div", {}, h("h4", {}, "Target roles"), list,
        h("p", { class: "muted", style: "margin-top:var(--s4)" }, "Or paste a job description below."),
      ),
      right,
    );

    if (jdResult) {
      renderMapping(right, jdResult.rows, jdResult.counts, {
        title: "Job description analysis",
        sub: jdResult.nearestRole ? `Closest role family in the evidence model: ${jdResult.nearestRole.label}.` : "No close role family matched.",
        extracted: jdResult.extracted,
      });
    } else if (state.role) {
      const m = E.mapRole(state.role);
      renderMapping(right, m.rows, m.counts, { title: m.role.label, questions: m.questions, roleId: m.role.id });
    } else {
      right.append(
        h("h4", {}, "Paste a job description"),
        h("p", { class: "muted", style: "margin-bottom:var(--s4)" }, "Requirements are extracted, synonyms normalised, and each one mapped to direct evidence, related evidence, or nothing. There is no match percentage because I cannot evidence one."),
        jdBox(),
      );
    }

    clear(body).append(pane);
    clear(foot).append(h("p", { class: "imw__fine" },
      h("span", {}, "Nothing you paste is stored, logged, or transmitted."),
      state.role || jdResult ? h("a", { href: "#", onClick: (e) => { e.preventDefault(); state.role = null; jdResult = null; renderRoleFit(); } }, "Reset") : null,
    ));
  }

  function jdBox() {
    const ta = h("textarea", { class: "jd-input", id: "imw-jd", placeholder: "Paste the full job description…", "aria-label": "Job description" });
    return h("div", {}, ta,
      h("div", { class: "rowgap", style: "margin-top:var(--s3)" },
        h("button", { class: "btn btn--primary", type: "button", onClick: () => runJD(ta.value) }, "Analyse"),
        h("span", { class: "muted" }, `Max ${MAX_JD.toLocaleString()} characters.`),
      ));
  }

  function runJD(text) {
    const clean = sanitiseInput(text, MAX_JD);
    const inj = detectInjection(clean);
    jdResult = E.analyseJD(clean);
    if (!jdResult) {
      jdResult = null;
      state.role = null;
      renderRoleFit();
      const r = body.querySelector(".imw__pane--split > div:last-child");
      r?.prepend(h("div", { class: "banner" }, "That text was too short to extract requirements from. Paste the full posting."));
      return;
    }
    jdResult.injection = inj.detected;
    state.role = null;
    renderRoleFit();
  }

  function renderMapping(container, rows, counts, opts) {
    container.append(h("h4", {}, opts.title));
    if (opts.sub) container.append(h("p", { class: "muted", style: "margin-bottom:var(--s4)" }, opts.sub));
    if (jdResult?.injection) {
      container.append(h("div", { class: "banner" }, "That job description contained text shaped like an instruction to me. I extracted requirements from it and ignored the instruction."));
    }

    container.append(h("div", { class: "tally" },
      h("div", { class: "tally__ok" }, h("b", {}, counts.direct), "direct evidence"),
      h("div", { class: "tally__adj" }, h("b", {}, counts.adjacent), "related evidence"),
      h("div", { class: "tally__no" }, h("b", {}, counts.none), "not demonstrated"),
      opts.extracted ? h("div", {}, h("b", {}, opts.extracted), "requirements extracted") : null,
    ));

    const tbody = h("tbody", {});
    for (const r of rows) {
      const cls = VERDICT_CLASS[r.verdict] || "none";
      const ev = h("td", { class: "reqs__ev" });
      if (r.evidence.length) {
        for (const e of r.evidence.slice(0, 2)) {
          ev.append(h("div", {},
            h("a", { href: e.exact_code_link || e.artifact_link || "#", target: "_blank", rel: "noopener" }, e.id),
            " ", e.project_or_experience || "",
          ));
        }
      } else if (r.gaps.length) {
        ev.append(h("div", {}, r.gaps[0].verification_note?.slice(0, 160) || "No public artifact."));
      } else {
        ev.append(h("div", {}, "No claim in the evidence database matches this requirement."));
      }
      tbody.append(h("tr", { "data-core": String(!!r.core) },
        h("td", {}, r.tag),
        h("td", {}, h("span", { class: `verdict verdict--${cls}` }, r.verdict)),
        ev,
      ));
    }

    container.append(h("div", { class: "tablewrap" },
      h("table", { class: "reqs" },
        h("thead", {}, h("tr", {}, h("th", {}, "Requirement"), h("th", {}, "Evidence state"), h("th", {}, "Source"))),
        tbody)));

    const actions = h("div", { class: "rowgap", style: "margin-top:var(--s5)" });
    if (opts.roleId) {
      actions.append(
        h("button", { class: "btn btn--primary", type: "button", onClick: () => applyFocus(opts.roleId) }, "Show on portfolio"),
        h("button", { class: "btn btn--ghost", type: "button", onClick: () => { state.role = opts.roleId; setTab("brief"); } }, "Interview brief →"),
        h("button", { class: "btn btn--ghost", type: "button", onClick: () => copyLink(opts.roleId) }, "Copy shareable link"),
      );
    }
    container.append(actions);

    if (opts.questions?.length) {
      container.append(h("h4", { style: "margin-top:var(--s6)" }, "Worth validating in an interview"),
        h("ol", { style: "padding-left:1.2em" }, ...opts.questions.map((q) => h("li", { style: "margin-bottom:var(--s2);font-size:var(--t-sm);color:var(--ink-2)" }, q))));
    }

    container.append(h("p", { class: "note" }, "No match percentage is produced. Direct and related evidence are kept separate on purpose, because adjacent experience is not converted into direct experience anywhere in this tool."));
  }

  function copyLink(roleId) {
    const url = `${location.origin}${location.pathname}#imw=role:${roleId}`;
    navigator.clipboard?.writeText(url).then(
      () => alert(`Copied:\n${url}`),
      () => prompt("Copy this link:", url),
    );
  }

  /* ---------- SHOW ON PORTFOLIO ---------------------------------------- */

  function applyFocus(roleId) {
    const role = ROLES.find((r) => r.id === roleId);
    if (!role) return;
    const wanted = new Set([...role.core, ...role.also]);
    state.focus = roleId;
    document.body.dataset.focus = roleId;

    const targets = document.querySelectorAll("[data-tags]");
    const hits = [];
    for (const el of targets) {
      const tags = (el.dataset.tags || "").split(",").map((s) => s.trim());
      const hit = tags.some((t) => wanted.has(t));
      el.classList.toggle("focus-dim", !hit);
      el.classList.toggle("focus-hit", hit);
      if (hit) hits.push(el);
    }

    // reorder projects so the most relevant come first; nothing is removed
    const container = document.querySelector(".projects");
    if (container) {
      const arts = [...container.querySelectorAll(".project")];
      arts
        .map((el) => {
          const tags = (el.dataset.tags || "").split(",").map((s) => s.trim());
          const score = tags.filter((t) => wanted.has(t)).length
            + tags.filter((t) => role.core.includes(t)).length * 2;
          return { el, score };
        })
        .sort((a, b) => b.score - a.score)
        .forEach(({ el }) => container.append(el));
    }

    mountFocusBar(role, hits.length);
    close();
  }

  function mountFocusBar(role, n) {
    const slot = document.getElementById("focusbar-slot");
    if (!slot) return;
    clear(slot).append(h("div", { class: "focusbar" },
      h("div", { class: "wrap focusbar__inner" },
        h("span", {}, "Portfolio reorganised for ", h("strong", {}, role.label), ". ",
          `${n} section${n === 1 ? "" : "s"} emphasised. Nothing has been removed or changed, only reordered and dimmed.`),
        h("button", { type: "button", onClick: restoreFocus }, "Restore portfolio"),
      )));
  }

  function restoreFocus() {
    state.focus = null;
    delete document.body.dataset.focus;
    for (const el of document.querySelectorAll("[data-tags]")) el.classList.remove("focus-dim", "focus-hit");
    clear(document.getElementById("focusbar-slot"));
    if (location.hash.startsWith("#imw=")) history.replaceState(null, "", location.pathname);
  }

  /* =========================================================================
     X-RAY
     ====================================================================== */

  function renderXray() {
    const x = XRAY[state.project];
    const sel = h("div", { class: "constraints", style: "margin-bottom:var(--s5)" });
    for (const [k, v] of Object.entries(XRAY)) {
      sel.append(h("button", {
        type: "button", "aria-pressed": String(state.project === k),
        onClick: () => { state.project = k; state.component = null; state.constraint = null; renderXray(); },
      }, v.title));
    }

    const flow = h("div", { class: "xr-flow" });
    const seen = new Set();
    for (const [from, to] of x.flow) {
      for (const n of [from, to]) {
        if (seen.has(n)) continue;
        seen.add(n);
        const comp = x.components.find((c) => c.id === n);
        flow.append(h("button", {
          class: "xr-node", type: "button",
          "aria-pressed": String(state.component === n),
          title: comp ? "Inspect this component" : "Stage, no separate component record",
          onClick: () => { state.component = comp ? n : null; renderXray(); },
        }, n));
      }
    }

    const detail = h("div", {});
    const comp = x.components.find((c) => c.id === state.component) || x.components[0];
    detail.append(componentCard(comp, x));

    const pane = h("div", { class: "imw__pane" },
      h("h4", {}, "Project"), sel,
      h("h5", {}, x.title),
      h("p", { class: "muted", style: "margin-bottom:var(--s4)" }, x.summary),
      x.provenance ? h("div", { class: "banner" }, x.provenance) : null,
      h("h4", {}, "Components, click to inspect"), flow,
      detail,
      decisionsBlock(x),
      stressBlock(x),
      failuresBlock(),
    );

    clear(body).append(pane);
    clear(foot).append(h("p", { class: "imw__fine" },
      h("span", {}, `Pinned @ ${x.sha.slice(0, 12)}`),
      h("a", { href: x.repo, target: "_blank", rel: "noopener" }, "Open repository →"),
    ));
  }

  function componentCard(c, x) {
    if (!c) return h("p", { class: "muted" }, "Select a component.");
    return h("div", { class: "xr-detail" },
      h("h5", {}, c.name),
      h("dl", {},
        h("dt", {}, "What"), h("dd", {}, c.what),
        h("dt", {}, "Why"), h("dd", {}, c.why),
        h("dt", {}, "Input"), h("dd", {}, c.input),
        h("dt", {}, "Output"), h("dd", {}, c.output),
        h("dt", {}, "Observed"), h("dd", {}, c.observed),
        h("dt", {}, "Path"), h("dd", {}, h("a", {
          href: `${x.repo}/blob/${x.sha}/${c.path}`.replace("/blob/" + x.sha + "/" + c.path.replace(/\/$/, "") + "/", `/tree/${x.sha}/${c.path}`),
          target: "_blank", rel: "noopener",
        }, c.path)),
      ),
      evidenceList(E.claims(c.claims), "Evidence"),
    );
  }

  function decisionsBlock(x) {
    const wrap = h("div", { style: "margin-top:var(--s6)" }, h("h4", {}, "Design decisions"));
    for (const d of x.decisions) {
      wrap.append(h("details", { class: "ev" },
        h("summary", {}, d.q),
        h("p", { style: "margin-top:var(--s3);max-width:70ch" }, d.a),
        evidenceList(E.claims(d.claims), "Evidence"),
      ));
    }
    return wrap;
  }

  /* ---------- STRESS THIS ARCHITECTURE --------------------------------- */

  const STRESS = {
    traffic100: {
      breaks: "The single-process scoring path. Windowing and detector computation are synchronous and CPU-bound; at 100× they become the queue.",
      proposal: [
        "Split scoring from detection: scoring goes behind a horizontally replicated service, detection becomes a scheduled batch job",
        "A work queue between them so a detection backlog never blocks inference",
        "Detector state kept per-window in object storage rather than in process memory",
      ],
      tradeoff: "Detection latency rises from seconds to minutes. Given the measured finding, that these signals carry information in their trajectory rather than their level, minutes is acceptable and seconds bought nothing.",
      demonstrated: ["Docker and docker-compose", "GitHub Actions CI", "Packaged Python with enforced module boundaries"],
      notDemonstrated: ["Horizontal autoscaling", "Message queues in production", "Load testing of any kind"],
    },
    traffic10: {
      breaks: "Nothing structural. The backtest already processes 35 windows over a million rows offline.",
      proposal: ["Vertical scaling and a scheduled run would likely cover it", "Add a per-window cache keyed on the reference-window hash"],
      tradeoff: "Least-change option. Worth doing before any of the 100× work, because the 100× design is speculative and this is not.",
      demonstrated: ["Batch processing over 1,054,948 rows"],
      notDemonstrated: ["Production traffic of any volume"],
    },
    docs10m: {
      breaks: "ClinIQ's pgvector store holds 122 embeddings over 10 documents. At 10M it needs an approximate index and a different ingestion path.",
      proposal: [
        "HNSW or IVFFlat index on the embedding column rather than exact search",
        "Batch embedding with a separate ingestion worker",
        "Hybrid retrieval: BM25 prefilter then vector rerank, to keep recall without scanning everything",
      ],
      tradeoff: "Approximate indexes trade recall for latency, which matters here: the embedding tier's whole value in the measured comparison was recall 1.000. Any ANN index must be evaluated against that number, not assumed harmless.",
      demonstrated: ["pgvector with vector(384)", "Measured precision/recall across three retrieval tiers"],
      notDemonstrated: ["ANN indexes at scale", "Hybrid BM25 + vector retrieval in production"],
    },
    latency200: {
      breaks: "The RAG tier. It took 1772 seconds for the evaluation set, roughly 3 s per item against a 0.2 s budget.",
      proposal: [
        "Serve the rule tier synchronously inside budget and run the RAG tier asynchronously",
        "Cache retrieved passages by query embedding",
        "Use the rule tier as a gate so only ambiguous cases reach the LLM",
      ],
      tradeoff: "The rule tier measured 0.861 precision and 0.847 recall, better balance than the RAG tier anyway. This is a case where the latency constraint and the quality evidence point the same way.",
      demonstrated: ["Measured per-tier elapsed time"],
      notDemonstrated: ["Production p95 latency work outside the self-reported employer context"],
    },
    hipaa: {
      breaks: "Any external LLM API call. ClinIQ avoided this by using only public review data and public guidance documents, so it was never a constraint that had to be solved.",
      proposal: [
        "Self-hosted model, or a BAA-covered endpoint with no training retention",
        "De-identification before any text leaves the trust boundary",
        "Audit log on every retrieval, and the source_url-per-embedding design already does half of this",
        "Row-level access control in PostgreSQL rather than at the application layer",
      ],
      tradeoff: "Self-hosting a model large enough to match Claude's precision is expensive. Given the measured result that the rule tier was competitive, a HIPAA deployment might legitimately skip the LLM tier entirely.",
      demonstrated: ["Public-data-only design", "Per-embedding source attribution", "No PHI in any repository"],
      notDemonstrated: ["Deploying inside a HIPAA boundary", "BAA-covered infrastructure", "De-identification pipelines"],
    },
    no_api: {
      breaks: "The Claude tier disappears entirely.",
      proposal: [
        "Local encoder model for the embedding tier, already all-MiniLM-L6-v2, which runs locally",
        "Fine-tuned local classifier in place of the LLM tier, which is exactly what the churn project does with BERT",
        "Keep the rule tier as the gate and the floor",
      ],
      tradeoff: "Loses the RAG tier's 0.938 precision. Given it also had 0.400 recall, this is a smaller loss than it sounds.",
      demonstrated: ["Local embeddings", "Fine-tuned BERT classifier", "Rule baseline"],
      notDemonstrated: ["Self-hosted generative inference"],
    },
    cost: {
      breaks: "The RAG tier's 29-minute evaluation run is the cost centre.",
      proposal: ["Gate the LLM behind the rule tier", "Cache by content hash", "Batch API calls rather than per-item"],
      tradeoff: "The measured comparison already suggests the cheap tier is the better default. The cost constraint mostly forces a decision the evidence supports anyway.",
      demonstrated: ["Per-tier cost measured in wall-clock time"],
      notDemonstrated: ["Cost modelling in production"],
    },
    multiregion: { breaks: "Nothing in the portfolio is deployed at all, so this is entirely hypothetical.",
      proposal: ["Read replicas per region for the vector store", "Region-local embedding, centralised index build"],
      tradeoff: "Consistency of the index across regions versus retrieval latency.",
      demonstrated: [], notDemonstrated: ["Any multi-region deployment"] },
    ha: { breaks: "No availability target has ever been set or measured on this work.",
      proposal: ["Stateless scoring replicas behind a load balancer", "Detection as a retryable job", "Degrade to the rule tier when the LLM provider is unavailable"],
      tradeoff: "The degradation path is the interesting part and it mirrors what this very portfolio does: the evidence engine keeps working when the AI layer does not.",
      demonstrated: ["Deterministic fallback implemented in this site"], notDemonstrated: ["99.9% availability in production"] },
    offline: { breaks: "Any API-dependent tier.",
      proposal: ["Local embeddings plus rule tier only", "Ship the index as a file"],
      tradeoff: "Same tradeoff as no-external-API, more severe.",
      demonstrated: ["Local embedding models", "Rule baseline"], notDemonstrated: ["Offline deployment"] },
    batch: { breaks: "Nothing. This is the shape the work already has.",
      proposal: ["The backtest runner is already a batch job over 35 windows", "Parallelise per-window scoring"],
      tradeoff: "Least speculative of all the constraints here.",
      demonstrated: ["Batch backtest over 1,054,948 loans"], notDemonstrated: ["Orchestrated batch beyond the self-reported Airflow work"] },
  };

  function stressBlock(x) {
    const wrap = h("div", { style: "margin-top:var(--s6)" },
      h("h4", {}, "Stress this architecture"),
      h("p", { class: "muted", style: "margin-bottom:var(--s3)" }, "Pick a constraint. Everything below the fold is a design proposal: reasoning about a system that was not built, clearly separated from what was."),
    );
    const btns = h("div", { class: "constraints" });
    for (const c of CONSTRAINTS) {
      btns.append(h("button", {
        type: "button", "aria-pressed": String(state.constraint === c.id),
        onClick: () => { state.constraint = state.constraint === c.id ? null : c.id; renderXray(); },
      }, c.label));
    }
    wrap.append(btns);

    if (state.constraint && STRESS[state.constraint]) {
      const s = STRESS[state.constraint];
      wrap.append(h("div", { class: "proposal" },
        h("span", { class: "proposal__tag" }, "Design proposal, not implemented in the original project"),
        h("p", { style: "font-size:var(--t-sm);margin-bottom:var(--s3)" }, h("strong", {}, "What breaks first: "), s.breaks),
        h("p", { style: "font-size:var(--t-sm);margin-bottom:var(--s2)" }, h("strong", {}, "Proposed changes:")),
        h("ul", {}, ...s.proposal.map((p) => h("li", {}, p))),
        h("p", { style: "font-size:var(--t-sm);margin-bottom:var(--s3)" }, h("strong", {}, "Tradeoff: "), s.tradeoff),
        h("p", { style: "font-size:var(--t-sm);margin-bottom:var(--s2)" }, h("strong", {}, "Already demonstrated:")),
        s.demonstrated.length
          ? h("div", { class: "rowgap" }, ...s.demonstrated.map((d) => h("span", { class: "chip chip--ok" }, d)))
          : h("p", { class: "muted", style: "font-size:var(--t-sm)" }, "Nothing in this proposal is demonstrated."),
        h("p", { style: "font-size:var(--t-sm);margin:var(--s3) 0 var(--s2)" }, h("strong", {}, "Hypothetical, no supporting evidence:")),
        h("div", { class: "rowgap" }, ...s.notDemonstrated.map((d) => h("span", { class: "chip chip--gap" }, d))),
      ));
    }
    return wrap;
  }

  function failuresBlock() {
    const rel = FAILURES.filter((f) => f.project === state.project);
    if (!rel.length) return null;
    const wrap = h("div", { style: "margin-top:var(--s6)" }, h("h4", {}, "Failure cases"));
    for (const f of rel) {
      wrap.append(h("details", { class: "ev" }, h("summary", {}, f.title), failureCard(f)));
    }
    return wrap;
  }

  /* =========================================================================
     MAP
     ====================================================================== */

  function renderMap() {
    const wanted = state.role ? new Set([...(ROLES.find(r => r.id === state.role)?.core || []), ...(ROLES.find(r => r.id === state.role)?.also || [])]) : null;

    // Build the graph from the evidence db: person -> projects -> tags
    const projects = [...new Set(DBclaims().map((c) => c.project_or_experience).filter(Boolean))];
    const tagCount = new Map();
    for (const c of DBclaims()) for (const t of c.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([t]) => t);

    const W = 760, H = 460, cx = W / 2, cy = H / 2;
    const nodes = [{ id: "Bhavani", x: cx, y: cy, r: 22, kind: "person" }];
    const edges = [];

    projects.forEach((p, i) => {
      const a = (i / projects.length) * Math.PI * 2 - Math.PI / 2;
      nodes.push({ id: p, x: cx + Math.cos(a) * 130, y: cy + Math.sin(a) * 110, r: 11, kind: "project" });
      edges.push(["Bhavani", p]);
    });

    topTags.forEach((t, i) => {
      const a = (i / topTags.length) * Math.PI * 2 - Math.PI / 2;
      const hot = wanted?.has(t);
      const rad = hot ? 150 : 210;
      nodes.push({ id: t, x: cx + Math.cos(a) * rad * 1.35, y: cy + Math.sin(a) * rad * 0.85, r: 6, kind: "tag", hot });
      const owner = DBclaims().find((c) => c.tags.includes(t) && c.project_or_experience);
      if (owner) edges.push([owner.project_or_experience, t]);
    });

    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Evidence graph linking projects to demonstrated technologies");

    for (const [a, b] of edges) {
      const na = byId[a], nb = byId[b];
      if (!na || !nb) continue;
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", na.x); line.setAttribute("y1", na.y);
      line.setAttribute("x2", nb.x); line.setAttribute("y2", nb.y);
      line.setAttribute("class", "map-edge");
      if (wanted) {
        if (nb.hot) line.dataset.hot = "true"; else line.dataset.dim = "true";
      }
      svg.append(line);
    }

    for (const n of nodes) {
      const g = document.createElementNS(svgNS, "g");
      g.setAttribute("class", "map-node");
      if (wanted && n.kind === "tag" && !n.hot) g.dataset.dim = "true";
      const c = document.createElementNS(svgNS, "circle");
      c.setAttribute("cx", n.x); c.setAttribute("cy", n.y); c.setAttribute("r", n.r);
      c.setAttribute("fill", n.kind === "person" ? "var(--accent)" : n.kind === "project" ? "var(--ink-2)" : (n.hot ? "var(--accent)" : "var(--muted-2)"));
      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("x", n.x); label.setAttribute("y", n.y + n.r + 11);
      label.setAttribute("text-anchor", "middle");
      label.textContent = n.id.length > 22 ? n.id.slice(0, 21) + "…" : n.id;
      if (n.kind === "person") { label.setAttribute("font-size", "11"); label.setAttribute("y", n.y + 4); label.setAttribute("fill", "var(--paper)"); }
      g.append(c, label);
      g.addEventListener("click", () => {
        const found = n.kind === "tag" ? E.retrieve(n.id, { tags: [n.id], limit: 6 }) : DBclaims().filter((x) => x.project_or_experience === n.id);
        state.thread.push({ q: `Evidence for “${n.id}”`, res: { blocks: [{ kind: "answer", text: `${found.length} claim${found.length === 1 ? "" : "s"} in the evidence database reference ${n.id}.` }], citations: found, validation: { ok: true }, fellBack: false } });
        setTab("ask");
      });
      svg.append(g);
    }

    const roleSel = h("select", {
      "aria-label": "Pull relevant evidence toward the centre",
      onChange: (e) => { state.role = e.target.value || null; renderMap(); },
      style: "font-family:var(--mono);font-size:var(--t-xs);padding:var(--s2);background:var(--paper);color:var(--ink);border:1px solid var(--rule);border-radius:var(--radius)",
    }, h("option", { value: "" }, "No role selected"),
       ...ROLES.map((r) => h("option", { value: r.id, selected: state.role === r.id }, r.label)));

    clear(body).append(h("div", { class: "imw__pane" },
      h("h4", {}, "Evidence graph"),
      h("p", { class: "muted", style: "margin-bottom:var(--s4)" }, "Built from the evidence database, not hand-drawn. Selecting a role pulls the relevant technologies toward the centre and fades the rest. Click any node to see its claims."),
      h("div", { class: "rowgap", style: "margin-bottom:var(--s4)" }, roleSel),
      h("div", { class: "map-wrap" }, svg),
      h("p", { class: "note" }, "Node position carries no meaning beyond relevance to the selected role. Edge presence means a claim links that project to that technology."),
    ));
    clear(foot);
  }

  const DBclaims = () => E.db().claims;

  /* =========================================================================
     PROOF LAB
     ====================================================================== */

  async function renderLab() {
    if (!state.lab) {
      try {
        const r = await fetch("imw/fixtures/sfd_backtest.json");
        state.lab = await r.json();
      } catch {
        clear(body).append(h("div", { class: "imw__pane" },
          h("div", { class: "banner" }, "The replay artifact could not be loaded. Nothing is simulated in its place.")));
        return;
      }
    }
    const lab = state.lab;
    const i = Math.min(state.labIdx, lab.windows.length - 1);
    const w = lab.windows[i];
    const ref = lab.reference;

    const scrub = h("input", {
      class: "scrub", type: "range", min: 0, max: lab.windows.length - 1, value: i,
      "aria-label": "Monitoring window",
      onInput: (e) => { state.labIdx = Number(e.target.value); renderLab(); },
    });

    const aucFlat = Math.abs(w.auc - ref.auc) < 0.03;
    const gapBad = Math.abs(w.gap) > 0.02;

    const readout = h("dl", { class: "readout" },
      h("div", {}, h("dt", {}, "Window"), h("dd", {}, w.window)),
      h("div", {}, h("dt", {}, "AUC"), h("dd", { "data-state": aucFlat ? "calm" : "" }, w.auc.toFixed(4))),
      h("div", {}, h("dt", {}, "Brier"), h("dd", {}, w.brier.toFixed(4))),
      h("div", {}, h("dt", {}, "Calibration gap"), h("dd", { "data-state": gapBad ? "alarm" : "" }, w.gap.toFixed(4))),
      h("div", {}, h("dt", {}, "Actual default rate"), h("dd", {}, w.base_rate.toFixed(4))),
      h("div", {}, h("dt", {}, "Model predicted"), h("dd", {}, w.mean_predicted.toFixed(4))),
    );

    const sigs = h("div", { class: "sigrow" });
    for (const [k, fired] of Object.entries(w.signals)) {
      sigs.append(h("span", { class: "sig", "data-fired": String(fired) }, `${k} ${fired ? "FIRING" : "quiet"}`));
    }

    // sparkline of AUC vs calibration gap across all windows
    const spark = sparkline(lab.windows, i);

    clear(body).append(h("div", { class: "imw__pane" },
      h("div", { class: "lab" },
        h("div", { class: "lab__head" },
          h("span", { class: "lab__badge" }, lab.label),
          h("h5", {}, "Silent failure, window by window"),
          h("p", { class: "muted", style: "font-size:var(--t-sm);margin:0" }, lab.disclosure),
        ),
        h("div", { class: "lab__body" },
          h("div", { class: "lab__meta" },
            h("span", {}, `project: ${lab.project}`),
            h("span", {}, `commit: ${lab.commit_sha}`),
            h("span", {}, `sources: ${lab.sources.join(", ")}`),
            h("span", {}, `windows: ${lab.n_windows} · loans: ${lab.total_loans.toLocaleString()}`),
          ),
          h("p", { class: "muted", style: "font-size:var(--t-sm)" },
            `Reference window (2013 H2, healthy): AUC ${ref.auc}, Brier ${ref.brier}, calibration gap ${ref.gap}. Drag to move through the monitoring period.`),
          scrub, readout, spark,
          h("h4", { style: "margin-top:var(--s4)" }, "Unsupervised detectors at this window"), sigs,
          h("p", { class: "note" },
            `Across all ${lab.n_windows} windows: KS fired ${lab.fired_counts.ks}, Wasserstein ${lab.fired_counts.wasserstein}, multivariate ${lab.fired_counts.multivariate}, PSI ${lab.fired_counts.psi}, KL ${lab.fired_counts.kl}, prediction drift ${lab.fired_counts.prediction}. Three detectors that fire on every window and one that never fires are two ways of carrying no information.`),
          evidenceList(E.claims(["sfd.result.silent_failure", "sfd.result.detectors_blind", "sfd.result.backtest_scale"]), "Evidence"),
        ),
      ),
      defenceBlock(),
    ));
    clear(foot).append(h("p", { class: "imw__fine" },
      h("span", {}, "This is an artifact replay, not live computation. The distinction is not decorative: no model is being run in your browser."),
    ));
  }

  function sparkline(rows, active) {
    const svgNS = "http://www.w3.org/2000/svg";
    const W = 720, H = 90, pad = 6;
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("class", "spark");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "AUC stays flat while the calibration gap widens across 35 windows");

    const aucs = rows.map((r) => r.auc);
    const gaps = rows.map((r) => Math.abs(r.gap));
    const scale = (vals) => {
      const lo = Math.min(...vals), hi = Math.max(...vals);
      return (v) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - pad * 2);
    };
    const sa = scale(aucs), sg = scale(gaps);
    const x = (i) => pad + (i / (rows.length - 1)) * (W - pad * 2);

    const path = (vals, s, color, dash) => {
      const p = document.createElementNS(svgNS, "path");
      p.setAttribute("d", vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${s(v).toFixed(1)}`).join(" "));
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", color);
      p.setAttribute("stroke-width", "1.6");
      if (dash) p.setAttribute("stroke-dasharray", dash);
      return p;
    };
    svg.append(path(aucs, sa, "var(--ok)"), path(gaps, sg, "var(--gap)"));

    const marker = document.createElementNS(svgNS, "line");
    marker.setAttribute("x1", x(active)); marker.setAttribute("x2", x(active));
    marker.setAttribute("y1", 0); marker.setAttribute("y2", H);
    marker.setAttribute("stroke", "var(--accent)"); marker.setAttribute("stroke-width", "1");
    svg.append(marker);

    const lbl = (t, y, fill) => {
      const e = document.createElementNS(svgNS, "text");
      e.setAttribute("x", W - pad); e.setAttribute("y", y); e.setAttribute("text-anchor", "end");
      e.setAttribute("font-size", "9"); e.setAttribute("font-family", "var(--mono)"); e.setAttribute("fill", fill);
      e.textContent = t; return e;
    };
    svg.append(lbl("AUC, flat", 12, "var(--ok)"), lbl("|calibration gap|, widening", 24, "var(--gap)"));
    return svg;
  }

  /* ---------- defence exercise ----------------------------------------- */

  function defenceBlock() {
    const wrap = h("div", { style: "margin-top:var(--s6)" },
      h("h4", {}, "Try to break it"),
      h("p", { class: "muted", style: "margin-bottom:var(--s4)" },
        "Fourteen recorded adversarial cases, each naming the specific rule that catches it. Run one, or type your own in ASK. This shows the checks working on the cases they were written for. It is not a claim that the system cannot be broken."),
    );
    const list = h("div", { class: "atk" });
    for (const a of ATTACKS) {
      const out = h("div", {});
      list.append(h("div", { class: "atk__case" },
        h("span", { class: "atk__cat" }, a.category),
        h("p", { class: "atk__prompt" }, `“${a.prompt}”`),
        h("div", { class: "rowgap" },
          h("button", { class: "btn btn--ghost", type: "button", onClick: () => runAttack(a, out) }, "Run this"),
          h("span", { class: "atk__rule" }, `rule: ${a.rule}`),
        ),
        out,
      ));
    }
    wrap.append(list);
    return wrap;
  }

  function runAttack(a, out) {
    const res = E.ask(a.prompt, state.persona);
    const text = res.blocks.map((b) => b.text).filter(Boolean).join(" ");
    const held = res.validation.ok;
    clear(out).append(
      h("p", { class: "atk__result", style: "margin-top:var(--s3)" },
        h("span", { class: "atk__badge" }, held ? "Defended" : "Fell back to evidence"), " ", text),
      res.injectionNote ? h("p", { class: "atk__rule" }, res.injectionNote) : null,
      h("p", { class: "atk__rule" }, `Expected: ${a.expect}`),
      evidenceList(res.citations, "Evidence used"),
    );
  }

  /* =========================================================================
     BRIEF
     ====================================================================== */

  function renderBrief() {
    if (!state.role) {
      const list = h("div", { class: "rolelist" });
      for (const r of ROLES) {
        list.append(h("button", { type: "button", onClick: () => { state.role = r.id; renderBrief(); } }, r.label));
      }
      clear(body).append(h("div", { class: "imw__pane" },
        h("h4", {}, "Technical interview brief"),
        h("p", { class: "muted", style: "margin-bottom:var(--s4)" }, "Pick a role. You get roughly ten minutes of preparation: the relevant systems, the evidence, what to probe, the known limitations, and questions worth asking. It contains no praise, by design."),
        list));
      clear(foot);
      return;
    }

    const b = E.buildBrief(state.role);
    const brief = h("div", { class: "brief" },
      h("h5", {}, `Technical interview brief: ${b.role.label}`),
      h("p", { class: "muted" }, "Prepared from the evidence database. Claims are marked by verification state; nothing here is a recommendation."),

      h("section", {},
        h("h5", {}, "Strongest relevant systems"),
        b.systems.length
          ? h("ul", {}, ...b.systems.map((s) => h("li", {}, h("strong", {}, s.project), ": ", s.claim.claim)))
          : h("p", { class: "muted" }, "No directly relevant system. The mapping below shows what is adjacent."),
      ),

      h("section", {},
        h("h5", {}, "Directly demonstrated"),
        b.direct.length
          ? h("ul", {}, ...b.direct.map((r) => h("li", {}, h("code", { class: "mono" }, r.tag), ": ", r.evidence[0]?.claim || "")))
          : h("p", { class: "muted" }, "Nothing in this role's core requirements is directly demonstrated."),
      ),

      h("section", {},
        h("h5", {}, "Adjacent only"),
        b.adjacent.length
          ? h("ul", {}, ...b.adjacent.map((r) => h("li", {}, h("code", { class: "mono" }, r.tag), ": supported by related work, not by direct evidence.")))
          : h("p", { class: "muted" }, "None."),
      ),

      h("section", {},
        h("h5", {}, "Not demonstrated"),
        b.missing.length
          ? h("ul", {}, ...b.missing.map((r) => h("li", {}, h("code", { class: "mono" }, r.tag), r.gaps[0] ? `: ${r.gaps[0].verification_note.slice(0, 180)}` : ": no matching claim in the evidence database.")))
          : h("p", { class: "muted" }, "None of this role's listed requirements are unaddressed."),
      ),

      h("section", {},
        h("h5", {}, "Failure and debugging examples to probe"),
        h("ul", {}, ...b.failures.map((f) => h("li", {}, h("strong", {}, f.title), ": ", f.measured))),
      ),

      h("section", {},
        h("h5", {}, "Known limitations"),
        h("ul", {}, ...b.limits.map((g) => h("li", {}, g.claim, " ", h("span", { class: "chip chip--gap" }, g.verification_status)))),
        h("li", { style: "list-style:none;margin-top:var(--s2)" }, h("span", { class: "muted" }, "The SS-SD capstone is a fork; its upstream commits are a teammate's. Employer metrics are self-reported and not publicly verifiable.")),
      ),

      h("section", {},
        h("h5", {}, "Recommended technical questions"),
        h("ol", {}, ...b.questions.map((q) => h("li", {}, q))),
      ),

      h("section", {},
        h("h5", {}, "Repositories"),
        h("ul", {}, ...Object.values(E.db().meta.repos).map((r) =>
          h("li", {}, h("a", { href: r.url, target: "_blank", rel: "noopener" }, r.name), `, ${r.provenance}, pinned @ ${r.sha.slice(0, 10)}`))),
      ),
    );

    clear(body).append(h("div", { class: "imw__pane" },
      h("div", { class: "rowgap", style: "margin-bottom:var(--s5)" },
        h("button", { class: "btn btn--ghost", type: "button", onClick: () => { state.role = null; renderBrief(); } }, "← Choose another role"),
        h("button", { class: "btn btn--primary", type: "button", onClick: () => copyBrief(b) }, "Copy brief"),
        h("button", { class: "btn btn--ghost", type: "button", onClick: () => copyLink(b.role.id) }, "Copy shareable link"),
      ),
      brief));
    clear(foot);
  }

  function copyBrief(b) {
    const L = [];
    L.push(`TECHNICAL INTERVIEW BRIEF: ${b.role.label}`);
    L.push(`Bhavani Adula · evidence last verified ${E.db().meta.last_full_verification}`);
    L.push("");
    L.push("DIRECTLY DEMONSTRATED");
    b.direct.forEach((r) => L.push(`  - ${r.tag}: ${r.evidence[0]?.claim || ""}`));
    if (!b.direct.length) L.push("  - none");
    L.push("");
    L.push("ADJACENT ONLY");
    b.adjacent.forEach((r) => L.push(`  - ${r.tag}`));
    if (!b.adjacent.length) L.push("  - none");
    L.push("");
    L.push("NOT DEMONSTRATED");
    b.missing.forEach((r) => L.push(`  - ${r.tag}`));
    if (!b.missing.length) L.push("  - none");
    L.push("");
    L.push("QUESTIONS WORTH ASKING");
    b.questions.forEach((q, i) => L.push(`  ${i + 1}. ${q}`));
    L.push("");
    L.push("KNOWN LIMITATIONS");
    b.limits.forEach((g) => L.push(`  - ${g.claim} [${g.verification_status}]`));
    L.push("  - The SS-SD capstone is a fork; upstream commits are a teammate's.");
    L.push("  - Employer metrics are self-reported.");
    L.push("");
    L.push("REPOSITORIES");
    Object.values(E.db().meta.repos).forEach((r) => L.push(`  - ${r.name} (${r.provenance}) ${r.url} @ ${r.sha}`));
    const text = L.join("\n");
    navigator.clipboard?.writeText(text).then(() => alert("Brief copied."), () => prompt("Copy:", text));
  }

  /* =========================================================================
     CONNECT YOUR AI (MCP)
     ====================================================================== */

  function showMcp() {
    setTab("ask");
    const pane = body.querySelector(".imw__pane");
    if (!pane) return;
    clear(pane).append(h("div", { class: "mcp" },
      h("h4", {}, "Connect your AI"),
      h("h5", {}, "Query this evidence from an MCP-compatible client"),
      h("p", { class: "muted", style: "margin-bottom:var(--s4)" },
        "The same evidence database, exposed read-only over the Model Context Protocol. There is no second knowledge base: the server reads the file this page reads, so the two cannot disagree."),
      h("pre", {}, `{
  "mcpServers": {
    "bhavani-evidence": {
      "command": "npx",
      "args": ["-y", "bhavani-evidence-mcp"],
      "env": { "EVIDENCE_URL": "https://bhavani-abhavi.github.io/evidence/claims.json" }
    }
  }
}`),
      h("h4", { style: "margin-top:var(--s5)" }, "Tools"),
      h("table", {},
        h("tbody", {},
          ...[
            ["search_evidence", "Free-text search over verified, public-safe claims."],
            ["get_project", "One project: architecture, decisions, evidence, provenance."],
            ["get_skill_proof", "Verdict plus sources for a named skill."],
            ["get_role_evidence", "Requirement mapping for one of 20 role families."],
            ["compare_job_description", "Requirements in, three-way evidence mapping out."],
            ["get_architecture", "Components and data flow for a project."],
            ["get_failure_cases", "Verified failures: what broke, how measured, how prevented."],
            ["get_code_reference", "Commit-pinned file link for a claim id."],
            ["get_research", "Methodology, baselines, limitations."],
            ["get_known_gaps", "What is not demonstrated, for a role or skill."],
          ].map(([t, d]) => h("tr", {}, h("td", {}, t), h("td", {}, d))))),
      h("h4", { style: "margin-top:var(--s5)" }, "What it will not do"),
      h("ul", { style: "font-size:var(--t-sm);color:var(--ink-2);padding-left:1.1em" },
        h("li", {}, "Return UNSUPPORTED or DEPRECATED evidence as support for a claim."),
        h("li", {}, "Infer experience the evidence does not establish. Ask it about Kubernetes and it returns the gap."),
        h("li", {}, "Expose private files, credentials, prompts, PHI, or employer-internal material."),
        h("li", {}, "Write anything. Every tool is read-only, and the endpoint is rate-limited."),
      ),
      h("p", { class: "note" }, "Nothing a client sends is stored. Responses carry evidence ids and source URLs so any answer can be checked against the same commit this page cites."),
      h("p", { style: "margin-top:var(--s4)" }, h("button", { class: "btn btn--ghost", type: "button", onClick: () => renderAsk() }, "← Back")),
    ));
  }

  return { open, close };
}
