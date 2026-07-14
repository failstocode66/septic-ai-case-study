# 12 — Anomaly detection across visit history

| | |
|---|---|
| **Origin** | **NEWLY DESIGNED.** The trend engine is real and shipped (`Backend/services/trendAnalysisService.js` — `computeMetricTrends`, rate + acceleration detection, formatted into the report prompt at `:365-422`). The **anomaly prompt does not exist**; today the trend text is narrated, not interrogated. |
| **Serves** | The contractor (catch the bad reading before it becomes a bad recommendation) and, indirectly, any Regional District auditing records it funded. |

---

## 1. Use case

A property with three years of maintenance history is a **time series**, and time series contain two
completely different kinds of surprise. Conflating them is the failure this prompt exists to
prevent.

**Kind 1 — the system changed.** Something real happened between visits:

- Solids jumped 11% → 19% → 27% at a steady rate. Ordinary accumulation.
- Solids went 12% → 14% → **31%**. That is not a rate; that is an *inflection*. Something changed
  in the household — a new tenant, a suite, a switch to non-dissolving toilet paper.
- Dissolved oxygen has fallen a little every visit for two years. Nobody flagged it, because it was
  never dramatic on any single visit. That is a blower dying in slow motion.

**Kind 2 — the *record* changed.** Nothing happened to the system; something happened to the data:

- Total fluid depth was 40" for three visits and is suddenly 52". A tank does not get deeper. Either
  the tank was replaced (a real event nobody recorded), or the technician measured to the wrong
  datum, or a digit was fat-fingered.
- Scum went 6.5" → 0.5" with no pump-out recorded. Either a pump-out happened and was not logged, or
  the reading is wrong.
- Pump amp draw is identical to two decimal places across three visits. Real clamp-meter readings do
  not do that. Someone is copying the last visit forward.

**These require opposite responses.** A Kind-1 anomaly is a finding: tell the homeowner, act on it.
A Kind-2 anomaly is a *data-integrity fault*: do **not** tell the homeowner, do **not** act on it,
go and check the record before it contaminates a trend, a projection, a pump-out schedule, and —
if the visit was rebate-funded — an audit trail for public money.

An LLM handed a table of readings will not make this distinction. It will helpfully narrate the
52-inch tank as a finding, and a *projection built on it* will be silently wrong for years.

> **A bad measurement in a time series does not stay a bad measurement. It becomes a bad rate, then
> a bad projection, then a bad schedule, then a truck that arrives at the wrong house.**

The existing production trend engine will happily compute an accumulation rate across that 52" jump.
It has no concept of an implausible reading.

---

## 2. What already exists (harvested)

`computeMetricTrends()` (`trendAnalysisService.js:217+`) tracks five metrics across up to five
visits — `scum_inches`, `sludge_inches`, `dissolved_oxygen_mgl`, `pre_filter_pressure`,
`post_filter_pressure` — and computes a rate of change **and an acceleration flag** (is the rate
itself increasing). `compareFindings()` produces `newIssues`, `resolvedIssues`, `persistentIssues`.
`formatTrendDataForPrompt()` (`:365-422`) turns all of it into narrative text for the report:

```text
HISTORICAL COMPARISON (vs. maintenance visit on June 2, 2025, 376 days ago):
- Health Score: Previous 82/100, Current 74/100 (declined by 8 points, trend: declining)
- NEW issues this visit: Dissolved oxygen below minimum; Effluent clarity cloudy
- ONGOING issues: Effluent filter soiling moderate

TREND DATA (3 visits):
- Scum: 1.5 -> 2.0 -> 2.5 in (rising)
- Sludge: 9.9 -> 17.0 -> 24.6 in (rising, accelerating)
```

That is genuinely useful and it is already in the prompt. What is missing is the *question*: **is
any of this wrong?**

---

## 3. The prompt

### System

