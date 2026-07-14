# 06 — Pump-out triage across a day's work

| | |
|---|---|
| **Origin** | **NEWLY DESIGNED.** The thresholds, statuses, and accumulation projections are harvested from real deterministic code (`Backend/services/solidsAnalysisService.js`); the *prompt* that consumes them does not exist in production — today those values are formatted into narrative text and folded into the report prompt. |
| **Serves** | The contractor — specifically the person doing dispatch, who has to decide who gets a truck and in what order. |
| **Model target** | `claude-haiku-4-5`, `temperature: 0`, structured JSON output. |

---

## 1. Use case

A contractor services six to ten properties in a day. Some of those tanks need pumping. Pumping is
a separate, expensive job requiring a vacuum truck, and it is scheduled *later* — so at the end of
the day someone has to turn a pile of tank measurements into a **call list**: who gets pumped this
week, who gets pumped this season, who gets a phone call about what they are flushing, and who is
fine.

Getting this wrong is expensive in both directions:

- **Over-recommend** and you have sold a homeowner a $500 pump-out they did not need. In a region
  where a public rebate program is paying 75% of the bill, that is public money spent on
  unnecessary work — and the fastest way for a contractor to lose a rebate-program referral.
- **Under-recommend** and solids carry over the outlet baffle into the drainfield. A drainfield is
  a five-figure replacement. The tank is cheap; the field is not.

The domain subtlety — and the reason this cannot be a `if (solids > 25) pump` — is that
**solids percentage and scum thickness are different failure modes with different remedies:**

| Situation | What it means | Right action |
|---|---|---|
| High solids %, normal scum | Ordinary accumulation over time | Pump |
| **Low solids %, thick scum crust** | The tank was pumped recently and the crust came *back*. Pumping again will not fix it. | **Do not pump.** Talk to the homeowner about wipes, grease, and toilet paper. |
| Very low solids AND low scum | Recently pumped | Do nothing |
| High solids % and thick crust | Overloaded system | Pump *and* change household practices |

A model asked to "recommend pumping" from a table of numbers will collapse this to "big number →
pump." The second row is the one it will get wrong, and it is the one where the homeowner is
charged for a truck that solves nothing.

---

## 2. The deterministic layer (already exists — harvested)

All of this is computed in JS before the model is invoked. From
`Backend/services/solidsAnalysisService.js`:

```js
const SOLIDS_THRESHOLDS = { LOW: 10, MODERATE: 25, HIGH: 33 };   // :13-17
const SCUM_THRESHOLDS   = { NORMAL: 2, MONITOR: 4, WARNING: 5, CRITICAL: 6 };  // :19-24
const FALLBACK_RATES    = { solidsPercentPerDay: 4/365, scumInchesPerDay: 0.5/365 };  // :26-30
```

`analyzeCurrentMeasurements()` (`:109-205`) emits a `pumpUrgency` of `immediate` / `soon` /
`monitor` / `none`, plus the two flags that encode the domain subtlety above:

- `likelyRecentPump` (`:169-174`) — low solids **and** low scum → urgency forced to `none`.
- `postPumpCrustIssue` (`:177-187`) — low solids **but** critical scum → urgency downgraded to
  `monitor`, `householdPracticeChanges = true`, and the "pump immediately" reason is **rewritten**
  to *"likely post-pump crust issue"*.

`analyzeHistoricalTrend()` (`:218-300`) computes accumulation rate from the two most recent visits,
**detects an intervening pump-out** (`solidsDiff < -5 || scumDiff < -1`, `:267`) and falls back to
a default rate when it finds one — because you cannot measure an accumulation rate across a tank
that was emptied in the middle of it — and projects `daysToSolidsRecommended` /
`daysToSolidsCritical`.

**Every one of those decisions is a domain judgement that a language model would get wrong, and
every one of them is already made before the model sees anything.** The model's job below is
narrower than it looks.

---

## 3. The prompt

### System

```text
You are a septic maintenance dispatcher for a ROWP Maintenance Provider in British Columbia.

You are given a set of tanks serviced this week. For each tank, a deterministic analysis engine has
ALREADY computed the solids percentage, the scum status, the pump urgency, and (where visit history
exists) the projected days until the pumping threshold is reached.

YOUR JOB IS NOT TO DECIDE WHETHER A TANK NEEDS PUMPING. That decision is already made and is
authoritative. Your job is to:
  (a) order the work into a defensible call list,
  (b) write one sentence per property that the office can read to the homeowner over the phone,
  (c) flag the properties where the right action is a CONVERSATION, not a truck.

RULES:
1. NEVER change a pump_urgency value. Do not recompute a solids percentage. Do not reinterpret a
   scum status. These are pre-computed from field measurements and are authoritative.
2. If post_pump_crust_issue is true, the tank must NOT be scheduled for pumping, even if the scum
   is thick. The crust returned after a recent pump-out; another pump-out will not fix it. The
   action is household practice change. Say so plainly.
3. If likely_recent_pump is true, take no action. Do not "monitor closely" -- the system is healthy.
4. If a projection is absent (no visit history), you MUST NOT estimate one. Write
   "no accumulation rate available -- first recorded visit for this tank" and recommend
   re-measuring at the next service. Do not guess a timeline from a single reading.
   A single measurement is a point, not a rate.
5. Order the call list by: immediate > soon > monitor > none. Within a tier, order by highest
   solids percentage.
6. The work is MAINTENANCE. Never describe it as an inspection.
7. Every homeowner_message must be plain English, under 30 words, and must state a REASON, not just
   an instruction. "Your tank is 34% full of solids, which is above the pumping threshold" is
   useful. "Pumping is recommended" is not.

Output ONLY valid JSON matching the schema. No preamble, no markdown fences.
```

