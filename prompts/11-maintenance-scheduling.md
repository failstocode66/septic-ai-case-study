# 11 — Service-interval recommendation

| | |
|---|---|
| **Origin** | **NEWLY DESIGNED.** Production has the *inputs* — the `maintenance_interval_appropriate` field, the accumulation projections in `solidsAnalysisService`, and one interval instruction in the report prompt (`Backend/aiReportService.js:602`). There is **no scheduling prompt and no scheduling feature.** |
| **Serves** | The contractor (route planning, recurring revenue) and the homeowner (not paying for visits they do not need, not missing the one they do). |

---

## 1. Use case

Every serviced system is on an interval: annually, twice a year, quarterly. The interval is usually
inherited — set at install, or by the operating permit, or by whoever booked the first job — and
then **never revisited**, because nobody has time to revisit it and there is no obvious moment at
which to do so.

That is wasteful in both directions:

- A stable, lightly-used system on a **6-month** interval is being visited twice as often as it
  needs. The homeowner pays for a visit that finds nothing. Over a fleet of properties that is real
  money and a real routing cost.
- A system with an accelerating solids trend, or a filter fouling faster every visit, on a
  **12-month** interval will be found in failure at the next visit rather than in decline. And on a
  Type 2/3 system with an operating permit, an interval that has drifted past the permit's
  requirement is a genuine problem.

The interesting thing about this task is that **the data to answer it is already sitting in the
database and nobody is asking it a question.** Every visit records solids, scum, filter soiling, and
a technician's own judgement in the `maintenance_interval_appropriate` field. Two or three visits of
history is an accumulation rate. An accumulation rate is a projection. A projection is a schedule.

The production system computes the projection (`solidsAnalysisService.js:287-299` —
`daysToSolidsRecommended`, `daysToSolidsCritical`) and then... puts it in a sentence in a PDF.

---

## 2. The trap, and why this prompt is mostly a refusal

A language model handed a single visit's measurements and asked "when should we come back?" will
answer. It will always answer. It will produce something like *"Based on the current accumulation
rate, we recommend service in approximately 14 months"* — and it will sound authoritative, and it
will be **entirely fabricated**, because:

> **From one measurement there is no rate.** One point is not a line. You cannot compute a slope
> from a single sample, and no amount of professional-sounding prose changes that.

This is the same class of error as prompt 04's "NEVER present a single-visit observation as a
trend", but it is worse here, because the output *is* a number and the number *is* the deliverable.
A hedged narrative that overreaches is a flaw. A schedule that overreaches is just wrong.

So the design principle for this prompt is inverted from most:

> **The default output is a refusal. A recommendation is the exception, and it must be earned by
> evidence.**

`analyzeHistoricalTrend()` already refuses correctly — it returns `null` on fewer than two data
points (`solidsAnalysisService.js:252-254`). And it does something even better: it **detects an
intervening pump-out** (`:267`, `solidsDiff < -5 || scumDiff < -1`) and falls back to a default
accumulation rate, because you cannot measure accumulation across a tank that was emptied halfway
through the interval. That is a domain judgement most implementations would miss, and it is already
in the code.

The prompt's job is to not throw that away.

---

## 3. The prompt

### System

```text
You are recommending a maintenance service interval for an onsite wastewater system in British
Columbia, on behalf of the ROWP Maintenance Provider who services it.

EVIDENCE RULES -- read these before anything else:

1. A recommendation requires a RATE. A rate requires at least TWO measured visits.
   If visit_history contains fewer than two visits with tank measurements, you MUST NOT recommend
   an interval change. Output "insufficient_history" and state what is needed. Do not estimate.
   Do not extrapolate. Do not use a typical or industry-average rate as a stand-in.
   One measurement is a point, not a rate.

2. If a pump-out occurred between two visits, the accumulation rate across that gap is UNKNOWN --
   the tank was emptied mid-interval. The analysis engine flags this as pump_detected and
   substitutes a conservative default rate. When pump_detected is true, you MUST say the projection
   is based on a default accumulation rate, not on this property's measured history, and you MUST
   NOT lengthen the interval on the strength of it. Conservative default -> conservative advice.

3. Projections are supplied to you PRE-COMPUTED (days_to_solids_recommended,
   days_to_solids_critical). Use them exactly. Never recalculate, never round to a "nicer" number,
   never adjust them for plausibility.

4. If the system has an operating permit with a required maintenance interval, you MUST NOT
   recommend an interval longer than it, regardless of what the accumulation data says. A permit
   interval is a floor on frequency, not a suggestion. If the data supports a longer gap, say so --
   and then recommend the permit interval anyway, and explain why.

5. The technician's own judgement is recorded in maintenance_interval_appropriate. If the technician
   said the interval should change, that is FIELD EVIDENCE from the person who was standing there.
   Weight it. If your recommendation contradicts it, you must say so explicitly and give your
   reason -- do not silently overrule the human who did the work.

RECOMMENDATION RULES:
6. Recommend a LENGTHENED interval only if ALL of: two or more measured visits; no pump-out between
   them; solids accumulation slower than the current interval requires; no critical findings on the
   most recent visit; no operating-permit constraint; and the technician did not say
   "increase frequency".
   Any one of those failing -> keep the current interval.
7. Recommend a SHORTENED interval if ANY of: projected to cross the pumping threshold before the
   next scheduled visit; accumulation is accelerating; filter soiling is Heavy; a critical finding
   is open; the technician said "increase frequency".
8. Bias toward the status quo. Changing a customer's service interval on thin evidence is worse
   than leaving it alone. When in doubt, keep it and say what you would need to see.

9. The work is MAINTENANCE. Never call it an inspection.

Output JSON only.
```

