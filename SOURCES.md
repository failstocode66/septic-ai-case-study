# Sources

Every regulatory figure used in this repository is listed here, with the primary source it was
checked against and the date it was read. Nothing in this repository is legal advice.

The sources were read on the access dates shown (2026-07-14) and have **not** been re-checked since.
Regulations, manuals and registration-body policy change; nothing here asserts that they are current.

Three rules were applied, and they are worth stating because they explain the shape of the list:

1. **A figure that could not be traced to a primary source was cut, not hedged.** One was: see
   *The 2.0 mg/L dissolved-oxygen threshold* below.
2. **Practitioner knowledge is labelled as practitioner knowledge**, not dressed up as a citation.
   The author has worked in this industry; where a claim comes from that work rather than from a
   document, it says so.
3. **A figure is only quoted where it is actually used.** An earlier draft of this repo carried
   caveats disclaiming figures (a 22,700 L/day threshold, a "$25,000/day penalty", a "30-day filing
   window" for maintenance reports) that appeared *nowhere in the repository except in the caveats
   themselves*. Those caveats manufactured exposure that did not exist, while blanket-disclaiming
   figures that turned out to be correct. They have been rewritten.

---

## Primary sources

| Key | Document | URL | Accessed |
|---|---|---|---|
| **SSR** | Sewerage System Regulation, BC Reg 326/2004 (under the *Public Health Act*) | https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/326_2004 | 2026-07-14 |
| **SPM V3** | Sewerage System Standard Practice Manual, Version 3 (September 2014), BC Ministry of Health | https://www2.gov.bc.ca/assets/gov/environment/waste-management/sewage/spmv3-24september2014.pdf | 2026-07-14 |
| **PPB-2023** | ASTTBC Professional Practice Bulletin #PPB-2023-OW-001, *FAQ: Onsite Wastewater System Inspections*, 15 February 2023 | https://asttbc.org/wp-content/uploads/2023/02/ROWP-Bulletin-FAQ-Final-February-15-2023.pdf | 2026-07-14 |
| **ROWP-PG** | ROWP Practice Guidelines (OWCB Policy, 26 January 2017) — superseded in part by PPB-2023 | https://asttbc.org/wp-content/uploads/2021/09/ROWP-Practice-Guidelines-1.pdf | 2026-07-14 |
| **ASTTBC-ROWP** | ASTTBC — Registered Onsite Wastewater Practitioners (registration categories) | https://asttbc.org/applicants/rowps/ | 2026-07-14 |
| **PHA** | Public Health Act, SBC 2008 c.28 | https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/08028_01 | 2026-07-14 |

---

## Figures used in this repository

### Type 1 / Type 2 / Type 3 treatment classification — **SSR s.1**

> *"(a) Type 1 is treatment by septic tank only, (b) Type 2 is treatment that produces an effluent
> consistently containing less than 45 mg/L of total suspended solids and having a 5 day biochemical
> oxygen demand of less than 45 mg/L, and (c) Type 3 is treatment that produces an effluent
> consistently containing less than 10 mg/L of total suspended solids and having (i) a 5 day
> biochemical oxygen demand of less than 10 mg/L…"* — SSR s.1, definition of *treatment method*.

Used in prompts 07, 09, 14. Two things follow from the actual wording:

- The **45 mg/L BOD/TSS** limit for a Type 2 unit is not merely a "technical standard" — it is the
  regulation's own definition of the type. Cite it as the SSR.
- **"Type" classifies the treatment method, not the dispersal method.** A Type 1 system is
  *"treatment by septic tank only"*; gravity vs. pressure is a separate axis. An earlier draft of
  prompt 14 wrote **"Type 1 (Gravity)"**, which conflates the two. It now reads
  **"Type 1 (Septic Tank Only)"**.

### Tank pump-out trigger: solids at 1/3 of the tank's internal height — **SPM V3**

> *"Assess the sludge and scum accumulations. Pump out when any of the following are noted: [•] Total
> solids accumulations are more than 1/3 of the internal height of the tank. [•] The scum layer
> reaches the top of outlet T in a one compartment tank. [•] The scum layer reaches the top of inlet
> T in a two compartment tank. [•] Any obvious carry-over of solids to the second compartment. [•]
> Premature effluent filter clogging. [•] An increase in TSS or O&G noted in downstream components."*
> — SPM V3, septic tank maintenance procedures.

Used in prompt 09 and in CASE-STUDY.md §6.3. Two corrections applied:

- The denominator is the tank's **internal height**, not its "working depth" (which is what an
  earlier draft said).
- It is **one of six OR-conditions**, not a standalone threshold. Where the repo previously implied a
  single rule, it now says so.

### Maintenance / monitoring intervals — **SPM V3, Table II-62** (not an operating permit)

Table II-62, *"Minimum initial frequencies for maintenance and monitoring"*: **Type 1 = 12 months;
Type 2 and Type 3 = 6 months**, as minimum intervals *"for maintenance visits and testing for the
first 12 to 14 months of operation."* The same page: *"The minimum long term maintenance frequency is
2 years for systems with Type 2 or 3 treatment systems and 5 years for all other systems."*

