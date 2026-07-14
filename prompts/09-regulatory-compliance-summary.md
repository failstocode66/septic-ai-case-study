# 09 — Maintenance-record summary for a Health Authority reader

| | |
|---|---|
| **Origin** | **NEWLY DESIGNED.** Production has `buildRegulatoryContext()` (`Backend/aiReportService.js:101-109`) and a regulatory knowledge domain in the corpus, but there is **no filing-summary prompt** and no submission feature. Nothing in this file is claimed to be shipped. |
| **Serves** | The contractor, producing the document a Health Authority (Island Health / VIHA in the Comox Valley) will read during an audit. |
| **Risk class** | **Highest in the library.** This is the only prompt whose output is read by a regulator. |

---

## 1. Use case

A BC sewerage system is maintained under a **maintenance plan**, and the obligation runs through that
plan: **BC Reg 326/2004 s.10(1)** — *"An owner must ensure that a sewerage system on the owner's land
is maintained in accordance with the maintenance plan"* — and **s.10(2)** requires the owner to
**keep** records of that maintenance. The **Standard Practice Manual V3 (2014), Table II-62** sets the
minimum *initial* maintenance and monitoring frequency: **6 months for Type 2 and Type 3 systems,
12 months for Type 1**, for the first 12–14 months of operation; thereafter the maintenance plan sets
the frequency (SPM V3's minimum long-term frequency is 2 years for Type 2/3 systems, 5 years for all
others). Sources and URLs: [`../SOURCES.md`](../SOURCES.md).

> **Two corrections from an earlier draft of this file, because they are exactly the kind of error
> this prompt exists to prevent.** (1) That draft attributed the 6–12 month interval to an *operating
> permit*. The interval is real, but it comes from the SPM's maintenance-plan guidance, not from a
> permit clause. (2) It asserted that **maintenance reports must be "filed with the Health
> Authority."** **The Sewerage System Regulation imposes no such filing duty** — s.10(2) requires the
> owner to *keep* records, not file them. (The SSR's one 30-day filing window, s.9(1), attaches to the
> letter of certification filed after *construction*.) If a particular health authority requires
> ongoing filing as a permit condition, that is a claim about *that authority* and must be cited to
> it. It is not in the regulation, and this file no longer says it is.

An Environmental Health Officer may pull those records years later, most often because a neighbour
complained about an odour or a wet patch.

What the EHO wants is boring and specific: *was the required maintenance performed, when, by whom,
what did they find, and what did they do about it.*

What they must **not** be handed is a document that quietly upgrades itself into something it is
not — a compliance determination, a certification, an inspection.

### The unique danger of this prompt

Every other prompt in this library risks a wrong recommendation, or a bad customer experience, or
money spent badly. **This one risks a document, written by a machine, asserting a regulatory
conclusion to a regulator, in a professional's name.**

And it sits at the confluence of three separate temptations, each of which a language model will
take without being asked:

1. **It will cite regulations it has not been given.** Ask a model for a compliance summary and it
   will produce section numbers. Some will be right. This is the single most dangerous behaviour in
   the entire domain — a **confidently mis-cited regulation in a document read by an EHO is worse
   than no citation at all**, because the citation is what gets checked.
2. **It will determine compliance.** "The system is in compliance with the Sewerage System
   Regulation." Nobody asked it to. A maintenance provider does not make that finding; it is not
   within the scope of practice.
3. **It will call the visit an inspection** — which is the compliance-verification scope of practice
   (Private Inspector) that the signing technician does not hold. In a document filed *with the
   regulator*, that is the worst possible place for the word to appear. See prompt 05.

The production system already carries the mitigation for (1), and it is worth quoting because it is
well-judged (`aiReportService.js:106-108`):

```text
REGULATORY STANDARDS:
Use the VERIFIED REFERENCE DATA section (provided in the maintenance data below) as your ground-truth
for all regulatory thresholds, standards, and specifications. Do not invent thresholds or cite values
not present in the reference data.
```

