# 02 — Deterministic-fact injection: pump amp draw

| | |
|---|---|
| **Origin** | **HARVESTED** — `Backend/aiReportService.js:211-272` (`computeAmpDrawDiagnostics`), sibling injector at `:283-339` (`computeNumericalClassifications`) |
| **Serves** | The contractor — and, downstream, the homeowner whose pump is about to burn out |
| **Position** | Injected into the **user** prompt *before* the raw maintenance data (`:788-795`) |

---

## 1. Use case

A submersible effluent pump has a **nameplate full-load amperage (FLA)** stamped on it. What the
pump is actually drawing, measured with a clamp meter, tells you what is happening hydraulically
*inside* a sealed system you cannot see:

- Drawing **22% of nameplate** — the motor is spinning with nothing to push. Dry run, sheared
  impeller, or a severed discharge line. It is cooling itself with fluid it does not have. It will
  burn out.
- Drawing **130% of nameplate** — it is fighting something. Clogged impeller, seized bearing,
  blocked discharge. Sustained draw above 125% of nameplate is beyond the band that motor overload
  protection is normally sized to.
- Drawing **85%** — this is exactly what a healthy residential effluent pump looks like.

The percentage is a ratio of two numbers. The classification is a lookup on a seven-tier scale.
**Neither task should ever be given to a language model**, and the reason is not that models are
bad at division.

## The actual reason (this is the thesis of the whole case study)

Give an assistant-tuned model a low amp reading and ask it to write "a professional maintenance
report", and it will produce something like:

> *"Pump amp draw was measured at 1.6 A, which is on the lower end of the operating range.
> The pump was observed running normally. Continue to monitor at the next service visit."*

That sentence is fluent, plausible, professionally-toned — and it describes a motor that is
destroying itself. The model did not hallucinate a fact. It hallucinated **reassurance**. It
regressed an alarming outlier toward the comfortable mean, because that is what the tone it was
asked for looks like in its training distribution.

Fabrication is the failure mode everyone guards against. **Reassurance is the failure mode that
actually gets someone's pump replaced at their expense**, and it is invisible in the output,
because the output looks *better* than the truthful version.

The fix is not a better instruction. The fix is to **take the judgement away from the model
entirely** and leave it only the prose.

---

## 2. The prompt

### 2a. The deterministic layer (JavaScript — this is the load-bearing part)

Verbatim from `aiReportService.js:235-243`. The seven-tier scale, each tier carrying its own
causal explanation:

```js
const SEVERITY_TIERS = [
  { min: 0,   max: 30,       label: 'CRITICAL - No Load',
    detail: 'Pump running but no hydraulic load detected. Possible causes: dry run (no fluid), broken/missing impeller, severed or disconnected discharge line. Motor damage risk from overheating without fluid cooling.' },
  { min: 30,  max: 50,       label: 'CRITICAL - Severe Underload',
    detail: 'Pump drawing far below normal operating current. Possible causes: damaged/eroded impeller, air lock in pump or discharge line, broken discharge pipe allowing free flow, check valve failure.' },
  { min: 50,  max: 70,       label: 'WARNING - Underload',
    detail: 'Pump drawing below normal operating range. Possible causes: worn impeller reducing efficiency, partial air lock, abnormally low discharge head, partially open bypass.' },
  { min: 70,  max: 100,      label: 'Normal Operating Range',
    detail: 'Pump operating within expected parameters. Optimal range is 80-90% FLA for residential effluent pumps.' },
  { min: 100, max: 115,      label: 'Elevated - Service Factor Range',
    detail: 'Drawing above nameplate but within typical service factor range. Acceptable short-term if motor SF >= 1.15. Monitor on subsequent visits.' },
  { min: 115, max: 125,      label: 'WARNING - Overload',
    detail: 'Pump drawing significantly above nameplate rating. Possible causes: clogged impeller or discharge, debris in pump, worn bearings increasing friction, excessive discharge head from pipe restrictions.' },
  { min: 125, max: Infinity, label: 'CRITICAL - Overload',
    detail: 'Motor damage imminent or occurring. Sustained draw above 125% of nameplate FLA is beyond the overload-protection band that motor protection is normally sized to (see the installation's governing electrical code). Possible causes: seized or binding impeller, severe pipe obstruction, failed bearing, locked rotor condition approaching.' }
];
```

