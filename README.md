# AI-Assisted Maintenance Reporting in the Septic Industry

**A case study in constraining a language model inside a document that carries legal weight.**

A septic maintenance report is signed by a registered practitioner, handed to a homeowner, read by a
health authority during an audit, and used to support a public rebate claim. The tolerance for a
confident, fluent, wrong sentence is approximately zero.

This repository documents the AI report-generation pipeline in **SepticScribe**, a maintenance
application built for onsite-wastewater contractors in British Columbia — and argues one
idea:

> **The model may never be the source of a claim that carries legal or financial weight.**
> Arithmetic, threshold classification, severity, and every regulated identifier are computed
> deterministically and handed to the model as facts it is forbidden to re-derive. The model narrates.
> It does not conclude.

The interesting engineering is not the language model. It is the deterministic layer built around it,
and the deliberate decision to demote the model from *reasoner* to *writer*.

---

## What this is

This is a case study of a real system, not a toy. **SepticScribe is a commercial product** — a
working system built for a regulated trade — and the pipeline described here is the one it ran at the
audited commit (`a37c4d9`, 2026-07-13). It is **pre-beta and has no customers yet** (as of July 2026),
which is worth saying plainly for two reasons: it means none of the defects below harmed anyone, and it
means that is a fact about timing rather than a defence. The code path was live and the defects were
real. Two consequences worth stating up front:

- **The constraints are real.** The regulatory boundary at the centre of the ethics section is not a
  hypothetical. Getting it wrong misdescribes the service performed in a document signed with a
  practitioner's registration number.
- **The defects are real, and they are reported.** The audit behind this repository found several,
  including one that undermined the exact compliance rule the case study argues is most important.
  The audit is of commit `a37c4d9` (2026-07-13). The author reports product fixes for four of the
  defects on 2026-07-14; the dissolved-oxygen label was disclosed here as an open defect on
  2026-07-14, and its fix was reported on 2026-07-15 (`b2f9ef2`); no fix is reported for the
  unsourced regulatory corpus. These are the author's dated reports about private code, not verified
  independently here, and [PROVENANCE.md](PROVENANCE.md) keeps them separate from what this
  repository can show.

SepticScribe's own source is private and is **not** included here, and no product source file is
vendored. What *is* here, and where each part came from, is set out in [PROVENANCE.md](PROVENANCE.md):
the prototype is a reduced re-implementation (its guardrail module names the production functions it
was ported from); seven of the fifteen prompt files quote production prompt text, with file and line
citations at the audited commit; the recorded model outputs are captured, not written; and the one
script that measures the production prompt imports it from a local checkout of the private product
rather than vendoring it, so it cannot be run from this repository alone.

---

## Start here

```bash
cd prototype
npm install          # one dependency
npm run demo         # offline, no API key, no network, ~5 seconds
```

That runs the headline comparison from recorded model responses: the same maintenance record rendered
with and without the deterministic guardrails. Without them, the model takes a pump drawing 22% of its
nameplate current — a motor destroying itself — and writes *"amp draw was on the low side; continue to
monitor."* That failure is the whole reason the rest of this exists.

`npm test` runs the full suite (60 tests, also offline). The tests import only Node built-ins and the
prototype's own modules, so they also run before `npm install`. An `ANTHROPIC_API_KEY` is optional,
and only needed to regenerate the recorded responses live.

| | |
|---|---|
| **[CASE-STUDY.md](CASE-STUDY.md)** | The argument. Problem, approach, solution, results, limitations, ethics. Start here if you are reading rather than running. |
| **[prompts/](prompts/00-INDEX.md)** | 15 documented prompts — 7 harvested from the production system, 8 designed. Each with its technique, its failure modes, and what is wrong with it. |
| **[prototype/](prototype/README.md)** | A runnable reduction of the pipeline. 60 tests, one dependency, runs offline. |
| **[BLOG-POST.md](BLOG-POST.md)** | The same story for a general and trade audience. Draft, unpublished. |
| **[PROVENANCE.md](PROVENANCE.md)** | What here is re-implemented, quoted, captured, or measured privately, what a reader can check, and the dated status of every reported product fix. |

**If you have ten minutes:** case study §3.4 (deterministic fact injection — the core technique),
§6.2 (the regulated word, the experiment, and the fix), and §5 (limitations — where the system is
genuinely weak).

---

## The architecture

```
   technician's field measurements (mobile app)
                    |
                    v
        +-----------------------+
        |   fetch + authorize   |  maintenance event, property, org, full visit history
        +-----------+-----------+
                    |
        +-----------+--------------------------------------------+
        |                                                        |
        v                                                        v
  DETERMINISTIC LAYER (plain JavaScript, no model)     RETRIEVAL (866 chunks, 6 domains)
  - health score, trends, solids analysis              1.   filter by vendor / model / category
  - amp draw / nameplate FLA -> 7-tier severity        1.5  unknown vendor -> generic guidance
  - classify solids %, filter dP, DO, liquid level          (so the model is never tempted to guess)
  - cross-component correlation -> root cause          2.   semantic search, only if budget remains
  - missing fields -> NOT MEASURED / NOT APPLICABLE
                      / NO DATA
        |                                                        |
        +-----------------------+--------------------------------+
                                v
                    +-----------------------+
                    |    prompt assembly    |
                    +-----------------------+
   SYSTEM (cached)   persona - OBSERVE/CORRELATE/DIAGNOSE/RECOMMEND - confidence ladder
                     terminology prohibition - one style-matched exemplar
   USER              >> authoritative conclusions FIRST ("do NOT recompute")
                     >> the raw measurements second
                                |
                                v
                    +-----------------------+
                    |   claude-haiku-4-5    |--fail--> gpt-4.1-mini --fail--> deterministic
                    +-----------+-----------+                                  template
                                |                                     (a contractor can always
                                v                                      produce a record)
                    +-----------------------+
                    |       validate        |  prohibited sections - terminology (blocking)
                    +-----------+-----------+  hallucinated brands - component coverage
                                |
                                v
                    +-----------------------+
                    |      PDF render       |  certification block, registration number, stamp,
                    +-----------------------+  photos, score table -- rendered from verified data,
                                               NEVER generated by the model
```

