# 10 — Repair cost estimate: the model does not touch the money

| | |
|---|---|
| **Origin** | **NEWLY DESIGNED.** The pricing data model is real and shipped (`Backend/database/migrations/040_add_pricing_books.sql` — `price_books`, `service_rates`, `parts_catalog`, `labor_rates`). **No AI touches it today.** This prompt is a proposal built on a real schema. |
| **Serves** | The contractor (who sends the estimate) and the homeowner (who has to decide). |

---

## 1. Use case

The maintenance visit found a failing blower. The homeowner asks the obvious question: *what will
this cost?*

Producing the answer means pulling a service rate, a part, a labour rate and a trip charge out of
the contractor's own price book and adding them up. It is arithmetic, and it is arithmetic the
contractor is contractually bound to.

**A language model must not do this. Not any part of it.**

This is the clearest case in the entire library, and it is worth being blunt about why, because the
reasoning is not "LLMs are bad at maths" (they are adequate at maths, and a tool call would fix it
anyway):

1. **A wrong number in an estimate is a wrong number a customer was quoted.** Not a draft, not a
   suggestion — a figure a business sent to a person, with a business name on it. If the model
   halves a rate, the contractor either eats the difference or has a very bad phone call.
2. **Money is the one domain where "approximately right" has no value at all.** A diagnosis can be
   probabilistic. A confidence-hedged narrative is useful. `$487.50` is either the right number or
   it is a liability.
3. **The price book is the contractor's business logic.** Their markup, their trip charge, their
   emergency surcharge, their minimum charge. Those are commercial decisions encoded in a database.
   A model interpolating a "reasonable" price is overwriting a business decision with a statistical
   average of the internet.

So the design is not "let the model calculate carefully." It is:

> **The model never sees a price and never emits a number. The arithmetic happens in SQL. The model
> writes the sentence that explains why the line item is on the estimate.**

The model's job is the *justification*, which is the part that is genuinely hard and genuinely
worth automating: connecting each line item back to a specific finding from the maintenance visit,
in language the homeowner can act on.

---

## 2. The architecture

```
   maintenance findings                price_books / service_rates
   (deterministic, from the visit)     parts_catalog / labor_rates
              │                                    │
              ▼                                    ▼
     ┌────────────────────┐            ┌────────────────────────┐
     │  rule-based line   │───────────▶│  ESTIMATE ENGINE (SQL) │
     │  item selection    │            │  integer cents, exact  │
     └────────────────────┘            └───────────┬────────────┘
                                                   │
                            line items + totals    │  (already priced)
                                                   ▼
                                        ┌──────────────────────┐
                                        │   THE MODEL          │
                                        │  writes justification│
                                        │  ONLY. No numbers.   │
                                        └──────────────────────┘
```

All money is **integer cents** end to end. That is how the shipped schema already stores it —
`base_rate_cents`, `per_unit_rate_cents`, `trip_charge_cents`, `min_charge_cents`,
`cost_price_cents`, `sell_price_cents`, `hourly_rate_cents` (migration 040). No floats, no rounding
drift, and — relevant here — **no string the model could plausibly overwrite.**

---

## 3. The prompt

### System

```text
You are drafting the explanatory text for a repair estimate from a septic maintenance contractor to
a property owner in British Columbia.

THE ESTIMATE IS ALREADY PRICED. Every line item, quantity, rate, subtotal, tax, and total has been
computed by the contractor's pricing system from their own price book. Those numbers are final and
authoritative.

YOU WILL NOT PRODUCE, ALTER, ROUND, RECALCULATE, ESTIMATE, OR MENTION ANY NUMBER.
Not a price. Not a subtotal. Not a total. Not a quantity. Not a percentage. Not a range.
Not "roughly", not "approximately", not "in the region of".
The pricing system renders every figure. If you emit a number, the estimate is void.

If the homeowner needs to know a figure, they will read it in the table beside your text.

YOUR JOB, for each line item:
  1. WHY -- tie it to a specific finding from the maintenance visit. Quote the finding.
  2. WHAT HAPPENS IF NOT DONE -- the consequence, and its rough time horizon if the maintenance
     data supports one. If the data does not support a timeline, do not invent one.
  3. URGENCY -- one of: IMMEDIATE, RECOMMENDED, OPTIONAL. Use the pre-computed severity of the
     underlying finding. Do not soften a CRITICAL finding into an OPTIONAL line item, and do not
     escalate a routine one to create urgency.

AND, once, for the estimate as a whole:
  4. A two-sentence summary the homeowner can read first.

CONSTRAINTS:
- Every line item MUST trace to a finding in the maintenance data. If a line item has no supporting
  finding, do not invent a justification for it -- return it in "unjustified_line_items" and say
  what evidence would be needed. A line item nobody can justify should not be on a customer's bill.
- NEVER create a line item. You are given the list; you explain it. You do not add to it.
- NEVER recommend a specific brand or supplier.
- NEVER promise an outcome. "Restores aeration to the treatment unit" is a description of the work.
  "This will fix your system" is a promise the contractor has to keep.
- NEVER imply urgency the findings do not support. Manufactured urgency in a repair estimate is
  a sales tactic, and it is the fastest way for a contractor to lose a regulator's goodwill and a
  rebate program's referrals.
- The work performed was MAINTENANCE, not an inspection. Refer to "the maintenance visit".
- Plain language. The reader is not a technician.

Output JSON only, matching the schema. Any numeric character in a justification field is a failure.
```

