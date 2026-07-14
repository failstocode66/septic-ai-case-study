# 13 — Report QA: an LLM-as-judge, scoped to what only a judge can do

| | |
|---|---|
| **Origin** | **NEWLY DESIGNED.** Production has `validateReportOutput()` (`Backend/aiReportService.js:1137-1207`) — deterministic, zero-cost, and **log-only**. There is no judge, no eval set, and no gate. |
| **Serves** | The contractor — this runs in the seconds between "generate report" and "the technician puts their registration number on it". |

---

## 1. Use case

The report is generated. It is fluent, structured, and about to be approved by a person who has been
in a crawlspace since 7am. **Between generation and signature there is exactly one chance to catch a
fabrication**, and after that the document is signed, filed, and possibly used to claim public money.

The production system already does the cheap half of this, and does it well.
`validateReportOutput()` checks, deterministically and at zero API cost:

1. **Prohibited sections** — a generated `## CERTIFICATION` or `## PHOTO DOCUMENTATION` is an
   **error** (`:1143-1148`).
2. **Urgency reflection** — critical conditions in the source data but no urgent language in the
   report (`:1150-1156`).
3. **Component coverage** — every component in the data is mentioned somewhere in the report
   (`:1158-1169`).
4. **Hallucinated manufacturers** — a 50-brand allowlist (Zoeller, Orenco, Norweco, Infiltrator,
   Hiblow, Polylok…, `:1182-1193`). If a brand appears in the *report* but nowhere in the *source
   data or RAG context*, flag it (`:1197-1204`).

That fourth check is genuinely clever and it costs nothing.

**But there are two problems with it, and they are both fatal:**

### Problem 1 — it does not block

`aiReportService.js:1131`: *"Phase 1: Log-only (warnings don't block report generation)."* The
enforcement site (`:1451-1458`) logs `validation.errors` and returns the report anyway. A report
containing a hallucinated `## CERTIFICATION` block — the single most legally-loaded failure the
system can produce — is written to a log line and then **shipped to the customer**.

A validator that does not block is not a validator. It is a diary.

### Problem 2 — it can only check strings

Every check above is a substring or regex test. None of them can see:

- A **measurement in the report that is not in the data.** "Sludge measured 8 inches" when the data
  says 7.5. The component is mentioned, no prohibited section exists, no unknown brand appears — and
  the report contains a number that nobody measured.
- A **service action claimed that was not performed.** "The effluent filter was cleaned and
  reinstalled" when `effluent_filter_cleaned` is `"No"`. This is billing for work not done, in the
  technician's name.
- A **compliance claim.** "The system meets the applicable requirements." No forbidden word, no
  forbidden section — and a maintenance provider has just made a determination outside their scope
  of practice.
- **A severity that was softened.** The deterministic layer said `CRITICAL - No Load`; the report
  says the pump "is drawing below its rated range and should be monitored." Every individual fact is
  arguably present. The *meaning* has been inverted. This is the failure mode the whole system is
  built to prevent (prompt 02), and **nothing checks whether the guardrail was actually obeyed.**

These are semantic. They need a reader.

---

## 2. Design principle: the judge must not duplicate the regex

The strongest temptation with LLM-as-judge is to hand it everything — "review this report for
accuracy and compliance." That produces a slower, more expensive, less reliable version of a check
you already have, plus a wall of vague feedback nobody acts on.

> **Give the deterministic checks everything they can do, and give the model only the residue.**

| Check | Who should do it | Why |
|---|---|---|
| Prohibited section present | **regex** | Exact, free, no false negatives |
| The word "inspection" | **regex** (prompt 05) | Same |
| Component not mentioned | **regex** | Same |
| Brand not in source data | **allowlist** | Same |
| Cited threshold not in the reference block | **string containment** — *not built* | Same. Should exist. See prompt 09. |
| **Number in the report that is not in the data** | **judge** | Requires reading a table and a sentence together |
| **Service action claimed but not performed** | **judge** | Requires understanding what the claim asserts |
| **Severity softened relative to the authoritative classification** | **judge** | Requires comparing two meanings |
| **Compliance/certification claim by paraphrase** | **judge** | The whole point is that it evades keywords |
| **Advice not grounded in a finding** | **judge** | Requires tracing a recommendation to evidence |

