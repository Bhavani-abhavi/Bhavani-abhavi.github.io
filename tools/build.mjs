#!/usr/bin/env node
/* =============================================================================
   build.mjs — production readiness gate.

   This is a static site, so "build" means: prove the deployable set is complete,
   prove the initial payload stayed small, and prove the heavy parts are still
   behind the lazy boundary.
   ========================================================================== */

import { readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const size = (p) => (existsSync(join(root, p)) ? statSync(join(root, p)).size : null);

/* ---------- 1. the deployable set exists --------------------------------- */
const REQUIRED = [
  "index.html",
  "assets/css/main.css",
  "assets/js/main.js",
  "imw/workspace.js",
  "imw/workspace.css",
  "imw/engine.js",
  "imw/validators.js",
  "imw/data.js",
  "imw/fixtures/sfd_backtest.json",
  "evidence/claims.json",
  "evidence/CONFLICTS.md",
  "mcp/server.mjs",
  "backend/worker.mjs",
];
for (const f of REQUIRED) {
  if (size(f) === null) problems.push(`missing: ${f}`);
}

/* ---------- 2. initial payload budget ------------------------------------ */
// What a first-time visitor downloads before touching Interview My Work.
const INITIAL = ["index.html", "assets/css/main.css", "assets/js/main.js"];
const initialBytes = INITIAL.reduce((n, f) => n + (size(f) || 0), 0);
const BUDGET = 60 * 1024; // uncompressed; ~15 KB over the wire with gzip

// Everything that must NOT load until the workspace is opened.
const DEFERRED = [
  "imw/workspace.js", "imw/workspace.css", "imw/engine.js",
  "imw/validators.js", "imw/data.js", "imw/fixtures/sfd_backtest.json",
];
const deferredBytes = DEFERRED.reduce((n, f) => n + (size(f) || 0), 0);

if (initialBytes > BUDGET) {
  problems.push(`initial payload ${kb(initialBytes)} exceeds the ${kb(BUDGET)} budget`);
}

/* ---------- 3. the lazy boundary actually holds -------------------------- */
const html = readFileSync(join(root, "index.html"), "utf8");
for (const f of DEFERRED) {
  const base = f.split("/").pop();
  // A deferred file must not be referenced by a src/href in the initial document.
  const re = new RegExp(`(?:src|href)="[^"]*${base.replace(".", "\\.")}"`);
  if (re.test(html)) problems.push(`${f} is loaded eagerly from index.html — it must stay behind the dynamic import`);
}
const mainJs = readFileSync(join(root, "assets", "js", "main.js"), "utf8");
if (!/import\(\s*["'][^"']*workspace\.js/.test(mainJs)) {
  problems.push("main.js does not dynamically import the workspace — the lazy boundary is gone");
}
if (/^\s*import\s+[^(]*from\s+["'][^"']*workspace\.js/m.test(mainJs)) {
  problems.push("main.js statically imports the workspace — it would load on every page view");
}

/* ---------- 4. the site must survive the AI layer failing ---------------- */
if (!/catch\s*\(/.test(mainJs) || !/failed to load/i.test(mainJs)) {
  problems.push("main.js does not handle the workspace failing to load");
}

/* ---------- 5. no secret may be present in a deployable file ------------- */
for (const f of REQUIRED) {
  if (f.startsWith("backend/")) continue;
  const body = readFileSync(join(root, f), "utf8");
  if (/sk-ant-|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30}/.test(body)) {
    problems.push(`${f} contains something shaped like a credential`);
  }
}

/* ---------- 6. evidence parses and is non-trivial ------------------------ */
try {
  const db = JSON.parse(readFileSync(join(root, "evidence", "claims.json"), "utf8"));
  if (!Array.isArray(db.claims) || db.claims.length < 20) {
    problems.push("evidence database is missing or implausibly small");
  }
} catch (e) {
  problems.push(`evidence/claims.json does not parse: ${e.message}`);
}

/* ---------- report ------------------------------------------------------- */
console.log("deployable set");
for (const f of REQUIRED) {
  const s = size(f);
  console.log(`  ${s === null ? "MISSING".padEnd(9) : kb(s).padStart(9)}  ${f}`);
}
console.log("");
console.log(`initial payload   ${kb(initialBytes).padStart(9)}  (budget ${kb(BUDGET)})`);
console.log(`deferred chunk    ${kb(deferredBytes).padStart(9)}  loaded only when Interview My Work opens`);
console.log(`ratio             ${(deferredBytes / initialBytes).toFixed(1)}x deferred vs initial`);
console.log("");

if (problems.length) {
  console.error("BUILD FAILED\n");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("build ok");