```text
You are auditing the maintenance history of a single onsite wastewater system.

You will receive a chronological series of maintenance visits with their measurements, plus
pre-computed rates and acceleration flags. Your task is to identify ANOMALIES, and to sort each one
into exactly one of two classes. Getting the class right matters more than finding every anomaly.

CLASS A -- SYSTEM ANOMALY. The measurements are plausible; the SYSTEM changed.
  - An abrupt change in a rate (an inflection, not a slope)
  - A slow monotonic drift that no single visit would flag
  - A metric moving against its expected direction
  - A resolved issue that has returned
  Response: this is a FINDING. It belongs in the report and in the conversation with the owner.

CLASS B -- DATA ANOMALY. The measurement itself is not credible.
  - A physically impossible change (tank total fluid depth changing between visits: a tank does not
    get deeper or shallower. If it changed, either the tank was replaced or the measurement is wrong.)
  - A large decrease in solids or scum with NO pump-out recorded (solids do not leave a tank
    by themselves)
  - Values identical to an implausible precision across visits (real clamp-meter and dipstick
    readings vary; a repeated 6.40 A to two decimals across three visits suggests the previous
    visit was copied forward)
  - A value outside the physical range of the instrument or the component
  - A value that contradicts another value from the same visit
  Response: this is a DATA INTEGRITY FAULT. It must NOT be reported to the homeowner as a finding,
  it must NOT be used in a projection, and it must NOT drive a recommendation. It goes to the
  contractor to verify the record.

CRITICAL RULES:
1. When you are unsure which class an anomaly belongs to, classify it as CLASS B and say you are
   unsure. A data fault wrongly reported as a system finding alarms a homeowner and may sell them
   work they do not need. A system finding wrongly held back as a data fault gets checked by a human
   at the next visit. The errors are not symmetric. Prefer the one a human catches.
2. NEVER invent an explanation for an anomaly. If you can see that something is wrong but not why,
   say exactly that. "Total fluid depth changed from 40 to 52 inches between visits; I cannot
   determine why from this data" is a complete and correct answer.
3. A single visit is not a trend. Two points make a line; three make a trend. State how many visits
   support each anomaly you report, in the anomaly itself.
4. Rates and acceleration flags are supplied PRE-COMPUTED. Do not recalculate them.
5. Do not report ordinary accumulation as an anomaly. Solids rising steadily is a septic tank
   working exactly as designed. An anomaly is a departure from the pattern, not the presence of one.
6. The visits are MAINTENANCE visits. Never call them inspections.

Output JSON only.
```

### User

```json
{
  "property_ref": "P-1211",
  "visits": [
    { "date": "2023-06-08", "solids_pct": 12.1, "scum_in": 1.5, "sludge_in": 9.9,
      "total_fluid_depth_in": 40, "do_mgl": 4.2, "pump_amps": 6.40, "pump_out_recorded": false },
    { "date": "2024-06-11", "solids_pct": 14.3, "scum_in": 2.0, "sludge_in": 10.2,
      "total_fluid_depth_in": 40, "do_mgl": 3.6, "pump_amps": 6.40, "pump_out_recorded": false },
    { "date": "2025-06-02", "solids_pct": 30.8, "scum_in": 2.5, "sludge_in": 17.0,
      "total_fluid_depth_in": 40, "do_mgl": 2.9, "pump_amps": 6.40, "pump_out_recorded": false },
    { "date": "2026-06-13", "solids_pct": 56.2, "scum_in": 4.6, "sludge_in": 24.6,
      "total_fluid_depth_in": 52, "do_mgl": 2.1, "pump_amps": 6.40, "pump_out_recorded": false }
  ],
  "precomputed_trends": [
    { "metric": "Sludge",  "values": [9.9, 10.2, 17.0, 24.6], "direction": "rising", "accelerating": true },
    { "metric": "Scum",    "values": [1.5, 2.0, 2.5, 4.6],    "direction": "rising", "accelerating": true },
    { "metric": "DO",      "values": [4.2, 3.6, 2.9, 2.1],    "direction": "falling", "accelerating": false }
  ]
}
```

Four visits, four anomalies, and they are **not all the same kind**. The 52-inch depth is the one
that matters, because it silently corrupts the solids percentage on the most recent visit — and the
solids percentage is what books the truck.

---

## 4. Expected output shape

