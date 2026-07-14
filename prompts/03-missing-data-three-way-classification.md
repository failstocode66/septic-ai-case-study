# 03 — Missing-data handling: typed absence, and "never assume zero"

| | |
|---|---|
| **Origin** | **HARVESTED** — system-prompt block at `Backend/aiReportService.js:650-666`; the data structure behind it at `:474-506` (`formatNullFieldsForPrompt`) and `Backend/reportDataPreprocessor.js:109-131` (`classifyNullField`) |
| **Serves** | The contractor (whose signature is on the record) and the homeowner (who is told what was and was not actually looked at) |
| **Position** | Rules in the system prompt; the typed field list injected into the **user** prompt before the data (`:782-785`) |

---

## 1. Use case

A maintenance visit almost never fills every field. Some fields were **not measured** — the
technician did not have a DO meter that day, or the riser was frozen shut. Some are **not
applicable** — the system has no LPP laterals, so there is no distal head to record. Some are
simply **empty**.

To a naive prompt these three are the same thing: a `null`. And a language model asked to produce
a complete, professional report from a payload full of nulls will do one of two things, both bad:

1. **Fill the hole.** `dissolved_oxygen: null` becomes *"Dissolved oxygen was within normal
   parameters."* This is the report asserting an observation that never happened, in a document
   signed under a professional registration and possibly filed with a Health Authority.
2. **Read the hole as a zero.** `dissolved_oxygen: null` becomes *"Dissolved oxygen: 0 mg/L —
   critical, anaerobic conditions, treatment failure."* This turns an *unmeasured* system into a
   *documented-failing* one. The homeowner gets an alarming, invented finding.

Inverted, the same bug is quieter and worse: an unmeasured field silently implies a pass.

**The absence of a measurement is itself information, and it has a type.** This prompt is the one
that types it.

---

## 2. The prompt

### 2a. The rules (verbatim, `aiReportService.js:650-666`)

```text
MISSING DATA HANDLING (CRITICAL — follow these rules precisely):

1. NEVER ASSUME ZERO: A missing measurement is NOT zero. If dissolved_oxygen_mgl, scum_inches,
   sludge_inches, pump_current_draw, or any other measurement field is absent, it was not
   measured — do not treat it as zero or normal.

2. THREE CATEGORIES: The "FIELDS NOT MEASURED OR NOT APPLICABLE" section in the inspection data
   classifies each missing field:
   - NOT MEASURED: Field could have been measured but was not. Report as "Not measured during this
     visit" and note if the missing data prevents a complete assessment (e.g., "Solids percentage
     could not be calculated — total_fluid_depth was not measured").
   - NOT APPLICABLE: Field does not apply to this system type. Omit entirely — do not mention these
     fields or their absence.
   - NO DATA: Field had no value. Omit or note absence only if the field would be expected for this
     system type.

3. PARTIAL MEASUREMENTS: When some but not all related measurements are present (e.g., scum
   measured but not sludge), report the available data and explicitly state what is missing. Use the
   PRE-COMPUTED MEASUREMENT CLASSIFICATIONS section which handles partial data annotations.

4. UNKNOWN MANUFACTURERS: If a component's manufacturer is listed as "Unknown" in the INSTALLED
   EQUIPMENT SPECIFICATIONS section, NEVER fabricate or guess a manufacturer name. Report the
   component by its type and any available model/spec data only.

5. SECTION OMISSION: If an entire report section would contain only "not measured" entries with no
   actionable findings, omit the section rather than generating placeholder content. Exception: if
   the missing data itself is noteworthy (e.g., dissolved oxygen not measured on an ATU system),
   mention it in Recommendations as "Recommend measuring [field] at next service visit."

6. TRUNCATION: If truncationWarning is present in the data, some field values may be incomplete —
   interpret conservatively and note the limitation.
```

*(Rule 2's own text says "inspection data". That is the defect prompt 05 is about, visible here in
the wild.)*

### 2b. The injected typed-absence block (verbatim format, `aiReportService.js:493-505`)

This is what makes rule 2 more than an exhortation. Every missing field is classified by
**deterministic code** and handed to the model already sorted:

```text
FIELDS NOT MEASURED OR NOT APPLICABLE:
NOT MEASURED (could have been measured but was not — do NOT assume zero, report as "Not measured during this visit"):
  aerobic_treatment_unit_0_dissolved_oxygen_mgl, septic_tank_0_total_fluid_depth
NOT APPLICABLE (components not present in this system — omit from report entirely):
  lpp_system_0_initial_distal_head_lateral_1, lpp_system_0_squirt_height_measured, drip_dispersal_0_zone_1_dosing_time
NO DATA (empty values — do not reference unless relevant):
  septic_tank_0_riser_notes
```

### 2c. How the classification is decided (verbatim, `reportDataPreprocessor.js:109-131`)

Not by asking the model. By reading the component list:

```js
function classifyNullField(key, findings, components) {
  const componentTypes = (components || []).map(c => (c.type || '').toLowerCase());
  const hasLpp  = componentTypes.some(t => t.includes('lpp'));
  const hasDrip = componentTypes.some(t => t.includes('drip'));
  const hasAtu  = componentTypes.some(t => t.includes('aerobic') || t.includes('atu'));

  // A measurement for a system type that isn't installed is NOT_APPLICABLE,
  // regardless of whether it is a measurement field.
  if (!hasLpp  && SYSTEM_TYPE_FIELDS.lpp.test(lowerKey))  return 'not_applicable';
  if (!hasDrip && SYSTEM_TYPE_FIELDS.drip.test(lowerKey)) return 'not_applicable';
  if (!hasAtu  && SYSTEM_TYPE_FIELDS.atu.test(lowerKey))  return 'not_applicable';

  if (MEASUREMENT_FIELDS.has(lowerKey)) return 'not_measured';
  for (const mf of MEASUREMENT_FIELDS) {
    if (lowerKey.endsWith(mf)) return 'not_measured';   // handles prefixed keys
  }
  return 'not_present';
}
```