…paired with a tone switch (`:102-104`): in `technical` tone the model is told to *show its
calculations and cite the regulation behind each recommendation*; in `professional` tone,
**citation is suppressed entirely** — "use these standards to inform your recommendations but do
NOT cite regulation names, show formulas, or reference specific standard documents."

That is a defensible design: **the safest citation policy is no citations**, and the org opts into
the risk explicitly by choosing the technical tone.

---

## 2. The prompt

### System

```text
You are preparing a MAINTENANCE RECORD SUMMARY for an onsite wastewater system in British Columbia.
It is a record of maintenance performed under the system's maintenance plan. The owner is required to
keep it, and a Health Authority may request or review it.

WHAT THIS DOCUMENT IS:
A factual record of maintenance performed -- date, practitioner, work performed, conditions
observed, measurements taken, deficiencies found, and actions recommended or completed.

WHAT THIS DOCUMENT IS NOT (absolute):
- It is NOT a compliance determination. You will NOT state, imply, or conclude that the system
  "is in compliance", "meets regulatory requirements", "passes", "is approved", or "is certified".
  Whether a system complies is a determination made by the Health Authority, not by a maintenance
  provider and not by you.
- It is NOT an inspection. The work was MAINTENANCE. An inspection is a separate service -- an
  assessment of an existing system's performance, delivered to its own standard, and the thing that
  backs a property transaction or a compliance verification. This visit was not that.
  Never use the words inspection / inspected / inspector to describe this visit, this work, this
  technician, or this document. ("Inspection port" -- a hardware component -- is permitted.)
- It is NOT a certification. Do not generate a certification block, a practitioner registration
  number, a signature line, or a stamp. These are rendered from verified profile data by the
  document system, never written by you.

CITATION RULES (violating these is worse than omitting the information entirely):
1. You may cite ONLY thresholds, standards, and regulatory references that appear verbatim in the
   VERIFIED REFERENCE DATA block below. Nothing else. No exceptions.
2. NEVER cite a regulation, section number, bylaw, or standard from your own knowledge. If you
   believe a requirement exists but it is not in the reference data, write:
   "The applicable requirement was not available in the reference data provided."
   That sentence is ALWAYS an acceptable output. A missing citation is a gap. A wrong citation is
   a misrepresentation to a regulator.
3. Do not paraphrase a threshold into a different number. Quote the value as given.
4. If the reference data is empty, produce the summary WITHOUT any regulatory citations at all.
   Report the measurements and the work performed. That is still a complete and useful record.

MEASUREMENT RULES:
5. All measurements, classifications, and severity assessments are supplied to you PRE-COMPUTED and
   are authoritative. Do not recompute, reclassify, or soften them.
6. A field that was not measured is reported as "not measured during this visit". Never as zero,
   never as normal, never omitted silently.

Output the JSON schema below. Facts only. No narrative flourish.
```

### User

```text
VERIFIED REFERENCE DATA:
[REFERENCE STANDARDS -- each carries its own source; not all of them are regulatory]
- Aerobic treatment operational target, dissolved oxygen: 2.0 mg/L
  (source: product reference corpus -- OPERATIONAL, not a regulatory limit; no BC regulation sets one)
- Tank solids pump-out trigger: solids exceeding 1/3 of the tank's internal height
  (source: BC Sewerage System Standard Practice Manual V3 (2014) -- one of six OR-conditions)

PRE-COMPUTED MEASUREMENT CLASSIFICATIONS (use these directly -- do NOT recompute):
- DISSOLVED OXYGEN: 1.4 mg/L -> BELOW OPERATIONAL THRESHOLD -- treatment impaired
- SOLIDS: 10.5" combined (3.0" scum + 7.5" sludge) / 40" fluid depth = 26.3% -> APPROACHING THRESHOLD -- monitor closely

MAINTENANCE RECORD:
  property_ref: P-1042
  address: "760 Saltmarsh Way (sample), Comox BC"  # invented street, real town
  system_type: Type_2_Advanced
  maintenance_plan_interval_months: 12
  service_date: "2026-06-13"
  previous_approved_service_date: "2025-06-02"
  practitioner_endorsement: "Maintenance Provider"
  work_performed:
    - "Effluent filter removed, cleaned, and reinstalled"
    - "Tank solids measured"
    - "Treatment unit dissolved oxygen measured"
    - "Blower serviced -- air filter cleaned"
  deficiencies:
    - "Dissolved oxygen below the 2.0 mg/L operational target"
    - "Effluent clarity: cloudy"
    - "Air blower condition: Fair"
  not_measured:
    - "aerobic_treatment_unit_0_effluent_bod"
```

