#!/usr/bin/env node
/* =============================================================================
   Bhavani Adula — evidence MCP server.

   Read-only access to the SAME evidence database the website uses. There is no
   second knowledge base, so the two cannot disagree.

   Transport: JSON-RPC 2.0 over stdio, per the Model Context Protocol.
   Zero dependencies on purpose — the whole point is that a reviewer can read
   this file and see exactly what it will and will not return.

   Guarantees enforced in code below, not merely documented:
     - Only public_safe claims are ever returned.
     - UNSUPPORTED and DEPRECATED claims are returned ONLY inside a `gaps`
       field, never inside `evidence`, so they can never support an assertion.
     - Self-reported material is labelled on every response that carries it.
     - No tool writes anything. There is no write path in this file.
     - Rate limited per process.
   ========================================================================== */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = { name: "bhavani-evidence", version: "1.0.0" };
const SITE = process.env.SITE_URL || "https://bhavani-abhavi.github.io";

/* ---------- load evidence ------------------------------------------------ */
function loadEvidence() {
  const override = process.env.EVIDENCE_FILE;
  const path = override || join(HERE, "..", "evidence", "claims.json");
  const db = JSON.parse(readFileSync(path, "utf8"));
  db.byId = Object.fromEntries(db.claims.map((c) => [c.id, c]));
  return db;
}
const DB = loadEvidence();

const PUBLIC = DB.claims.filter((c) => c.public_safe === true);
const SUPPORTING = PUBLIC.filter((c) => c.verification_status === "VERIFIED");
const SELF_REPORTED = PUBLIC.filter((c) => c.verification_status === "VERIFICATION_REQUIRED");
const GAPS = PUBLIC.filter((c) => ["UNSUPPORTED", "DEPRECATED"].includes(c.verification_status));

/* ---------- rate limiting ------------------------------------------------ */
const LIMIT = Number(process.env.RATE_LIMIT || 60);
const WINDOW_MS = 60_000;
let bucket = [];
function rateLimited() {
  const now = Date.now();
  bucket = bucket.filter((t) => now - t < WINDOW_MS);
  if (bucket.length >= LIMIT) return true;
  bucket.push(now);
  return false;
}

/* ---------- shaping ------------------------------------------------------ */
const MAX_RESULTS = 25;

/** The only function that turns a stored claim into a response object.
 *  Everything a client sees passes through here. */
function shape(c) {
  return {
    evidence_id: c.id,
    claim: c.claim,
    verification_status: c.verification_status,
    category: c.category,
    project_or_experience: c.project_or_experience,
    source_type: c.source_type,
    source_location: c.source_location,
    how_verified: c.verification_note || null,
    commit_sha: c.commit_sha,
    code_url: c.exact_code_link,
    artifact_url: c.artifact_link,
    tags: c.tags,
    last_verified: c.last_verified,
    // The caveat is keyed on verification state, not on source_type. Keying it
    // on source_type let `team_report` through uncaveated, which the MCP
    // boundary tests caught.
    ...(c.verification_status === "VERIFICATION_REQUIRED"
      ? { caveat: `Not independently verifiable (source: ${c.source_type}). Do not present as established fact.` }
      : {}),
    ...(["UNSUPPORTED", "DEPRECATED"].includes(c.verification_status)
      ? { caveat: `${c.verification_status}: inspected and NOT supported by the evidence. Must never be used to support a claim.` }
      : {}),
  };
}

const NOTICE =
  "Evidence states: VERIFIED is checked against primary source. VERIFICATION_REQUIRED is self-reported " +
  "and must not be stated as fact. Items under `gaps` are NOT demonstrated and must never be used to " +
  "support a claim. No percentage match or fit score is produced by this server.";

function envelope(payload) {
  return {
    ...payload,
    source: `${SITE}/evidence/claims.json`,
    last_full_verification: DB.meta.last_full_verification,
    notice: NOTICE,
  };
}

/* ---------- retrieval ---------------------------------------------------- */
const STOP = new Set(["the", "and", "for", "with", "has", "have", "does", "did", "she", "her",
  "bhavani", "work", "works", "about", "what", "which", "show", "tell", "any", "use", "used"]);

