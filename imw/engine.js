/* =============================================================================
   engine.js — the evidence engine.

   Pipeline (not "PDF -> chunks -> embeddings -> LLM"):
     question
       -> intent identification
       -> persona / role context
       -> structured evidence lookup          (claims.json, by id and tag)
       -> lexical retrieval fallback          (only when structure misses)
       -> claim validation                    (state discipline)
       -> response composition                (templated from claims)
       -> citation attachment
       -> unsupported-claim validators        (hype / numeric / conflict)
       -> output, or deterministic fallback

   This runs entirely in the browser. A backend LLM, when configured, is an
   *enhancement* layered on the same evidence and passed through the same
   validators — never a replacement for them.
   ========================================================================== */

import {
  validateAnswer, detectInjection, sanitiseInput, MAX_QUESTION,
} from "./validators.js";
import { ROLES, SYNONYMS, PERSONAS, XRAY, FAILURES } from "./data.js";

let DB = null;

export async function loadDb(base = "../evidence/claims.json") {
  if (DB) return DB;
  const res = await fetch(base);
  if (!res.ok) throw new Error(`evidence unavailable (${res.status})`);
  DB = await res.json();
  DB.byId = Object.fromEntries(DB.claims.map((c) => [c.id, c]));
  return DB;
}

export function db() { return DB; }
export function claim(id) { return DB?.byId?.[id] || null; }
export function claims(ids = []) { return ids.map(claim).filter(Boolean); }

/* ---------------------------------------------------------------------------
   Evidence-state discipline
   ------------------------------------------------------------------------ */

const USABLE = new Set(["VERIFIED"]);
const MENTIONABLE = new Set(["VERIFIED", "VERIFICATION_REQUIRED"]);

export const supporting = (cs) => cs.filter((c) => USABLE.has(c.verification_status));
export const selfReported = (cs) => cs.filter((c) => c.verification_status === "VERIFICATION_REQUIRED");
export const unsupported = (cs) => cs.filter((c) => c.verification_status === "UNSUPPORTED" || c.verification_status === "DEPRECATED");

/* ---------------------------------------------------------------------------
   Normalisation — map free text onto canonical evidence tags
   ------------------------------------------------------------------------ */

export function tagsInText(text) {
  const l = ` ${text.toLowerCase()} `;
  const found = new Set();
  for (const [tag, forms] of Object.entries(SYNONYMS)) {
    for (const f of forms) {
      if (l.includes(f.toLowerCase())) { found.add(tag); break; }
    }
  }
  return [...found];
}

/* ---------------------------------------------------------------------------
   Retrieval — structured first, lexical only as a fallback
   ------------------------------------------------------------------------ */

// Words that match many claims without indicating subject matter. A question
// made only of these is not a question the evidence database can answer.
const STOPWORDS = new Set([
  "work", "works", "working", "about", "tell", "show", "what", "which", "does",
  "done", "with", "have", "from", "this", "that", "them", "they", "your",
  "bhavani", "she", "her", "hers", "experience", "project", "projects", "more",
  "give", "some", "any", "good", "best", "much", "like", "into", "using", "used",
]);

function scoreClaim(c, terms, tags) {
  let s = 0;
  for (const t of tags) if (c.tags.includes(t)) s += 6;
  const hay = `${c.claim} ${c.verification_note || ""} ${c.project_or_experience || ""} ${c.category}`.toLowerCase();
  let lexical = 0;
  for (const term of terms) {
    if (term.length < 4 || STOPWORDS.has(term)) continue;
    if (hay.includes(term)) lexical += 2;
  }
  s += lexical;
  // Status is a tie-breaker, never enough on its own to clear the bar.
  if (s > 0) {
    if (c.verification_status === "VERIFIED") s += 1.5;
    if (c.verification_status === "UNSUPPORTED") s += 0.5; // surfaced for gap questions
  }
  return s;
}