---

## 3. Expected output shape

```json
{
  "filing_summary": {
    "system_type": "Type 2 (Advanced Treatment)",
    "service_date": "2026-06-13",
    "previous_approved_service_date": "2025-06-02",
    "days_since_previous_service": 376,
    "maintenance_plan_interval_months": 12,
    "interval_observation": "376 days elapsed since the previous approved maintenance visit. The maintenance-plan interval on record is 12 months. This is a factual statement of elapsed time; it is not a compliance determination.",
    "practitioner_scope": "Maintenance Provider",
    "work_performed": [
      "Effluent filter removed, cleaned, and reinstalled",
      "Tank solids measured",
      "Treatment unit dissolved oxygen measured",
      "Air blower serviced -- air filter cleaned"
    ],
    "measurements": [
      { "parameter": "Dissolved oxygen",
        "value": "1.4 mg/L",
        "reference_threshold": "2.0 mg/L operational target (not a regulatory limit)",
        "threshold_source": "product reference corpus",
        "classification": "BELOW OPERATIONAL THRESHOLD -- treatment impaired" },
      { "parameter": "Tank solids",
        "value": "26.3% of fluid depth",
        "reference_threshold": "1/3 of the tank's internal height",
        "threshold_source": "BC SPM V3 (2014)",
        "classification": "APPROACHING THRESHOLD -- monitor closely" },
      { "parameter": "Effluent BOD",
        "value": "not measured during this visit",
        "reference_threshold": null,
        "threshold_source": null,
        "classification": null }
    ],
    "deficiencies_identified": [
      "Dissolved oxygen measured 1.4 mg/L, below the 2.0 mg/L operational target in the reference data provided.",
      "Effluent clarity recorded as cloudy.",
      "Air blower condition recorded as Fair."
    ],
    "actions_recommended": [
      "Service or replace the air blower to restore aeration.",
      "Re-measure dissolved oxygen at the next maintenance visit to confirm treatment recovery."
    ],
    "uncited_requirements": [
      "Effluent BOD/TSS limits for a Type 2 system were not available in the reference data provided and are therefore not cited in this summary."
    ]
  },
  "disclaimers": [
    "This is a record of MAINTENANCE performed. It is not an inspection, a compliance determination, or a certification.",
    "Compliance with the applicable regulation is determined by the Health Authority, not by the maintenance provider."
  ]
}
```

Look at `uncited_requirements`. That is the prompt's most important field. **The model is given a
place to put the thing it does not know**, so that it does not have to smuggle it into a sentence.
A model with nowhere to say "I wasn't given this" will invent something rather than leave a hole,
because a hole looks like a failure and a plausible section number looks like competence.

Give the refusal a **named slot in the schema** and refusal becomes the path of least resistance
instead of the path of most courage.

---

## 4. Techniques used