### 2b. The injected prompt block (verbatim, `aiReportService.js:269-271`)

```text
PUMP AMP DRAW DIAGNOSTIC (pre-computed from manufacturer nameplate data — AUTHORITATIVE, DO NOT override):
Pump 0: 1.6A measured / 7.2A nameplate = 22.2% FLA -- CRITICAL - No Load. Pump running but no
hydraulic load detected. Possible causes: dry run (no fluid), broken/missing impeller, severed or
disconnected discharge line. Motor damage risk from overheating without fluid cooling.
IMPORTANT: These classifications are computed server-side from the manufacturer's nameplate
full-load amperage using SepticScribe's diagnostic severity scale. (The scale is our own
engineering heuristic, calibrated to residential effluent pumps -- it is not reproduced from any
published standard, and you must not attribute it to one or cite a code clause for it.) You MUST
use these exact severity classifications in your report. Do NOT rationalize, downplay, or reinterpret CRITICAL or
WARNING classifications — they indicate real equipment problems requiring immediate attention.
```

Read that last sentence again. It is not a generic "be accurate" instruction. It names the specific
cognitive move the model is about to make — *rationalize, downplay, reinterpret* — and forbids it.
Whoever wrote it had watched the model do exactly that.

### 2c. The refusal branch (verbatim, `aiReportService.js:253`)

When the nameplate FLA has not been configured for that pump, the injector does **not** guess a
typical FLA. It emits:

```text
Pump 0: Measured 1.6A — nameplate FLA not configured, cannot classify against 7-tier scale.
Report this amp draw reading as-is without severity classification. Note that nameplate data is
needed for proper assessment. Do not guess or assume a FLA value.
```

**Refusal is designed in at the deterministic layer, not delegated to the model's discretion.** No
denominator, no percentage, no classification — and an explicit instruction not to invent one. A
system that will happily classify without the data it needs to classify is worse than one that
won't, because you cannot tell its guesses from its measurements.

### 2d. The sibling injector — partial data (verbatim, `aiReportService.js:336-338` and `:305`)

Same pattern, extended to solids %, filter pressure differential, dissolved oxygen, and liquid level:

```text
PRE-COMPUTED MEASUREMENT CLASSIFICATIONS (use these directly — do NOT recompute):
- SOLIDS: 10.5" combined (3.0" scum + 7.5" sludge) / 40" fluid depth = 26.3% → APPROACHING THRESHOLD — monitor closely
- FILTER PRESSURE: 8.0 PSI (pre) - 4.0 PSI (post) = 4.0 PSI differential → DIRTY — plan cleaning at next service
- DISSOLVED OXYGEN: 1.4 mg/L → BELOW REGULATORY MINIMUM — treatment impaired
IMPORTANT: All numerical assessments and classifications in PRE-COMPUTED sections have been
verified by deterministic calculation. Use these values directly in the report. Do NOT recalculate
percentages, thresholds, or classifications.
```

> ⚠️ **`BELOW REGULATORY MINIMUM` is wrong, and it is reproduced verbatim here because it is what the
> system actually emits.** No BC regulation or standard sets a dissolved-oxygen minimum — not BC Reg
> 326/2004, not SPM V3 (both checked by full-text extraction; see [`../SOURCES.md`](../SOURCES.md)).
> The 2.0 mg/L figure is an *operational* threshold from the product's own unsourced corpus. The word
> REGULATORY is an affirmative claim the system cannot support, in text that reaches a document a
> health authority may read. It is an open defect (CASE-STUDY.md §5.10); the correct string is
> `BELOW OPERATIONAL THRESHOLD -- treatment impaired`, which is what the prototype in this repo emits.
> The transcript is not rewritten to hide it.