export function retrieve(text, { limit = 6, tags = null } = {}) {
  if (!DB) return [];
  const terms = text.toLowerCase().split(/[^a-z0-9.+#-]+/).filter(Boolean);
  const tg = tags || tagsInText(text);
  // A hit needs either a canonical tag match or two substantive lexical matches.
  // Without this floor, "quantum computing" retrieves the whole database on "work".
  const MIN = 5.5;
  return DB.claims
    .map((c) => ({ c, s: scoreClaim(c, terms, tg) }))
    .filter((x) => x.s >= MIN)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.c);
}

/* ---------------------------------------------------------------------------
   Capability verdicts
   ------------------------------------------------------------------------ */

export const VERDICT = {
  DIRECT: "DIRECTLY DEMONSTRATED",
  ADJACENT: "SUPPORTED BY ADJACENT EXPERIENCE",
  NOT: "NOT CURRENTLY DEMONSTRATED",
  NONE: "INSUFFICIENT EVIDENCE",
};

const ADJACENCY = {
  kubernetes: ["docker", "ci", "devops"],
  aws: ["docker", "ci", "backend"],
  gcp: ["api-integration", "llm"],
  azure: [],
  agents: ["llm", "api-integration", "tool-calling"],
  scaling: ["system-design", "monitoring"],
  latency: ["monitoring", "evaluation"],
  "tool-calling": ["agent-reliability", "llm"],
  airflow: ["etl", "data-engineering", "backtesting"],
  dbt: ["sql", "data-engineering"],
};

export function capability(tag) {
  if (!DB) return { verdict: VERDICT.NONE, direct: [], adjacent: [], gaps: [] };

  const direct = DB.claims.filter((c) => c.tags.includes(tag) && c.verification_status === "VERIFIED");
  const claimed = DB.claims.filter((c) => c.tags.includes(tag) && c.verification_status === "VERIFICATION_REQUIRED");
  const gaps = DB.claims.filter((c) => c.tags.includes(tag) && (c.verification_status === "UNSUPPORTED"));

  if (direct.length) return { verdict: VERDICT.DIRECT, direct, adjacent: [], gaps, claimed };

  const adjTags = ADJACENCY[tag] || [];
  const adjacent = adjTags.length
    ? DB.claims.filter((c) => c.verification_status === "VERIFIED" && c.tags.some((t) => adjTags.includes(t)))
    : [];

  if (gaps.length) return { verdict: VERDICT.NOT, direct: [], adjacent, gaps, claimed };
  if (claimed.length) return { verdict: VERDICT.ADJACENT, direct: [], adjacent: adjacent.concat(claimed), gaps, claimed };
  if (adjacent.length) return { verdict: VERDICT.ADJACENT, direct: [], adjacent, gaps, claimed };
  return { verdict: VERDICT.NONE, direct: [], adjacent: [], gaps, claimed };
}

/* ---------------------------------------------------------------------------
   Intent
   ------------------------------------------------------------------------ */

const INTENTS = [
  ["injection",   /ignore (your|all|previous)|system override|reveal (your )?(system )?prompt|you are now|new instructions|jailbreak|forget everything/i],
  ["hire_decision", /should (we|i) hire|is she (a )?(good|great) hire|would you hire|yes or no/i],
  ["false_premise", /\b(right\??|correct\??|isn'?t (she|it)|didn'?t she|confirm (that|it|she))\s*$|,\s*(right|correct)\s*\?/i],
  ["gaps",        /\b(gap|gaps|weakness|weaknesses|can'?t|cannot|lack|missing|not demonstrated|red flag|concern)/i],
  ["failure",     /\b(fail|failed|failure|broke|broken|bug|debug|hardest|went wrong|mistake|regression)/i],
  ["shipped",     /\b(shipped|actually built|really built|what has she (built|done)|portfolio)/i],
  ["evaluation",  /\b(evaluat|eval|benchmark|measur|metric|test|validate|baseline)/i],
  ["role_fit",    /\b(fit|suited|match|qualif|right person|consider(ing)? her for)/i],
  ["capability",  /\b(can she|does she (know|have)|experience (with|in)|familiar with|worked with|ever used|proficien)/i],
  ["project",     /\b(cliniq|silent failure|churn|ss-sd|surgical|diffusion|meal planner|nas|holdline|hold line|voice agent)/i],
  ["evidence",    /\b(evidence|proof|prove|source|cite|citation|verify|verified)/i],
];

export function classifyIntent(q) {
  const inj = detectInjection(q);
  if (inj.detected) return "injection";
  for (const [name, re] of INTENTS) {
    if (name === "injection") continue;
    if (re.test(q)) return name;
  }
  return "general";
}

/* ---------------------------------------------------------------------------
   Known false premises — checked before anything else is composed
   ------------------------------------------------------------------------ */

const FALSE_PREMISES = [
  { re: /\b(k8s|kubernetes|helm|eks|gke)\b/i, tag: "kubernetes",
    cites: ["gap.kubernetes", "skill.docker", "skill.ci"],
    correction: "The verified evidence shows Docker and docker-compose, GitHub Actions CI, and a packaged Python project with enforced module boundaries. It does not establish production Kubernetes ownership." },
  { re: /\btrain(ed|ing)?\s+(gpt-?4|gpt-?5|claude|llama|a foundation model|an llm from scratch)\b/i, tag: null,
    cites: ["churn.result.bert", "churn.arch.t5_shap", "sssd.arch.kinematic_encoder"],
    correction: "No evidence supports training a foundation model. The fine-tuning evidence is BERT and T5 for classification and summarisation, and a low-rank LoRA adapter on Stable Diffusion." },
  { re: /\b(at|for|with)\s+(google|meta|amazon|microsoft|apple|openai|netflix|nvidia|deepmind)\b/i, tag: null,
    cites: ["hippocratic.eval.scenarios", "yrall.pipelines"],
    correction: "No such employment appears in the record. The two employers are Hippocratic AI, as an AI/ML Engineer Intern, and Yrall Media Solutions, as a Data Engineer. Both entries are self-reported." },
  { re: /\b(five|5|six|6|seven|7|eight|8|nine|9|ten|10)\+?\s*(years?|yrs?)\b/i, tag: null,
    cites: ["hippocratic.eval.scenarios", "yrall.pipelines", "edu.masters"],
    correction: "I will not confirm a seniority figure. The dated record is in the evidence below, all of it self-reported, and the arithmetic is yours rather than mine." },
  { re: /\blangchain|llamaindex|langgraph|autogen|crewai\b/i, tag: "agents",
    cites: ["gap.agent_frameworks", "cliniq.arch.three_tier"],
    correction: "No agent framework appears in any public repository. ClinIQ calls the Anthropic SDK directly, which is a defensible choice but is not framework experience." },
  { re: /\baws certified|certified (solutions )?architect|gcp certified|azure certified\b/i, tag: null,
    cites: ["cert.list", "gap.aws_public"],
    correction: "No cloud certification appears in the record. The listed credentials are Google Data Analytics coursework, Data Science with AI from upGrad, Tableau for Data Science and Python from HackerRank — and the first of those is individual courses rather than a confirmed full certificate." },
  { re: /\bfid\b/i, tag: null,
    cites: ["sssd.metrics.fid", "sssd.eval.cross_pair_baseline"],
    correction: "FID is not supported. The script exists in the upstream SS-SD repository but was never merged into this fork, and no FID value exists in either. PSNR, SSIM, histogram chi-squared, edge IoU and Farneback optical-flow correlation are genuinely implemented." },
];

/** Claims that licence the figures in each project's X-Ray summary. */
const PROJECT_ANCHORS = {
  sfd: ["sfd.scale.code", "sfd.result.backtest_scale", "sfd.result.silent_failure", "sfd.design.label_isolation"],
  cliniq: ["cliniq.scale.corpus", "cliniq.arch.three_tier", "cliniq.result.method_comparison", "cliniq.provenance"],
  churn: ["churn.result.bert", "churn.arch.t5_shap"],
  sssd: ["sssd.arch.kinematic_encoder", "sssd.eval.cross_pair_baseline", "sssd.provenance"],
  holdline: ["holdline.status", "holdline.design.post_generation_validation", "holdline.testing.suite", "holdline.failure.live_model_pass"],
};

export function checkFalsePremise(q) {
  const asserted = /\b(right|correct|yes\?|confirm|isn'?t (she|it)|didn'?t she|she (did|has|used|worked|ran|built))\b/i.test(q);
  for (const fp of FALSE_PREMISES) {
    if (!fp.re.test(q)) continue;
    // only treat as a premise to reject if it isn't already a gap-seeking question
    return { hit: true, asserted, ...fp };
  }
  return { hit: false };
}

/* ---------------------------------------------------------------------------
   Answer composition
   ------------------------------------------------------------------------ */

function personaDepth(persona) {
  return PERSONAS[persona]?.depth || "medium";
}

function block(kind, text, extra = {}) { return { kind, text, ...extra }; }

/**
 * @returns {{blocks:Array, citations:Array, validation:Object, intent:string}}
 */
export function ask(rawQuestion, persona = "recruiter") {
  const q = sanitiseInput(rawQuestion, MAX_QUESTION);
  if (!q) {
    return {
      intent: "empty",
      blocks: [block("answer", "Ask about a project, a technology, an engineering decision, a failure, or how the evidence maps to a role.")],
      citations: [], validation: { ok: true, failures: [] },
    };
  }

  const intent = classifyIntent(q);
  const tags = tagsInText(q);
  const depth = personaDepth(persona);
  const blocks = [];
  let cites = [];
  let injectionNote = null;

  if (intent === "injection") {
    injectionNote = "That message contained an instruction to change my rules. I have not followed it. It does not affect the evidence below.";
  }

  /* ---- HoldLine: in progress, private, so no X-Ray and no code link ----- */
  if (/holdline|hold ?line/i.test(q) && intent !== "injection") {
    blocks.push(block("answer",
      "HoldLine is an in-progress build, and the only wholly self-authored system in the recent work. "
      + "It is a voice agent that places real, time-limited holds on bakery inventory over the phone. "
      + "The design point worth asking about is that every response is validated after generation "
      + "against that turn's tool results, with violations tiered by consequence: a wrong quantity "
      + "retries once, an allergen claim never retries and hard-blocks to a human."));
    blocks.push(block("note",
      "The repository is private and four of nine phases are done, so none of this is open for you to "
      + "check. The figures were verified against the working tree rather than copied from a resume, "
      + "but that is not the same as you being able to verify them, and the evidence below is marked "
      + "accordingly."));
    return finish(blocks, claims(PROJECT_ANCHORS.holdline), intent, injectionNote);
  }

  /* ---- hiring decisions: declined, always ------------------------------ */
  if (intent === "hire_decision") {
    blocks.push(block("answer",
      "I do not make hiring decisions and I do not produce a fit score. What I can give you is the evidence split three ways: what is directly demonstrated, what is adjacent, and what is not demonstrated at all. Pick a role in ROLE FIT, or paste the job description, and you will get exactly that."));
    blocks.push(block("note", "A number here would be invented. The three-way split is the honest version of the same question."));
    return finish(blocks, [], intent, injectionNote);
  }

  /* ---- false premises: rejected before composing ----------------------- */
  const fp = checkFalsePremise(q);
  if (fp.hit && intent !== "gaps") {
    blocks.push(block("answer", fp.correction));
    // The correction is grounded in named claims, not in whatever retrieval
    // happened to return — so the reader can check the rejection itself.
    cites = claims(fp.cites || []);
    if (fp.tag) {
      const cap = capability(fp.tag);
      const extra = [...cap.direct, ...cap.gaps].filter((c) => !cites.includes(c));
      cites = [...cites, ...extra].slice(0, 6);
    }
    blocks.push(block("note", "I have not agreed with the premise. If you have a source that establishes it, it is not one I can see."));
    return finish(blocks, cites, intent, injectionNote);
  }

  /* ---- gaps ------------------------------------------------------------ */
  if (intent === "gaps") {
    const gapClaims = DB.claims.filter((c) => c.category === "gap");
    const reviewClaims = DB.claims.filter((c) => c.verification_status === "VERIFICATION_REQUIRED").slice(0, 4);
    blocks.push(block("answer",
      "Four things are documented as not demonstrated, and a further set is self-reported rather than verifiable. Both lists are published rather than omitted, because a reviewer would find them anyway."));
    blocks.push(block("gaps", "Not demonstrated in any public repository:"));
    blocks.push(block("limits", "Self-reported, mostly employer-internal, and never stated here as established fact:"));
    cites = [...gapClaims, ...reviewClaims];
    return finish(blocks, cites, intent, injectionNote);
  }

  /* ---- failures -------------------------------------------------------- */
  if (intent === "failure") {
    const picked = FAILURES.slice(0, depth === "short" ? 2 : 5);
    blocks.push(block("answer",
      depth === "short"
        ? "The clearest example is a bug pattern that appeared three times in one codebase: a safety check computed downstream of a transformation that removes the evidence the check looks for. Each instance reported 'all clear' while being structurally incapable of reporting anything else."
        : "Five are documented, four of them in one project, and they share a pattern worth naming: a check computed downstream of a transformation that removes the evidence the check looks for. Each returned a clean result while being structurally incapable of returning anything else."));
    blocks.push(block("failures", "", { failures: picked }));
    cites = claims(["sfd.failure.blinded_checks", "sfd.integrity.retraction"]);
    return finish(blocks, cites, intent, injectionNote);
  }

  /* ---- capability ------------------------------------------------------ */
  if (intent === "capability" || (tags.length === 1 && intent === "general")) {
    const tag = tags[0];
    if (!tag) {
      blocks.push(block("answer", "I could not match that to a technology or skill in the evidence database. Try naming the technology directly — for example retrieval, calibration, Docker, pgvector, or Airflow."));
      return finish(blocks, [], intent, injectionNote);
    }
    const cap = capability(tag);
    const lead = {
      [VERDICT.DIRECT]: `Directly demonstrated. There is code or a committed artifact for ${tag}.`,
      [VERDICT.ADJACENT]: `Supported by adjacent experience rather than direct evidence for ${tag}.`,
      [VERDICT.NOT]: `Not currently demonstrated for ${tag}.`,
      [VERDICT.NONE]: `I do not have enough verified evidence to answer that for ${tag}.`,
    }[cap.verdict];

    blocks.push(block("verdict", lead, { verdict: cap.verdict }));
    cites = [...cap.direct, ...(cap.adjacent || []), ...cap.gaps].slice(0, depth === "short" ? 3 : 6);
    if (cap.verdict === VERDICT.ADJACENT) {
      blocks.push(block("note", "Adjacent evidence is not direct evidence and I will not present it as such. It tells you the habits are there; it does not tell you the specific tool is."));
    }
    return finish(blocks, cites, intent, injectionNote);
  }

  /* ---- shipped --------------------------------------------------------- */
  if (intent === "shipped") {
    blocks.push(block("answer",
      "Six public repositories, of which four carry real engineering. One is sole-authored and is the strongest: a drift-monitoring framework of 8,209 lines with 261 tests, which backtests a frozen credit model across 35 monthly windows and 1,054,948 loans. Two are team projects held as forks, stated as such. One is documentation only, with no published implementation."));
    cites = claims([
      "sfd.scale.code", "sfd.result.backtest_scale", "sfd.result.silent_failure",
      "cliniq.arch.three_tier", "cliniq.provenance",
      "churn.result.bert", "sssd.arch.kinematic_encoder", "skill.nas_docs_only",
    ]);
    blocks.push(block("note", "Provenance is stated on every entry. Two flagship projects are forks of teammates' repositories and the code commits are theirs."));
    return finish(blocks, cites, intent, injectionNote);
  }

  /* ---- evaluation ------------------------------------------------------ */
  if (intent === "evaluation") {
    blocks.push(block("answer",
      "Evaluation is the throughline. Three patterns recur: run a baseline before the expensive method, make the evaluation structurally unable to cheat, and report the result when it is negative."));
    cites = claims([
      "sfd.design.label_isolation", "cliniq.result.method_comparison",
      "sssd.eval.cross_pair_baseline", "sfd.result.detectors_blind",
      "sfd.integrity.retraction", "sfd.result.fpr_zero",
    ]);
    if (depth === "deep") {
      blocks.push(block("note",
        "The structural point is the one worth probing in an interview: an import-linter contract prevents the label-free estimator from importing the module that holds the labels it is scored against, and the boundary is mirrored by a test so it survives the linter being absent."));
    }
    return finish(blocks, cites, intent, injectionNote);
  }

  /* ---- project --------------------------------------------------------- */
  if (intent === "project") {
    // HoldLine is handled before this branch: it has no X-Ray, because that
    // view exists to link inspectable code and this repository is private.
    const key = /cliniq/i.test(q) ? "cliniq"
      : /silent|drift|monitor/i.test(q) ? "sfd"
      : /churn/i.test(q) ? "churn"
      : /ss-?sd|surgical|diffusion|kinemat/i.test(q) ? "sssd" : null;
    if (key && XRAY[key]) {
      const x = XRAY[key];
      blocks.push(block("answer", x.summary));
      if (x.provenance) blocks.push(block("note", x.provenance));
      // Anchor claims licence the figures in the summary. Retrieval then adds
      // whatever else the question asked about.
      const anchored = claims(PROJECT_ANCHORS[key] || []);
      const extra = retrieve(q, { limit: 4 }).filter((c) => !anchored.includes(c));
      cites = [...anchored, ...extra].slice(0, depth === "short" ? 5 : 8);
      blocks.push(block("open_xray", "", { project: key }));
      return finish(blocks, cites, intent, injectionNote);
    }
  }

  /* ---- general: structured retrieval ----------------------------------- */
  const found = retrieve(q, { limit: depth === "short" ? 4 : 7, tags });
  if (!found.length) {
    blocks.push(block("answer",
      "I do not have verified evidence covering that. The evidence database spans six public repositories and two employers; if the subject sits outside it, I would rather say so than improvise."));
    blocks.push(block("note", "Try a technology name, a project name, or paste a job description into ROLE FIT."));
    return finish(blocks, [], intent, injectionNote);
  }

  const verified = supporting(found);
  const claimedOnly = selfReported(found);
  if (verified.length) {
    blocks.push(block("answer", `The strongest supporting evidence is ${verified[0].project_or_experience || "in the public repositories"}.`));
  } else if (claimedOnly.length) {
    blocks.push(block("answer", "The portfolio has self-reported material on that but no verifiable public artifact, so I will not present it as established."));
  }
  cites = found;
  return finish(blocks, cites, intent, injectionNote);
}

/* ---------------------------------------------------------------------------
   Finalisation — validators run here, on every path
   ------------------------------------------------------------------------ */

function finish(blocks, cites, intent, injectionNote) {
  const text = blocks.map((b) => b.text).join(" ");
  const validation = validateAnswer(text, cites);

  if (!validation.ok) {
    // The answer is not patched. It is replaced by the evidence listing, which
    // is composed only of stored claim text and cannot fail these checks.
    return {
      intent,
      injectionNote,
      blocks: [
        block("answer", "I composed an answer that did not pass its own output checks, so I am showing the underlying evidence instead."),
        block("note", `Failed: ${validation.failures.map((f) => f.rule).join(", ")}.`),
      ],
      citations: cites,
      validation,
      fellBack: true,
    };
  }
  return { intent, injectionNote, blocks, citations: cites, validation, fellBack: false };
}

/* ---------------------------------------------------------------------------
   ROLE FIT
   ------------------------------------------------------------------------ */

export function mapRole(roleId) {
  const role = ROLES.find((r) => r.id === roleId);
  if (!role || !DB) return null;

  const rows = [];
  for (const tag of role.core) rows.push(requirementRow(tag, true));
  for (const tag of role.also) rows.push(requirementRow(tag, false));

  return {
    role,
    rows,
    counts: {
      direct: rows.filter((r) => r.verdict === VERDICT.DIRECT).length,
      adjacent: rows.filter((r) => r.verdict === VERDICT.ADJACENT).length,
      none: rows.filter((r) => r.verdict === VERDICT.NOT || r.verdict === VERDICT.NONE).length,
    },
    questions: interviewQuestions(role),
  };
}

function requirementRow(tag, core) {
  const cap = capability(tag);
  return {
    tag, core,
    verdict: cap.verdict,
    evidence: [...cap.direct, ...(cap.adjacent || [])].slice(0, 3),
    gaps: cap.gaps.slice(0, 2),
  };
}

const QUESTION_BANK = {
  evaluation: "The import-linter contract stops the estimator importing the labels. What would you do if the constraint had to be relaxed for a legitimate reason — how would you keep the evaluation honest?",
  monitoring: "You concluded fixed-threshold alerting was the wrong architecture. Walk me through what rate-of-change alerting would look like, and how you'd tune it without labels.",
  rag: "ClinIQ's rule tier beat the RAG tier on balance. When would you still ship the RAG tier, and what would you need to see first?",
  retrieval: "The embedding tier hit perfect recall at 0.50 precision. If you had to ship one tier to a clinical reviewer tomorrow, which, and what would you put around it?",
  statistics: "You retracted a finding after correcting for serial dependence. How did you decide the correction was necessary, and what would you check before publishing a correlation next time?",
  "computer-vision": "Explain the cross-pair baseline. What would you have concluded if the diagonal and off-diagonal scores had matched?",
  "data-engineering": "The lineage and CI data-quality work at Yrall has no public artifact. Describe the failure that made you build the gate.",
  "agent-reliability": "Invalid tool calls down 70% — what was the validation actually checking, and what got through anyway?",
  testing: "One bug pattern appeared three times. How would you find the fourth instance before it ships?",
  scaling: "Nothing in the portfolio runs at scale. Given the monitoring framework, what breaks first at 100x and what would you do about it?",
  kubernetes: "There's no Kubernetes evidence. What's your actual exposure, and how would you get to competent on it?",
};

function interviewQuestions(role) {
  const out = [];
  for (const tag of [...role.core, ...role.also]) {
    if (QUESTION_BANK[tag] && !out.includes(QUESTION_BANK[tag])) out.push(QUESTION_BANK[tag]);
    if (out.length >= 5) break;
  }
  if (out.length < 3) out.push(QUESTION_BANK.testing, QUESTION_BANK.evaluation);
  return [...new Set(out)].slice(0, 5);
}

/* ---------------------------------------------------------------------------
   JOB DESCRIPTION ANALYSIS
   ------------------------------------------------------------------------ */

const SECTION_HINTS = {
  required: /\b(required|must have|requirements|qualifications|you have|minimum)\b/i,
  preferred: /\b(preferred|nice to have|bonus|plus|desired|ideally)\b/i,
  responsibility: /\b(responsibilit|you will|role|what you'?ll do|day to day)\b/i,
};

export function analyseJD(rawText) {
  const text = sanitiseInput(rawText, 20000);
  if (text.length < 40) return null;

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // section-aware requirement extraction
  let section = "responsibility";
  const byTag = new Map();
  for (const line of lines) {
    for (const [k, re] of Object.entries(SECTION_HINTS)) {
      if (re.test(line) && line.length < 90) section = k;
    }
    for (const tag of tagsInText(line)) {
      const prev = byTag.get(tag);
      // required beats preferred beats responsibility
      const rank = { required: 3, preferred: 2, responsibility: 1 };
      if (!prev || rank[section] > rank[prev.section]) {
        byTag.set(tag, { tag, section, line: line.slice(0, 180) });
      }
    }
  }

  const rows = [...byTag.values()].map((r) => {
    const cap = capability(r.tag);
    return {
      ...r,
      verdict: cap.verdict,
      evidence: [...cap.direct, ...(cap.adjacent || [])].slice(0, 3),
      gaps: cap.gaps.slice(0, 2),
    };
  });

  const order = { required: 0, preferred: 1, responsibility: 2 };
  rows.sort((a, b) => order[a.section] - order[b.section] || a.tag.localeCompare(b.tag));

  // closest role family, by tag overlap
  const scored = ROLES.map((role) => {
    const set = new Set([...role.core, ...role.also]);
    const overlap = rows.filter((r) => set.has(r.tag)).length;
    const coreHit = rows.filter((r) => role.core.includes(r.tag)).length * 2;
    return { role, score: overlap + coreHit };
  }).sort((a, b) => b.score - a.score);

  return {
    rows,
    nearestRole: scored[0]?.score > 0 ? scored[0].role : null,
    counts: {
      direct: rows.filter((r) => r.verdict === VERDICT.DIRECT).length,
      adjacent: rows.filter((r) => r.verdict === VERDICT.ADJACENT).length,
      none: rows.filter((r) => r.verdict === VERDICT.NOT || r.verdict === VERDICT.NONE).length,
    },
    extracted: rows.length,
  };
}

/* ---------------------------------------------------------------------------
   BRIEF
   ------------------------------------------------------------------------ */

export function buildBrief(roleId) {
  const mapped = mapRole(roleId);
  if (!mapped) return null;
  const { role, rows, questions } = mapped;

  const direct = rows.filter((r) => r.verdict === VERDICT.DIRECT);
  const adjacent = rows.filter((r) => r.verdict === VERDICT.ADJACENT);
  const missing = rows.filter((r) => r.verdict === VERDICT.NOT || r.verdict === VERDICT.NONE);

  const systems = [];
  const seen = new Set();
  for (const r of direct) {
    for (const e of r.evidence) {
      const p = e.project_or_experience;
      if (p && !seen.has(p)) { seen.add(p); systems.push({ project: p, claim: e }); }
    }
  }

  return { role, direct, adjacent, missing, systems: systems.slice(0, 4), questions,
           failures: FAILURES.slice(0, 3),
           limits: DB.claims.filter((c) => c.category === "gap") };
}
