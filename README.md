# AI-Assisted Maintenance Reporting in the Septic Industry

**A case study in constraining a language model inside a document that carries legal weight.**

A septic maintenance report is signed by a registered practitioner, handed to a homeowner, read by a
health authority during an audit, and used to support a public rebate claim. The tolerance for a
confident, fluent, wrong sentence is approximately zero.

This repository documents the AI report-generation pipeline in **SepticScribe**, a production
maintenance application used by onsite-wastewater contractors in British Columbia — and argues one
idea:

> **The model may never be the source of a claim that carries legal or financial weight.**
> Arithmetic, threshold classification, severity, and every regulated identifier are computed
> deterministically and handed to the model as facts it is forbidden to re-derive. The model narrates.
> It does not conclude.

The interesting engineering is not the language model. It is the deterministic layer built around it,
and the deliberate decision to demote the model from *reasoner* to *writer*.

---

## Why this exists

This is **Portfolio Project #3** of a structured prompt-engineering retraining program — a career
transition following an injury. The brief: design a set of domain-specific prompts, build a prototype
demonstrating one key use case, and write it up honestly — problem, approach, solution, results,
limitations, ethics.

Most portfolio pieces of this kind are built on a toy. This one is not. **SepticScribe is a real
commercial product** — a working system built for a regulated trade — and the pipeline described here
is the one it ships. It is **pre-beta and has no customers yet**, which is worth saying plainly for
two reasons: it means none of the defects below harmed anyone, and it means that is a fact about
timing rather than a defence. The code path was live and the defects were real. Two consequences
worth stating up front:

- **The constraints are real.** The regulatory boundary at the centre of the ethics section is not a
  hypothetical. Getting it wrong misrepresents an uncertified service in a document signed with a
  practitioner's registration number.
- **The defects are real, and they are reported.** The audit behind this repository found several,
  including one that undermined the exact compliance rule the case study argues is most important.
  They were fixed in the product *before* any of this was written down.

SepticScribe's own source is private and is **not** included here. Nothing was copied out of it; the
prototype is an independent reduction, and the one script that measures the production prompt imports
it from a local checkout rather than vendoring it.

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

`npm test` runs the full suite (60 tests, also offline). An `ANTHROPIC_API_KEY` is optional, and only
needed to regenerate the recorded responses live.

| | |
|---|---|
| **[CASE-STUDY.md](CASE-STUDY.md)** | The argument. Problem, approach, solution, results, limitations, ethics. Start here if you are reading rather than running. |
| **[prompts/](prompts/00-INDEX.md)** | 15 documented prompts — 9 harvested from the production system, 6 designed. Each with its technique, its failure modes, and what is wrong with it. |
| **[prototype/](prototype/README.md)** | A runnable reduction of the pipeline. 60 tests, one dependency, runs offline. |
| **[BLOG-POST.md](BLOG-POST.md)** | The same story for a general and trade audience. Draft, unpublished. |

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
  described as *maintenance*, never an *inspection* — the latter is a separately-certified scope of
  practice the technician does not hold. The production system's own few-shot exemplar contained the
  sentence *"Your inspection revealed elevated scum levels…"*, in homeowner-facing prose. Four prompt
  conditions, n=12 each: with a clean exemplar the model **never** claimed the visit was an
  inspection; with the poisoned one it did so in **half of all runs**, twice reproducing the
  exemplar's own sentence almost verbatim. **A few-shot exemplar is imitated, not merely read.**
  All 48 raw model outputs are committed so the result can be re-scored rather than believed.
- **Prompt composition**, re-derived by importing the production `buildReportPrompt` itself.
- **Test counts, coverage, knowledge-base size** — with the command that produced each.

And what is *not* measured is stated plainly: there is no eval set, no hallucination rate, no
latency or cost figure for production. The system logs those and throws them away. No number in this
repository is invented, and where one could not be honestly obtained, it is not reported.

## The defects

**They were fixed before this was published** (SepticScribe `c391dc5` and `276cf32`): the property
address, land-title parcel ID and technician name were being sent to the model provider on every
report, though the document re-composes them locally and never needed them — the product is pre-beta,
so no real person's data was ever in that payload, but shipping it would have made it customer PII on
day one; the regulated word was in the few-shot exemplar with nothing downstream to catch it; a deterministic guardrail was silently dead on the exact system it was
written for; and an authoritative prompt block cited a standard it does not come from, in the wrong
jurisdiction.

Publishing a live compliance defect in a product that real contractors sign their registration number
against would have been the same mistake this document is about.

A case study whose subject has no flaws is marketing.

---

## Notes

- **No customer data appears anywhere in this repository.** Every example runs on a synthetic record.
  No property, person, business, or credential number here is real. SepticScribe itself is a private
  repository and is not included.
- The **maintenance-vs-inspection rule** at the centre of this project is practitioner knowledge —
  the author works in the septic industry. It is informed industry practice, not a reading of a
  statute. The *numeric* regulatory figures the product relies on come from its own domain corpus,
  which is unsourced — that is one of the audit's findings, not the basis for the rule. See
  [CASE-STUDY.md §2.3](CASE-STUDY.md). **Nothing here is legal advice.**
- MIT licensed. The prototype is a teaching artifact, not a product.