```json
{
  "anomalies": [
    { "class": "B",
      "confidence": "high",
      "metric": "total_fluid_depth_in",
      "observation": "Total fluid depth was 40 inches on three consecutive visits (2023, 2024, 2025) and 52 inches on 2026-06-13.",
      "why_implausible": "A septic tank's working depth is fixed by its geometry. It does not change between maintenance visits unless the tank was replaced.",
      "explanation_offered": null,
      "impact_if_used": "The solids percentage for 2026-06-13 was computed against a 52-inch depth. If the true depth is 40 inches, the reported 56.2% is wrong. Every projection built on this visit is wrong.",
      "recommended_action": "Verify the recorded total fluid depth for 2026-06-13 with the technician before this visit is used in any pumping recommendation or projection. Confirm whether the tank was replaced.",
      "visits_supporting": 4 },

    { "class": "B",
      "confidence": "high",
      "metric": "pump_amps",
      "observation": "Pump amp draw is recorded as exactly 6.40 A on all four visits.",
      "why_implausible": "Clamp-meter readings on a working pump vary between visits with head, wear, and fluid level. Four identical readings to two decimal places across three years is not a measurement pattern; it is a copy-forward pattern.",
      "explanation_offered": null,
      "impact_if_used": "Pump condition is being reported as stable on the basis of a value that may not have been measured since 2023. A developing pump fault would be invisible.",
      "recommended_action": "Confirm the pump amp draw is being measured at each visit rather than carried forward from the last record.",
      "visits_supporting": 4 },

    { "class": "A",
      "confidence": "high",
      "metric": "solids_pct / sludge_in",
      "observation": "Sludge rose 9.9 -> 10.2 inches over the first year (0.3 in/yr), then 10.2 -> 17.0 -> 24.6 (roughly 7 in/yr). The rate increased by more than an order of magnitude after the 2024 visit.",
      "why_significant": "This is an inflection, not a slope. Something changed in how the property is loading the system after mid-2024 -- occupancy, usage, or what is being flushed. The accumulation itself is normal; the change in its rate is not.",
      "impact_if_used": null,
      "recommended_action": "Discuss with the owner: occupancy change, added suite, change in toilet paper or wipes use since mid-2024. Note that the 2026 solids figure is unreliable pending the depth anomaly above -- resolve that first.",
      "visits_supporting": 4 },

    { "class": "A",
      "confidence": "moderate",
      "metric": "do_mgl",
      "observation": "Dissolved oxygen has declined at every visit: 4.2 -> 3.6 -> 2.9 -> 2.1 mg/L. It is now just above the 2.0 mg/L minimum.",
      "why_significant": "No single visit shows an alarming drop, which is why this has not been flagged before. The trend is monotonic across four visits and will cross the minimum before the next scheduled visit if it continues. This is the signature of a slowly failing blower.",
      "impact_if_used": null,
      "recommended_action": "Assess the air blower (condition, pressure, amp draw against nameplate) at the next visit, or sooner. Do not wait for DO to cross the threshold -- by then treatment has already been impaired for months.",
      "visits_supporting": 4 }
  ],

  "data_integrity_blocking": true,
  "blocking_note": "Two Class B data anomalies are present. The 2026-06-13 solids percentage must not be used for a pumping recommendation or a projection until the total fluid depth is verified."
}
```

The last field is the one that earns the prompt its place. `data_integrity_blocking: true` is a
**machine-readable stop**: downstream, the pump-out triage (prompt 06) and the scheduling
recommendation (prompt 11) should refuse to run on this property until a human clears it.

Without it, the most likely outcome of this dataset is a report that confidently tells a homeowner
their tank is 56% full of solids — on the strength of a number that a tank cannot physically produce.

---

## 5. Techniques used

| Technique | How |
|---|---|
| **Two-class taxonomy as the primary output** | The classification *is* the deliverable. "The system changed" and "the record is wrong" demand opposite responses, and a model that does not have the distinction imposed on it will not invent it — it will narrate everything as a finding, because narrating findings is what it was asked to do everywhere else. |
| **Physical-plausibility rules stated explicitly** | *"A tank does not get deeper."* *"Solids do not leave a tank by themselves."* These are domain axioms a model does not reliably hold. They are cheap to state and they are the entire basis of Class B. |
| **Asymmetric-error instruction (rule 1)** | When unsure → Class B. And the *reason* is given: a data fault reported as a finding sells unnecessary work; a finding held back gets caught by a human next visit. **Telling the model which way to fail is one of the highest-leverage sentences you can put in a prompt**, and it is almost always omitted. |
| **Explicit no-confabulation rule (rule 2)** | *"NEVER invent an explanation for an anomaly."* With a worked example of an acceptable non-explanation. A model that spots a 52-inch tank will *want* to explain it — "possibly indicating settling or a change in measurement reference" — and every one of those explanations is fabricated. The prompt makes `explanation_offered: null` a legitimate, expected output. |
| **Evidence count on every claim (rule 3)** | `visits_supporting` forces the model to expose the thinness of its own basis. |
| **Anti-noise constraint (rule 5)** | Ordinary accumulation is not an anomaly. Without this, an anomaly detector reports everything and is ignored — the classic failure of every alerting system ever built. |
| **Impact propagation** | `impact_if_used` makes the model state what *downstream* decision the bad data would corrupt. This is what converts a data-quality note into something anyone will act on. |
| **Machine-readable blocking signal** | `data_integrity_blocking` gates the downstream prompts. Anomaly detection that only produces prose is a report nobody reads. |
| **Deterministic trends, passed through** | Rates and acceleration flags come from `computeMetricTrends()`. The model classifies; it does not compute. |