| Technique | How |
|---|---|
| **Retrieval-grounded citation with a closed source set** | "You may cite ONLY thresholds that appear verbatim in the VERIFIED REFERENCE DATA. No exceptions." The model's parametric knowledge of BC regulation is treated as **contamination**, not as a resource — because it cannot be audited. |
| **Refusal given a schema slot** | `uncited_requirements[]`, and a prescribed sentence: *"The applicable requirement was not available in the reference data provided."* Explicitly declared ALWAYS acceptable. |
| **Explicit cost-asymmetry statement** | *"A missing citation is a gap. A wrong citation is a misrepresentation to a regulator."* Telling the model *which error is worse* is a load-bearing instruction, and it is the one most prompts omit. Left to itself, a model treats omission and error as equally bad — so it fills. |
| **Definition by negation** | The prompt spends more words on what the document *is not* than on what it is. For a document that a regulator reads, the boundary is the artifact. |
| **Structured output with provenance fields** | Every threshold carries a `threshold_source`. A citation with no source field cannot be constructed. **Make the unsafe output unrepresentable in the schema.** |
| **Factual restatement instead of judgement** | `interval_observation` reports 376 days elapsed against a 12-month interval and then explicitly declines to conclude. The EHO can do the subtraction; that is their job, and it is not the maintenance provider's. |
| **Terminology guardrail** | Restated absolutely, in the document class where the violation is most consequential. See prompt 05. |
| **Certification block excluded** | Same structural control as prompt 01, instruction 10: the registration number is rendered from verified profile data by the document layer, never written by a model. |

---

## 5. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| **Hallucinated regulation citation** | A wrong section number in a document an EHO checks. Destroys the practitioner's credibility with their regulator, permanently. | Closed source set; `threshold_source` required in the schema; `uncited_requirements` as the escape hatch; the professional-tone option suppresses citations entirely | Moderate. The schema makes it hard, not impossible. **A post-hoc string check — every cited threshold must appear verbatim in the reference block — is trivial, deterministic, and should be a blocking gate.** It does not exist. |
| **Compliance determination** | The provider asserts a finding outside their scope of practice, to the body that actually makes it | Explicit prohibition; `interval_observation` demonstrates the factual-restatement pattern; disclaimers array | Moderate — a *paraphrase* ("no deficiencies preventing normal operation") evades a keyword check. This is the semantic-judge case (prompt 05 §4, category B). |
| **"Inspection"** | Asserts a certification the signer does not hold, in a filing to the regulator | Absolute prohibition + the blocking gate from prompt 05 | See prompt 05. Live defect today. |
| Model writes a certification block | Fabricated registration number | Structural exclusion (rendered by the document layer) + validator error | Low — this is the best-defended failure in the whole system. |
| **The reference data is itself wrong** | Every citation in the summary is faithfully grounded in a corpus that nobody sourced | — | **This is the real one. See §6.** |

---

## 6. The uncomfortable finding: the ground truth has no source

The `VERIFIED REFERENCE DATA` block is retrieved from `Backend/knowledge/domains/` — 131 files,
31,701 lines, 866 chunks, of which 16 are in the `regulatory` domain.

**`bc-health-authority-regulations.json` carries `"sourceUrl": null` and a self-assigned
`"confidence": "high"`.**

It is *synthesized* domain content. It reads like a regulation. It is formatted like a citation. It
is labelled VERIFIED in the prompt. And nothing in it points at BC Laws, ASTTBC, or the Standard
Practice Manual.

Every regulatory fact this prompt would ground itself on — the 2.0 mg/L DO minimum, the 1/3 rule,
the Type 2/3 BOD/TSS limits — traces back to a corpus of unsourced text. (The R.O.W.P. scope boundary
that the ethics argument in prompt 05 rests on does **not**: that is the author's own practitioner
knowledge, and prompt 05 says so. The two were run together in an earlier draft, and separating them
matters — one is a finding about the pipeline, the other is a claim the author stands behind.)

Checking them by hand against the primary sources — which is what this project eventually did, see
[`../SOURCES.md`](../SOURCES.md) — is instructive, because the corpus turns out to be **mostly right
and confidently wrong in one place**. That is the worst possible distribution: right often enough to
be trusted, wrong exactly where nobody looked. The DO "regulatory minimum" is not a regulation. It
was never a regulation. And it has been printed, in a report a regulator may read, next to figures
that *are*.