The obligation runs through the **maintenance plan**, not through a permit clause: SSR s.10(1) —
*"An owner must ensure that a sewerage system on the owner's land is maintained in accordance with
the maintenance plan"*; s.10(2) requires the owner to **keep** records of maintenance.

**What the SSR does *not* say, and what this repo no longer claims:** it imposes **no duty to file
ongoing maintenance reports with the health authority**, and no deadline for doing so. An earlier
draft asserted that maintenance reports must be *"filed with the Health Authority"* and attributed a
6–12 month interval to an operating permit. Both statements are now corrected. (The SSR's only
30-day filing window, s.9(1), attaches to the **letter of certification filed after construction** —
not to maintenance records. It is not used anywhere in this repo.)

If a *specific* health authority imposes report filing as a condition of an operating permit, that is
a claim about that health authority and must be cited to it — not to the SSR.

### The maintenance / inspection scope boundary — **practitioner knowledge** (the author's)

This is the load-bearing domain claim of the whole project, and it is **not** a citation. It comes
from the author's work in the septic industry and from conversations with inspectors, maintenance
providers, and WACOWMA representatives. It is stated as informed industry practice, and it is not
legal advice.

Two documented facts sit alongside it, and both are recorded here because they are easy to get wrong:

- **ASTTBC registration categories are distinct**, each with its own scope: Planner, Installer,
  Maintenance Provider, and Private Inspector (Residential / Commercial) — **ASTTBC-ROWP**.
- **Since 15 February 2023, a Maintenance Provider may conduct private inspections without holding
  the Private Inspector endorsement.** PPB-2023: *"ROWP Planners and Maintenance Providers are not
  required to obtain the Private Inspector endorsement in order to conduct inspections."* Corroborated
  on **ASTTBC-ROWP**: *"Individuals that are registered as a Maintenance Provider are also permitted
  to perform private inspections without the requirement of the Private Inspector endorsement."*
  **Before** that bulletin the opposite was true — ROWP-PG §7.1 required the PI endorsement for any
  ROWP *"[providing] any assessment or confirmation of the performance or functionality of an existing
  sewage system other than for the purposes of maintenance."*

An earlier draft of this repo asserted the pre-2023 position (*"a Maintenance Provider is not thereby
authorized to practise as a Private Inspector"*) as current. That was stale, and it has been
corrected wherever it appeared.

**The terminology rule is unaffected by that reversal, and this is the point:** the 2023 bulletin
changed *who may perform an inspection*. It did not turn a maintenance visit into one. An inspection
remains a distinct service, with its own scope, standards and deliverables (ROWP-PG §7.2), and a
report that describes a maintenance visit as an *inspection* misdescribes the work performed and the
standard it was performed to — regardless of which endorsements the signer happens to hold. The harm
vector is unchanged and is the strongest leg of the argument: a homeowner, buyer, or lender reading
*"your inspection revealed…"* may rely on the document as something it is not.

---

## The one figure that is *not* regulatory: **2.0 mg/L dissolved oxygen**

As audited (commit `a37c4d9`, 2026-07-13), SepticScribe classified dissolved oxygen below **2.0 mg/L**
as **`BELOW REGULATORY MINIMUM`**, and that string was emitted into the prompt — and, through it, into a maintenance report a health
authority may read.

**There is no such regulatory minimum.**

- **BC Reg 326/2004 sets no dissolved-oxygen threshold of any kind.**
- **SPM V3 sets none either.** This is a checked negative, not a failure to find: the 9.8 MB PDF was
  downloaded and its full text extracted; every occurrence of "oxygen" is either the BOD definition,
  the aerobic/anaerobic glossary entries, or soil oxygen transport (§III-5.6.8). There is no
  "2.0 mg/L", no DO minimum, and no regulatory DO limit anywhere in it.

The 2.0 mg/L figure traces to SepticScribe's own reference corpus
(`Backend/knowledge/domains/bc-health-authority-regulations.json`, `sourceUrl: null`) — the same
unsourced corpus this case study identifies as a finding (CASE-STUDY.md §6.3).

**As an operational threshold it may well be sound** — an aerated unit does need aerobic conditions,
and a DO reading of 1.4 mg/L in an ATU is a real diagnostic signal. **As a regulatory claim it is
unsupported, and the word "REGULATORY" is a defect.** So:

- **In this repository**, the regulatory framing is **cut**. The prototype emits
  `BELOW OPERATIONAL THRESHOLD — treatment impaired`, and the prompt library presents 2.0 mg/L as an
  operational target for aerobic function, sourced to the product's own corpus and labelled as such.
- **In SepticScribe**, the string was live when this register was first written (2026-07-14), and it
  was disclosed then as an open defect. On 2026-07-15 the author reported it fixed (commit `b2f9ef2`;
  CASE-STUDY.md §5.10). The product's code is private, so that is a dated report, not something this
  repository can demonstrate. Transcripts of audit-time production output are reproduced verbatim in these documents
  — including the wrong word — because rewriting a transcript to flatter the system would be a worse
  offence than the defect it hides.

This is the same failure mode as the electrical-standard misattribution (CASE-STUDY.md §3.4), one
layer down: real operational knowledge, correct on the merits, wearing a borrowed uniform it never
needed.
