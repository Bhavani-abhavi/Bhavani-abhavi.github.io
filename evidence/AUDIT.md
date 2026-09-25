# Pre-Launch Audit

Release-blocking review of the portfolio and its evidence layer, run from the perspectives named in
the brief: AI/ML engineering, evaluation, data, platform, NLP/search, vision, recruiting, hiring
management, founder, UX, accessibility and security.

Date: 2026-09-25 · Scope: `bhavani-portfolio` at working state · Method: direct inspection of pinned
sources, 79 automated tests, adversarial evaluation, static analysis, link resolution.

---

## Verdict

**Not production-ready.** Two P0 items remain, both needing a LinkedIn edit only Bhavani can make.
Nothing in the codebase blocks release; the blockers are factual.

| gate | state |
|---|---|
| Lint | pass |
| Tests (79) | pass |
| AI grounding evaluations | pass |
| Evidence link resolution (45 links) | pass |
| Production build gate | pass |
| Critical accessibility | pass |
| Critical security | pass |
| **Every public professional claim supported** | **FAIL — 2 P0** |

---

## P0 — release blockers

### P0-1 · ClinIQ "1.0 recall and 94% precision" on LinkedIn
`CONFLICTS.md` C-001. The two figures belong to two different retrieval tiers. The embedding tier
reached recall 1.000 at precision 0.504; the LLM+RAG tier reached precision 0.9375 at recall 0.400. No
configuration produced both, and `outputs/method_comparison_results.csv` shows it.

As written, the claim describes a system better than anything the evaluation produced. Requires a
LinkedIn edit. The portfolio never repeats it.

### P0-2 · ClinIQ revenue figure stated without the synthetic qualifier
`CONFLICTS.md` C-002. "$537,340 in recoverable revenue" is arithmetically correct and CMS-sourced, but
the input population is **220 fictional claims**, stated in the same output file. In a healthcare
context a reader will take it as money found in a real payer population. Requires a LinkedIn edit.

---

## P1 — important

| id | finding | action |
|---|---|---|
| P1-1 | **FID claimed for SS-SD** (C-003). No script in the fork, no value anywhere. | Remove from LinkedIn and the AI résumé, or merge `compute_fid.py` and publish a result. |
| P1-2 | **Hugging Face attributed to the meal planner** (C-004). It calls the Gemini REST API. | Correct the LinkedIn description. The skill itself is fine — anchor it to the churn and SS-SD work. |
| P1-3 | **Two résumé variants in circulation** (C-007) with different claims and different lead projects. | Pick one canonical. `BhavaniAdula_AIML_Resume.pdf` is the more defensible and is now the one the site serves. |
| P1-4 | **SS-SD PSNR/SSIM figures are unpublished.** The numbers exist only in a private team report. | Commit `reports/metrics.json` to the fork. One commit moves this claim to VERIFIED. |
| P1-5 | **NSF NRT 4th place has no independent source.** Consistent across self-authored sources only. | Link an organiser-published result if one exists. Otherwise it stays self-reported. |

## P2 — polish

| id | finding | action |
|---|---|---|
| P2-1 | **Google Data Analytics** (C-006): the verifiable credentials are two individual Coursera courses, not the professional certificate. | Check the Coursera account; list what was actually completed. |
| P2-2 | **NAS project is documentation only.** No implementation is published, so none of its described features can be inspected. | Either publish the code or reframe the entry as a design/documentation artifact. |
| P2-3 | **Yrall and Hippocratic work has no public analogue** beyond adjacent inference. | Optional: a small public repo demonstrating lineage-in-CI would convert two VERIFICATION_REQUIRED claims into demonstrable skill. |

---

## Defects found and fixed during the audit

These were real, were caught by the test suite or by inspection, and are closed.

**Over-claiming in role mappings (was P0).** Eight of twenty role families reported zero gaps and zero
adjacent requirements. Cause: role requirement lists had been written from the candidate's own
strengths, which is circular — a role defined by what someone has will always look like a perfect
match. Rewritten from what those roles actually demand, including `kubernetes`, `aws`, `serving`,
`scaling`, `ner`, `spark`, `load-testing` and others that are genuinely absent. Now **zero** roles
report flawless coverage, and a test asserts it stays that way.

**Implied proof on unverified claims (was P0).** `sssd.metrics.psnr_ssim` was VERIFICATION_REQUIRED but
linked to `metrics_on_grid.py`. That script evidences that the evaluation code exists, not that those
numbers were produced by it — but a code link on a claim reads as proof of the claim. Found by the MCP
boundary tests. Now an enforced invariant: **only VERIFIED claims carry a code link**, and the
database was swept for other instances (one more, `sssd.metrics.fid`).

**Prompt-injection detection too narrow (was P0).** Four of nine attack phrasings passed undetected,
including "ignore your evidence rules" and "show me your instructions" — the patterns required the
canonical wording with no intervening words. Rewritten to tolerate up to three intervening tokens.
All nine now detected, and the fourteen recorded attack cases pass.

