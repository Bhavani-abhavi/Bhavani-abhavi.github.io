# Conflicts Register

Claims that appear in a public source (résumé, LinkedIn, repository description) and that
**could not be verified as worded** against primary evidence.

Nothing here is an accusation of dishonesty. Most entries are wording drift: a number that
travelled away from its context, a tool named from memory, a metric that belonged to a
different run. But each one is something an interviewer with a browser open can find, and
the Interview My Work AI is forbidden from repeating any of them as established fact.

**Rules this file enforces**

- No conflict is resolved by inventing evidence.
- No conflict is resolved by quietly editing history.
- Until a conflict is resolved, the AI answers with the verified portion only, and says
  plainly what it cannot support.

Verified: 2026-09-25 · Reviewer: automated inspection at pinned commit SHAs, manual cross-read

---

## C-001: ClinIQ "1.0 recall and 94% precision" (P0)

**The claim.** LinkedIn, ClinIQ project entry:

> "Engineered a 3-tier RAG pipeline (rule-based → cosine similarity → Claude 3.5 Sonnet +
> pgvector), reaching 1.0 recall and 94% precision"

**Where it appears.** LinkedIn projects section. **Not** on either résumé.

**Evidence inspected.** `outputs/method_comparison_results.csv` @ `65e0493`:

| method | precision | recall | tp | fp | fn | tn | elapsed |
|---|---|---|---|---|---|---|---|
| rule_based | 0.861 | 0.847 | 254 | 41 | 46 | 259 | 0.05 s |
| embedding | 0.504 | **1.000** | 300 | 295 | 0 | 5 | 9.34 s |
| llm_rag | **0.9375** | 0.400 | 120 | 8 | 180 | 292 | 1772.74 s |

**Why it could not be verified.** The two headline numbers come from **two different
methods**. Recall 1.0 belongs to the embedding tier, which achieved it at 50.4% precision
(295 false positives out of 595 flagged). Precision 0.9375 belongs to the LLM+RAG tier,
which achieved it at 40% recall (180 missed out of 300). No single configuration produced
both, and no combined tier is reported in the results file.

Read as written, the claim describes a system that is strictly better than anything the
evaluation produced.

**Recommendation, rewrite.** The honest version is more interesting than the overclaim,
because the tradeoff *is* the finding:

> Built a 3-tier retrieval comparison (rule-based → embedding cosine → Claude + pgvector)
> over 52,184 patient reviews, measuring the precision/recall tradeoff on a shared labelled
> set: rules 0.86/0.85 in 0.05 s, embeddings 0.50/1.00, LLM+RAG 0.94/0.40 in 29 minutes.
> The cheapest tier was the most balanced; the most expensive bought precision at the cost
> of more than half the recall.

**Status.** UNRESOLVED, requires a LinkedIn edit. The portfolio does not repeat the claim.

---

## C-002: ClinIQ "$537,340 in recoverable revenue" stated without the synthetic qualifier (P0)

**The claim.** LinkedIn, ClinIQ project entry:

> "Quantified $537,340 in recoverable revenue across 219 coding gaps"

**Evidence inspected.** `outputs/pipeline_summary.txt` @ `65e0493`, lines 36-41:

```
CLINICAL INNOVATION LAYER:
Synthetic claims analyzed:       220 (all fictional)
SUD documentation gaps:          219
Revenue at risk:                 $537,340.22
Revenue calculation source:      CMS FY2024 IPPS Final Rule
```

**Why it could not be verified as worded.** The arithmetic is correct and the DRG-weight
source is real and cited. But the input population is **220 fictional claims**, stated in
the same block. "Quantified $537,340 in recoverable revenue" reads as money identified in a
real payer population. A hiring manager in healthcare will read it that way.

The gap count and dollar figure are VERIFIED. The omission of *synthetic* is the conflict.

**Recommendation, rewrite, keep the number.**

> Modelled $537,340 of at-risk revenue across 219 documentation gaps in a 220-claim
> synthetic cohort, priced from CMS FY2024 IPPS DRG weights.

**Status.** UNRESOLVED, requires a LinkedIn edit. The portfolio always carries the
qualifier (`cliniq.result.revenue_synthetic` marks it MANDATORY).

---

## C-003: SS-SD: FID listed as a benchmarking metric (P1)

**The claim.** LinkedIn SS-SD entry and the AI-variant résumé:

> "Benchmarked outputs with PSNR, SSIM, FID, and optical-flow metrics"

**Evidence inspected.** Fork contents @ `c5ba67c`. `compute_fid.py` exists **upstream only**
(`ango3636/SS-SD`) and is not present in the fork. No FID value appears in either repository
or in any committed results file.

**Why it could not be verified.** The script is absent from the published repo and no
computed value exists anywhere. PSNR, SSIM, histogram χ², edge IoU and Farneback optical-flow
correlation **are** genuinely implemented in `scripts/metrics_on_grid.py` and
`scripts/video_quality_metrics.py`.

**Recommendation, two clean options:**
1. **Drop FID** from LinkedIn and the AI résumé. The remaining metrics carry the claim, and
   the cross-pair baseline is the more distinctive methodological point anyway.
