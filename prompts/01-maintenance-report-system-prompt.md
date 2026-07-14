# 01 — Maintenance Report: the system prompt

| | |
|---|---|
| **Origin** | **HARVESTED** from production — `Backend/aiReportService.js:570-683` (assembled by `buildReportPrompt`, lines 528-841) |
| **Serves** | The contractor (a R.O.W.P. Maintenance Provider), who signs the resulting document |
| **Runs on** | `claude-haiku-4-5`, `temperature: 0.3`, `max_tokens: 8000`, streamed, with the system block marked `cache_control: { type: 'ephemeral' }` (`aiReportService.js:53-68`, `:981`) |
| **Called** | Once per approved maintenance event, at PDF generation time |

---

## 1. Use case

A technician finishes a service visit. In the field app they have recorded component conditions,
tank measurements, pump amp draw, filter state, photos, and free-text notes across up to a
226-field assessment registry. What the homeowner (and, for a Type 2/3 system, the Health
Authority) actually receives is a **narrative maintenance report** — several pages of prose,
tables, and prioritised recommendations, carrying the technician's name and registration.

Writing that document by hand is unbilled after-hours work, and it is where quality collapses:
a technician who is excellent in a tank is often slow and inconsistent at prose. This prompt is
the one that turns structured field data into that document.

It is the highest-stakes prompt in the system, because its output is signed.

---

## 2. The prompt

Verbatim from `aiReportService.js:570-683`, with the dynamic slots marked `{{ }}`. Some
long domain sections (LPP, drip dispersal, effluent-filter guidelines) are elided at the marked
points for length; they are more of the same shape — conditional formatting rules keyed on
specific field ids.

> **Note:** this is quoted *as it actually is*, including the phrase "inspection context" and
> "inspection data" at two points. That is a live defect. See prompt 05.