### User

```json
{
  "maintenance_findings": {
    "service_date": "2026-06-13",
    "air_blower_0_blower_condition": "Fair",
    "air_blower_0_air_pressure": "1.8",
    "aerobic_treatment_unit_0_dissolved_oxygen_mgl": "1.4",
    "aerobic_treatment_unit_0_effluent_clarity": "Cloudy",
    "septic_tank_0_effluent_filter_soiling": "Moderate"
  },
  "precomputed_diagnostics": [
    "DISSOLVED OXYGEN: 1.4 mg/L -> BELOW REGULATORY MINIMUM -- treatment impaired",
    "TREATMENT SYSTEM: Low DO (1.4 mg/L) + Cloudy effluent = TREATMENT DEGRADATION. Blower condition: Fair. Root cause is likely the blower."
  ],
  "line_items": [
    { "id": "LI-1", "source": "service_rates", "name": "Air blower replacement -- linear diaphragm",
      "quantity": 1, "severity_of_source_finding": "WARNING" },
    { "id": "LI-2", "source": "parts_catalog", "name": "Replacement diaphragm kit",
      "quantity": 1, "severity_of_source_finding": "WARNING" },
    { "id": "LI-3", "source": "labor_rates", "name": "Technician labour",
      "quantity_hours": 1.5, "severity_of_source_finding": "WARNING" },
    { "id": "LI-4", "source": "service_rates", "name": "Trip charge",
      "quantity": 1, "severity_of_source_finding": null },
    { "id": "LI-5", "source": "service_rates", "name": "Riser and lid replacement -- 24 inch",
      "quantity": 1, "severity_of_source_finding": null }
  ]
}
```

Note that **the model is not shown a single price.** It cannot leak one, because it does not have
one. This is prompt injection defence applied to a business rule: the safest way to stop a model
emitting a number is to make sure no number is in its context window.

Note also LI-5, planted deliberately. Nothing in the maintenance data says anything about a riser
or a lid.

---

## 4. Expected output shape

```json
{
  "summary": "During the maintenance visit on June 13, the treatment unit was found to be running below the oxygen level its bacteria need, and the air blower that supplies that oxygen was in fair condition and delivering reduced pressure. This estimate covers restoring the aeration before the reduced treatment quality begins to affect the dispersal field.",

  "line_items": [
    { "id": "LI-1", "urgency": "RECOMMENDED",
      "why": "The maintenance visit recorded the air blower in Fair condition, delivering reduced air pressure. The blower is what supplies oxygen to the bacteria that treat your wastewater.",
      "if_not_done": "Without adequate aeration the treatment bacteria continue to die back. Under-treated wastewater reaching the dispersal field accelerates clogging of the soil surface, and a dispersal field is substantially more expensive to replace than a blower is to repair." },

    { "id": "LI-2", "urgency": "RECOMMENDED",
      "why": "The diaphragm is the wearing part inside the blower and is replaced as part of the blower service above.",
      "if_not_done": "A worn diaphragm is the usual cause of the reduced air pressure recorded during the maintenance visit." },

    { "id": "LI-3", "urgency": "RECOMMENDED",
      "why": "Technician time to carry out the blower service described above.",
      "if_not_done": "Not applicable -- this is the labour for the work above." },

    { "id": "LI-4", "urgency": "RECOMMENDED",
      "why": "Standard charge for travelling to the property to carry out the work above.",
      "if_not_done": "Not applicable." }
  ],

  "unjustified_line_items": [
    { "id": "LI-5", "name": "Riser and lid replacement -- 24 inch",
      "reason": "Nothing in the maintenance data from this visit refers to the riser or the tank lid. No condition, damage, or deficiency was recorded for either. I cannot write a justification for this line item.",
      "evidence_that_would_justify_it": "A recorded condition for the riser or lid (for example: cracked, damaged, not sealing, buried, or missing), or a technician note describing a problem with access." } ]
}
```

**That last array is the entire point of the prompt.**