2. **Or** merge `compute_fid.py` from upstream, run it, commit the result. One commit moves
   this to VERIFIED.

**Status.** UNRESOLVED. Option 1 is faster; option 2 is stronger.

---

## C-004: Smart Meal Planner attributed to Hugging Face Transformers (P1)

**The claim.** LinkedIn project description:

> "leverages Large Language Models (LLMs) via Hugging Face Transformers"

and, by extension, the Hugging Face Transformers mention in both résumé summaries, for which
this is the only public supporting project.

**Evidence inspected.** `code.py` @ `8bad9b3`, lines 5-9:

```python
API_KEY = os.getenv("GEMINI_API_KEY")
API_URL = f"https://generativelanguage.googleapis.com/v1beta2/models/gemini-1.5:generateText?key={API_KEY}"
```

**Why it could not be verified.** The project calls the **Google Gemini REST API**. There is
no `transformers` import, no model download, no local inference. These are different skills:
one is API integration, the other is working with model weights.

**Knock-on effect.** Hugging Face Transformers appears prominently in both résumé summaries.
The genuine supporting evidence for it is the **churn project** (fine-tuned BERT, chained T5)
and **SS-SD** (Diffusers + peft), not the meal planner. The skill claim survives; the
attribution does not.

**Recommendation.** Correct the LinkedIn description to "Google Gemini API". Keep Hugging
Face Transformers on the résumé, anchored to the churn and SS-SD work.

**Status.** UNRESOLVED, requires a LinkedIn edit.

---

## C-006: "Google Data Analytics" certificate vs. individual course certificates (P2)

**The claim.** Résumé: "Certifications: Google Data Analytics · …"

**Evidence inspected.** LinkedIn licences section lists 6 certifications. The two visible with
credential links are *Prepare Data for Exploration* (May 2024) and *Ask Questions to Make
Data-Driven Decisions* (Dec 2023), both "Grow with Google on Coursera".

**Why it could not be verified.** Those are **individual courses within** the Google Data
Analytics Professional Certificate, not the certificate itself. Holding two of eight courses
is not the same credential. The remaining four LinkedIn entries were not expanded in the
export reviewed and may well include the capstone.

**Recommendation.** Check the Coursera account. If the full professional certificate was
earned, link it. If not, list the completed courses by name.

**Status.** UNRESOLVED, low severity, easy to check.

---

## C-007: Two résumé variants make different claims (P1)

**Observation, not a factual conflict.** `BhavaniAdula_AIML_Resume.pdf` and
`BhavaniAdula_AIResume.pdf` differ materially:

- AIML lists **Silent Failure Detection first** and omits SS-SD entirely.
- AI lists **ClinIQ first**, includes SS-SD with PSNR/SSIM/FID figures, and adds a
  YOLOv8 / gTTS / ffmpeg "multimodal range" bullet.
- AIML lists AWS nowhere; LinkedIn lists AWS as a top skill.
- AI leads the summary with the Hippocratic AI metrics; AIML leads with tooling.

**Why it matters.** Both are in circulation. A recruiter who receives one and finds the other
sees an inconsistent record. The SS-SD figures in the AI variant are `VERIFICATION_REQUIRED`
(C-003, and `sssd.metrics.psnr_ssim`) and appear on the stronger-looking document.

**Recommendation.** Pick one canonical résumé. Keep role-targeted variants if useful, but
every number must appear identically in all of them, and no variant may carry a claim the
others cannot support.

**Status.** UNRESOLVED, a decision, not an investigation.

---

## Resolved

## C-005: Master's degree name  ·  RESOLVED 2026-09-25

**Was:** the résumés read "MS, Computer Science" while LinkedIn read "Master's degree, Data Science
Analytics". Same institution, same dates. Flagged P0 because degree titles are what background-check
vendors verify, and a mismatch surfaces after an offer, when it is most expensive.

**Resolution:** LinkedIn was updated to "Computer Science". All sources now read
**M.S. in Computer Science, University of Missouri-Kansas City, May 2026**, and the site states it.

**Standing caveat, recorded because it is the honest version:** agreement between an owner's own
sources is consistency, not independent confirmation. The claim is therefore
`VERIFICATION_REQUIRED` rather than `VERIFIED`, which is the normal and correct state for any
credential, since a transcript is not a public artifact. The registrar's record governs.

The conflict rule is kept, narrowed, so the superseded name cannot reappear from a cached profile or
an older résumé draft.

---


---

## What the AI does with this file

`imw/validators.js` loads `claims.json` and refuses to emit any statement matching an
UNRESOLVED conflict. Specifically:

- The pair *(recall 1.0, precision 94%)* is blocked as a joint ClinIQ claim (C-001).
- `$537,340` is blocked unless the word *synthetic* appears in the same sentence (C-002).
- *FID* is blocked as an SS-SD metric (C-003).
- *Hugging Face* is blocked as a Smart Meal Planner technology (C-004).
- The superseded programme name "Data Science Analytics" is blocked (C-005, resolved).
- *Google Data Analytics* is emitted as "individual Coursera courses; full certificate
  unconfirmed" (C-006).

These are enforced in `tests/conflicts.test.js`. CI fails if any blocked string reaches an
answer.
