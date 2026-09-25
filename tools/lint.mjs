#!/usr/bin/env node
/* =============================================================================
   lint.mjs — static checks that do not need a toolchain.
   Secrets, accessibility basics, and module parse validity.
   ========================================================================== */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative, extname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const warn = [];

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const files = walk(root);
const rel = (p) => relative(root, p).replace(/\\/g, "/");

/* ---------- 1. secrets ---------------------------------------------------- */
const SECRET_PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/, "Anthropic API key"],
  [/sk-[A-Za-z0-9]{32,}/, "OpenAI-style API key"],
  [/AIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/ghp_[A-Za-z0-9]{30,}/, "GitHub token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/(?:password|passwd|secret)\s*[:=]\s*["'][^"'{$][^"']{6,}["']/i, "hardcoded credential"],
];

for (const f of files) {
  if (![".js", ".mjs", ".json", ".html", ".css", ".md", ".yml", ".yaml"].includes(extname(f))) continue;
  const body = readFileSync(f, "utf8");
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(body)) problems.push(`${rel(f)}: possible ${label} committed`);
  }
}

/* ---------- 2. no API key may reach the browser -------------------------- */
for (const f of files.filter((p) => rel(p).startsWith("assets/") || rel(p).startsWith("imw/"))) {
  if (extname(f) !== ".js") continue;
  const body = readFileSync(f, "utf8");
  if (/ANTHROPIC_API_KEY|OPENAI_API_KEY|api[_-]?key\s*[:=]\s*["']/i.test(body)) {
    problems.push(`${rel(f)}: client-side code references an API key. Keys must stay server-side.`);
  }
}

/* ---------- 3. accessibility basics in HTML ------------------------------ */
const html = readFileSync(join(root, "index.html"), "utf8");

for (const m of html.matchAll(/<img\b[^>]*>/g)) {
  if (!/\balt=/.test(m[0])) problems.push(`index.html: <img> without alt — ${m[0].slice(0, 60)}`);
}
for (const m of html.matchAll(/<button\b[^>]*>/g)) {
  if (!/\btype=/.test(m[0])) problems.push(`index.html: <button> without type — ${m[0].slice(0, 60)}`);
  if (!/>[^<]*\S/.test(html.slice(m.index, m.index + 200)) && !/aria-label=/.test(m[0])) {
    problems.push(`index.html: <button> with no accessible name — ${m[0].slice(0, 60)}`);
  }
}
if (!/<html[^>]+lang=/.test(html)) problems.push("index.html: <html> missing lang");
if (!/class="skip"/.test(html)) problems.push("index.html: no skip link");
if (!/<title>/.test(html)) problems.push("index.html: no <title>");
if (!/name="viewport"[^>]+viewport-fit=cover/.test(html)) warn.push("index.html: viewport lacks viewport-fit=cover (safe areas)");

// every in-page anchor must have a target
for (const m of html.matchAll(/href="#([a-zA-Z0-9_-]+)"/g)) {
  const id = m[1];
  if (id === "top") continue;
  if (!new RegExp(`id="${id}"`).test(html)) problems.push(`index.html: anchor #${id} has no target`);
}

/* ---------- 4. reduced motion + both themes ------------------------------ */
const css = readFileSync(join(root, "assets", "css", "main.css"), "utf8");
if (!/prefers-reduced-motion/.test(css)) problems.push("main.css: no prefers-reduced-motion handling");
if (!/:root:not\(\[data-theme="light"\]\)/.test(css)) problems.push("main.css: dark media query is not guarded against an explicit light choice");
if (!/:root\[data-theme="dark"\]/.test(css)) problems.push("main.css: no explicit dark theme block");
if (!/body\s*\{[^}]*background:/.test(css)) problems.push("main.css: body has no explicit background");
if (!/:focus-visible/.test(css)) problems.push("main.css: no visible focus style");

// every token used must be declared on the bare :root
const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
for (const t of used) {
  if (!declared.has(t)) problems.push(`main.css: var(${t}) used but never declared`);
}

/* ---------- 5. modules parse -------------------------------------------- */
for (const f of files.filter((p) => [".js", ".mjs"].includes(extname(p)))) {
  const r = rel(f);
  // Importing a module runs it. tools/ and tests/ are executables with side
  // effects (network calls, process.exit) and are exercised by npm scripts,
  // not by being imported here. backend/ and mcp/ are node-only entrypoints.
  if (/^(tools|tests|backend|mcp)\//.test(r)) continue;
  try {
    await import(pathToFileURL(f).href);
  } catch (err) {
    // Browser modules that call fetch at import time are expected to fail here.
    if (!/fetch is not defined|Cannot read properties|document is not defined/.test(String(err))) {
      problems.push(`${rel(f)}: module failed to parse — ${err.message}`);
    }
  }
}

/* ---------- 6. leftover markers ----------------------------------------- */
for (const f of files.filter((p) => [".js", ".mjs", ".html", ".css"].includes(extname(p)))) {
  if (rel(f) === "tools/lint.mjs") continue; // this file names the markers it searches for
  const body = readFileSync(f, "utf8");
  for (const m of body.matchAll(/\b(TODO|FIXME|XXX|HACK)\b/g)) {
    warn.push(`${rel(f)}: leftover ${m[1]}`);
  }
  if (/console\.log\(/.test(body) && !/^(tools|tests|mcp)\//.test(rel(f))) {
    // mcp/ writes JSON-RPC frames to stdout; stdout is its transport, not logging.
    warn.push(`${rel(f)}: console.log in shipped code`);
  }
}

/* ---------- report ------------------------------------------------------- */
for (const w of warn) console.warn(`  warn  ${w}`);
if (problems.length) {
  console.error("\nLINT FAILED\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log(`lint ok — ${files.length} files, ${warn.length} warning(s)`);
