# Prompt Library — AI-Assisted Maintenance Reporting in the Septic Industry

Fifteen domain-specific prompts for onsite-wastewater (septic) maintenance work in British Columbia.

Nine are **HARVESTED** — copied out of a real, in-production report pipeline (SepticScribe) and
annotated. Six are **NEWLY DESIGNED** for this case study, either to fill a gap the production
system has not built yet, or to *fix* a defect the production system actually has.

Every harvested prompt cites the file and line range it came from. Every claim about the running
system is true of the code as it exists at commit `a37c4d9` (2026-07-13). Where the production
system is weaker than the prompt in this library, the file says so.

---

## The catalogue

| # | Prompt | Serves | Origin | Headline technique |
|---|---|---|---|---|
| [01](01-maintenance-report-system-prompt.md) | Maintenance report — system prompt | Contractor | HARVESTED | Role assignment + procedural CoT scaffold |
| [02](02-deterministic-fact-injection-pump-amp-draw.md) | Pump amp-draw severity injection | Contractor | HARVESTED | Deterministic-fact grounding (authority inversion) |
| [03](03-missing-data-three-way-classification.md) | Missing-data handling | Contractor / Homeowner | HARVESTED | Typed absence + "never assume zero" |
| [04](04-confidence-calibration-ladder.md) | Confidence calibration | Contractor / Regional District | HARVESTED | Four-tier epistemic ladder |
| [05](05-terminology-guardrail-maintenance-not-inspection.md) | **Maintenance-not-inspection guardrail** | Contractor (registration risk) | **NEWLY DESIGNED (fixes a live defect)** | Negative constraint + exemplar hygiene + output gate |
| [06](06-pump-out-triage.md) | Pump-out triage across a day's work | Contractor | NEWLY DESIGNED | Structured output + deterministic pre-classification |
| [07](07-atu-failure-diagnosis.md) | ATU / aerobic-unit failure diagnosis | Contractor | HARVESTED (+ extended) | Cross-component correlation, root-cause first |
| [08](08-homeowner-plain-language-explanation.md) | Plain-language homeowner explanation | Homeowner | HARVESTED (+ extended) | Audience shift with a closed fact set |
| [09](09-regulatory-compliance-summary.md) | Operating-permit / filing summary | Contractor → Health Authority | NEWLY DESIGNED | Citation grounding + hard refusal design |
| [10](10-cost-estimate-drafting.md) | Repair cost estimate drafting | Contractor / Homeowner | NEWLY DESIGNED | Arithmetic removed from the model entirely |
| [11](11-maintenance-scheduling.md) | Service-interval recommendation | Contractor | NEWLY DESIGNED | Projection-grounded, refuses without history |
| [12](12-anomaly-detection-visit-history.md) | Anomaly detection across visit history | Contractor / Regional District | NEWLY DESIGNED | Data-integrity vs system-condition separation |
| [13](13-report-qa-llm-judge.md) | Report QA (LLM-as-judge) | Contractor (pre-signature) | NEWLY DESIGNED | Judge with a closed evidence set + abstention |
| [14](14-period-summary-for-funding-claim.md) | Period summary for a funding claim | Regional District (via contractor) | NEWLY DESIGNED | Aggregation-only; eligibility refusal |
| [15](15-vendor-knowledge-rag-grounding.md) | Vendor/OEM knowledge grounding | Contractor | HARVESTED | Retrieval grounding + brand allowlist check |

---

## Which prompt-engineering techniques appear where

| Technique | Prompts |
|---|---|
| Role assignment / persona | 01, 07, 08, 09, 13 |
| Procedural chain-of-thought (protocol scaffold, not "think step by step") | 01, 07, 12, 13 |
| Few-shot (single-shot, style-matched whole-document exemplar) | 01, 05, 08 |
| Deterministic-fact grounding ("authority inversion") | 02, 03, 06, 07, 10, 11, 12 |
| Negative constraints / explicit prohibition lists | 01, 05, 08, 09, 14, 15 |
| Confidence calibration (epistemic ladder) | 04, 07, 12 |
| Refusal / abstention design | 03, 09, 11, 13, 15 |
| Structured output (JSON schema) | 06, 10, 11, 12, 13, 14 |
| Retrieval grounding (RAG) + allowlist verification | 15, 09 |
| Output-space restriction (forbidden sections) | 01, 05, 09 |
| Ordering as authority (guardrails placed before raw data) | 01, 02, 06 |
| Data-completeness gating (report ambition scales with evidence) | 01, 11 |
| LLM-as-judge | 13, 05 |
| Prompt-layer separation (stable system / volatile user) | 01, 15 |

---

## The one idea that runs through all fifteen

**The model is a writer, not a decider.**

