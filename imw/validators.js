/* =============================================================================
   validators.js
   Output guards. Every answer passes through these before it is rendered,
   whether it came from the deterministic engine or from a backend LLM.

   These are not stylistic preferences. Each one corresponds to a specific way
   a portfolio assistant can mislead someone, and each is covered by a test in
   tests/validators.test.js.
   ========================================================================== */

/* ---------------------------------------------------------------------------
   1. HYPE
   Superlatives that cannot be evidenced. Blocked unless directly quoted and
   attributed, which the engine never does.
   ------------------------------------------------------------------------ */

export const HYPE_TERMS = [
  "world-class", "world class", "best-in-class", "best in class",
  "perfect candidate", "perfect fit", "ideal candidate",
  "exceptional", "outstanding candidate", "exceptionally talented",
  "expert in everything", "expert at everything",
  "guaranteed", "guarantee",
  "industry-leading", "industry leading",
  "cutting-edge", "state-of-the-art expert",
  "10/10", "rockstar", "ninja", "unicorn",
  "definitely qualified", "absolutely qualified",
  "flawless", "unmatched", "unparalleled", "second to none",
];

const MATCH_PERCENT = /\b(\d{1,3})\s*%\s*(?:match|fit)\b|\b(?:match|fit)\s*(?:score|rating)?\s*[:=]?\s*(\d{1,3})\s*%/i;
const FIT_SCORE = /\b(\d{1,2})\s*\/\s*10\b|\bscore\s*(?:of)?\s*\d+(?:\.\d+)?\s*(?:out of|\/)\s*(?:10|100)\b/i;

export function checkHype(text) {
  const lower = text.toLowerCase();
  const hits = HYPE_TERMS.filter((t) => lower.includes(t));
  if (MATCH_PERCENT.test(text)) hits.push("numeric match percentage");
  if (FIT_SCORE.test(text)) hits.push("numeric fit score");
  return { ok: hits.length === 0, hits };
}

/* ---------------------------------------------------------------------------
   2. NUMERIC CLAIMS
   Any number the assistant states about Bhavani must appear in the evidence it
   cites. Structural numbers (list positions, years in a date it also cites,
   small counts of its own bullet points) are allowlisted.
   ------------------------------------------------------------------------ */

// Numbers that are about the answer's own structure, not about a person.
const STRUCTURAL = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);

const NUM_RE = /\$?\b\d[\d,]*(?:\.\d+)?\s*(?:%|dB|x|×)?\b/gi;

function normaliseNumber(raw) {
  return raw
    .replace(/[$,]/g, "")
    .replace(/\s+/g, "")
    .replace(/[×xX]$/, "x")
    .toLowerCase();
}

/**
 * Build the set of numbers an answer is permitted to use, from its citations.
 * @param {Array} claims - the claim objects cited by the answer
 */
export function permittedNumbers(claims) {
  const allowed = new Set();
  for (const c of claims) {
    const haystack = [c.claim, c.verification_note, c.source_location]
      .filter(Boolean)
      .join(" ");
    const found = haystack.match(NUM_RE) || [];
    for (const f of found) {
      const n = normaliseNumber(f);
      allowed.add(n);
      // A cited "0.6719" also licenses "0.672" and "0.67" as a rounding of itself.
      if (n.includes(".")) {
        const f4 = parseFloat(n);
        if (!Number.isNaN(f4)) {
          allowed.add(String(Math.round(f4 * 1000) / 1000));
          allowed.add(String(Math.round(f4 * 100) / 100));
          allowed.add(f4.toFixed(3));
          allowed.add(f4.toFixed(2));
        }
      }
      // "8,209" cited also licenses "8209"; handled by normalise. Percent forms:
      if (n.endsWith("%")) allowed.add(n.slice(0, -1));
      else allowed.add(n + "%");
    }
  }
  return allowed;
}