### User

```json
{
  "week_of": "2026-06-15",
  "tanks": [
    { "property_ref": "P-1042",
      "municipality": "Comox",
      "solids_percentage": 34.5, "scum_inches": 3.0, "sludge_inches": 10.8,
      "total_fluid_depth": 40,
      "solids_status": "critical", "scum_status": "monitor",
      "pump_urgency": "immediate",
      "household_practice_changes": false,
      "likely_recent_pump": false, "post_pump_crust_issue": false,
      "reasons": ["Solids at 34.5% -- exceeds critical threshold (33%). Pump immediately"],
      "projection": { "days_to_solids_recommended": 0, "days_to_solids_critical": 0,
                      "based_on_visits": 3 } },

    { "property_ref": "P-1077",
      "municipality": "Royston",
      "solids_percentage": 7.2, "scum_inches": 6.5, "sludge_inches": 1.4,
      "total_fluid_depth": 44,
      "solids_status": "low", "scum_status": "critical",
      "pump_urgency": "monitor",
      "household_practice_changes": true,
      "likely_recent_pump": false, "post_pump_crust_issue": true,
      "reasons": ["Scum/crust at 6.5\" despite low solids (7.2%) -- likely post-pump crust issue. Monitor + household practice changes recommended"],
      "projection": null },

    { "property_ref": "P-1103",
      "municipality": "Merville",
      "solids_percentage": 27.1, "scum_inches": 2.5, "sludge_inches": 8.4,
      "total_fluid_depth": 40,
      "solids_status": "high", "scum_status": "monitor",
      "pump_urgency": "soon",
      "household_practice_changes": false,
      "likely_recent_pump": false, "post_pump_crust_issue": false,
      "reasons": ["Solids at 27.1% -- above 25% threshold. Pumping recommended"],
      "projection": { "days_to_solids_recommended": 0, "days_to_solids_critical": 214,
                      "based_on_visits": 2 } },

    { "property_ref": "P-1129",
      "municipality": "Black Creek",
      "solids_percentage": 5.8, "scum_inches": 1.0, "sludge_inches": 1.3,
      "total_fluid_depth": 40,
      "solids_status": "low", "scum_status": "normal",
      "pump_urgency": "none",
      "household_practice_changes": false,
      "likely_recent_pump": true, "post_pump_crust_issue": false,
      "reasons": [],
      "projection": null }
  ]
}
```