This is not a hypothetical risk. It is the **exact failure the whole system is built to prevent**,
displaced one layer down:

> The pipeline carefully prevents the *report-writing* model from inventing a threshold — by
> grounding it in a corpus that may itself have been written by a model.

The word `VERIFIED` in `VERIFIED REFERENCE DATA` is doing work it has not earned. It is a label, not
a provenance chain.

**What honesty requires here:**

1. **Done, before publication: every regulatory claim in this case study was re-verified against
   primary sources** — BC Laws for the Sewerage System Regulation, ASTTBC for R.O.W.P. registration
   categories, and the SPM V3 itself for technical thresholds. The register is
   [`../SOURCES.md`](../SOURCES.md), with URLs and access dates. Publishing a regulatory claim sourced
   from an unsourced RAG corpus, *inside a case study about not trusting LLMs near regulatory
   documents*, would have been self-refuting. **What that check found:** the Type 1/2/3 definitions and
   the 45/10 mg/L BOD/TSS limits are exactly right (BC Reg 326/2004 s.1); the 1/3 pump-out trigger is
   real and quotable from SPM V3 (though its denominator is the tank's *internal height*, not "working
   depth", and it is one of six OR-conditions); the 6/12-month intervals are real but come from SPM V3
   Table II-62, not from an operating permit; there is **no duty to file maintenance reports with the
   health authority** in the SSR at all; and **the 2.0 mg/L dissolved-oxygen "regulatory minimum" does
   not exist** — no BC regulation or standard sets a DO threshold. That last one is still emitted by
   production as `BELOW REGULATORY MINIMUM`, and it is now carried as an open defect (CASE-STUDY.md
   §5.10) rather than a caveat.
2. **Before the feature ships**, every chunk in the `regulatory` domain needs a real `sourceUrl` and
   an "unsourced" chunk must be **excluded from retrieval** for this prompt specifically. A
   citation-bearing prompt may only be grounded in citable chunks. That is a two-line filter and it
   is the difference between a defensible feature and a liability.
3. **This finding stays in the case study.** "Our RAG ground truth had no provenance and we found it
   by auditing our own corpus" is a genuinely valuable result about retrieval systems, and it is
   worth more to a reader than a clean story would have been. The lesson generalises well beyond
   septic: **RAG moves the trust problem; it does not solve it.** Every RAG system has a corpus, and
   somebody wrote it. If you cannot say who, you have not grounded anything — you have laundered it.

---

## 7. Provenance and verification

- `buildRegulatoryContext()` — `Backend/aiReportService.js:101-109`; the tone-dependent citation
  policy at `:102-104`; injected into the system prompt at `:595`.
- Knowledge corpus — `Backend/knowledge/` (131 files / 31,701 lines counted; 866 chunks across 6
  domains; 16 chunks in `regulatory`). Retrieval: `Backend/services/knowledgeService.js:443`.
- **Note:** regulatory chunks were deliberately *removed* from RAG retrieval —
  `knowledgeService.js:543-544`: *"Regulatory chunks removed from RAG — regulations stay hardcoded
  in system prompt (more compact, always present, cacheable). Budget redirected to diagnostics."* So
  in production today, the regulatory thresholds the model sees come from the **hardcoded prompt
  text**, not from retrieval at all. That is arguably safer (a fixed, reviewable string) and it means
  the `VERIFIED REFERENCE DATA` block currently carries vendor and diagnostic chunks, not regulatory
  ones. **A filing-summary prompt would need to turn regulatory retrieval back on — and that is
  exactly the moment the unsourced-corpus problem becomes live.**
- **Nothing in this file is in production.** There is no filing-summary feature, no submission
  endpoint, and no Health Authority integration. This is a design, and it is presented as one.