---

## 6. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| **Data fault narrated as a system finding** | Homeowner told their tank is 56% full on the strength of an impossible depth reading. Sold a pump-out. In a rebate-funded market, that is public money on a typo. | Two-class taxonomy + explicit physical-plausibility rules + bias-to-Class-B on uncertainty | Moderate. This is the core risk and the whole prompt is aimed at it. It should be backed by **deterministic invariant checks** (see below) — a model should not be the only thing standing between a fat-fingered digit and a customer. |
| **Confabulated explanation for an anomaly** | "The increase in fluid depth may reflect seasonal groundwater infiltration" — plausible, authoritative, invented, and it *closes the investigation*. | Rule 2 + `explanation_offered: null` as a first-class output | Low-moderate. This is the most seductive failure in the file: the confabulated explanation is *more useful-sounding* than the honest one. |
| **Alert fatigue** — everything flagged | The detector is switched off, and then it is decorative | Rule 5 | Moderate; needs tuning against real history, which requires an eval set that does not exist. |
| **Real slow drift missed** (the DO decline) | A blower dies over two years and nobody notices, because no single visit was alarming | Pre-computed monotonic trend + explicit "slow monotonic drift" in the Class A definition | Low — this is what the trend engine is *for*, and it is the case it handles best. |
| **The trend engine computes a rate across corrupt data** | Every projection downstream is wrong, silently, forever | `data_integrity_blocking` | **This is the real gap.** The production `computeMetricTrends()` has **no plausibility check at all** — it will compute a slope across a 40"→52" depth change without complaint. The blocking flag is only useful if the downstream code honours it, and today there is no downstream code. |

## The deterministic checks that should exist and do not

Everything in Class B is a **hard invariant**, and hard invariants do not need a language model:

```js
// These are assertions, not judgements. Run them before any trend, projection, or recommendation.
const INVARIANTS = [
  { id: 'DEPTH_STABLE',
    check: v => sameTankDepthAcrossVisits(v),
    msg: 'total_fluid_depth changed between visits — a tank does not change depth' },
  { id: 'SOLIDS_MONOTONIC_ABSENT_PUMP',
    check: v => !solidsDecreased(v) || pumpOutRecorded(v),
    msg: 'solids decreased with no pump-out recorded' },
  { id: 'NO_COPY_FORWARD',
    check: v => !identicalToFullPrecision(v, 'pump_amps', 3),
    msg: 'identical measurement across 3+ visits — possible copy-forward' },
];
```

Three checks, no API call, no latency, no nondeterminism, and they catch the two Class B anomalies
in the example above with certainty rather than probability. **The model should be reserved for the
Class A judgements, which genuinely need judgement.**

This is the same lesson as prompt 05 §4: *do not spend a model on a problem a regex or an assertion
already solves.* The anomaly prompt is valuable — but if it is the only thing catching a 52-inch
tank, the architecture is wrong.

---

## 7. Provenance and verification

- `computeMetricTrends()` — `Backend/services/trendAnalysisService.js:217+`. Tracked metrics
  (`:221-227`): `scum_inches`, `sludge_inches`, `dissolved_oxygen_mgl`, `pre_filter_pressure`,
  `post_filter_pressure`. Rate and acceleration computed across up to five visits.
- `computeTrendsFromEvents()` — `:115-169`; returns `null` on fewer than two events (`:116-118`).
  `compareFindings()` produces new / resolved / persistent issues.
- `formatTrendDataForPrompt()` — `:365-422`; injected into the report prompt as `trendText`
  (`jobs/pdfJob.js:128,192`).
- **Confirmed absent:** there is no plausibility check, no invariant assertion, no anomaly
  classification, and no data-integrity gate anywhere in the trend path. A depth change of 40" → 52"
  would flow through `computeMetricTrends`, into the solids percentage, into
  `analyzeHistoricalTrend`'s projection, into the report, unchallenged.
- **Not in production:** this prompt, and the invariants above. Both are proposals. The invariants
  are the cheaper and more important of the two.