Anything that carries consequence — arithmetic, threshold classification, severity tiering,
cross-component root cause, health scoring, accumulation projection, money, and above all the
professional certification block — is computed in ordinary deterministic code and handed to the
model as a fact it is forbidden to relitigate. The model's remaining job is prose, structure,
and tone.

That inversion is the thesis. The failure mode it defends against is not hallucination-as-fabrication
(the model inventing a measurement) but **hallucination-as-reassurance** (the model smoothing an
alarming measurement into comfortable narrative). A fluent report that softens a dry-running pump
into "amp draw was low, continue monitoring" is more dangerous than a report that is obviously wrong,
because it will be signed.

---

## Data and privacy

Every example payload in this library is **synthetic**. No customer, property, contractor, or
technician in these files is real.

- Street names are invented; towns are real (Comox Valley).
- Phone numbers use the NANP fiction block (`250-555-01xx`).
- Emails use RFC 2606 reserved domains (`example.com`).
- Parcel IDs use an impossible sentinel block (`000-…`) and are labelled `(sample)`. Real BC PIDs
  resolve to a real registered parcel and a real owner; a plausible-looking one is a quasi-identifier.
- **No R.O.W.P. certification number appears anywhere in this library.** A sample report that
  displays a certification number asserts a certification — which is the exact misrepresentation
  prompt 05 is about. Sample certification blocks are shown empty, deliberately.

Payload shapes match production exactly, including a real and uncomfortable fact documented in
**prompt 01 §7**: the production pipeline **does** send the property address, parcel ID, and
technician name to the third-party model provider on every report — and it does not need to. The
model's use of those fields is transcription, not reasoning, and the document layer re-composes them
locally anyway. A three-line redaction would remove them at zero cost to report quality. That is
reported, not hidden, and it is a better finding than the privacy boast would have been.

---

## Terminology note (read before anything else)

In BC, **"maintenance" and "inspection" name two different services.** Maintenance is the ongoing
servicing of a system. An *inspection* is an assessment of an existing system's performance — the
thing that backs a property transaction or a compliance verification — and it is a distinct service
with its own scope, standards, and deliverables. Describing maintenance work as an "inspection" in a
document signed under a practitioner's registration misdescribes the work performed and the standard
it was performed to, and a homeowner, buyer, or lender may rely on it as something it is not.

> **Where this rule comes from — stated plainly, because it carries the project.** It is
> **practitioner knowledge**. The author works in this industry; the rule comes from doing the work
> and from conversations with inspectors, maintenance providers, and WACOWMA representatives. It is
> first-hand industry practice, and it is labelled as such rather than dressed up as a citation to a
> regulation it is not. Treat it as informed industry practice, **not legal advice**.
>
> **One documented fact that is easy to get wrong, and that an earlier draft of this library got
> wrong.** ASTTBC's registration categories (Planner, Installer, Maintenance Provider, Private
> Inspector) *are* distinct, each with its own scope — but since **Practice Bulletin
> #PPB-2023-OW-001 (15 Feb 2023)** a ROWP holding the Maintenance Provider endorsement **may**
> conduct private inspections without separately holding the Private Inspector endorsement. Before
> that bulletin, the PI endorsement was required (ROWP Practice Guidelines, 2017, §7.1). The earlier
> draft asserted the pre-2023 position as current. That has been corrected here and in prompt 05.
>
> **The rule is unaffected by that reversal**, and this is the point: the bulletin changed *who may
> perform an inspection*. It did not turn a maintenance visit into one. Calling a maintenance visit
> an inspection still misdescribes the service rendered — regardless of which endorsements the signer
> holds — and the false-reliance harm is identical.
>
> **The numeric figures in this library have been checked against primary sources** and are cited in
> [`../SOURCES.md`](../SOURCES.md): the Type 1/2/3 definitions and the 45 / 10 mg/L BOD/TSS limits
> (BC Reg 326/2004 s.1); the 1/3-of-internal-height pump-out trigger and the 6/12-month initial
> maintenance intervals (Standard Practice Manual V3, 2014). **One figure is not regulatory despite
> being labelled so in the product's own output**: the **2.0 mg/L dissolved-oxygen "regulatory
> minimum"** has no basis in BC Reg 326/2004 or SPM V3 — it is an operational threshold from
> SepticScribe's own unsourced corpus, and the word REGULATORY in that output is a defect. See
> [`../SOURCES.md`](../SOURCES.md) and prompt 09 §6.
>
> That the product's regulatory ground truth is unsourced remains one of this project's real
> findings — but it is a finding about the *pipeline*, not the origin of the rule above.

Throughout this library, the work is **maintenance**. The only places the word "inspection" appears
are (a) verbatim quotations of the production system's prompt text **as it stood when this audit was
performed** — it contained the word, that was a defect, it is the subject of prompt 05, and it was
fixed in SepticScribe commit `c391dc5` (2026-07-14) — and (b) the industry component name
"inspection port", which is correct.