Five jobs. That is what the model is for.

---

## 3. The prompt

### System

```text
You are a technical reviewer auditing an AI-generated septic MAINTENANCE report before a licensed
practitioner signs it. The practitioner's professional registration goes on this document. Assume
it will be read by a homeowner and may be audited by a health authority.

You will be given:
  (1) SOURCE DATA -- the measurements and conditions actually recorded during the maintenance visit.
  (2) AUTHORITATIVE CLASSIFICATIONS -- severities computed deterministically from the source data.
      These are correct by construction and are not open to review.
  (3) THE REPORT -- the generated markdown.

YOUR ONLY JOB is to find claims in THE REPORT that are not supported by (1) and (2), and claims that
CONTRADICT (2). You are checking grounding, not quality.

Check exactly these five things. Nothing else.

  F1. UNSUPPORTED MEASUREMENT. Any number in the report that does not appear in the source data or
      the authoritative classifications. Includes numbers that are close-but-wrong (7.5 reported as
      8), and numbers that were computed rather than measured.

  F2. UNSUPPORTED ACTION. Any service action the report claims was performed, that is not recorded
      in the source data. ("The filter was cleaned" when the data does not record it being cleaned.)
      This is the most serious finding you can make: it is a claim of work performed.

  F3. SOFTENED SEVERITY. Any place the report describes a condition less seriously than the
      AUTHORITATIVE CLASSIFICATION for that condition. If the classification says CRITICAL and the
      report says "monitor", that is a softening, even if every individual number is correct.
      Report the classification and the report's language side by side.

  F4. SCOPE OR COMPLIANCE OVERCLAIM. Any statement or implication that:
        - the system is compliant, approved, passing, certified, or meets requirements
        - the document is an inspection, or the technician is an inspector
        - the document is suitable for a property transaction
      A maintenance record documents work performed. It determines nothing.

  F5. UNGROUNDED ADVICE. Any recommendation or homeowner guidance that does not trace to a specific
      finding in the source data. (Advice to check for root intrusion, when nothing about roots was
      observed.)

RULES:
- Quote the exact text from the report. Never paraphrase a finding.
- If you cannot decide whether something is a violation, report it with confidence "uncertain" and
  say what would settle it. Do NOT resolve your own uncertainty in favour of passing the report.
- Do NOT comment on tone, style, formatting, grammar, length, or completeness. Those are not your job
  and noise in this output makes the whole check ignorable.
- An empty findings array is a valid and expected result. Do not manufacture a finding to seem useful.
  A judge that always finds something will be switched off within a week.
- You are advisory. Your findings go to a human, not to an automatic reject.

Output JSON only.
```

### User

```text
SOURCE DATA:
{ "septic_tank_0_scum_inches": "3.0",
  "septic_tank_0_sludge_inches": "7.5",
  "septic_tank_0_total_fluid_depth": "40",
  "septic_tank_0_effluent_filter_cleaned": "No",
  "septic_tank_0_effluent_filter_soiling": "Moderate",
  "pump_0_pump_current_draw": "1.6",
  "aerobic_treatment_unit_0_dissolved_oxygen_mgl": "1.4" }

COMPONENTS:
[ { "type": "pump", "label": "Effluent Pump", "specs": { "nameplateAmps": 7.2 } }, ... ]

AUTHORITATIVE CLASSIFICATIONS:
- Pump 0: 1.6A measured / 7.2A nameplate = 22.2% FLA -- CRITICAL - No Load. Pump running but no
  hydraulic load detected. Motor damage risk from overheating without fluid cooling.
- SOLIDS: 10.5" combined (3.0" scum + 7.5" sludge) / 40" fluid depth = 26.3% -> APPROACHING
  THRESHOLD -- monitor closely
- DISSOLVED OXYGEN: 1.4 mg/L -> BELOW REGULATORY MINIMUM -- treatment impaired

THE REPORT:
<generated markdown>
```

---

## 4. Expected output shape

Against a deliberately bad report:

```json
{
  "findings": [
    { "code": "F3", "severity": "critical", "confidence": "high",
      "report_text": "The effluent pump was drawing 1.6 A, below its rated range. Recommend monitoring at the next service visit.",
      "authoritative_classification": "CRITICAL - No Load. Pump running but no hydraulic load detected. Motor damage risk from overheating without fluid cooling.",
      "problem": "The authoritative classification is CRITICAL - No Load and calls for immediate attention. The report describes it as 'below its rated range' and recommends monitoring. The severity has been inverted.",
      "would_settle_it": null },

    { "code": "F2", "severity": "critical", "confidence": "high",
      "report_text": "The effluent filter was removed, cleaned, and reinstalled.",
      "problem": "septic_tank_0_effluent_filter_cleaned is 'No'. The report claims a service action that the source data records as not performed.",
      "would_settle_it": null },

    { "code": "F1", "severity": "moderate", "confidence": "high",
      "report_text": "| Sludge Depth | 8 inches |",
      "problem": "Source data records septic_tank_0_sludge_inches as 7.5. The report states 8.",
      "would_settle_it": null },

    { "code": "F4", "severity": "critical", "confidence": "high",
      "report_text": "This inspection confirms the system is operating within acceptable parameters.",
      "problem": "Two overclaims in one sentence: it calls the maintenance visit an 'inspection' (a separately certified scope of practice), and it makes a conformance determination that a maintenance provider does not make.",
      "would_settle_it": null },

    { "code": "F5", "severity": "minor", "confidence": "uncertain",
      "report_text": "Homeowners should also have the drainfield assessed for root intrusion.",
      "problem": "Nothing about roots, trees, or drainfield intrusion appears in the source data. This may be generic advice rather than a finding from this visit.",
      "would_settle_it": "A recorded observation of roots or vegetation near the dispersal field." }
  ],
  "summary": { "critical": 3, "moderate": 1, "minor": 1, "uncertain": 1 },
  "recommendation": "DO_NOT_APPROVE_WITHOUT_REVIEW"
}
```

F3 is why this exists. Every number in that pump sentence is *correct*. The component is mentioned.
No prohibited section. No unknown brand. **Every deterministic check passes.** And the report has
taken a motor that is destroying itself and told the homeowner to keep an eye on it.

That is hallucination-as-reassurance, it is the exact failure the deterministic-fact injection
(prompt 02) exists to prevent, and **nothing in production checks that the injection was obeyed.**
The guardrail is written; whether the model followed it is unverified.

---

## 5. Techniques used

| Technique | How |
|---|---|
| **Closed evidence set** | The judge may only compare the report against the source data and the authoritative classifications. It has no independent view of septic systems and is not asked for one. This is what separates a *grounding check* from an *opinion*. |
| **Scope discipline (five codes, nothing else)** | The explicit prohibition on commenting about tone, style, grammar, or completeness is load-bearing. A judge that returns twelve style nits alongside one fabrication has buried the fabrication. **The output must be small enough that a tired technician reads all of it.** |
| **Anti-sycophancy on the judge itself** | *"An empty findings array is a valid and expected result. Do not manufacture a finding to seem useful."* A judge model wants to be helpful, and helpful means finding something. A judge with a nonzero false-positive rate at 6pm on a Friday gets switched off, and then you have no judge. |
| **Uncertainty as an output, with an anti-resolution rule** | `confidence: "uncertain"` plus *"do NOT resolve your own uncertainty in favour of passing the report"* — closing the specific loophole where an unsure model reasons itself into silence. |
| **Severity comparison against an authoritative baseline (F3)** | The single most valuable check, and the only one that verifies the deterministic guardrail was actually respected. It requires the authoritative classifications to be *in the judge's context* — which means the pipeline must pass them through, which it currently does not. |
| **Advisory, not blocking** | The judge is a probabilistic reader; it should not silently reject a technician's report. It surfaces to a human. **Contrast prompt 05**, where the check is a regex and therefore *is* safe to block on. The right rule: **deterministic checks may block; probabilistic checks may only advise.** |
| **Separation of judge from generator** | Different model call, no shared context, the judge never sees the generation prompt. A model asked to review its own output in the same context will defend it. |

---

## 6. Failure modes and mitigations

