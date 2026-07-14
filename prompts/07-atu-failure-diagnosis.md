# 07 — ATU / aerobic-unit failure diagnosis: root cause, not symptom list

| | |
|---|---|
| **Origin** | **HARVESTED** — `computeSystemCorrelations()` at `Backend/aiReportService.js:350-391`, plus the DIAGNOSTIC REASONING block at `:634-639`. **Extended** here with an explicit reasoning contract and a structured differential. |
| **Serves** | The contractor — this is the diagnosis that decides whether the homeowner spends $400 on a blower or $25,000 on a drainfield. |

---

## 1. Use case

An **Aerobic Treatment Unit** (ATU) is what makes a Type 2 system a Type 2 system: it blows air
through the effluent so that aerobic bacteria digest the organics before the water reaches the
dispersal field. Under BC's technical standard it must hold effluent quality below 45 mg/L
BOD/TSS, and a healthy unit runs at **≥ 2.0 mg/L dissolved oxygen**.

The characteristic failure is a **cascade**, and every stage of it looks like a separate problem:

```
blower diaphragm wears out
      ↓
airflow drops
      ↓
dissolved oxygen falls below 2.0 mg/L
      ↓
aerobic bacteria die back; treatment goes anaerobic
      ↓
effluent leaves the unit cloudy and high in organics
      ↓
that effluent is dosed onto the drainfield
      ↓
biomat forms across the infiltrative surface, faster than it should
      ↓
the field stops accepting water: surface ponding, effluent breakout
      ↓
DRAINFIELD REPLACEMENT — a five-figure job
```

The technician arrives at stage seven. What they see is **surface ponding over the drainfield** —
the single most alarming thing a septic system can show you. The intuitive diagnosis is "the
drainfield is failing; it's old; it needs replacing."

**The drainfield is a victim, not the culprit.** The culprit is a worn rubber diaphragm in a
$400 blower, and the field may well recover if the treatment is restored before the biomat
consolidates.

This is the single highest-value diagnosis in the entire domain, and it is exactly the one a
symptom-by-symptom report will miss — because each finding, read alone, is unremarkable:

- DO is 1.4 mg/L. *Slightly low. Monitor.*
- Effluent is cloudy. *Note it.*
- Blower condition: Fair. *Note it.*
- Ponding at the field. *The field is failing.*

Four true sentences, four wrong conclusions, and a $25,000 recommendation instead of a $400 one.
The correlation is the diagnosis, and an LLM handed a component list will produce the component
list back.

> The code comment on the production correlation engine says exactly this
> (`aiReportService.js:344-346`): *"The AI treats each component in isolation — this function
> connects symptoms across components to identify root causes and cascading failures."*

---

## 2. The prompt

### 2a. The deterministic correlation block (HARVESTED, verbatim)

`computeSystemCorrelations()` (`:350-391`) hand-codes three multi-signal rules and injects the
result as a fact:

```js
// Correlation 1 — treatment effectiveness: DO + effluent clarity + blower condition
if (!isNaN(doLevel) && doLevel < 2.0 && effluentClarity && effluentClarity !== 'Clear') {
  const blowerNote = blowerComp && blowerComp.condition !== 'Good'
    ? `Blower condition: ${blowerComp.condition}. Root cause is likely the blower — addressing it will improve DO and effluent quality.`
    : 'Blower appears functional — chemical interference or excessive organic loading may be suppressing biological activity.';
  correlations.push(`TREATMENT SYSTEM: Low DO (${doLevel} mg/L) + ${effluentClarity} effluent = TREATMENT DEGRADATION. ${blowerNote}`);
}

// Correlation 3 — the important one: drainfield stress is DOWNSTREAM of treatment failure
if (hasSurfaceIssue && !isNaN(doLevel) && doLevel < 2.0) {
  correlations.push(`DRAINFIELD + TREATMENT: Surface water issues detected AND low DO (${doLevel} mg/L). Poor treatment quality accelerates biomat formation — drainfield stress may be caused by upstream treatment failure rather than field age or soil conditions.`);
}
```

Injected into the user prompt, before the raw data, as:

```text
CROSS-CORRELATED SYSTEM DIAGNOSTICS (pre-computed — use these as authoritative findings):
- TREATMENT SYSTEM: Low DO (1.4 mg/L) + Cloudy effluent = TREATMENT DEGRADATION. Blower condition: Fair. Root cause is likely the blower -- addressing it will improve DO and effluent quality.
- DRAINFIELD + TREATMENT: Surface water issues detected AND low DO (1.4 mg/L). Poor treatment quality accelerates biomat formation -- drainfield stress may be caused by upstream treatment failure rather than field age or soil conditions.
```

Note the hedge in the second one: *"may be caused by"*, not *"is caused by"*. Even the
deterministic layer respects the confidence ladder (prompt 04). It is a correlation, not a proof.