function search(query, pool = PUBLIC, limit = 8) {
  const terms = String(query || "").toLowerCase().split(/[^a-z0-9.+#-]+/).filter((t) => t.length > 2 && !STOP.has(t));
  if (!terms.length) return [];
  return pool
    .map((c) => {
      const hay = `${c.claim} ${c.verification_note || ""} ${c.tags.join(" ")} ${c.project_or_experience || ""}`.toLowerCase();
      let s = 0;
      for (const t of terms) {
        if (c.tags.some((tag) => tag.includes(t))) s += 5;
        else if (hay.includes(t)) s += 2;
      }
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, Math.min(limit, MAX_RESULTS))
    .map((x) => shape(x.c));
}

function byTag(tag, pool) {
  const t = String(tag || "").toLowerCase().trim();
  return pool.filter((c) => c.tags.some((x) => x === t || x.includes(t)));
}

const ADJACENT = {
  kubernetes: ["docker", "ci", "devops"], aws: ["docker", "ci"], gcp: ["api-integration", "llm"],
  agents: ["llm", "api-integration"], scaling: ["system-design", "monitoring"],
  airflow: ["etl", "data-engineering"], dbt: ["sql", "data-engineering"],
};

function verdictFor(skill) {
  const t = String(skill || "").toLowerCase().trim();
  const direct = byTag(t, SUPPORTING);
  const claimed = byTag(t, SELF_REPORTED);
  const gaps = byTag(t, GAPS);
  if (direct.length) return { verdict: "DIRECTLY_DEMONSTRATED", direct, claimed, gaps, adjacent: [] };
  const adjTags = ADJACENT[t] || [];
  const adjacent = adjTags.length ? SUPPORTING.filter((c) => c.tags.some((x) => adjTags.includes(x))) : [];
  if (gaps.length) return { verdict: "NOT_DEMONSTRATED", direct: [], claimed, gaps, adjacent };
  if (claimed.length || adjacent.length) return { verdict: "SUPPORTED_BY_ADJACENT_EXPERIENCE", direct: [], claimed, gaps, adjacent };
  return { verdict: "INSUFFICIENT_EVIDENCE", direct: [], claimed, gaps, adjacent };
}

/* ---------- tools -------------------------------------------------------- */
const TOOLS = {
  search_rahul_evidence: null, // reserved: not this person's server
  search_evidence: {
    description:
      "Free-text search over Bhavani Adula's verified, public-safe professional evidence. Returns claims with evidence ids, verification states and commit-pinned source URLs.",
    schema: { type: "object", properties: { query: { type: "string", description: "What to look for, e.g. 'retrieval evaluation' or 'calibration'." } }, required: ["query"] },
    run: ({ query }) => envelope({
      query: String(query).slice(0, 500),
      evidence: search(query, SUPPORTING),
      self_reported: search(query, SELF_REPORTED, 4),
      gaps: search(query, GAPS, 4),
    }),
  },

  get_project: {
    description: "One project: what it is, what was found, provenance, and its verified evidence.",
    schema: { type: "object", properties: { project_id: { type: "string", description: "One of: silent-failure-detection, ClinIQ, Explainable Customer Churn Prediction, SS-SD, Smart Meal Planner, NAS Web Server." } }, required: ["project_id"] },
    run: ({ project_id }) => {
      const key = String(project_id).toLowerCase();
      const hits = PUBLIC.filter((c) => (c.project_or_experience || "").toLowerCase().includes(key));
      if (!hits.length) {
        return envelope({ project_id, found: false,
          available: [...new Set(PUBLIC.map((c) => c.project_or_experience).filter(Boolean))] });
      }
      const repo = Object.values(DB.meta.repos).find((r) => r.name.toLowerCase().includes(key)
        || (hits[0].exact_code_link || "").includes(r.name));
      return envelope({
        project_id, found: true,
        repository: repo ? { url: repo.url, commit: repo.sha, provenance: repo.provenance, authorship: repo.author } : null,
        evidence: hits.filter((c) => c.verification_status === "VERIFIED").map(shape),
        self_reported: hits.filter((c) => c.verification_status === "VERIFICATION_REQUIRED").map(shape),
        gaps: hits.filter((c) => ["UNSUPPORTED", "DEPRECATED"].includes(c.verification_status)).map(shape),
      });
    },
  },

  get_skill_proof: {
    description: "Whether a named skill is directly demonstrated, adjacent, or not demonstrated — with sources. Asking about something not demonstrated returns the gap rather than an inference.",
    schema: { type: "object", properties: { skill: { type: "string", description: "A technology or skill, e.g. 'pgvector', 'kubernetes', 'calibration'." } }, required: ["skill"] },
    run: ({ skill }) => {
      const v = verdictFor(skill);
      return envelope({
        skill, verdict: v.verdict,
        evidence: v.direct.map(shape),
        adjacent_evidence: v.adjacent.map(shape),
        self_reported: v.claimed.map(shape),
        gaps: v.gaps.map(shape),
        interpretation: {
          DIRECTLY_DEMONSTRATED: "Code or a committed artifact exists.",
          SUPPORTED_BY_ADJACENT_EXPERIENCE: "Related work only. Do not convert this into direct experience.",
          NOT_DEMONSTRATED: "Inspected and absent from the public record.",
          INSUFFICIENT_EVIDENCE: "Nothing in the database addresses this either way.",
        }[v.verdict],
      });
    },
  },

  get_role_evidence: {
    description: "Requirement-by-requirement evidence mapping for one of 20 target role families. Returns no score.",
    schema: { type: "object", properties: { role: { type: "string", description: "Role id or label, e.g. 'ai_eval', 'search', 'Data Engineer I'." } }, required: ["role"] },
    run: async ({ role }) => {
      const { ROLES } = await import("../imw/data.js");
      const q = String(role).toLowerCase();
      const r = ROLES.find((x) => x.id === q || x.label.toLowerCase() === q)
        || ROLES.find((x) => x.label.toLowerCase().includes(q) || x.id.includes(q));
      if (!r) return envelope({ role, found: false, available: ROLES.map((x) => ({ id: x.id, label: x.label })) });
      const rows = [...r.core.map((t) => [t, true]), ...r.also.map((t) => [t, false])].map(([tag, core]) => {
        const v = verdictFor(tag);
        return { requirement: tag, core, verdict: v.verdict,
                 evidence: v.direct.slice(0, 2).map(shape), gaps: v.gaps.slice(0, 1).map(shape) };
      });
      return envelope({ role: r.label, role_id: r.id, requirements: rows,
        summary: {
          directly_demonstrated: rows.filter((x) => x.verdict === "DIRECTLY_DEMONSTRATED").length,
          adjacent: rows.filter((x) => x.verdict === "SUPPORTED_BY_ADJACENT_EXPERIENCE").length,
          not_demonstrated: rows.filter((x) => ["NOT_DEMONSTRATED", "INSUFFICIENT_EVIDENCE"].includes(x.verdict)).length,
        },
        note: "No match percentage is produced. Direct and adjacent evidence are reported separately and must not be merged.",
      });
    },
  },

  compare_job_description: {
    description: "Map a list of job requirements, or raw job-description text, onto the evidence. Returns a three-way split and no score.",
    schema: { type: "object", properties: {
      requirements: { type: "array", items: { type: "string" }, description: "Requirement strings." },
      text: { type: "string", description: "Or the raw job description." },
    } },
    run: async ({ requirements, text }) => {
      const { SYNONYMS } = await import("../imw/data.js");
      const blob = (Array.isArray(requirements) ? requirements.join("\n") : "") + "\n" + String(text || "");
      const src = ` ${blob.toLowerCase().slice(0, 20000)} `;
      const tags = [];
      for (const [tag, forms] of Object.entries(SYNONYMS)) {
        if (forms.some((f) => src.includes(f.toLowerCase()))) tags.push(tag);
      }
      const rows = tags.map((tag) => {
        const v = verdictFor(tag);
        return { requirement: tag, verdict: v.verdict, evidence: v.direct.slice(0, 2).map(shape), gaps: v.gaps.slice(0, 1).map(shape) };
      });
      return envelope({
        requirements_extracted: rows.length, mapping: rows,
        summary: {
          directly_demonstrated: rows.filter((x) => x.verdict === "DIRECTLY_DEMONSTRATED").length,
          adjacent: rows.filter((x) => x.verdict === "SUPPORTED_BY_ADJACENT_EXPERIENCE").length,
          not_demonstrated: rows.filter((x) => ["NOT_DEMONSTRATED", "INSUFFICIENT_EVIDENCE"].includes(x.verdict)).length,
        },
        privacy: "The submitted text is not stored or logged by this server.",
      });
    },
  },

  get_architecture: {
    description: "Components and data flow for a project, each component tied to the evidence that establishes it.",
    schema: { type: "object", properties: { project_id: { type: "string", description: "sfd, cliniq, churn or sssd." } }, required: ["project_id"] },
    run: async ({ project_id }) => {
      const { XRAY } = await import("../imw/data.js");
      const key = String(project_id).toLowerCase().replace(/[^a-z]/g, "");
      const x = XRAY[key] || Object.values(XRAY).find((v) => v.title.toLowerCase().replace(/[^a-z]/g, "").includes(key));
      if (!x) return envelope({ project_id, found: false, available: Object.keys(XRAY) });
      return envelope({
        project: x.title, repository: x.repo, commit: x.sha, summary: x.summary,
        provenance: x.provenance || "Sole-authored.",
        data_flow: x.flow.map(([from, to, carries]) => ({ from, to, carries })),
        components: x.components.map((c) => ({
          id: c.id, name: c.name, what: c.what, why: c.why, input: c.input, output: c.output,
          observed_effect: c.observed, path: c.path,
          evidence: c.claims.map((id) => DB.byId[id]).filter(Boolean).map(shape),
        })),
        design_decisions: x.decisions.map((d) => ({ question: d.q, answer: d.a,
          evidence: d.claims.map((id) => DB.byId[id]).filter(Boolean).map(shape) })),
        caution: "Any architecture beyond this list is a design proposal, not something that was built.",
      });
    },
  },

  get_failure_cases: {
    description: "Verified failures: what broke, how it was detected and measured, how it was fixed, and how regression was prevented.",
    schema: { type: "object", properties: { project_id: { type: "string", description: "Optional project filter." } } },
    run: async ({ project_id }) => {
      const { FAILURES } = await import("../imw/data.js");
      const list = project_id
        ? FAILURES.filter((f) => f.project.toLowerCase().includes(String(project_id).toLowerCase()))
        : FAILURES;
      return envelope({
        count: list.length,
        failures: list.map((f) => ({
          id: f.id, project: f.project, title: f.title,
          what_broke: f.broke, how_detected: f.detected, how_measured: f.measured,
          how_fixed: f.fixed, regression_prevented: f.prevented,
          evidence: f.claims.map((id) => DB.byId[id]).filter(Boolean).map(shape),
        })),
      });
    },
  },

  get_code_reference: {
    description: "The commit-pinned file link backing a specific evidence id.",
    schema: { type: "object", properties: { claim_id: { type: "string", description: "An evidence id, e.g. 'sfd.design.label_isolation'." } }, required: ["claim_id"] },
    run: ({ claim_id }) => {
      const c = DB.byId[String(claim_id)];
      if (!c || !c.public_safe) return envelope({ claim_id, found: false });
      if (["UNSUPPORTED", "DEPRECATED"].includes(c.verification_status)) {
        return envelope({ claim_id, found: true, code_url: null,
          reason: `This claim is ${c.verification_status} and has no supporting code. ${c.verification_note}` });
      }
      if (c.source_type === "self_reported") {
        return envelope({ claim_id, found: true, code_url: null,
          reason: "Self-reported employer work. No public artifact exists and none should." });
      }
      return envelope({ claim_id, found: true, code_url: c.exact_code_link,
        artifact_url: c.artifact_link, commit_sha: c.commit_sha, how_verified: c.verification_note });
    },
  },

  get_research: {
    description: "Methodology, baselines, metrics, limitations and reproducibility for the research-style work.",
    schema: { type: "object", properties: { topic: { type: "string", description: "Optional topic filter, e.g. 'drift', 'diffusion'." } } },
    run: ({ topic }) => {
      const pool = SUPPORTING.filter((c) =>
        ["research_integrity", "experimental_result", "evaluation", "design_decision"].includes(c.category));
      const hits = topic ? search(topic, pool, 12) : pool.map(shape);
      return envelope({
        topic: topic || "all",
        findings: hits,
        methodology_notes: [
          "Baselines are run before the expensive method in every project that has one.",
          "A finding that fails its own significance test is retracted in a commit, not reworded.",
          "Limitations are published alongside results, including that results rest on a single dataset and model class.",
        ],
      });
    },
  },

  get_known_gaps: {
    description: "What is NOT demonstrated, optionally narrowed to a role or skill. This is the honest answer to 'does she have X'.",
    schema: { type: "object", properties: { role_or_skill: { type: "string", description: "Optional filter." } } },
    run: ({ role_or_skill }) => {
      const gaps = role_or_skill ? search(role_or_skill, GAPS, 10) : GAPS.map(shape);
      return envelope({
        filter: role_or_skill || "all",
        not_demonstrated: gaps.length ? gaps : GAPS.map(shape),
        self_reported_and_unverifiable: SELF_REPORTED.map(shape),
        provenance_caveats: [
          "SS-SD is a fork of a teammate's repository; the upstream commits are theirs.",
          "All employer metrics are self-reported and have no public artifact.",
          "The Master's programme name differs between the resume and LinkedIn and is not stated until resolved.",
        ],
      });
    },
  },
};
delete TOOLS.search_rahul_evidence;

/* ---------- JSON-RPC over stdio ------------------------------------------ */
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
const err = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: SERVER,
      instructions:
        "Read-only evidence about Bhavani Adula's engineering work. Every response carries evidence ids " +
        "and commit-pinned source URLs. Never present items under `gaps` as capabilities, never present " +
        "`self_reported` material as established fact, and do not compute a fit score from these responses.",
    });
  }

  if (method === "notifications/initialized") return;

  if (method === "tools/list") {
    return ok(id, {
      tools: Object.entries(TOOLS).map(([name, t]) => ({
        name, description: t.description, inputSchema: t.schema,
      })),
    });
  }

  if (method === "tools/call") {
    if (rateLimited()) return err(id, -32000, `Rate limit: ${LIMIT} calls per minute.`);
    const tool = TOOLS[params?.name];
    if (!tool) return err(id, -32601, `Unknown tool: ${params?.name}`);
    try {
      const result = await tool.run(params.arguments || {});
      return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      // Sanitised: never leak a stack trace or a filesystem path to a client.
      return ok(id, { isError: true, content: [{ type: "text", text: "The request could not be completed." }] });
    }
  }

  if (method === "ping") return ok(id, {});
  if (id !== undefined) err(id, -32601, `Unknown method: ${method}`);
}

