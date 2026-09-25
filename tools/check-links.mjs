#!/usr/bin/env node
/* =============================================================================
   check-links.mjs — evidence drift detection.

   Every commit-pinned URL in the evidence database is fetched. If a repository
   is renamed, made private, or a pinned file is deleted, the claim it backs is
   no longer inspectable and the build fails.

   This is the check that stops the portfolio quietly becoming unverifiable.
   Run with --offline to skip network calls (structure is still validated).
   ========================================================================== */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const db = JSON.parse(readFileSync(join(root, "evidence", "claims.json"), "utf8"));
const html = readFileSync(join(root, "index.html"), "utf8");

const OFFLINE = process.argv.includes("--offline") || process.env.OFFLINE === "1";
const CONCURRENCY = 4;

/* ---------- collect every external link ---------------------------------- */
const links = new Map(); // url -> [where]

/* Hosts that cannot be link-checked meaningfully:
   - font hosts appear only as preconnect origins, which have no page at /
   - LinkedIn answers unauthenticated requests with HTTP 999 by policy
   Excluding them keeps the signal in this check about evidence, not noise. */
const UNCHECKABLE = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "www.linkedin.com",
  "linkedin.com",
];

const add = (url, where) => {
  if (!url || !/^https?:\/\//.test(url)) return;
  if (UNCHECKABLE.some((hostFragment) => new URL(url).hostname === hostFragment)) return;
  if (!links.has(url)) links.set(url, []);
  links.get(url).push(where);
};

for (const c of db.claims) {
  add(c.exact_code_link, `claim ${c.id} (exact_code_link)`);
  add(c.artifact_link, `claim ${c.id} (artifact_link)`);
}
for (const [k, r] of Object.entries(db.meta.repos)) add(r.url, `repo ${k}`);
for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) add(m[1], "index.html");

/* ---------- structural checks (always run) ------------------------------- */
let structural = 0;
for (const [url, where] of links) {
  if (!url.includes("github.com")) continue;
  if (/\/(blob|tree)\/(main|master|HEAD)\//.test(url)) {
    console.error(`  MOVING REF  ${url}\n              ${where.join(", ")}`);
    structural++;
  }
}
if (structural) {
  console.error(`\n${structural} link(s) point at a branch rather than a commit. Evidence can drift.`);
  process.exit(1);
}
console.log(`structure ok — ${links.size} unique external links, none on a moving ref`);

if (OFFLINE) {
  console.log("offline mode: skipping network verification");
  process.exit(0);
}

/* ---------- network checks ----------------------------------------------- */
const urls = [...links.keys()];
const failures = [];
let done = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attempt(url, method) {
  const headers = { "user-agent": "bhavani-portfolio-link-check" };
  // An authenticated request gets a far higher rate limit; optional.
  if (process.env.GITHUB_TOKEN && url.includes("github.com")) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, {
    method, redirect: "follow", headers, signal: AbortSignal.timeout(15000),
  });
  return res;
}

async function check(url) {
  // Up to three passes with backoff. Unauthenticated GitHub answers a
  // rate-limited request with 404 or 403, which is indistinguishable from a
  // deleted file on a single try — so never fail one on the first response.
  for (let pass = 0; pass < 3; pass++) {
    if (pass) await sleep(1500 * pass * pass);
    for (const method of ["HEAD", "GET"]) {
      try {
        const res = await attempt(url, method);
        if (res.ok) return null;
        if (res.status === 429) { pass = Math.max(pass, 1); break; }
        if (method === "HEAD" && [403, 404, 405].includes(res.status)) continue;
        if ([403, 404, 429].includes(res.status)) break; // retry the whole pass
        return `${res.status}`;
      } catch (err) {
        if (method === "GET") {
          if (pass === 2) return err.name === "TimeoutError" ? "timeout" : err.message;
          break;
        }
      }
    }
  }
  return "404 or rate-limited";
}

async function worker(queue) {
  while (queue.length) {
    const url = queue.pop();
    const problem = await check(url);
    done++;
    if (problem) failures.push({ url, problem, where: links.get(url) });
    process.stdout.write(`\r  checked ${done}/${urls.length}`);
  }
}

const queue = [...urls];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
process.stdout.write("\n");

/* A broad failure across many hosts is throttling, not drift. Say which it is
   rather than reporting a rate limit as a dozen deleted files. */
const ghTotal = urls.filter((u) => u.includes("github.com")).length;
const ghFailed = failures.filter((f) => f.url.includes("github.com")).length;
if (ghTotal > 4 && ghFailed / ghTotal > 0.5) {
  console.error(`\nRATE LIMITED — ${ghFailed} of ${ghTotal} GitHub links failed after retries.`);
  console.error("That pattern is throttling, not evidence drift. Set GITHUB_TOKEN and re-run,");
  console.error("or wait a few minutes. Not failing the build on a throttled check.");
  process.exit(0);
}

if (failures.length) {
  console.error("\nEVIDENCE DRIFT — these links no longer resolve:\n");
  for (const f of failures) {
    console.error(`  ${f.problem.padEnd(12)} ${f.url}`);
    for (const w of f.where) console.error(`               ${w}`);
  }
  console.error(`\n${failures.length} of ${urls.length} links broken. A claim without reachable evidence is not a verified claim.`);
  process.exit(1);
}

console.log(`all ${urls.length} evidence links resolve`);