And note the **else branch** in correlation 1, which is the part most people would leave out: if
the blower is fine, the block does *not* silently blame the blower anyway — it names the two other
real candidates (chemical interference, organic overloading). A correlation engine that always
finds the same culprit is a broken correlation engine.

### 2b. The extension — an explicit differential (NEWLY DESIGNED)

The production block asserts the conclusion. It does not ask the model to *reason to* it, and it
does not surface the alternatives that were ruled out. For a diagnosis with a five-figure delta
attached, both are worth the tokens. Added to the system prompt for ATU-bearing systems:

```text
AEROBIC TREATMENT UNIT — DIAGNOSTIC PROTOCOL

An ATU failure presents as a CASCADE. The symptom you see is usually downstream of the cause.
Before you attribute any drainfield problem to field age, soil, or hydraulic overloading, you MUST
first rule out upstream treatment failure. Work the chain in this order:

1. AERATION      -- blower condition, run time, air pressure, amp draw vs nameplate
2. TREATMENT     -- dissolved oxygen (>= 2.0 mg/L is the minimum for aerobic function)
3. EFFLUENT      -- clarity, solids carryover, filter soiling
4. DISPERSAL     -- surface ponding, breakout, saturated ground, field condition

A finding at stage 4 with a co-occurring finding at stage 1, 2 or 3 is NOT an independent
drainfield problem. It is the visible end of a chain that starts upstream. Report the ROOT CAUSE
as the primary finding and the drainfield condition as its CONSEQUENCE.

REQUIRED, in this order, in the Findings narrative:
  a. The root cause, named, with the evidence chain that supports it.
  b. The consequence(s) it explains.
  c. THE DIFFERENTIAL: what else could produce this pattern, and what measurement would
     distinguish them. You MUST name at least one alternative you did not choose, and the specific
     test that would rule it in or out. If the data cannot distinguish two causes, say so and
     recommend the test -- do not pick the more likely one and present it as settled.
  d. The cost asymmetry, when one exists: state plainly if a small upstream repair may prevent a
     large downstream replacement. Do NOT invent dollar figures. Say "component repair" versus
     "field replacement" -- the office prices the work, not you.

CONSTRAINTS:
- If dissolved oxygen was NOT measured on a system with an aerobic treatment unit, you CANNOT
  assess treatment performance. Say exactly that, and recommend measuring DO at the next visit.
  Do not infer treatment quality from effluent clarity alone -- clarity is a weak proxy and a
  clear-looking effluent can be biologically dead.
- A drainfield does not recover on the strength of a report. If a field is already ponding, restoring
  treatment may or may not save it. Never promise recovery. State that restoring treatment removes
  the ongoing cause and that the field's response must be assessed at the next visit.
- The work is MAINTENANCE. Never describe it as an inspection.
```

### 2c. Synthetic input

```yaml
components:
  - type: aerobic_treatment_unit
    label: "Treatment Unit"
    condition: "Fair"
    specs: { manufacturer: "Unknown", ratedFlowGpd: 600 }
  - type: air_blower
    label: "Air Blower"
    condition: "Fair"
    specs: { nameplateAmps: 1.1, ratedWatts: 80 }
  - type: drainfield_gravity
    label: "Dispersal Field"
    condition: "Needs Attention"
findings:
  aerobic_treatment_unit_0_dissolved_oxygen_mgl: "1.4"
  aerobic_treatment_unit_0_effluent_clarity: "Cloudy"
  air_blower_0_air_pressure: "1.8"          # psi
  air_blower_0_blower_condition: "Fair"
  drainfield_gravity_0_field_condition: "Needs Attention"
  drainfield_gravity_0_surface_condition: "Ponding observed at distribution end"
```

---

## 3. Techniques used

| Technique | How |
|---|---|
| **Deterministic cross-component correlation** | The multi-signal diagnosis is computed in JS from co-occurring findings and injected as authoritative. The model is not asked to notice the pattern — noticing is exactly what it is bad at when the signals sit in different rows of different tables. |
| **Directional reasoning scaffold (upstream/downstream)** | The four-stage chain (AERATION → TREATMENT → EFFLUENT → DISPERSAL) is a *domain-shaped* chain-of-thought. Not "reason step by step" — a specific causal ordering that encodes how this equipment actually fails. |
| **Named-anti-pattern constraint** | *"A finding at stage 4 with a co-occurring finding at stage 1, 2 or 3 is NOT an independent drainfield problem."* The wrong conclusion is stated and forbidden, rather than the right one merely being encouraged. |
| **Forced differential diagnosis** | Requirement (c): name an alternative you rejected and the test that would distinguish it. This is borrowed straight from clinical reasoning, and it is the strongest single anti-overconfidence device available — a model that must produce a rival hypothesis cannot collapse into the first fluent story. |
| **Abstention as a required output** | *"If the data cannot distinguish two causes, say so and recommend the test."* The differential has a legal exit: "I don't know, here's how to find out." |
| **Refusal on a missing key measurement** | No DO reading on an ATU → treatment performance is *unassessable*, full stop. And explicitly: do not substitute clarity as a proxy. Naming the tempting substitute is what stops the substitution. |
| **Cost-asymmetry framing, without numbers** | The model may say "component repair vs field replacement" and may **not** invent dollar figures — pricing comes from the org's own price book (prompt 10). This is the right split: the model can carry the *shape* of the asymmetry without inventing a *number*. |
| **Confidence calibration** | The correlations are INDICATED, not CONFIRMED — even the deterministic block hedges ("may be caused by"). See prompt 04. |
| **Refusing a comforting promise** | "Never promise recovery." A ponding field may be past saving; a report that implies the $400 blower will fix it is setting up a very bad conversation in six months. |

