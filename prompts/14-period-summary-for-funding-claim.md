# 14 — Period summary: the records behind a funding claim

| | |
|---|---|
| **Origin** | **NEWLY DESIGNED.** No aggregation, batch reporting, or funding-program feature exists in the product. |
| **Serves** | The **Regional District** — indirectly. It is generated *by the contractor*, from their own records, and attached to *their* claim. |
| **Scope warning** | **SepticScribe does not integrate with, submit to, or bill any funding program.** See §2. Getting this wrong would be a false claim about the system. |

---

## 1. Use case

The Comox Valley Regional District runs a **septic maintenance rebate program**: a multi-year
program that reimburses a share of the cost of maintenance work, in specific electoral areas, on the
condition that the work was performed by a **R.O.W.P.** The homeowner claims; the contractor's
record is what backs the claim.

The structural problem this creates is worth stating plainly, because it is the reason report
quality matters to anyone other than the contractor:

> **A public body is spending public money on work it does not witness.**

The program's integrity rests entirely on *records of maintenance actually performed*. A rebate claim
is only as good as the document behind it. And there is no standard format — two contractors produce
two different documents, which makes any region-wide reconciliation or audit essentially intractable.

**The document is the audit surface for public funds.** That is the whole reason a maintenance report
is worth engineering carefully, and it is the strongest argument in the case study for why an
AI-drafted record needs harder guardrails than an AI-drafted marketing email.

So: a contractor who has done thirty rebate-eligible jobs this quarter needs a **period summary** —
a consistent, checkable roll-up of the maintenance records behind those claims. Not a claim. Not an
eligibility determination. **A summary of records that already exist.**

---

## 2. The scope constraint (do not get this wrong)

The product's plan explicitly descoped funding-program integration. In the owner's own words:

> *"The RD program itself is not necessarily important for the purpose of this application… It is a
> **motivator**… This application is merely meant to be the **heavy lifter for the contractors**."*

Billing is each contractor's own responsibility and is permanently out of scope.

**The correct framing, and the only one the case study may use:**

> The funding program creates the demand. SepticScribe produces the records that support a
> contractor's claim. It does not make the claim, does not determine eligibility, and does not talk
> to the Regional District.

Describing this as "Regional-District-integrated compliance software" would be false. It is a
records tool used in a market where records happen to be worth money.

This constraint is not a legal nicety — it is the **first prohibition in the prompt below**, because
the model will otherwise cheerfully determine eligibility. It is the single most natural thing in
the world for a model to do with a list of maintenance jobs and a rebate program in the context: it
will start ticking boxes.

---

## 3. The prompt

### System

```text
You are producing a PERIOD SUMMARY of maintenance records for a ROWP Maintenance Provider in
British Columbia. The summary may be attached, by the contractor, to their own or a homeowner's
claim under a maintenance funding program.

WHAT YOU ARE DOING:
Aggregating and describing maintenance records that already exist. Nothing more.

WHAT YOU ARE NOT DOING (absolute -- a violation here is a misrepresentation to a public body):
- You are NOT determining eligibility for any funding program. You do not know the program's rules,
  you have not been given them, and eligibility is determined by the funding body. NEVER write that
  a property "qualifies", "is eligible", "meets the program requirements", or "is approved".
- You are NOT certifying that the work was performed. The records assert that; you summarise them.
  Write "the record states", not "the work was performed".
- You are NOT determining regulatory compliance. That is the Health Authority's determination.
- These were MAINTENANCE visits. Never call them inspections. The practitioner holds a Maintenance
  Provider certification; "inspection" names a separate certification (Private Inspector) that this
  summary must not imply.

RULES:
1. Every row of the summary must trace to an APPROVED maintenance record. A record that is still
   pending review, or that was returned for corrections, is NOT conducted maintenance and MUST NOT
   appear in the summary. List those separately under "excluded_records", with the reason.
2. Report counts and dates exactly as they appear in the records. Compute nothing. Estimate nothing.
   If a total is needed, it is supplied to you pre-computed.
3. Do not include personal information. Properties are identified by their internal reference and
   their municipality. NEVER include an owner name, a full street address, a parcel or folio ID, a
   phone number, or an email address in this summary. If a record contains them, omit them.
4. Where a record is incomplete (a required measurement was not taken), say so in that row. Do not
   silently present an incomplete record as a complete one. An incomplete record is not a failed
   record -- it is an incomplete one, and the distinction is the summary's job to preserve.
5. If asked for a figure you have not been given, write "not available in the records provided".
   Never estimate a figure that a public body might rely on.

Output JSON only.
```

### User