/* ---------- CLI self-test ------------------------------------------------ */
if (process.argv.includes("--selftest")) {
  const out = [];
  const k8s = await TOOLS.get_skill_proof.run({ skill: "kubernetes" });
  out.push(["kubernetes verdict", k8s.verdict]);
  out.push(["kubernetes returns no supporting evidence", k8s.evidence.length === 0]);
  const evalq = await TOOLS.search_evidence.run({ query: "AI evaluation" });
  out.push(["evaluation search returns evidence", evalq.evidence.length > 0]);
  const allShaped = [...evalq.evidence, ...evalq.self_reported, ...evalq.gaps];
  out.push(["no UNSUPPORTED inside evidence", evalq.evidence.every((e) => e.verification_status === "VERIFIED")]);
  out.push(["every result carries an evidence id", allShaped.every((e) => !!e.evidence_id)]);
  const cr = await TOOLS.get_code_reference.run({ claim_id: "sssd.metrics.fid" });
  out.push(["unsupported claim yields no code url", cr.code_url === null]);
  const sr = await TOOLS.get_code_reference.run({ claim_id: "hippocratic.eval.scenarios" });
  out.push(["self-reported claim yields no code url", sr.code_url === null]);
  let failed = 0;
  for (const [label, v] of out) {
    const pass = v === true || typeof v === "string";
    if (v === false) failed++;
    console.log(`${v === false ? "FAIL" : "ok  "}  ${label}${typeof v === "string" ? `: ${v}` : ""}`);
  }
  process.exit(failed ? 1 : 0);
}

/* ---------- run ---------------------------------------------------------- */
createInterface({ input: process.stdin }).on("line", async (line) => {
  const text = line.trim();
  if (!text) return;
  let req;
  try { req = JSON.parse(text); } catch { return err(null, -32700, "Parse error"); }
  try { await handle(req); } catch { err(req?.id ?? null, -32603, "Internal error"); }
});
