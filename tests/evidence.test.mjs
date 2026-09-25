/* =============================================================================
   Evidence database integrity + drift detection.
   These fail the build if a number on the site stops matching its source.
   ========================================================================== */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./setup.mjs";

const db = JSON.parse(readFileSync(join(root, "evidence", "claims.json"), "utf8"));
const site = readFileSync(join(root, "index.html"), "utf8");
const conflicts = readFileSync(join(root, "evidence", "CONFLICTS.md"), "utf8");

const STATES = ["VERIFIED", "VERIFICATION_REQUIRED", "UNSUPPORTED", "DEPRECATED"];
const REQUIRED = [
  "id", "claim", "verification_status", "category", "source_type", "source_location",
  "project_or_experience", "commit_sha", "exact_code_link", "artifact_link",
  "public_safe", "tags", "last_verified",
];

test("every claim has the full schema", () => {
  for (const c of db.claims) {
    for (const k of REQUIRED) {
      assert.ok(k in c, `${c.id} missing field ${k}`);
    }
    assert.ok(STATES.includes(c.verification_status), `${c.id} bad state`);
    assert.ok(Array.isArray(c.tags) && c.tags.length, `${c.id} has no tags`);
  }
});

test("claim ids are unique", () => {
  const ids = db.claims.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every VERIFIED claim cites a pinned commit", () => {
  for (const c of db.claims.filter((x) => x.verification_status === "VERIFIED")) {
    assert.ok(c.commit_sha, `${c.id} is VERIFIED without a commit_sha`);
    assert.match(c.commit_sha, /^[0-9a-f]{40}$/, `${c.id} sha is not a full sha`);
  }
});