```json
{
  "period": { "from": "2026-04-01", "to": "2026-06-30" },
  "contractor_ref": "ORG-7",
  "precomputed_totals": {
    "approved_records": 3,
    "excluded_records": 2,
    "properties_serviced": 3,
    "distinct_municipalities": 3
  },
  "records": [
    { "property_ref": "P-1042", "municipality": "Comox",
      "status": "Approved", "service_date": "2026-06-13",
      "system_type": "Type_2_Advanced",
      "practitioner_endorsement": "Maintenance Provider",
      "work_performed": ["Effluent filter cleaned", "Tank solids measured", "Blower serviced"],
      "measurements_complete": true,
      "deficiencies_recorded": ["Dissolved oxygen below 2.0 mg/L minimum"] },

    { "property_ref": "P-1103", "municipality": "Merville",
      "status": "Approved", "service_date": "2026-05-28",
      "system_type": "Type_1_Gravity",
      "practitioner_endorsement": "Maintenance Provider",
      "work_performed": ["Tank solids measured", "Effluent filter cleaned"],
      "measurements_complete": true,
      "deficiencies_recorded": ["Solids at 27.1% -- pumping recommended"] },

    { "property_ref": "P-1129", "municipality": "Black Creek",
      "status": "Approved", "service_date": "2026-04-19",
      "system_type": "Type_1_Gravity",
      "practitioner_endorsement": "Maintenance Provider",
      "work_performed": ["Tank solids measured"],
      "measurements_complete": false,
      "missing_measurements": ["total_fluid_depth"],
      "deficiencies_recorded": [] },

    { "property_ref": "P-1155", "municipality": "Courtenay",
      "status": "Pending", "service_date": "2026-06-29",
      "system_type": "Type_1_Gravity" },

    { "property_ref": "P-1177", "municipality": "Royston",
      "status": "Corrections Requested", "service_date": "2026-06-25",
      "system_type": "Type_2_Advanced" }
  ]
}
```

Note P-1155 and P-1177. Both were serviced inside the period. **Neither is conducted maintenance**,
because in this system only an **admin-Approved** event counts — a `Pending` record has not been
reviewed and a `Corrections Requested` record has been actively rejected. A model summarising "the
quarter's work" will include them, because they *look* like work, and they will end up backing a
claim for money.

That is the trap this prompt is built around.

---

## 4. Expected output shape

```json
{
  "period": { "from": "2026-04-01", "to": "2026-06-30" },
  "records_summarised": 3,
  "records_excluded": 2,

  "maintenance_records": [
    { "property_ref": "P-1042", "municipality": "Comox", "service_date": "2026-06-13",
      "system_type": "Type 2 (Advanced Treatment)",
      "practitioner_scope": "Maintenance Provider",
      "record_states": "Effluent filter cleaned; tank solids measured; blower serviced.",
      "deficiencies_recorded": ["Dissolved oxygen below the 2.0 mg/L minimum"],
      "record_completeness": "complete" },

    { "property_ref": "P-1103", "municipality": "Merville", "service_date": "2026-05-28",
      "system_type": "Type 1 (Gravity)",
      "practitioner_scope": "Maintenance Provider",
      "record_states": "Tank solids measured; effluent filter cleaned.",
      "deficiencies_recorded": ["Tank solids at 27.1% -- pumping recommended"],
      "record_completeness": "complete" },

    { "property_ref": "P-1129", "municipality": "Black Creek", "service_date": "2026-04-19",
      "system_type": "Type 1 (Gravity)",
      "practitioner_scope": "Maintenance Provider",
      "record_states": "Tank solids measured.",
      "deficiencies_recorded": [],
      "record_completeness": "incomplete",
      "incompleteness_note": "Total fluid depth was not measured during this visit. Without it, tank solids percentage cannot be calculated for this record." }
  ],

  "excluded_records": [
    { "property_ref": "P-1155", "service_date": "2026-06-29", "status": "Pending",
      "reason": "This record has not been reviewed and approved. It is not conducted maintenance and is not included in this summary." },
    { "property_ref": "P-1177", "service_date": "2026-06-25", "status": "Corrections Requested",
      "reason": "This record was returned for corrections and has not been approved. It is not included in this summary." }
  ],

  "totals": {
    "approved_maintenance_records": 3,
    "properties_serviced": 3,
    "municipalities": 3,
    "records_with_incomplete_measurements": 1
  },

  "disclaimers": [
    "This is a summary of maintenance records. It is not a determination of eligibility under any funding program; eligibility is determined by the funding body.",
    "It is not a certification that work was performed, and not a determination of regulatory compliance.",
    "These were maintenance visits performed under a Maintenance Provider certification. They were not inspections."
  ]
}
```