```text
You are a Senior Septic Maintenance Technician with 20+ years of field experience writing a
formal maintenance report. Your diagnostic approach follows this protocol:

1. OBSERVE: Report what was measured and observed, exactly as documented
2. CORRELATE: Cross-reference related measurements (e.g., amp draw + flow rate + discharge
   pressure together indicate pump health; scum thickness + filter soiling + water usage patterns
   together indicate biological load)
3. DIAGNOSE: State the most likely cause based on correlated evidence, distinguishing between
   confirmed findings (directly measured) and inferred conditions (logically derived from
   multiple data points)
4. RECOMMEND: Provide actionable recommendations ranked by severity, with clear reasoning
   connecting each recommendation to specific findings

You NEVER guess. If data is insufficient to draw a conclusion, you state what additional testing
or observation would be needed.

TONE: {{toneInstruction}}

INSTRUCTIONS:
1. Write a professional septic system maintenance report in Markdown format
2. Use ## for section headers. Minimize use of ### subsections - prefer flat structure with ##
   sections and bullet lists. Only use ### when a section has genuinely distinct sub-topics.
   Never nest bullets more than one level deep
3. ALWAYS begin with a ## PROPERTY INFORMATION section using plain text with bold labels.
   Include only: Property Address, Parcel / Folio ID (only if present in the data), Owner Name
   (if available), Technician, Service Date, System Type, and System Name (if provided). Do NOT
   use a table for this section. Then follow this section order for remaining sections:
   {{orderedSections}}
4. NEVER fabricate data. Only reference measurements, conditions, components, and observations
   explicitly present in the MAINTENANCE DATA JSON. Use "Not Observed" for missing information or
   omit the section entirely. Do not invent component conditions, measurements, or service actions
   not documented in the data
5. Use tables for measurements (include threshold comparisons) and component assessments
6. Be concise but thorough - focus on findings and actionable recommendations
7. Omit any section entirely if there is no relevant data for it - do not generate empty or
   placeholder sections
8. FAILED COMPONENT TIMELINES: When a component is failed, non-functional, or critically impaired,
   recommend "Immediate professional attention" -- do NOT assign an arbitrary time window (e.g.,
   "within 7 days"). Exceptions where time-based timelines ARE appropriate: (a) pumping schedules
   based on accumulation projections, (b) items requiring monitoring at next scheduled visit,
   (c) situations requiring further testing or assessment, (d) items already remedied but needing
   follow-up verification
9. HOMEOWNER GUIDANCE: When instructed in the ADDITIONAL INSTRUCTIONS, include a
   "## HOMEOWNER GUIDANCE" section after Recommendations. Write in an approachable but
   professional tone regardless of the overall report tone. Do NOT include this section unless
   specifically instructed
10. Do NOT include a CERTIFICATION section - technician certification, R.O.W.P details, and stamp
    are rendered separately by the PDF system with verified data from the user's profile. Never
    generate certification text, technician names, license numbers, or dates in the report markdown
11. Do NOT include a PHOTO DOCUMENTATION section -- photos are selected and rendered separately by
    the PDF system with actual image data and captions. Never generate photo descriptions, image
    references, or photo archival notes
12. COMPONENT FIELD COVERAGE: For every serviced component, review ALL fields provided in the
    MAINTENANCE DATA JSON. If any field shows a non-optimal value (e.g., "No", "Fail", "Corroded",
    "Significant", "Below Outlet", "Inadequate", "Damaged", "Heavy"), include it in the component
    assessment table and/or narrative. Do NOT silently omit fields with concerning values

REGULATORY STANDARDS:
Use the VERIFIED REFERENCE DATA section (provided in the maintenance data below) as your
ground-truth for all regulatory thresholds, standards, and specifications. Do not invent
thresholds or cite values not present in the reference data.
{{citationInstruction}}   # technical tone: show calculations + cite the regulation
                          # professional tone: use the standards silently, cite nothing

MEASUREMENT GUIDELINES:
- If scum_inches, sludge_inches, and total_fluid_depth are present, create a Tank Measurements
  table [...] List Scum Thickness, Sludge Depth, and Total Fluid Depth as simple measurements
  WITHOUT threshold or status columns - these individual measurements are not inherently good or
  bad on their own
- Add a Solids Content row showing the calculated percentage WITH a threshold note [...]
  Only the total solids percentage indicates pumping need
- Note: High crust/scum (>4-5 inches) may indicate biological issues such as incorrect toilet paper
  usage or insufficient rest time - mention this narratively if present, not as a table threshold.
  Sludge depth is a normal effect of time and does not inherently indicate a negative condition
- If liquid_level_relative shows "Below Outlet", flag as potential tank leak or recent heavy
  pumping -- recommend investigation
- If solids_carryover shows "Significant", flag that solids are passing the outlet baffle
- If electrical_connections shows "Corroded" or "Loose", flag as a safety concern requiring
  immediate attention
[... LPP GUIDELINES, DRIP DISPERSAL GUIDELINES elided ...]

DIAGNOSTIC REASONING:
- Always correlate findings across components. If multiple symptoms are present, identify the root
  cause rather than treating each symptom independently.
- Trace upstream: If the drainfield is failing, check if ATU treatment quality has declined (DO,
  clarity). If ATU is struggling, check if influent quality has changed (effluent filter condition,
  tank solids).
- Trace downstream: If a pump fails, assess impact on downstream distribution (LPP head, drip zone
  pressures, drainfield loading).
- When a critical finding exists, explain the likely cause chain and timeline for cascading effects
  if not addressed.
- Distinguish between confirmed diagnoses and findings that require further investigation
  (recommend specific follow-up tests).

CONFIDENCE CALIBRATION:
[see prompt 04 — the four-tier ladder]

{{diagnosticDepthInstruction}}   # CONCISE | MODERATE | (EXPLANATIVE — dead code, see §6)

MISSING DATA HANDLING (CRITICAL — follow these rules precisely):
[see prompt 03 — six rules, headed by "NEVER ASSUME ZERO"]

FORMATTING:
- Use only ASCII characters. Do NOT use Unicode arrows, bullets, smart quotes, or em-dashes.
  The PDF renderer uses Helvetica which cannot display Unicode symbols.
- For cause chains, use plain text like "A leads to B leads to C", never arrow characters.

EFFLUENT FILTER GUIDELINES:
[... conditional rules keyed on effluent_filter_condition / _soiling / _cleaned ...]

{{exemplar}}   # exactly ONE of thin.txt | standard.txt | comprehensive.txt
```

### The user prompt, in its deliberate order

Assembled at `aiReportService.js:685-838`. The ordering is the point:

```text
REPORT STYLE: {{THIN|STANDARD|COMPREHENSIVE}} (Data completeness score: {{score}}/100)
CRITICAL ISSUES: {{include a Critical Issues section | do NOT include one}}
THRESHOLD OVERRIDES (Organization-specific): ...        # only if org overrode defaults
ADDITIONAL INSTRUCTIONS: ...                            # intro, closing, health-score context,
                                                        # inter-visit work, homeowner guidance
FIELDS NOT MEASURED OR NOT APPLICABLE: ...              # prompt 03
PUMP AMP DRAW DIAGNOSTIC (AUTHORITATIVE, DO NOT override): ...   # prompt 02
PRE-COMPUTED MEASUREMENT CLASSIFICATIONS (do NOT recompute): ...  # prompt 02
CROSS-CORRELATED SYSTEM DIAGNOSTICS (use as authoritative): ...   # prompt 07
VERIFIED REFERENCE DATA: ...                            # prompt 15 (RAG)
INSTALLED EQUIPMENT SPECIFICATIONS: ...
MAINTENANCE DATA:
<the entire payload, YAML>
{{interVisitText}}
{{trendText}}
```

**Every deterministic guardrail is placed *before* the raw data.** The model reads the conclusions
it is not allowed to overturn, and only then sees the numbers it might otherwise be tempted to
re-derive. Ordering is used as a form of authority.

### Synthetic example of the tail of the user prompt

```yaml
MAINTENANCE DATA:
# NOTE: address, parcelId, ownerName and technician are DELIBERATELY ABSENT.
# They identify a real person and property, the model does not need them to write
# narrative prose, and the PROPERTY INFORMATION block below is composed
# deterministically from the local record instead. Until c391dc5 they were
# YAML-dumped verbatim into this prompt and sent to the model provider on every
# report. Stripping them cost nothing. See prompts/05 and the case study, §6.5.
date: "2026-06-13"
systemType: "Type_2_Advanced"
healthScore: 74
components:
  - type: septic_tank
    label: "Septic Tank"
    condition: "Good"
    specs: { material: concrete, capacityGallons: 1250 }
  - type: pump
    label: "Effluent Pump"
    condition: "Good"
    specs: { nameplateAmps: 7.2 }
  - type: aerobic_treatment_unit
    label: "Treatment Unit"
    condition: "Fair"
findings:
  septic_tank_0_scum_inches: "3.0"
  septic_tank_0_sludge_inches: "7.5"
  septic_tank_0_total_fluid_depth: "40"
  septic_tank_0_effluent_filter_soiling: "Moderate"
  pump_0_pump_current_draw: "6.4"
  aerobic_treatment_unit_0_dissolved_oxygen_mgl: "1.4"
  aerobic_treatment_unit_0_effluent_clarity: "Cloudy"
```

---

## 3. Techniques used

| Technique | Where, concretely |
|---|---|
| **Role assignment** | "Senior Septic Maintenance Technician with 20+ years of field experience." Not decoration — it sets the register of the whole document, and it is the *only* place the maintenance-vs-inspection framing is asserted positively (see §6). |
| **Procedural chain-of-thought** | OBSERVE → CORRELATE → DIAGNOSE → RECOMMEND. A *named domain protocol*, not "think step by step". It attacks a specific real-world failure: technicians under time pressure report symptoms independently and never correlate them. The prompt makes correlation a mandatory stage. |
| **Few-shot (single-shot, style-matched)** | Exactly one exemplar is appended — `thin`, `standard`, or `comprehensive` — chosen by a *deterministic completeness score*. Each exemplar is a whole sample report between `---BEGIN SAMPLE---` markers, not an input/output pair. Whole-document imitation, ~2.6k / 5.2k / 11.7k chars. |
| **Data-completeness gating** | `calculateDataCompleteness()` (`reportDataPreprocessor.js:599-694`) scores the payload 0-100 across weighted field categories; <30 → thin, <60 → standard, else comprehensive; **critical findings force comprehensive regardless of score** (`:661-664`). A thin dataset *cannot* produce an authoritative-looking long report. This is a hallucination control disguised as a formatting feature. |
| **Output-space restriction (negative constraints)** | Instructions 10 and 11 forbid the model from writing the CERTIFICATION and PHOTO DOCUMENTATION sections. These carry the technician's name, R.O.W.P. number and stamp. They are rendered by the PDF layer from verified profile data. **The regulated claim is structurally removed from the stochastic component** — the single best control in the system. |
| **Anti-fabrication constraint** | Instruction 4: "NEVER fabricate data… Do not invent component conditions, measurements, or service actions not documented in the data." A fabricated "effluent filter cleaned" is billing for work not done. |
| **Anti-omission constraint** | Instruction 12 is the mirror image: the model must *not silently drop* a field with a concerning value. Fluency has a bias toward tidy narratives; this forces the ugly fields in. |
| **Prompt-layer separation** | System = persona + rules + exemplar (stable per org-preferences × style, and cacheable). User = everything per-visit. In the minimal case the system prompt is ~92% of input characters. |
| **Ordering as authority** | Guardrail blocks precede raw data (see the user-prompt order above). |
| **Format constraint driven by a downstream renderer** | The ASCII-only rule exists because the PDF renderer uses Helvetica and cannot draw a Unicode arrow. A prompt constraint caused by a font. This is what production prompts actually look like. |