### User — case A: enough history

```json
{
  "property_ref": "P-1103",
  "current_interval_months": 12,
  "operating_permit_interval_months": null,
  "system_type": "Type_1_Gravity",
  "visit_history": [
    { "date": "2024-05-20", "solids_percentage": 11.4, "scum_inches": 1.5, "filter_soiling": "Light" },
    { "date": "2025-06-02", "solids_percentage": 19.0, "scum_inches": 2.0, "filter_soiling": "Moderate" },
    { "date": "2026-06-13", "solids_percentage": 27.1, "scum_inches": 2.5, "filter_soiling": "Moderate" }
  ],
  "precomputed": {
    "solids_rate_percent_per_day": 0.0219,
    "pump_detected": false,
    "days_to_solids_recommended": 0,
    "days_to_solids_critical": 214,
    "based_on_visits": 3,
    "pump_urgency": "soon",
    "acceleration_detected": false
  },
  "maintenance_interval_appropriate": "Yes",
  "critical_findings": []
}
```

### User — case B: the trap

```json
{
  "property_ref": "P-1042",
  "current_interval_months": 12,
  "operating_permit_interval_months": 12,
  "system_type": "Type_2_Advanced",
  "visit_history": [
    { "date": "2026-06-13", "solids_percentage": 34.5, "scum_inches": 3.0, "filter_soiling": "Moderate" }
  ],
  "precomputed": {
    "solids_rate_percent_per_day": null,
    "pump_detected": false,
    "days_to_solids_recommended": null,
    "days_to_solids_critical": null,
    "based_on_visits": 1,
    "pump_urgency": "immediate",
    "acceleration_detected": null
  },
  "maintenance_interval_appropriate": null,
  "critical_findings": []
}
```

Case B is the whole test. One visit. Solids at 34.5% — high, alarming, *and utterly uninformative
about rate*. The tank could have been pumped last month or never. A model that produces a schedule
here has failed, no matter how sensible the schedule sounds.

---

## 4. Expected output shape

**Case A — a recommendation, earned:**

```json
{
  "outcome": "recommendation",
  "recommended_interval_months": 12,
  "change_from_current": "none",
  "confidence": "moderate",
  "reasoning": "Solids have risen from 11.4% to 19.0% to 27.1% across three measured visits, a steady rate of roughly 8 percentage points per year with no acceleration and no pump-out in between. At that rate the tank is projected to reach the critical threshold in 214 days -- before the next annual visit. The interval itself is appropriate; the tank simply needs pumping now. Shortening the interval would not address that.",
  "actions": [
    "Schedule a pump-out (already flagged: pump urgency 'soon').",
    "Keep the 12-month maintenance interval.",
    "Re-measure solids at the next visit to confirm the accumulation rate resets after pumping."
  ],
  "technician_judgement": "Technician recorded the interval as appropriate. This recommendation agrees.",
  "based_on": { "measured_visits": 3, "pump_detected_in_history": false }
}
```

Note what it did **not** do: it did not shorten the interval because the number was scary. The
projection says the tank crosses the threshold before the next visit — so **pump the tank**, and
leave the schedule alone. Conflating "this tank needs pumping" with "this property needs more
visits" is the most common way a scheduling system gets more expensive without getting better.

**Case B — a refusal, which is the correct answer:**

```json
{
  "outcome": "insufficient_history",
  "recommended_interval_months": 12,
  "change_from_current": "none",
  "confidence": "none",
  "reasoning": "This is the first recorded maintenance visit for this property. A service interval recommendation requires an accumulation rate, and an accumulation rate requires at least two measured visits. A single solids reading of 34.5% tells us the tank needs pumping now; it tells us nothing about how fast it got there. It cannot be used to project a future interval.",
  "actions": [
    "Schedule a pump-out (pump urgency: immediate -- 34.5% exceeds the critical threshold).",
    "Keep the current 12-month interval. It is also the operating permit interval and may not be lengthened.",
    "Measure solids, scum and total fluid depth again at the next visit. Two measured visits will establish an accumulation rate and a defensible interval."
  ],
  "what_would_change_this": "One more visit with tank measurements, with no pump-out in between -- or, if the tank is pumped now, two visits after the pump-out.",
  "based_on": { "measured_visits": 1, "pump_detected_in_history": false }
}
```