The ordering is deliberate and correct: **applicability is checked before measurability.** A DO
reading on a system with no aerobic unit is not a missed measurement — it is a meaningless one, and
mentioning its absence in the report would be noise that makes the technician look sloppy.

---

## 3. Techniques used

| Technique | How it is applied |
|---|---|
| **Typed absence (the core idea)** | `null` is not one thing. Three types, each with a *different prescribed behaviour*: NOT MEASURED → say so; NOT APPLICABLE → say nothing; NO DATA → judgement call. The model is never asked to infer which kind of nothing it is looking at. |
| **Deterministic grounding of a semantic judgement** | "Is this field applicable to this system?" *looks* like a job for a language model. It is a set-membership test against the installed component list. It is done in JS, in 20 lines, with no possibility of error. |
| **Negative constraint, stated first and in caps** | "1. NEVER ASSUME ZERO." Rule ordering is not accidental — the most consequential prohibition is rule 1. |
| **Refusal design** | Rule 4 (never guess a manufacturer) and rule 3 (say what is missing) both instruct the model to *decline to conclude*. Refusal is a first-class output, not an error state. |
| **Prescribed phrasing** | The prompt supplies the exact sentence to use — *"Not measured during this visit"*, *"Solids percentage could not be calculated — total_fluid_depth was not measured"*. Giving the model the words for an awkward admission dramatically raises the odds it makes the admission instead of smoothing past it. |
| **Anti-noise constraint** | Rule 5: do not generate a section that is nothing but "not measured" rows. Honesty about gaps must not become a wall of gaps. |
| **Escalation of an absence into an action** | Rule 5's exception: a *noteworthy* absence (no DO reading on an ATU) becomes a **recommendation** — "Recommend measuring dissolved oxygen at next service visit." The gap in the record becomes a work item. This is the nicest move in the block. |

---

## 4. Expected output shape

Inline in the Markdown report, not a separate section:

```markdown
## SERVICE FINDINGS

| Component | Condition | Notes |
|-----------|-----------|-------|
| Treatment Unit | Fair | Effluent cloudy. Dissolved oxygen not measured during this visit. |

## TANK MEASUREMENTS

| Measurement | Value |
|-------------|-------|
| Scum Thickness | 3.0 inches |
| Sludge Depth | 7.5 inches |
| Total Fluid Depth | Not measured during this visit |

Solids percentage could not be calculated -- total fluid depth was not measured. Pumping need
cannot be assessed from this visit's data.

## RECOMMENDATIONS

3. Measure total fluid depth and dissolved oxygen at the next service visit. Without these,
   treatment performance and pumping need cannot be assessed.
```

And, correctly, **no mention anywhere** of LPP laterals or drip zones — the property has neither,
so those nulls were typed NOT APPLICABLE and never reach the narrative.

---

## 5. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| Missing → invented normal value | The record asserts an observation that did not occur. Filed with a Health Authority; relied on by a homeowner. | Rule 1 + typed NOT MEASURED list + prescribed phrasing | Log-only detection; nothing blocks a report that did it anyway. |
| Missing → treated as `0` | An unmeasured DO becomes "0 mg/L — treatment failure". Alarming, invented, and it will cost the homeowner money. | Rule 1, stated as the first and loudest rule; partial-data annotations from prompt 02 | Low. |
| Missing → implied pass | The quiet inverse. Silence reads as "fine". | Rule 5's exception (turn the gap into a recommendation) | Moderate — depends on the model actually escalating it. |
| Report clutters with irrelevant absences ("LPP lateral heads: not measured" on a gravity system) | Report looks incompetent; buries real findings | NOT APPLICABLE classification, computed from the component list | Low — this is fully deterministic. |
| Guessed manufacturer to fill an "Unknown" | Wrong parts, wrong maintenance guidance, permanently wrong record | Rule 4; plus a post-hoc brand allowlist check (prompt 15) | Detection only, and the allowlist is finite. |
| **The typed-absence list itself is empty because the classifier is broken** | The model sees no missing-data section at all and falls back to its own instincts | — | **Real. The sibling classifiers had exactly this bug (see prompt 02 §5).** Same liveness-check recommendation applies. |

---

## 6. Provenance and verification

- Rules block — `Backend/aiReportService.js:650-666`, inside the system prompt.
- `formatNullFieldsForPrompt` — `:474-506`. Note the deliberate cap at `:498`: the NO DATA bucket
  is only emitted if it has ≤20 entries, because a long list of empty fields is noise, not signal.
- `classifyNullField` — `Backend/reportDataPreprocessor.js:109-131`; the system-type regexes it
  depends on at `:96-100`.
- Injected into the user prompt at `:782-785`, ahead of the diagnostics and the payload.

**Assessment:** this is the strongest *purely prompt-level* control in the production system, and
the one with the least distance between the instruction and a real-world harm. It is also, unlike
the terminology rule (prompt 05), actually implemented — the taxonomy is computed, not hoped for.