---

## 4. Expected output shape

Freeform **Markdown**. `##` section headers, in the org's configured order, beginning with
`## PROPERTY INFORMATION`. No JSON, no schema, no tool calling.

```markdown
<!-- This block is NOT written by the model. It is composed deterministically from the
     local record and prepended, exactly as the certification block is. The model never
     saw any of these values. -->
## PROPERTY INFORMATION
**Property Address:** 760 Saltmarsh Way (sample), Comox BC
**Parcel / Folio ID:** 000-555-0142 (sample sentinel — not a real BC PID)
**Technician:** A. Technician
**Service Date:** June 13, 2026
**System Type:** Type 2 - Advanced Treatment

## EXECUTIVE SUMMARY
The system is functional but treatment performance has declined... Health score: 74/100.

## SERVICE FINDINGS
| Component | Condition | Notes |
|-----------|-----------|-------|
| Septic Tank | Good | 1250 gal concrete; no structural defects observed |
| Effluent Pump | Good | 6.4 A measured against 7.2 A nameplate (88.9% FLA) |
| Treatment Unit | Fair | Dissolved oxygen 1.4 mg/L; effluent cloudy |

## TANK MEASUREMENTS
| Measurement | Value |
|-------------|-------|
| Scum Thickness | 3.0 inches |
| Sludge Depth | 7.5 inches |
| Total Fluid Depth | 40 inches |
| Solids Content | 26.3% -- above monitoring threshold |

## RECOMMENDATIONS
1. ...
```

**Structured output is NOT enforced.** No `response_format`, no JSON schema, no tool calling
anywhere in the pipeline (verified by grep). Format is constrained by prose instruction and checked
*after the fact* by substring/regex tests in `validateReportOutput()` (`:1137-1207`) — which is
**log-only and does not block** (`:1131`, `:1451-1458`). This is a real weakness, and the newly
designed prompts in this library (06, 10, 11, 12, 13, 14) all use schema-constrained output instead.

---

## 5. Failure modes and mitigations

| Failure mode | Why it happens | Mitigation in this prompt | Honest residual risk |
|---|---|---|---|
| **Fabricated measurement or service action** | A fluent report "wants" complete tables. The model fills a gap. | Instruction 4; the three-way missing-data taxonomy (prompt 03); pre-computed classifications (prompt 02). | Detection is heuristic and non-blocking. |
| **Hallucination-as-reassurance** — an alarming reading rendered as comfortable prose | Assistant-tuned models regress toward the reassuring mean. "Pump amp draw was low, continue monitoring" is a *fluent* sentence and a *lethal* one. | Severity is classified in JS and injected as AUTHORITATIVE (prompt 02). The model is left only the prose. | The strongest idea in the system; see prompt 02 for the case where it silently failed. |
| **Silent omission of an ugly field** | Narrative smoothing. | Instruction 12 (COMPONENT FIELD COVERAGE) + a post-hoc component-coverage check in the validator. | Validator warns; nothing blocks. |
| **The model writes the certification block** | It has seen thousands of reports that end with one. | Instructions 10 & 11 forbid it; validator flags `## CERTIFICATION` as an **error**; the PDF renders the real block from profile data. | The error is logged, not enforced. The structural control (PDF renders it) is what actually saves you. |
| **Arbitrary urgency windows** ("replace within 7 days") | Models invent plausible-sounding deadlines. | Instruction 8: failed component → "Immediate professional attention", never a made-up window; time windows allowed only where a *projection* backs them. | Good, and specific. |
| **Unicode that the PDF cannot render** | Models love `→` and `—`. | FORMATTING block. | Partly effective; the code strips some downstream. |
| **The model calls the work an "inspection"** | The training distribution is saturated with the higher-status word, and the exemplar it is told to imitate contains it. | **Nothing.** There is no negative constraint on the word. | **This is the live defect. See prompt 05.** |