The refusal is **not empty**. It still books the pump-out, it still holds the permit interval, and
it names precisely what would unlock a real recommendation. A refusal that leaves the contractor
with nothing to do is a bad refusal; this one leaves them with a work order and a plan.

---

## 5. Techniques used

| Technique | How |
|---|---|
| **Refusal as the default branch** | The prompt is organised so that "insufficient history" is the *expected* output, and a recommendation is the exception that has to satisfy six conjunctive conditions (rule 6). Most prompts make the answer the default and the refusal the exception, which is backwards whenever the answer requires evidence the caller may not have. |
| **Stating the epistemics, not just the rule** | *"One measurement is a point, not a rate."* The model given the *reason* declines correctly in situations the rule did not enumerate. A bare "don't recommend with one visit" would leave it free to reason its way around the edge cases. |
| **Deterministic projections, passed through** | `days_to_solids_critical` is computed in JS (`solidsAnalysisService.js:287-299`). Rule 3 forbids recomputation *and* "rounding to a nicer number" — a real and specific model behaviour: 214 days quietly becomes "about 7 months" becomes "about 6 months" becomes wrong. |
| **Hard constraint that overrides the data (rule 4)** | The permit interval is a floor on frequency. The model may *observe* that the data would support a longer gap and must still recommend the permit interval. This is the shape of every real regulatory constraint: **the data does not get a vote.** |
| **Human field judgement as weighted evidence (rule 5)** | `maintenance_interval_appropriate` is the technician's own call, made while standing at the tank. The model may disagree — and must **say so out loud**. Silently overruling the human who did the work is how automation erodes the expertise it depends on, and it is how a technician stops reading the output. |
| **Status-quo bias, stated (rule 8)** | Asymmetric cost: a wrong change is worse than a missed improvement. The prompt says so, so the model does not have to infer it. |
| **Actionable refusal** | `what_would_change_this` — a named schema field. |
| **Separating two decisions the model wants to merge** | "This tank needs pumping" ≠ "this property needs more visits". Case A shows the model keeping them apart. |

---

## 6. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| **Interval fabricated from one visit** | A schedule presented as data-driven that is a guess. Either the homeowner pays for visits they do not need, or a system degrades unwatched between them. | Rule 1 + `insufficient_history` outcome + `based_on.measured_visits` in the output so the evidence base is *visible on the artifact* | Low. And the `based_on` field means a reviewer can see the thinness of the evidence without reading the reasoning. |
| **Rate computed across a pump-out** | A tank emptied mid-interval shows *negative* accumulation. Naively, "solids are decreasing — extend the interval." Exactly backwards. | Deterministic `pump_detected` (`:267`) + conservative default rate + rule 2 forbidding lengthening on it | Low — the detection is already in production code and it is good. |
| **Lengthening past an operating-permit interval** | A regulatory breach, recommended by software, in the provider's name | Rule 4 | Low, and it is deterministically checkable: `recommended <= permit_interval` is an assertion, not a hope. Enforce it in code. |
| **Silently overruling the technician** | The human stops reading the output; the loop is now open | Rule 5 requires explicit disagreement | Moderate — "must say so" is unenforced. A deterministic check (if recommendation contradicts `maintenance_interval_appropriate`, the `technician_judgement` field must be non-empty) is trivial. |
| **Projection rounded to a friendlier number** | 214 days → "about 6 months" → the tank overflows the threshold before the visit | Rule 3, explicitly including "never round to a nicer number" | Low-moderate; check numerically against the input. |
| **Shortening the interval because a number looked alarming** | Revenue-positive, evidence-negative. This is the failure that quietly makes a scheduling feature indefensible. | Rule 7 enumerates the shortening triggers exhaustively; rule 8's status-quo bias | Moderate — and it deserves an audit: any interval change should be reviewable against which rule-7 trigger fired. If none did, the change is unjustified. |

---

## 7. Provenance and verification

- Accumulation rates and projections — `Backend/services/solidsAnalysisService.js:218-300`.
  Insufficient-history refusal at `:252-254` (fewer than two data points → `null`). Pump-out
  detection at `:267`. Fallback rates at `:26-30` (~4%/yr solids, ~0.5"/yr scum). Projections at
  `:287-299`.
- `maintenance_interval_appropriate` is a real assessment field. Its only production use is one
  line in the report prompt (`Backend/aiReportService.js:602`): *"'No - Increase Frequency' =
  recommend shortening maintenance interval with reasoning based on observed filter soiling;
  'No - Decrease Frequency' = note cost savings opportunity by extending interval."* — i.e. it
  currently produces a *sentence in a PDF*, not a schedule.
- **Not in production:** there is no scheduling engine, no interval recommendation, no fleet view.
  The projections are computed and then rendered into narrative and discarded. This prompt is a
  design; the deterministic half of it already exists and is already good, which is what makes it
  the cheapest high-value thing on this list to actually build.
- Operating-permit intervals (6-12 months for Type 2/3, reports filed with the Health Authority)
  come from the system's own unsourced knowledge corpus — **re-verify against the BC Sewerage System
  Regulation before publishing any specific interval figure.** See prompt 09 §6.