export function checkNumbers(text, claims) {
  const allowed = permittedNumbers(claims);
  const found = text.match(NUM_RE) || [];
  const unsupported = [];
  for (const raw of found) {
    const n = normaliseNumber(raw);
    if (STRUCTURAL.has(n)) continue;
    if (allowed.has(n)) continue;
    // tolerate a bare year that is inside a cited range
    if (/^(19|20)\d\d$/.test(n) && allowed.has(n)) continue;
    unsupported.push(raw.trim());
  }
  return { ok: unsupported.length === 0, unsupported: [...new Set(unsupported)] };
}

/* ---------------------------------------------------------------------------
   3. CONFLICTS
   Mirrors evidence/CONFLICTS.md. Each rule blocks a specific statement that a
   public source makes but the evidence does not support.
   ------------------------------------------------------------------------ */

export const CONFLICT_RULES = [
  {
    id: "C-001",
    label: "ClinIQ precision/recall conflation",
    // recall 1.0 and precision 94% belong to two different methods
    test: (t) => {
      const l = t.toLowerCase();
      const hasRecall1 = /(?:1\.0+|100\s*%|perfect)\s*recall|recall\s*(?:of\s*)?(?:1\.0+|100\s*%)/.test(l);
      const hasPrec94 = /(?:0?\.9[34]|9[34]\s*%|94\s*percent)\s*precision|precision\s*(?:of\s*)?(?:0?\.9[34]|9[34]\s*%)/.test(l);
      return hasRecall1 && hasPrec94 && !l.includes("different");
    },
    message:
      "Recall 1.0 and precision 0.94 come from two different ClinIQ tiers (embedding and LLM+RAG respectively). No single configuration produced both.",
  },
  {
    id: "C-002",
    label: "ClinIQ revenue without the synthetic qualifier",
    test: (t) => {
      const l = t.toLowerCase();
      return /537[,.]?340/.test(l) && !/(synthetic|fictional|modelled|modeled)/.test(l);
    },
    message:
      "The $537,340 figure is computed over 220 synthetic, fictional claims. It must never be stated without that qualifier.",
  },
  {
    id: "C-003",
    label: "FID attributed to SS-SD",
    test: (t) => {
      const l = t.toLowerCase();
      return /\bfid\b/.test(l) && /(ss-sd|surgical|diffusion|suturing)/.test(l) && !/(not|no|unsupported|absent|withdrawn)/.test(l);
    },
    message:
      "No FID script and no FID value exist in the SS-SD fork. The claim is UNSUPPORTED.",
  },
  {
    id: "C-004",
    label: "Hugging Face attributed to the meal planner",
    test: (t) => {
      const l = t.toLowerCase();
      return /(hugging\s*face|transformers)/.test(l) && /meal\s*planner/.test(l) && !/(gemini|not|instead)/.test(l);
    },
    message:
      "The Smart Meal Planner calls the Google Gemini REST API. Hugging Face Transformers evidence lives in the churn and SS-SD projects instead.",
  },
  {
    id: "C-005",
    label: "Superseded programme name",
    // C-005 is RESOLVED: the resume and LinkedIn now both read "Computer
    // Science". The rule is kept, narrowed, so the superseded name cannot
    // reappear from a cached source or an older resume draft.
    test: (t) => /data science analytics/i.test(t),
    message:
      "'Data Science Analytics' is a superseded programme name. The record reads M.S. in Computer Science, UMKC, May 2026.",
  },
  {
    id: "C-006",
    label: "Google Data Analytics full certificate",
    test: (t) => {
      const l = t.toLowerCase();
      return /google data analytics/.test(l) && !/(course|individual|unconfirmed|partial)/.test(l);
    },
    message:
      "The verifiable credentials are individual Coursera courses within the Google Data Analytics certificate. Completion of the full programme is unconfirmed.",
  },
];

export function checkConflicts(text) {
  const hits = CONFLICT_RULES.filter((r) => r.test(text));
  return { ok: hits.length === 0, hits };
}