---

## 4. Expected output shape

Markdown, inside the Findings and Recommendations sections of the main report:

```markdown
## SERVICE FINDINGS

**Root cause -- aeration failure.** The air blower is in Fair condition and delivering 1.8 psi.
Dissolved oxygen in the treatment unit measured 1.4 mg/L, below the 2.0 mg/L minimum required for
aerobic biological treatment, and effluent leaving the unit was cloudy. These three findings form a
single chain: reduced aeration has suppressed the aerobic bacteria, and the unit is no longer
treating to specification.

**Consequence -- dispersal field stress.** Ponding was observed at the distribution end of the
field. Under-treated effluent accelerates biomat formation across the infiltrative surface. The
ponding is most probably a consequence of the treatment failure above, rather than an independent
failure of the field itself.

**Differential.** Two other conditions produce low dissolved oxygen with a functioning blower:
chemical interference (bleach or antibacterial products killing the biology) and hydraulic or
organic overloading (more waste than the unit is rated for). The blower's Fair condition and low
air pressure make aeration the leading explanation, but this is not settled by the current data.
Measuring blower amp draw against its 1.1 A nameplate and recording household occupancy would
distinguish these. Recommend both at the next service visit.

**Cost asymmetry.** Restoring aeration is a component-level repair. Replacing a dispersal field is
not. Addressing the blower now removes the ongoing cause of field loading; whether the field
recovers cannot be determined from this visit and must be reassessed at the next one.
```

Notice what the report does **not** say: it does not say the drainfield is failing, it does not
promise the field will recover, and it does not name a dollar figure.

---

## 5. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| **Symptom-by-symptom reporting** — four findings, no chain | The homeowner is quoted a drainfield replacement for a blower fault. Five-figure error. | Deterministic correlation injection + the four-stage protocol | Low for the two coded correlations. **Only three correlation rules exist** (`:350-391`) — any cascade nobody hand-coded is invisible. This is the honest ceiling of the approach. |
| **Blaming the drainfield** (the intuitive, wrong answer) | Same as above | Correlation 3 states the inversion explicitly as an authoritative finding | Low. |
| **Always blaming the blower** | A correlation engine that only ever returns one culprit is useless | The else-branch at `:362` names chemical interference and organic loading when the blower is fine; the forced differential re-raises them in prose | Good — this is genuinely well designed. |
| Inferring treatment quality from clear-looking effluent | A biologically dead unit passes because the water looks fine | Explicit constraint; clarity named as a weak proxy | Low. |
| Promising the field will recover | A promise the system cannot keep, made in a signed document | Explicit constraint | Low. |
| Inventing a repair cost | A quote the contractor never gave, in their name | "Do NOT invent dollar figures" — pricing is prompt 10's job, from the org's price book | Low. |
| **A correlation nobody coded** | e.g. a failing effluent filter causing solids carryover that fouls the ATU. Real, common, and **not one of the three rules.** | — | **Unmitigated.** Hand-coded correlation rules do not scale. The honest statement for the case study: this technique bought three high-value diagnoses cheaply and does not generalise past them. The next build is a rule set that is *data*, not code — or an eval harness that can tell you whether the model finds cascade #4 on its own. |

---

## 6. Provenance and verification

- `computeSystemCorrelations()` — `Backend/aiReportService.js:350-391`. Three rules: treatment
  degradation (`:359-364`), filter/solids reinforcement (`:376-378`), drainfield-downstream-of-
  treatment (`:383-385`). Injected header at `:389`.
- The design comment — `:344-346`.
- The DO threshold (≥2.0 mg/L) and its regulatory framing appear in `computeNumericalClassifications`
  (`:322-324`) and in the system prompt's MEASUREMENT GUIDELINES.
- DIAGNOSTIC REASONING (upstream/downstream tracing) — `:634-639`, already in production.
- **Newly designed here:** the four-stage protocol, the forced differential, the DO-refusal
  constraint, and the cost-asymmetry framing. None of these exist in production today.
- **Caveat:** the 2.0 mg/L DO minimum and the Type 2 BOD/TSS limits are taken from the system's own
  knowledge corpus, which is unsourced (`"sourceUrl": null`). Re-verify against the BC Standard
  Practice Manual before publication.