Three things this output does that a naive one would not:

1. **It excludes the two unapproved records, loudly.** They are not silently dropped — silently
   dropping them looks like a smaller quarter and invites someone to add them back. They are listed
   with a reason.
2. **It flags the incomplete record without failing it.** P-1129 is real maintenance with a missing
   measurement. Rule 4 preserves the distinction between *incomplete* and *deficient*, which a public
   body reviewing records genuinely needs and which a model will otherwise collapse.
3. **It says `record_states`, not "work performed".** One word, and it is the difference between
   summarising a record and certifying it.

---

## 5. Techniques used

| Technique | How |
|---|---|
| **Prohibition on the natural conclusion** | The model is handed a list of maintenance jobs and a rebate context, and told in the strongest terms **not to determine eligibility**. This is the highest-value instruction in the file, because determining eligibility is exactly what a helpful model does next. |
| **Evidentiary hedging built into the schema** | The field is named `record_states`, not `work_performed`. **A schema field name is a constraint the model cannot forget halfway down a long list** — far more durable than an instruction, because it is re-imposed on every row. |
| **Status gating from the domain model** | Only `Approved` counts. This is not a prompt invention — it is the product's actual rule (`Pending → Approved / Corrections`; only Approved events count as conducted maintenance anywhere in the system). The prompt inherits it rather than re-deriving it. |
| **Visible exclusion** | `excluded_records[]` with a reason per row. Exclusions that are visible cannot be quietly reversed. |
| **PII prohibition at the aggregation boundary** | Rule 3. A per-property report needs the address; a **period summary does not**. Aggregation is the natural place to drop identifying data, and it is the place most systems forget to. Property ref + municipality is enough to audit against. |
| **Incomplete ≠ deficient** | Rule 4 preserves a distinction a reviewer needs and a summariser will flatten. |
| **Refusal on any figure not supplied** | Rule 5: *"never estimate a figure that a public body might rely on."* The stakes are named, which is why the rule holds. |
| **Terminology guardrail** | See prompt 05 — and note it appears in the `disclaimers` array, i.e. on the artifact itself, not just in the prompt. |

---

## 6. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| **Eligibility determined** | Software tells a homeowner they qualify for public money. They do not. The contractor is the one who said it. | First and strongest prohibition; `disclaimers` on the artifact | Moderate — a *paraphrase* ("all three records meet the program's requirements") evades a keyword check. Needs the semantic judge (prompt 13, F4). |
| **Unapproved record included** | A claim backed by a record that was never reviewed — or one that was actively **rejected**. This is the fraud-shaped failure. | Deterministic status gate; visible `excluded_records[]` | Low, and it should be enforced in the query, not the prompt: **only fetch Approved records.** Never give the model the temptation. |
| **Summary reads as a certification of work** | The contractor has certified, in aggregate, work the summary was only meant to describe | `record_states` schema field; "you summarise them, you do not certify them" | Low — the schema carries it. |
| **PII in a document sent to a public body** | Owner names and street addresses in a spreadsheet at a regional district | Rule 3; property ref + municipality only | Low, and enforceable: strip identifying fields *before* the model sees them. Same principle as prompt 10 — the safest way to prevent a leak is to not have the data in context. |
| **Estimated total** | A number a public body relies on that nobody computed | Rule 2 (totals are pre-computed and passed in) + rule 5 | Low. |
| Incomplete record presented as complete | A record that cannot support the claim it is attached to | Rule 4 | Low. |
| **The summary is used as a compliance document** | It is not one, and it does not claim to be — but people use documents for what they look like | `disclaimers` on the artifact itself, not just in the prompt | Moderate, and largely outside the system's control. Worth one honest sentence in the case study rather than a claim of mitigation. |

---

## 7. Provenance and verification

- The approval gate is real: only an admin-**Approved** maintenance event counts as conducted
  maintenance, and this rule is applied consistently across health scoring, last-visit dates, trend
  analysis, and reporting. The inter-visit task lookup in the report pipeline explicitly finds *"the
  previous **Approved** event"* (`Backend/jobs/pdfJob.js:156-175`).
- Funding-program facts (the rebate share, the eligible electoral areas, the program term, the ROWP
  requirement) come from a secondhand market-research note, **not a primary check of the Regional
  District's own page.** The plan step that would have established that ground truth was explicitly
  descoped and never done. **Re-verify every program figure directly with the Regional District
  before publication.** No specific percentage, dollar cap, or area list is stated in this file, on
  purpose.
- **Not in production:** no aggregation feature, no batch export, no period summary, no funding
  integration. This prompt is a design, and the scope constraint in §2 is a hard boundary on what the
  case study is permitted to claim.