| Failure mode | Harm | Mitigation | Residual risk |
|---|---|---|---|
| **Judge misses a fabrication** | The whole point of the judge fails silently | Closed evidence set; narrow codes; F1/F2 are close to mechanical | **Real and unquantified.** There is no eval set, so the judge's recall is unknown. A judge with unmeasured recall is a comfort object. See §7. |
| **Judge hallucinates a violation** | Technician loses trust in the check, disables it, is now unprotected | Exact-quote requirement (the model must produce report text verbatim — a fabricated finding requires a fabricated quote, which is checkable); anti-manufacture instruction | Moderate. **The quotes should be verified deterministically:** every `report_text` must appear as a substring of the report. That is a two-line check and it makes fabricated findings structurally impossible. |
| **Judge nitpicks** | Signal lost in noise; check ignored | Scope discipline; five codes only | Moderate. |
| Judge is used as an auto-reject | A correct report is blocked by a probabilistic reader; contractor cannot work | Advisory only; `recommendation` is a suggestion to a human | By design. |
| Judge and generator share a bias | Both models miss the same thing (they may be the same model family) | — | **Real.** A judge from the same family will share blind spots — especially the tendency toward reassurance that F3 is meant to catch. Using a *different* provider for the judge is a genuine mitigation and costs nothing architecturally: the pipeline already has both an Anthropic and an OpenAI client configured (`aiReportService.js:31-50`). |
| **Cost** | An extra call per report | The report is generated once per visit. A judge on a ~20k-token report is cents. The deterministic checks are free and should catch most of it first. | Low. |

---

## 7. What this prompt is not, and cannot be

**It is not evidence that the system is accurate.**

There is **no eval set, no golden outputs, no A/B, and no scored benchmark anywhere in the
repository.** `validateReportOutput` emits warnings that are logged and never aggregated. The token
stats (`stats.promptTokens`, `cachedTokens`) are computed and thrown away — no table stores them.
The `report_logs` table exists, is indexed, and **has zero INSERT statements anywhere in the
codebase.** It is a dead table.

Therefore:

> **Any claim of the form "deterministic fact injection reduced hallucination by X%" would be
> fabricated.** The mechanism is real, verifiable, and describable. The effect size has never been
> measured. This case study reports the mechanism and claims no number.

That is not a hedge; it is the finding. A system this carefully guarded against model
hallucination has **no instrumentation to tell whether the guards work.** The guardrails were even
silently dead on real data for months (prompt 02 §5) and nothing noticed — which is precisely what
an unmeasured system looks like from the inside.

The honest next build, in order:

1. **A synthetic eval set** — 20-30 fabricated maintenance visits with known-correct findings,
   including deliberately adversarial ones (a CRITICAL pump reading, a missing measurement, an
   unknown vendor, a partial tank dataset). Zero customer data, buildable in a day.
2. **Run the pipeline over it and score the outputs** — with this judge, and with a human on a
   sample of them to measure the *judge's* accuracy. A judge whose own recall is unknown cannot
   certify anything.
3. **Then, and only then**, a number.

Until step 3, the case study's metrics are architectural — 866 knowledge chunks, 131 corpus files,
11 unit tests over the AI subsystem, 27% statement coverage on `aiReportService.js`, a 314-line
prompt builder — and every one of those was counted, not estimated.

---

## 8. Provenance and verification

- `validateReportOutput()` — `Backend/aiReportService.js:1137-1207`. Prohibited sections
  `:1143-1148`; urgency reflection `:1150-1156`; component coverage `:1158-1169`; brand allowlist
  `:1182-1193` and the hallucination check `:1197-1204`.
- Log-only, confirmed: comment at `:1131`; call site `:1451-1458` logs `validation.errors` and
  returns the report regardless.
- `report_logs` — created and indexed in `Backend/database/runMigrations.js:328` (indexes at
  `:343-345`, `:790-792`); **zero INSERT statements exist**. No token columns exist in any table.
- Test surface of the AI pipeline: **11 tests in 2 files**
  (`tests/unit/services/diagnosticFindingKeys.test.js`, `tests/unit/services/fallbackReport.test.js`),
  11/11 passing. `buildReportPrompt` and `validateReportOutput` have **no direct unit test**;
  `knowledgeService.js` has 0% coverage.
- **Not in production:** this judge, the eval set, the quote-verification check, and any form of
  blocking. All four are proposals.