---

## 6. Provenance and verification

- Every line quoted above was read in source at `Backend/aiReportService.js`. Assembled by
  `buildReportPrompt()` at **lines 528-841**; the system prompt is **lines 570-683**.
- Exemplars: `Backend/exemplars/{thin,standard,comprehensive}.txt` (60 / 113 / 236 lines), loaded
  once at module init (`:79-90`), appended at `:683`.
- Model config: `:53-68`. Token budget: `:71-76` (max input 24,000; target 16,000; max output 8,000).

**Three defects in this prompt, found while harvesting it, reported rather than hidden:**

1. **Conflicting solids thresholds.** The MEASUREMENT GUIDELINES tell the model "25%+ =
   High/pumping recommended" (`:599`). The deterministic injector tells it 25-33% is
   "APPROACHING THRESHOLD — monitor closely" and only 33%+ "EXCEEDS THRESHOLD" (`:294-296`). At
   28% solids the model receives a *do-not-recompute* fact saying **monitor** and a guideline
   saying **pump**. Two sources of truth in one prompt.
2. **A dead depth tier.** `DEPTH_MIGRATION` is applied twice — once in `generateReportContent`
   (`:1389`) and again inside `buildDiagnosticDepthInstruction` (`:435`) — so `explanative`
   collapses to `moderate` and the EXPLANATIVE instruction block (`:454-461`) is unreachable.
   Two of three advertised diagnostic depths actually work. There is a user-facing setting for
   the third.
3. **The word "inspection" is in the prompt** ("inspection context", `:599`; "inspection data",
   `:654`; "current inspection readings" and "routine inspections", `:755`) and, worse, inside the
   few-shot exemplar the model is told to imitate. See prompt 05.

---

## 7. Privacy: what actually goes to the model

This must be stated precisely, because the tempting claim is false and the true story is better.

**The property address, the parcel/folio ID, and the technician's name ARE transmitted to the
third-party model provider on every report generation.** Verified end to end:

1. `Backend/routes/reports.js:347-359` builds the payload under the comment *"Build inspection data
   object for AI"*, including `address: event.property_address`, `parcelId:
   event.property_parcel_id`, `technician: event.created_by_name`.
2. → `generateReportContent(inspectionData, …)` (`reports.js:373`, `:551`).
3. → `preprocessReportData()` (`reportDataPreprocessor.js:329-379`) destructures out the findings
   and **retains every other field**: `const { findings, ...otherData } = inspectionData;`
4. → `aiReportService.js:826-828`: `yaml.dump(textData)` — **the entire object**, verbatim, into the
   user prompt under `MAINTENANCE DATA:`.

So: **do not write "no PII is sent to the model."** It is false.

Be precise about what *isn't* sent, too: owner **name**, **phone**, and **email** are not in
`inspectionData` and genuinely never reach the provider. A parcel/folio ID is the sharpest item in
the list — a real BC PID resolves to a registered parcel and its registered owner. It is a
quasi-identifier as strong as an address.

**The honest finding is stronger than the boast would have been: the model does not need any of it.**

The address and parcel ID are re-composed into the finished document *locally* regardless —
`buildFallbackReportContent` (`:1239-1257`) prints `**Property:** ${address}` and `**Parcel / Folio
ID:** ${parcelId}` straight from `inspectionData`, and the PDF letterhead is rendered from a
separate `metadata` object. The AI's contribution to the PROPERTY INFORMATION section is
*transcription*, not reasoning. Nothing in the diagnosis, the severity classification, the
correlation, or the narrative depends on knowing the street.

A three-line redaction in `preprocessReportData` —

```js
// The model diagnoses a system; it does not need to know whose system it is.
// address / parcelId / technician are re-composed locally by the PDF layer.
const { address, parcelId, technician, ...modelSafeData } = otherData;
```

— removes the PII from the prompt at **zero cost to report quality**. It is not built.

This generalises into the cleanest privacy heuristic in the whole library, and it is the same move
prompt 10 makes with money and prompt 14 makes with owner names:

> **The most reliable way to stop a model leaking a field is to not put the field in its context.**
> Ask of every field in the payload: does the *reasoning* need this, or does only the *document*
> need it? If only the document needs it, the document layer can add it back.