And when only *some* of the tank measurements exist:

```text
- SOLIDS: PARTIAL DATA — scum: 3.0", sludge: 7.5" measured. Cannot compute solids percentage:
  total_fluid_depth not measured.
```

The gap is named *for* the model, pre-emptively, so it does not have to decide what to do about a
hole in the data — the single most reliable way to provoke a confabulation.

---

## 3. Techniques used

| Technique | How it is applied |
|---|---|
| **Deterministic-fact grounding (authority inversion)** | The standard RAG framing is "retrieve facts, let the model reason." This inverts it: **the reasoning happens in JavaScript and the model is demoted to a writer.** Arithmetic, thresholds, severity tiers and causal explanations are all computed before the model is invoked. |
| **Explicit authority marking** | "AUTHORITATIVE, DO NOT override" / "use these directly — do NOT recompute". The block is not offered as context; it is asserted as a conclusion. |
| **Adversarial negative constraint** | "Do NOT rationalize, downplay, or reinterpret." Names the failure behaviour rather than the failure output. |
| **Provenance in the constraint** | "computed server-side from the manufacturer's nameplate full-load amperage using SepticScribe's diagnostic severity scale". The model is told *why* it may not argue — the number outranks it because of where it came from: a nameplate and a deterministic lookup, not the model's own judgement. |
| **Refusal design** | No nameplate → report raw, classify nothing, "Do not guess or assume a FLA value." |
| **Typed partial data** | `PARTIAL DATA — … not measured` rather than an absent section. |
| **Positional authority** | The block is pushed into the user prompt *before* the YAML payload (`:788-795`), so the conclusion is established before the model sees the raw numbers. |

---

## 4. Expected output shape

The injected block does not change the *shape* of the output (still Markdown prose + tables). It
changes the **content of the judgement**. The pump row of the assessment table must read:

```markdown
| Effluent Pump | Fail | 1.6 A measured against 7.2 A nameplate (22.2% FLA) -- CRITICAL, no-load
condition. Pump is running without hydraulic load. |
```

…and the Recommendations section must carry immediate urgency, using the exact severity word the
deterministic layer chose. If the report says "monitor", the guardrail has been overridden and the
report is wrong.

---

## 5. Failure modes and mitigations

| Failure mode | Mitigation | Residual risk |
|---|---|---|
| Model softens a CRITICAL reading into reassuring prose | Severity is not the model's to choose; the explicit anti-rationalisation sentence | The model still *writes* the sentence. It can technically ignore the instruction. Nothing blocks a report where it did — validation is log-only. |
| Model recomputes the percentage and gets it wrong | "do NOT recompute"; the arithmetic never reaches the model as a task | Low. |
| Model guesses a nameplate FLA to produce a percentage | Explicit refusal branch | Low — and this is the branch most systems get wrong. |
| Model treats a missing measurement as zero | `PARTIAL DATA` naming + prompt 03's "NEVER ASSUME ZERO" | Low. |
| **The guardrail silently produces nothing and the model reverts to free-hand judgement** | — | **This actually happened. See below.** |

## The failure that matters: a guardrail that failed *open*

Findings are stored **prefixed** by component and index (`septic_tank_0_scum_inches`). Until
2026-06-16, `computeNumericalClassifications()` and `computeSystemCorrelations()` read the **bare**
field ids (`scum_inches`). On real field data they matched nothing, returned an empty string, and
the entire `PRE-COMPUTED MEASUREMENT CLASSIFICATIONS` section **simply vanished from the prompt**.

- No error. No exception. No log line. No alarm.
- The report still generated. It still looked perfect. It still had a solids percentage in it —
  computed by the model, unguarded, unchecked.
- The amp-draw injector escaped only by luck: its regex `^pump_(\d+)_pump_current_draw$` happens to
  match the prefixed shape.