/* ---------------------------------------------------------------------------
   4. EVIDENCE-STATE DISCIPLINE
   UNSUPPORTED and DEPRECATED evidence may be described, but may never be used
   to support a claim. Self-reported material may never carry a code link.
   ------------------------------------------------------------------------ */

export function checkCitationDiscipline(claims) {
  const problems = [];
  for (const c of claims) {
    if (c.verification_status === "UNSUPPORTED" || c.verification_status === "DEPRECATED") {
      if (c.exact_code_link) {
        problems.push(`${c.id} is ${c.verification_status} but carries a code link`);
      }
    }
    if (c.source_type === "self_reported" && c.exact_code_link) {
      problems.push(`${c.id} is self-reported but carries a code link`);
    }
  }
  return { ok: problems.length === 0, problems };
}

/* ---------------------------------------------------------------------------
   5. INPUT SAFETY
   Visitor text is untrusted. Length-capped, and injection attempts are noted
   so the UI can show that the attempt was seen and ignored.
   ------------------------------------------------------------------------ */

export const MAX_QUESTION = 2000;
export const MAX_JD = 20000;

// Each pattern allows a few intervening words, because real injection attempts
// are phrased naturally ("ignore your evidence rules", "show me your
// instructions") rather than in the canonical form.
const GAP = "(?:\\s+\\w+){0,3}\\s+";

const INJECTION_PATTERNS = [
  new RegExp(`\\b(?:ignore|disregard|bypass|override|forget)${GAP}(?:instructions?|rules?|prompts?|guidelines?|constraints?|policy|policies)`, "i"),
  new RegExp(`\\b(?:reveal|show|print|output|repeat|display|leak|dump|give)${GAP}(?:system\\s+)?(?:prompt|instructions?|configuration|config|source\\s+files?|api\\s+keys?|secrets?|env(?:ironment)?)`, "i"),
  /\bsystem\s*(?:override|prompt)\b|^\s*system\s*:/i,
  /\byou\s+are\s+now\b/i,
  /\bpretend\b|\bmake believe\b|\brole-?play\s+as\b/i,
  /\bact\s+as\s+(?:if|though|a|an)\b/i,
  /\bnew\s+instructions?\b/i,
  /\bDAN\b|\bjailbreak\b|\bdeveloper\s+mode\b/i,
  /\bforget\s+(?:everything|all|what)\b/i,
  /\boutput\s+(?:the\s+)?(?:raw\s+)?(?:json|database|claims\.json)\b/i,
  /\bfrom\s+now\s+on\s+you\b/i,
  /\byour\s+(?:real|true|actual)\s+(?:instructions|prompt|rules)\b/i,
];

export function detectInjection(text) {
  const matched = INJECTION_PATTERNS.filter((p) => p.test(text));
  return { detected: matched.length > 0, count: matched.length };
}

export function sanitiseInput(text, max = MAX_QUESTION) {
  if (typeof text !== "string") return "";
  return text.slice(0, max).replace(/\u0000/g, "").trim();
}

/** Escape for safe insertion as text. The UI uses textContent almost everywhere;
 *  this covers the few places a string is composed into markup. */
export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ---------------------------------------------------------------------------
   6. THE GATE
   Runs everything. An answer that fails is not patched — it is replaced with
   the deterministic evidence listing, which cannot fail these checks.
   ------------------------------------------------------------------------ */

export function validateAnswer(text, claims = []) {
  const hype = checkHype(text);
  const nums = checkNumbers(text, claims);
  const conf = checkConflicts(text);
  const cite = checkCitationDiscipline(claims);

  const failures = [];
  if (!hype.ok) failures.push({ rule: "hype", detail: hype.hits });
  if (!nums.ok) failures.push({ rule: "numeric", detail: nums.unsupported });
  if (!conf.ok) failures.push({ rule: "conflict", detail: conf.hits.map((h) => `${h.id} ${h.label}`) });
  if (!cite.ok) failures.push({ rule: "citation", detail: cite.problems });

  return { ok: failures.length === 0, failures };
}