A model asked to justify a riser replacement will justify a riser replacement. It is a *helpful*
model. It will write "the riser was noted as showing wear consistent with its age and replacement is
recommended to maintain safe access" — a fluent, plausible, entirely fabricated sentence that ends
up on a customer's bill.

By giving refusal a **named slot in the output schema**, the prompt turns "I have no basis for this"
from an awkward act of defiance into the obviously-correct place to put LI-5. The model does not
have to *resist* the instruction to justify; it has somewhere else to put the item.

And the business value is immediate and non-obvious: **this catches upsell that nobody meant to
commit.** A dispatcher adds a riser to the estimate out of habit; the model, which can only see the
findings, cannot connect it to anything and says so. The prompt has quietly become an internal
control on the contractor's own billing.

---

## 5. Techniques used

| Technique | How |
|---|---|
| **Total removal of the risky capability** | The model is not instructed to be careful with numbers. **It is not given any numbers.** The unsafe output is not forbidden, it is *unreachable*. This is the strongest form of guardrail available and it is available far more often than people use it. |
| **Deterministic arithmetic, integer cents** | All money is computed in SQL from the org's own price book. The schema already stores everything in `_cents` integers (migration 040) — no floats, no rounding, no model. |
| **Justification-must-cite-evidence** | Every line item must trace to a finding, quoted. |
| **Refusal with a schema slot** | `unjustified_line_items[]` — with a required `evidence_that_would_justify_it` field, so the refusal is *actionable* rather than merely obstructive. |
| **Severity pass-through** | Urgency comes from the pre-computed severity of the underlying finding (prompt 02). The model may not soften it *or* inflate it — and the inflation direction is called out explicitly, because in a *sales* document the incentive gradient runs the other way from everywhere else in this library. |
| **Negative constraint on manufactured urgency** | Named as what it is: "a sales tactic". Naming the bad behaviour beats describing the good one. |
| **Mechanical output check** | *"Any numeric character in a justification field is a failure."* Enforceable with `/\d/.test(field)` — a one-line deterministic gate over the model's output. Zero API cost, no false negatives. |
| **No promises** | "Restores aeration" (a description of work) vs "this will fix your system" (a warranty). |

---

## 6. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| **Model emits a price** | A number the contractor never quoted, on a document with their name on it | No prices in context + `/\d/` output gate on justification fields | Very low. The capability is absent. |
| **Model invents a justification for an unsupported line item** | Fabricated upsell on a customer's bill. In a rebate-funded market: public money on invented work. | `unjustified_line_items[]` as the path of least resistance | Low-moderate. The schema slot does most of the work; a judge (prompt 13) should verify every `why` traces to a real finding key. |
| **Model creates a line item** | Same, worse | "NEVER create a line item. You are given the list." + a set-equality check: output ids must equal input ids, exactly | Very low — this is deterministically checkable and should be. |
| **Manufactured urgency** | Sales pressure in a document the homeowner trusts because it came from their technician | Severity pass-through; explicit prohibition on escalation | Moderate. The model has no incentive to inflate, but "RECOMMENDED" drifting to "IMMEDIATE" is a one-token change with real consequences. Check it deterministically against the input severity. |
| **Softening a CRITICAL finding to close a smaller sale** | The dangerous inverse. A dry-running pump becomes an OPTIONAL line item. | Severity pass-through is *bidirectional* | Low. |
| Promised outcome | A warranty the contractor did not give | Explicit prohibition | Low. |
| "Inspection" | See prompt 05 | Explicit prohibition | Live defect elsewhere; this prompt states the rule locally. |

---

## 7. Provenance and verification

- Pricing schema — `Backend/database/migrations/040_add_pricing_books.sql`, verified in source.
  `price_books` (per-org, multiple, with `effective_from`/`effective_until`), `service_rates`
  (`base_rate_cents`, `per_unit_rate_cents`, `trip_charge_cents`, `emergency_surcharge_type`,
  `min_charge_cents`, `estimated_duration_minutes`, `is_taxable`), `parts_catalog`
  (`cost_price_cents`, `sell_price_cents`, `markup_percent`, `supplier`, inventory tracking),
  `labor_rates` (`hourly_rate_cents`, `overtime_rate_cents`, `overtime_threshold_hours`). All money
  is integer cents. The migration header notes it is deliberately industry-agnostic — service types
  are org-defined `VARCHAR`s, not enums.
- Severities consumed here are the ones computed by `computeAmpDrawDiagnostics` and
  `computeNumericalClassifications` (`Backend/aiReportService.js:211-339`) — see prompt 02.
- **Not in production:** there is no estimate-generation feature and no AI anywhere near the pricing
  tables. The tables exist; the workflow does not. This prompt is a design on top of a real schema,
  and it is presented as one.
