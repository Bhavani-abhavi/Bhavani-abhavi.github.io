# bhavani-abhavi.github.io

Portfolio for Bhavani Adula, with an evidence layer that can be inspected rather than taken on trust.

The premise: a portfolio is a set of claims, and claims are cheap. So every substantive claim on this
site is recorded in a structured database, given a verification state, and pinned to a specific commit
in a specific repository. What could not be verified says so. What is missing is listed.

**Interview My Work** is the interface onto that database — six tabs that let a reviewer interrogate the
evidence, map it to a role, inspect an architecture, replay a real evaluation run, and try to break the
assistant's grounding.

---

## Layout

```
index.html                  the site
assets/css/main.css         design tokens and components
assets/js/main.js           site shell only (4 KB) — lazily imports the workspace

evidence/
  claims.json               44 claims. The single source of truth.
  CONFLICTS.md              claims a public source makes that the evidence does not support

imw/                        Interview My Work — loaded only when opened
  workspace.js              six-tab UI
  engine.js                 intent -> structured lookup -> validation -> citation
  validators.js             hype, numeric, conflict and injection guards
  data.js                   roles, architectures, failure cases, adversarial cases
  fixtures/                 recorded artifacts for the Proof Lab

mcp/server.mjs              read-only MCP server over the same evidence
backend/worker.mjs          optional LLM layer (the site works fully without it)
tools/                      lint, link check, build gate, local server
tests/                      78 tests across evidence, behaviour and MCP boundaries
```

---

## Evidence states

| state | meaning |
|---|---|
| `VERIFIED` | Checked against code, a committed data file, or a test. Carries a commit-pinned link. |
| `VERIFICATION_REQUIRED` | Self-reported, typically employer-internal. Never stated as fact. Carries **no** code link. |
| `UNSUPPORTED` | Inspected and not supported. May be described, never used as support. |
| `DEPRECATED` | Previously claimed, since retracted. |

Current counts: **28 verified · 12 needs verification · 4 documented gaps.**

Two invariants are enforced by tests, because both are ways to mislead by implication:

- Only `VERIFIED` claims carry a code link. A link on an unverified claim reads as proof of it.
- Adjacent evidence is never merged into direct evidence, anywhere in the system.

---

## What the assistant will not do

It runs deterministically in the browser. No network call is needed to answer a supported question.

- No hiring recommendation, no match percentage, no fit score — none of these can be evidenced.
- No superlatives. `validators.js` blocks them and the tests assert no answer contains one.
- No number about Bhavani that does not appear in the evidence it cites. An answer that fails this
  check is **replaced** by the raw evidence, not edited into compliance.
- No agreement with a false premise. Ask it about Kubernetes and it returns the gap.
- No chain-of-thought. Only the supporting claim, its source, and the code.

---

## Running it

```bash
npm run serve      # http://localhost:8080
npm test           # 78 tests
npm run verify     # lint + tests + link check + build gate
```

`npm run verify` is what CI runs. It fails if:

- a number on the site stops matching its source in `claims.json`
- a commit-pinned evidence link stops resolving
- an answer in the evaluation suite starts hyping, inventing a figure, or accepting a false premise
- the initial payload exceeds its budget, or the workspace stops being lazily loaded

The link check also runs weekly on a schedule, because evidence drifts without anyone touching the repo.

---

## MCP server

The same evidence, read-only, for MCP-compatible clients:

```json
{
  "mcpServers": {
    "bhavani-evidence": {
      "command": "node",
      "args": ["/absolute/path/to/mcp/server.mjs"]
    }
  }
}
```

Ten tools: `search_evidence`, `get_project`, `get_skill_proof`, `get_role_evidence`,
`compare_job_description`, `get_architecture`, `get_failure_cases`, `get_code_reference`,
`get_research`, `get_known_gaps`.

`node mcp/server.mjs --selftest` checks the boundaries in one command. There is no write path in the
file, one filesystem read, and no subprocess spawn — `tests/mcp.test.mjs` asserts all three.

---

## Optional AI layer

`backend/worker.mjs` deploys to Cloudflare Workers and handles phrasings the deterministic engine
cannot parse. It is held to the same evidence and the same validators, and a generated answer that
cites an id outside its injected context is discarded rather than repaired.

The site works completely without it. If it is down, rate-limited, or never deployed, the in-browser
engine answers everything it always did.

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler deploy
```

No provider key ever reaches the browser. `tools/lint.mjs` fails the build if client-side code so much
as references one.

---

## Privacy

Pasted job descriptions are analysed in the browser and never leave it. The optional backend holds a
request in memory for its lifetime and writes nothing to any log or store. No PHI, private employer
material, or credentials appear anywhere in this repository; `tests/evidence.test.mjs` scans for them.

---

## Known limitations

Stated here rather than discovered later:

- Two flagship projects (ClinIQ, SS-SD) are forks of teammates' repositories. The code commits are
  theirs. This is marked on the site, in the evidence database, and in every MCP response.
- All employer metrics are self-reported with no public artifact, which is normal for industry work
  and is labelled as such throughout.
- Seven entries in `CONFLICTS.md` are unresolved, three of them P0. They are documented rather than
  quietly corrected, and the assistant is blocked from repeating any of them.
- The Proof Lab replays committed artifacts. It is labelled `ARTIFACT REPLAY` and is not live
  computation; no model runs in your browser.