Two things in that diagram carry most of the argument. **The deterministic conclusions are placed
before the raw data in the prompt**, so the authoritative judgement is established before the model
sees the numbers it might otherwise re-derive. And **the regulated content is never within the
model's reach at all** — the certification block, the registration number and the stamp are rendered
by the PDF layer from verified profile data, and the model is explicitly forbidden to write them.

---

## What is actually measured here

An architecture argument that cannot be run is an opinion, so the claims that matter were executed,
not just traced:

- **The regulated-word experiment.** The strongest constraint in this domain is that the work must be
  described as *maintenance*, never an *inspection* — an inspection is a distinct service with its
  own scope, standards and deliverables, and calling a maintenance visit one misdescribes the service
  performed, regardless of which endorsements the signer holds ([SOURCES.md](SOURCES.md) sets out
  this practitioner rule and its limits). The production system's own few-shot exemplar contained the
  sentence *"Your inspection revealed elevated scum levels…"*, in homeowner-facing prose. Four prompt
  conditions, n=12 each: with a clean exemplar the model **never** claimed the visit was an
  inspection; with the poisoned one it did so in **half of all runs**, twice reproducing the
  exemplar's own sentence almost verbatim. **A few-shot exemplar is imitated, not merely read.**
  All 48 raw model outputs are committed so the result can be re-scored rather than believed.
- **Prompt composition**, re-derived by importing the production `buildReportPrompt` itself. That
  needs a checkout of the private product, so for a reader of this repository it is a reported
  measurement rather than a reproducible one.
- **Test counts, coverage, knowledge-base size** — with the command that produced each, run against
  the private product.

And what is *not* measured is stated plainly: there is no eval set, no hallucination rate, no
latency or cost figure for production. The system logs those and throws them away. No number in this
repository is invented, and where one could not be honestly obtained, it is not reported.

## The defects

**The author reports that they were fixed before this was published** (SepticScribe `c391dc5` and
`276cf32`, 2026-07-14; `b2f9ef2`, 2026-07-15): the property address, land-title parcel ID and
technician name were being sent to the model provider on every report, though the document
re-composes them locally and never needed them — the product is pre-beta, so no real person's data
was ever in that payload, but shipping it would have made it customer PII on day one; the regulated
word was in the few-shot exemplar with nothing downstream to catch it; a deterministic guardrail was
silently dead on the exact system it was written for; an authoritative prompt block cited a standard
it does not come from, in the wrong jurisdiction; and a dissolved-oxygen threshold was labelled
*regulatory* although no BC regulation sets one. Those commits are in the private product, so each
fix is a dated report rather than something this repository can demonstrate;
[PROVENANCE.md](PROVENANCE.md) keeps the status of each.

Publishing a live compliance defect in a product built for contractors to sign their registration
number against would have been the same mistake this document is about.

A case study whose subject has no flaws is marketing.

---

## Notes

- **No customer data appears anywhere in this repository.** Every example runs on a synthetic record.
  No property, person, business, or credential number here is real. SepticScribe itself is a private
  repository and is not included.
- The **maintenance-vs-inspection rule** at the centre of this project is practitioner knowledge —
  the author has worked in the septic industry, and it comes from doing the work and from
  conversations with inspectors, maintenance providers, and WACOWMA representatives. It is informed
  industry practice, stated as such rather than dressed up as a citation. See
  [CASE-STUDY.md §2.3](CASE-STUDY.md).
- **Every regulatory figure used here is checked against a primary source**, with URL and access date,
  in [SOURCES.md](SOURCES.md) — BC Reg 326/2004, the Standard Practice Manual V3, ASTTBC. Those
  sources were read on 2026-07-14 and have not been re-checked since; nothing here claims they are
  current. One figure failed that check: the product labelled a dissolved-oxygen reading below
  2.0 mg/L `BELOW REGULATORY MINIMUM`, and **no BC regulation sets a dissolved-oxygen minimum**
  (CASE-STUDY.md §5.10). It was disclosed here as an open defect on 2026-07-14, and the author reported
  it fixed in the product on 2026-07-15 (`b2f9ef2`). What this repository shows directly is narrower:
  the prototype emits `BELOW OPERATIONAL THRESHOLD` instead, and the audit-time transcripts keep the
  original wording on purpose. The *numeric* regulatory figures the product itself relies on come from
  an unsourced domain corpus — that is one of the audit's findings, and it is not the basis for the
  rule above. **Nothing here is legal advice.**
- MIT licensed. The prototype is a teaching artifact, not a product.