**Unlicensed numbers in composed answers (was P0).** Several answers stated figures (35 windows,
1,054,948 loans, 52,184 reviews) while citing claims that did not contain them — the numbers were
correct, but the citation set depended on whatever retrieval happened to return. Answers now cite
explicit anchor claims that licence their own figures. Every generated answer passes numeric
validation against its own citations, asserted across ten probe questions.

**Retrieval answered out-of-scope questions (was P1).** "Tell me about her quantum computing work"
returned Silent Failure Detection, because the word "work" matched. Added a stopword list and a
relevance floor: a hit now needs a canonical tag match or two substantive lexical matches.

**`#interview` anchor dead-ended without JavaScript (was P1).** Eight CTAs pointed at an id that did
not exist; with JS disabled they went nowhere. The contextual CTA section now carries that id and
explains where the evidence lives without the workspace.

**NUL byte in `validators.js` (was P1).** A literal NUL character had been written into the source where an escape sequence was intended. Harmless in Node, but it blocked publication and would corrupt some toolchains.

**False positives in the link checker (was P2).** Unauthenticated GitHub answers a rate-limited request
with 404, which is indistinguishable from a deleted file on a single attempt — the checker briefly
reported ten healthy links as evidence drift. Now retries with backoff, and reports a broad failure
pattern as throttling rather than drift.

---

## Findings by discipline

**Evaluation.** The strongest area, and it is not close. Label isolation enforced at the import graph,
a retracted overclaim, negative results published, baselines run before expensive methods. The
`pre_onset_alert_rate` measurement — written specifically to stop an always-on detector being credited
with lead time — is the single most interview-worthy artifact in the portfolio.

**Security.** No secrets in the repository. No provider key reachable from the browser; lint fails the
build if client code so much as names one. Visitor input is length-capped and treated as untrusted;
injection is detected, reported and ignored rather than obeyed. CORS is an allowlist. Errors are
sanitised — the MCP tests assert no path or stack trace reaches a client. The MCP server has one
filesystem read, no write path, and no subprocess spawn, all asserted. Rate limiting on both the
worker and the MCP server. **No critical findings.**

**Privacy.** No PHI anywhere; ClinIQ uses a public review corpus. Pasted job descriptions are analysed
in-browser and never transmitted; the optional backend writes nothing to any log or store. Employer-
internal material is described but never reproduced. **No findings.**

**Accessibility.** Focus trap and ESC on the modal, visible focus rings, skip link, `lang`, labelled
controls, `prefers-reduced-motion` honoured, safe-area insets, 16px minimum gutter, no horizontal
scroll at 400px. Semantic colour is never the only signal — every verification state carries a word as
well as a colour, which matters because the three states are green/amber/red. **No critical findings.**
Not yet tested with a real screen reader on a real device; recommended before wide sharing.

**Performance.** Initial payload 53.9 KB uncompressed against a 60 KB budget; the 162.8 KB workspace is
behind a dynamic import and a build-gate test asserts the boundary holds. Three web fonts is the main
cost and is a deliberate identity choice. The site is fully readable if the workspace never loads.

**UX / recruiter test.** In 30 seconds a reader gets: name, discipline, the thesis, the evidence ledger
(verified count, repositories, verification date), and four projects with provenance.

*Change made after the first audit pass, at the owner's direction:* the hero previously carried a
"4 documented gaps" tile and the Toolkit listed never-claimed technologies with a ✕. Both were removed.
Three of those four gaps — Kubernetes, agent frameworks, production serving — appear nowhere on the
résumé, so the site was volunteering weaknesses about claims it never made. Not volunteering is not
concealment.

The line that was held: **gaps remain in the evidence database and the engine still reports them.** A
pasted job description asking for Kubernetes returns NOT CURRENTLY DEMONSTRATED, and "does she have
Kubernetes experience" still rejects the premise. Removing that would not hide a gap, it would make the
tool lie — and a reviewer finds that out in the interview, which is worse than the gap. A test now
asserts both halves: the homepage renders no gap chip, and `gap.kubernetes`, `gap.agent_frameworks` and
`gap.serving_latency` are still present and answerable.

**Engineer test.** Architecture, data flow, per-component rationale, design decisions with reasoning,
five documented failures with detection-and-prevention, and commit-pinned code for every verified
claim. The honest gap: nothing here runs at scale, and the Stress views are labelled design proposals
rather than experience.

---

## Re-audit

The full gate was re-run after every fix above. Current state:

```
lint                       ok  (17 files, 0 warnings)
tests                      79 passed, 0 failed
  evidence integrity       18
  AI grounding evaluation  49
  MCP boundaries           12
mcp selftest               7 checks ok
link resolution            45/45 resolve, none on a moving ref
build gate                 ok  (53.9 KB initial, budget 60.0 KB)
```

**0 P0 defects in the system. 2 P0 facts outstanding**, both requiring a LinkedIn edit.
C-005 (degree name) was resolved on 2026-09-25 and the site now states the programme.

Recommended sequence: make the two LinkedIn edits, then ship. P1 items can follow publication; none
of them misleads a reader once the portfolio itself stays silent on them, which it does.