test("code links are pinned to a sha, never to a branch", () => {
  for (const c of db.claims) {
    for (const link of [c.exact_code_link, c.artifact_link]) {
      if (!link || !link.includes("/blob/")) continue;
      assert.doesNotMatch(link, /\/(blob|tree)\/(main|master|HEAD)\//,
        `${c.id} links to a moving branch: ${link}`);
      assert.match(link, /\/(blob|tree)\/[0-9a-f]{40}\//, `${c.id} link is not sha-pinned`);
    }
  }
});

test("a link's sha matches the claim's commit_sha", () => {
  for (const c of db.claims) {
    if (!c.commit_sha) continue;
    for (const link of [c.exact_code_link, c.artifact_link]) {
      if (!link) continue;
      const m = link.match(/\/(?:blob|tree)\/([0-9a-f]{40})\//);
      if (m) assert.equal(m[1], c.commit_sha, `${c.id} link sha differs from commit_sha`);
    }
  }
});

test("self-reported claims never carry a code link", () => {
  for (const c of db.claims) {
    if (c.source_type !== "self_reported") continue;
    assert.equal(c.exact_code_link, null, `${c.id} is self-reported but links to code`);
    assert.equal(c.commit_sha, null, `${c.id} is self-reported but pins a commit`);
  }
});

test("UNSUPPORTED and DEPRECATED claims never carry a code link", () => {
  for (const c of db.claims) {
    if (!["UNSUPPORTED", "DEPRECATED"].includes(c.verification_status)) continue;
    assert.equal(c.exact_code_link, null, `${c.id} is ${c.verification_status} but links to code`);
  }
});

test("every claim is public-safe and mentions no PHI or secret", () => {
  const forbidden = /\b(sk-[a-z0-9]|api[_-]?key\s*[:=]\s*\S|password|BEGIN (RSA|PRIVATE)|patient name|ssn|mrn)\b/i;
  for (const c of db.claims) {
    assert.equal(c.public_safe, true, `${c.id} is not marked public_safe`);
    const blob = JSON.stringify(c);
    assert.doesNotMatch(blob, forbidden, `${c.id} may contain sensitive material`);
  }
});

test("repo shas are full 40-char shas", () => {
  for (const [k, r] of Object.entries(db.meta.repos)) {
    assert.match(r.sha, /^[0-9a-f]{40}$/, `repo ${k} sha malformed`);
    assert.ok(r.provenance, `repo ${k} has no provenance`);
  }
});

/* --------------------------------------------------------------------------
   DRIFT: numbers printed on the site must exist in the evidence.
   ----------------------------------------------------------------------- */

test("headline numbers on the site appear in the evidence database", () => {
  const evidenceBlob = JSON.stringify(db).replace(/,/g, "");
  // Each entry: the string as rendered on the page, and how it appears in evidence.
  const mustMatch = [
    "8,209", "261", "35", "1,054,948",
    "0.6719", "0.6661", "17%", "27-fold",
    "52,184", "3,316", "37", "1.7%", "30.5%",
    "0.861", "0.847", "0.504", "0.938", "0.400",
    "0.793", "0.73", "1,409",
    "76-dimensional", "rank 4",
  ];
  for (const n of mustMatch) {
    assert.ok(site.includes(n), `site is missing expected figure ${n}`);
    const bare = n.replace(/,/g, "").replace(/-(dimensional|fold)$/, "").replace("rank ", "");
    assert.ok(
      evidenceBlob.includes(bare) || JSON.stringify(db).includes(n),
      `site prints ${n} but the evidence database does not contain it`,
    );
  }
});

test("the site prints no unsupported metric", () => {
  // Figures explicitly retracted or never supported must not appear as claims.
  assert.doesNotMatch(site, /FID\s*(?:of|score|=|:)\s*\d/i, "site states an FID value");
  assert.ok(!/\b\d{1,3}\s*%\s*(match|fit)\b/i.test(site), "site states a match percentage");
  assert.ok(!/\b\d{1,2}\s*\/\s*10\b/.test(site), "site states a fit score");
});

test("the ledger counts equal the database", () => {
  const verified = db.claims.filter((c) => c.verification_status === "VERIFIED").length;
  const repos = Object.keys(db.meta.repos).length;
  const grab = (key) => {
    const m = site.match(new RegExp(`data-count="${key}">(\\d+)<`));
    return m ? Number(m[1]) : null;
  };
  assert.equal(grab("verified"), verified, "ledger 'verified' disagrees with the database");
  assert.equal(grab("repos"), repos, "ledger 'repositories' disagrees with the database");

  const stamp = site.match(/data-stamp="verified-on"[^>]*>([\d-]+)</);
  assert.equal(stamp?.[1], db.meta.last_full_verification, "ledger date disagrees with the database");
});

test("the site does not advertise gaps, but the evidence engine still holds them", () => {
  // Product decision: the homepage stops volunteering weaknesses it never
  // claimed. The database keeps every gap, so Role Fit and the JD analyser
  // still answer NOT DEMONSTRATED rather than going silent — which is the
  // difference between not advertising and misleading.
  assert.ok(!/documented gaps/i.test(site), "the homepage advertises a gap count");
  assert.ok(!/chip--gap/.test(site), "the homepage renders a gap chip");

  const gaps = db.claims.filter((c) => c.category === "gap");
  assert.ok(gaps.length >= 4, "gaps were deleted from the evidence database, not just the homepage");
  for (const id of ["gap.kubernetes", "gap.agent_frameworks", "gap.serving_latency"]) {
    assert.ok(db.claims.some((c) => c.id === id), `${id} is missing — the engine can no longer answer honestly`);
  }
});

/* --------------------------------------------------------------------------
   CONFLICTS register
   ----------------------------------------------------------------------- */

test("every conflict id referenced by a claim exists in CONFLICTS.md", () => {
  const referenced = new Set();
  for (const c of db.claims) {
    const m = (c.verification_note || "").match(/C-\d{3}/g);
    if (m) m.forEach((x) => referenced.add(x));
  }
  assert.ok(referenced.size >= 5, "expected several claims to reference conflicts");
  for (const id of referenced) {
    assert.ok(conflicts.includes(`## ${id}`), `${id} referenced but not documented`);
  }
});

test("the site never repeats an unresolved conflict", () => {
  // C-001: the conflated pair
  assert.ok(!/1\.0\s*recall[^.]{0,40}94\s*%\s*precision/i.test(site));
  // C-002: the revenue figure without its qualifier
  if (site.includes("537,340")) {
    assert.match(site, /537,340[\s\S]{0,300}(synthetic|fictional|modelled)/i);
  }
  // C-005 is resolved: the site may now state the programme, but the
  // superseded name must never reappear from a cached source or old draft.
  assert.ok(!/Data Science Analytics/i.test(site), "site states the superseded programme name");
  assert.match(site, /M\.S\.\s*Computer Science/i, "site no longer states the resolved degree");
});

test("the resolved degree is reported as self-reported, not verified", () => {
  const edu = db.claims.find((c) => c.id === "edu.masters");
  assert.ok(edu, "edu.masters is missing");
  assert.equal(edu.verification_status, "VERIFICATION_REQUIRED",
    "a credential cannot be VERIFIED from public sources — a transcript is not a public artifact");
  assert.equal(edu.exact_code_link, null);
  assert.match(edu.verification_note, /registrar/i,
    "the note must record that agreement between the owner's own sources is not confirmation");
});

/* --------------------------------------------------------------------------
   Proof-lab fixture must agree with the claims it illustrates
   ----------------------------------------------------------------------- */

test("the replay fixture corroborates the detector claims", () => {
  const fx = JSON.parse(readFileSync(join(root, "imw", "fixtures", "sfd_backtest.json"), "utf8"));
  assert.equal(fx.n_windows, 35);
  assert.equal(fx.windows.length, 35);
  assert.equal(fx.fired_counts.ks, 35, "claim says KS fired on 100% of windows");
  assert.equal(fx.fired_counts.wasserstein, 35);
  assert.equal(fx.fired_counts.multivariate, 35);
  assert.equal(fx.fired_counts.prediction, 0, "claim says prediction drift never fired");
  assert.equal(fx.commit_sha, db.meta.repos.sfd.sha, "fixture is pinned to a different commit than the repo record");
  assert.equal(fx.label, "ARTIFACT REPLAY", "replay must not be presented as live computation");
});

test("the replay fixture's AUC really is flat while the gap widens", () => {
  const fx = JSON.parse(readFileSync(join(root, "imw", "fixtures", "sfd_backtest.json"), "utf8"));
  const aucs = fx.windows.map((w) => w.auc);
  const spread = Math.max(...aucs) - Math.min(...aucs);
  const worst = Math.min(...fx.windows.map((w) => w.gap));
  assert.ok(spread < 0.06, `AUC spread ${spread} is larger than the claim implies`);
  assert.ok(worst < -0.05, `worst calibration gap ${worst} does not match the claimed -0.0513`);
});

test("only VERIFIED claims carry a code link", () => {
  // A code link reads as proof. Attaching one to a claim that is self-reported
  // or unsupported implies the linked file evidences the claim, which it does
  // not. Found by the MCP boundary tests on sssd.metrics.psnr_ssim.
  for (const c of db.claims) {
    if (c.verification_status === "VERIFIED") continue;
    assert.equal(c.exact_code_link, null, `${c.id} is ${c.verification_status} but links to code`);
    assert.equal(c.artifact_link, null, `${c.id} is ${c.verification_status} but links to an artifact`);
    assert.equal(c.commit_sha, null, `${c.id} is ${c.verification_status} but pins a commit`);
  }
});