*(Synthetic. Properties are identified by internal reference and municipality only — a dispatch
list does not need a street address to be useful, and the same PII-minimisation argument made in
prompt 14 §5 applies here: do not put data in the model's context that the task does not need.)*

---

## 4. Expected output shape

Schema-constrained JSON. Every field is either copied from the input or is prose — **the model
produces no new numbers**:

```json
{
  "call_list": [
    { "rank": 1, "property_ref": "P-1042", "action": "SCHEDULE_PUMP_OUT",
      "urgency": "immediate",
      "homeowner_message": "Your tank is 34.5% full of solids, above the 33% level where solids start reaching the drainfield. We recommend pumping this week.",
      "office_note": "Above critical threshold on a 3-visit history. Book vacuum truck." },

    { "rank": 2, "property_ref": "P-1103", "action": "SCHEDULE_PUMP_OUT",
      "urgency": "soon",
      "homeowner_message": "Your tank is 27% full of solids, past the level where we recommend pumping. It can be scheduled at your convenience over the next few weeks.",
      "office_note": "Above recommended threshold; projected to reach critical in ~214 days. Not urgent." },

    { "rank": 3, "property_ref": "P-1077", "action": "HOMEOWNER_CONVERSATION",
      "urgency": "monitor",
      "homeowner_message": "The crust layer in your tank has built back up since the last pump-out even though the tank itself is not full. Pumping again will not fix it -- what goes down the drain will.",
      "office_note": "POST-PUMP CRUST. Do NOT book a truck. Call re: wipes, grease, non-dissolving toilet paper. Re-measure next visit.",
      "flags": ["do_not_pump", "household_practice_change"] },

    { "rank": 4, "property_ref": "P-1129", "action": "NO_ACTION",
      "urgency": "none",
      "homeowner_message": "Your system looks healthy. Nothing needed until the next scheduled maintenance visit.",
      "office_note": "Recently pumped. No follow-up." }
  ],
  "summary": {
    "pump_outs_to_schedule": 2,
    "homeowner_conversations": 1,
    "no_action": 1,
    "projections_unavailable": ["P-1077", "P-1129"]
  }
}
```

Note rank 3. That is the whole prompt earning its keep: a tank with a 6.5-inch crust that must
**not** be pumped, with an explanation the office can actually say out loud.

---

## 5. Techniques used

| Technique | How |
|---|---|
| **Deterministic-fact grounding** | Every number, status, urgency and flag arrives pre-computed. The model may not produce a new one. This is prompt 02's authority inversion applied to a batch decision. |
| **Structured output (JSON schema)** | A call list is a data structure that feeds dispatch software, not prose. Freeform Markdown (which the production report pipeline uses) would be the wrong choice here. `temperature: 0`. |
| **Encoding a domain trap as an explicit rule** | Rule 2 (post-pump crust → do not pump) exists because it is the exact judgement the model would get wrong. The rule is written as *"even if the scum is thick"* — naming the tempting wrong answer, then forbidding it. |
| **Refusal design on projections** | Rule 4: no history → **no timeline**, and say why. "A single measurement is a point, not a rate" gives the model the *reason*, which generalises better than the prohibition alone. Inventing a plausible "pump in about 2 years" from one reading is the most natural thing in the world for a model to do, and it is fabrication. |
| **Ordering as authority** | The pre-computed block comes first in the payload; the raw measurements follow. |
| **Deterministic sort rule** | Rule 5 fixes the ranking so it is reproducible run-to-run, rather than a fluent guess. |
| **Prose quality constraint with a test** | Rule 7 requires a *reason*, not an instruction, and gives a good/bad pair. This is the difference between a call list an office will use and one it will ignore. |
| **Terminology constraint** | Rule 6 — see prompt 05. |

---

## 6. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| **Pumping a post-pump crust tank** | Homeowner charged ~$500 for a truck that fixes nothing; crust returns; trust destroyed; a rebate claim spent on useless work | Rule 2 + the `post_pump_crust_issue` flag computed deterministically at `solidsAnalysisService.js:177-187` | Low — the decision never reaches the model. |
| **Fabricated pump-out timeline** ("pump in about 18 months") from a single visit | A schedule presented as data-driven that is a guess. Under- or over-service. | Rule 4; `projection: null` is passed explicitly rather than omitted, so the absence is *visible* rather than merely missing | Low-moderate. This is the most likely remaining slip and the judge in prompt 13 should check for it. |
| Model recomputes solids % and disagrees with the engine | Two numbers in one system | Rule 1; arithmetic never given as a task | Low. |
| Over-recommending pump-outs to be safe | Public rebate money on unneeded work; a real integrity problem in a funded program | The thresholds are fixed and org-configurable, not the model's to soften or tighten | Low. |
| Under-recommending (missing a 34% tank) | Solids carry over the baffle into a five-figure drainfield | Deterministic threshold; forced ordering | Low. |
| **The thresholds themselves disagree** | — | — | **Real, and unfixed in production.** The system prompt says 25%+ = "pumping recommended" (`aiReportService.js:599`); `computeNumericalClassifications` says 25-33% = "APPROACHING — monitor closely" (`:294-296`); `solidsAnalysisService` names 25% `solidsRecommended` and 33% `solidsCritical`. **At 28% solids the model can be told to monitor and to pump, in the same prompt.** This prompt sidesteps it by consuming `pumpUrgency` (from `solidsAnalysisService`, the most authoritative of the three) — but the underlying inconsistency should be fixed before any of this is showcased. |

---

## 7. Provenance and verification

- Thresholds: `Backend/services/solidsAnalysisService.js:13-24`. Fallback accumulation rates
  `:26-30` (~4%/yr solids, ~0.5"/yr scum).
- `analyzeCurrentMeasurements` `:109-205`; `likelyRecentPump` `:169-174`; `postPumpCrustIssue`
  `:177-187`.
- `analyzeHistoricalTrend` `:218-300`; pump-out detection `:267`; projections `:287-299`.
- Org-configurable overrides: `DEFAULT_THRESHOLDS` `:34-39`, surfaced into the report prompt as
  `THRESHOLD OVERRIDES` (`aiReportService.js:736-741`).
- **Not in production:** the triage prompt itself. Today `analyzeSolids()` output is formatted into
  narrative text (`solidsText`, `jobs/pdfJob.js:192`) and appended to the single-report prompt.
  There is no cross-property batch view, and no structured call list. This prompt is the case
  study's proposal for one — the deterministic half already exists and is already good.