This is documented in the code itself, in the docstring of the fix (`aiReportService.js:173-190`):
*"so those classifications silently never fired on real maintenance data."* Fixed in commit
`9cf8686`; regression test at `Backend/tests/unit/services/diagnosticFindingKeys.test.js`.

**A guardrail that fails open is worse than no guardrail**, because it manufactures confidence.
Everyone — including the person who wrote it — believed the arithmetic was being done in JS. It was
being done by a language model, silently, for months.

The design lesson is not "test your guardrails" (though: there were no unit tests on these
classifiers before the bug, and there are eight now). It is architectural:

> **A guardrail whose absence is indistinguishable from its success needs a liveness check.**
> If the injected block is empty for a payload that contains the measurements it classifies, that
> is not "no findings" — that is a **fault**, and it should be loud.

The pipeline still does not have that check. Recommended, and cheap:

```js
// Liveness assertion — a classifier that produces nothing on data it should classify is broken.
if (hasTankMeasurements(findings) && numericalClassifications === '') {
  logger.error('GUARDRAIL FAULT: tank measurements present but classifier emitted nothing', {
    eventId, findingKeys: Object.keys(findings)
  });
}
```

---

## 6. Provenance and verification

- `computeAmpDrawDiagnostics` — `aiReportService.js:211-272`. Tiers at `:235-243`; no-nameplate
  refusal at `:252-255`; injected header at `:269-271`.
- `computeNumericalClassifications` — `:283-339`. Partial-data branch at `:298-306`.
- The thesis, stated in a code comment at `:277-279`: *"LLMs are unreliable at arithmetic —
  deterministic classification is dramatically more accurate."* (True, but as argued above, it
  understates its own idea: the arithmetic is the least of it.)
- The fail-open bug — `getFinding()` docstring, `:173-190`; fix in commit `9cf8686` (2026-06-16);
  regression test `Backend/tests/unit/services/diagnosticFindingKeys.test.js` (8 tests, passing).
- **Known inconsistency, unfixed:** the solids tiers in this injector (25-33% = *monitor*, 33%+ =
  *pump*) contradict the MEASUREMENT GUIDELINES in the system prompt (25%+ = *pumping recommended*,
  `:599`). At 28% solids the model gets both.

### Where the tier boundaries actually come from — a correction

The injected block used to end: *"computed server-side from manufacturer nameplate data and
industry-standard thresholds (**NEC 430, DOE motor efficiency standards**)."* That attribution was
wrong twice over, and it was in the shipped prompt — in the block the model is told is AUTHORITATIVE,
and so in every report the system produced (the product is pre-beta, so no customer received one; that
is timing, not absolution):

1. **NEC 430.32 governs the sizing of motor overload protection.** It does not define a seven-tier
   diagnostic scale, and it certainly does not say "0-30% FLA = no load" or "80-90% = optimal for a
   residential effluent pump." Those boundaries are **the author's own engineering heuristic** —
   defensible as such, and load-bearing precisely because they are deterministic and
   nameplate-derived. Attributing them to a named standard added authority the code had not earned.
2. **The NEC is the US National Electrical Code.** BC electrical work is governed by the Canadian
   Electrical Code (CSA C22.1). Citing the wrong jurisdiction's code, in a document read by a BC
   contractor or an Environmental Health Officer, is exactly the sort of error that costs a document
   its credibility.

This is the same failure the case study condemns elsewhere — **citing a standard you were not
given** — committed by the system's author rather than by the model, in the one block the model is
told is AUTHORITATIVE. It is a good illustration that the deterministic layer is not automatically
trustworthy just because it is deterministic: it is trustworthy only to the extent that what it
asserts is true.

Fixed in `c391dc5`: the block now says the scale is SepticScribe's own nameplate-derived diagnostic
scale, and explicitly instructs the model **not** to attribute it to a published standard or cite a
code clause for it. The guardrail's authority over the model comes from being deterministic and
nameplate-derived — not from a citation, which added risk and no value.
