# Deterministic-fact injection as a hallucination guardrail

A standalone, runnable prototype of one technique from a production AI reporting
pipeline: **take every judgement that carries consequence away from the language
model, compute it in ordinary code, and hand the model the conclusions as facts
it is forbidden to relitigate.** The model's remaining job is prose.

It generates septic-system **maintenance reports** from structured field data.
It runs on synthetic data, with no backend, no database, and no customer
information of any kind. With no API key it replays real recorded model
responses, so you can see the whole thing work in about five seconds for free.

```bash
npm install
npm run demo
```

---

## The idea in thirty seconds

The interesting failure mode of an LLM in a regulated document is not that it
invents facts. It is that **it reassures you.**

A septic pump drawing 1.6 A against a 7.2 A nameplate is a motor running dry and
destroying itself. Every other reading on that visit is fine. Asked to write a
"professional maintenance report," the model looks at one alarming number
surrounded by healthy ones, and averages. Here is what Claude Haiku 4.5 actually
wrote when we handed it the raw measurements and let it do its own analysis:

> | Effluent Pump (0.5 hp, 115V) | **Good** | Amp draw 1.6A (nameplate 7.2A); **normal operating range** |
>
> This low amp draw relative to nameplate capacity is **normal for a lightly
> loaded system** and indicates the pump is **operating efficiently without
> strain.**

"Operating efficiently without strain" is a confident, fluent, entirely invented
reassurance about a motor that is cooking itself. The word `CRITICAL` appears
nowhere in that report. A technician skimming that table signs off on it.

Now compute the ratio in JavaScript, classify it against the manufacturer's
nameplate on a 7-tier scale, and inject the result as an authoritative fact.
Same model, same data, same temperature:

> This maintenance visit identified a **critical problem** with the effluent
> pump. The pump is running but drawing only **22.2% of its nameplate amperage,
> indicating no hydraulic load.** This is a **failure condition requiring
> immediate professional attention.** All other system components are in good
> condition.

The arithmetic was never the hard part. The *judgement* was. So we moved the
judgement out of the model.

---

## Run it

```bash
npm install

npm run demo                                   # the headline comparison, offline
node src/index.js list                         # the three synthetic visits
node src/index.js guardrails --visit dry-running-pump   # the deterministic layer alone (free, no network)
node src/index.js compare --visit treatment-degradation --offline
npm test                                       # 60 tests
```

Everything above runs with **no API key and no network**. Recorded responses live
in `fixtures/replay/`.

With an `ANTHROPIC_API_KEY` set, the same commands call
`claude-haiku-4-5` live (the model SepticScribe runs in production), and:

```bash
node src/index.js run --visit dry-running-pump --record   # re-record a fixture
node src/index.js tokens                                  # measure the prompt against the cache floor
node src/experiment.js --trials 12                        # the terminology experiment (~US$0.50)
node src/rescore.js --audit                               # re-score the stored outputs, free
```

Generating one report **with this prototype** costs roughly **US$0.01** at
`claude-haiku-4-5` list pricing, computed from the real token counts in the
fixtures. That is the prototype's cost on a small synthetic visit — it excludes the
OpenAI fallback path, the embedding calls and production's RAG payload, so it is
**not** SepticScribe's cost per report, which is not measured anywhere.

---

## What to look for

Three synthetic visits, each targeting a different way the model fails.

| Visit | The trap | What the guardrail does |
|---|---|---|
| `dry-running-pump` | One critical reading inside an otherwise healthy system. The model averages it away. | Classifies 22.2% FLA as `CRITICAL - No Load` and forbids softening it. |
| `treatment-degradation` | Four symptoms across four components. The model reports four unrelated problems and blames field ponding on soil age. | Correlates them: the blower is failing, and everything downstream is a *consequence*. |
| `partial-data` | Sludge was never measured, and the pump has no nameplate on file. Enough data to *tempt* a calculation. | Refuses to compute, out loud, and forbids the model from supplying the missing judgement. |

Run `compare` on each. In every case the report generated **without** the
deterministic layer fails a mechanical check of the very findings it was
reporting on; the report generated **with** it passes.

The `partial-data` case is the subtlest and the best. Unprompted, the model got
most of it right — it refused to compute solids, it flagged the missing
nameplate. And then it wrote this:

> Nameplate full-load amps for this pump are not recorded in the equipment file...
> **The reading of 3.1 A is within the typical range for a 0.5 horsepower
> 115-volt pump**, but without nameplate data, this assessment is indicative only.

It acknowledged the gap and then filled it anyway. There is nothing to compare
3.1 A against; "typical range" is invented. The guarded run says only *"cannot be
classified against severity standards"* and stops. Acknowledging a gap does not
license filling it — so the validator now checks both.

---

## Measured results

Everything in this section was produced by running the code. Nothing is
estimated. Nothing is illustrative.

### A poisoned few-shot example puts the regulated word into homeowner-facing prose

The strongest ethics constraint in this domain (see below) is that the work must
be called **maintenance**, never an **inspection**.

**What counts as a violation matters enormously here, and the first version of
this experiment got it wrong.** The violation is *asserting that the regulated
act occurred* — "your inspection revealed…", "components inspected during this
visit". It is **not** a violation for the model to recommend future work with the
ordinary English verb — "the pump must be inspected by a technician" claims
nothing about what this visit was. The first classifier counted those repair
recommendations as regulatory violations and reported a leak rate roughly seven
times the real one. The instrument has to measure the claim you are actually
making; a number that looks earned and isn't is worse than no number at all. That
mistake is preserved in the git history rather than quietly deleted, and it is the
same class of bug as the production defects catalogued below.

`claude-haiku-4-5`, temperature 0.3, n=12 per condition, one synthetic visit
(`dry-running-pump`). **Every one of the 48 raw model outputs is committed to
`fixtures/experiment-raw/`**, and every occurrence of the word in all 48 was then
read and classified by hand — so this table can be audited, and re-scored against
a different definition, without paying to re-run it (`node src/rescore.js --audit`).

| Configuration | Asserts an inspection occurred | Recommends a future inspection |
|---|---|---|
| Positive framing only, clean example | **0 / 12 (0%)** | 12 / 12 |
| Positive framing only, **contaminated** example | **6 / 12 (50%)** | 12 / 12 |
| Explicit prohibition, contaminated example | **0 / 12 (0%)** | 0 / 12 |
| Explicit prohibition, clean example | **0 / 12 (0%)** | 0 / 12 |

Three things fall out, and the honest version is more interesting than the first
one I published:

1. **The contaminated example IS the root cause.** With a clean few-shot, the
   model never once claimed the visit was an inspection. Poison a single sentence
   of the example and it does so in half of all runs. And the phrasing it produces
   is the tell: two of the six reproduce the poisoned exemplar's own sentence —
   *"Your inspection revealed solids at 22.9 percent…"* — near-verbatim, in the
   homeowner-facing section. **A few-shot exemplar is imitated, not merely read.**
   That is the entire thesis of this project, demonstrated on the system's own
   production exemplar, which contained exactly that sentence.

2. **An explicit negative constraint plus a mechanical output gate takes it to
   zero** — 0/24 across both exemplars, including the deliberately poisoned one.

3. **But the prohibition is blunter than it was designed to be, and this is a real
   cost.** The advisory tier — the carve-out this validator spends a whole section
   justifying, so that legitimate recommendations survive — **never fires in the
   shipped configuration**. Under the rule, the model's use of the inspect-verb
   drops from 12/12 trials to 0/24: it stops using the word *entirely*, including
   in the forward-looking recommendations the gate was carefully built to permit.
   Spot-checking the guarded outputs, it substitutes cleanly — *"a qualified
   technician must **examine** the pump impeller, discharge line, and inlet
   connections… and **assess** whether repair or replacement is necessary"* — so
   the recommendations do not read worse for it. But the design intent and the
   measured behaviour are not the same thing, and a guardrail must be reported for
   what it actually does, not what it was meant to do. That is the whole argument
   of this project, and it applies to my own fix as much as to the production bugs.

**Scope, stated inline rather than in a footnote:** one synthetic visit, one
model, one temperature, n=12 per condition. This is a mechanism demonstration, not
an efficacy guarantee.

### Prompt caching on this system is a no-op, silently

`node src/index.js tokens`, using Anthropic's real tokenizer:

```
system prompt (cacheable):   2105 tokens
full request:                3134 tokens
system prompt share:         67.2% of all input tokens

Haiku 4.5 min cacheable prefix: 4096 tokens
BELOW THE FLOOR by 1991 tokens -- caching SILENTLY does nothing.
```

The `cache_control: {type: 'ephemeral'}` marker is present and correct, and it
does nothing at all, because the cached prefix never reaches Haiku 4.5's
4,096-token minimum. No error is raised. `cache_creation_input_tokens` comes back
`0` forever. Confirmed empirically: across all six recorded fixtures,
`cacheReadInputTokens` is `0` every time.

This is worth stating plainly because it is the exact shape of the bug this whole
project is about — **a control that appears to be working, reports nothing wrong,
and is inert.**

### Latency and tokens

Real, from the six recorded fixtures (`fixtures/replay/*.json`):
input 2,853–3,576 tokens, output 735–1,765 tokens, latency 6.3–18.5 s per report.
Roughly **US$0.01 per report** at Haiku 4.5 list pricing. These are measurements
of *this prototype* on *these three fixtures*, not of production: they exclude the
OpenAI fallback path, the embedding calls, and production's much larger RAG payload.
SepticScribe's real per-report cost and latency are **not measured anywhere** — the
token counts are logged and discarded, and the `report_logs` table has no INSERT.

---

## How it works

```
visit JSON
    │
    ├─► guardrails.js ──► deterministic facts (JavaScript, no model)
    │                       • amp draw vs nameplate FLA, 7-tier scale (own heuristic)
    │                       • solids %, filter differential, dissolved oxygen
    │                       • cross-component root-cause correlation
    │                       • explicit REFUSALS where data is missing
    │
    ├─► prompt.js ────► system prompt  (stable, cacheable, terminology constraint)
    │                   user prompt    (guardrails FIRST, then raw data)
    │
    ├─► client.js ────► claude-haiku-4-5   ── or replay a recorded response
    │
    └─► validate.js ──► BLOCKING checks against the deterministic ground truth
```

Two structural choices are load-bearing:

**Guardrails go before the data.** The authoritative conclusions are established
in the prompt before the model ever sees the numbers it might otherwise re-derive.

**The validator judges against ground truth, not against what the model was
told.** The deterministic facts are true regardless of whether we injected them.
That is what makes the `--no-guardrails` ablation meaningful rather than
circular — the unguarded report is measured against the same reality.

### What the validator blocks

| Check | Catches |
|---|---|
| `SEVERITY_DROPPED` | The deterministic layer computed `CRITICAL`; the prose never says it. **The reassurance failure.** |
| `REFUSAL_OVERRIDDEN` | We declined to classify; the model classified anyway. |
| `REFUSAL_IGNORED` | A missing measurement is never acknowledged, so it reads as normal. |
| `TERMINOLOGY` | The report asserts an "inspection" occurred. |
| `PROHIBITED_SECTION` | The model wrote a CERTIFICATION block — content that carries a professional's registration number. |
| `HALLUCINATED_BRAND` | A manufacturer appears in the report but nowhere in the source data. |

An error **blocks**: the report is never returned. (Production's equivalent is
explicitly log-only and ships the report anyway — see below.)

---

## The terminology constraint, and why it is the ethics core

In British Columbia, **maintenance** and **inspection** name two different services.
Maintenance is the ongoing servicing of a system. An *inspection* is an assessment
of an existing system's performance — the thing that backs a property transaction or
a compliance verification — delivered to its own standard, with its own deliverables.
The contractor using this system performs maintenance.

> **Where this claim comes from, and it is the strength of this project rather than
> its weak point.** The boundary is **practitioner knowledge**. I work in this
> industry; it comes from doing the work and from conversations with inspectors,
> maintenance providers, and WACOWMA representatives. It is first-hand industry
> practice, stated as such rather than dressed up as a citation to a regulation it is
> not. It is **not legal advice**.
>
> **One thing an earlier draft got wrong, corrected here.** ASTTBC's registration
> categories are distinct — but since Practice Bulletin **#PPB-2023-OW-001**
> (15 Feb 2023) a ROWP with the *Maintenance Provider* endorsement **may** conduct
> private inspections without separately holding the *Private Inspector* endorsement.
> The earlier draft asserted the pre-2023 position as current. **The rule survives
> that reversal untouched:** the bulletin changed *who may perform an inspection*; it
> did not turn a maintenance visit into one.
>
> **The numeric regulatory figures in this repo have been checked against primary
> sources** — see [`../SOURCES.md`](../SOURCES.md) (BC Reg 326/2004; Standard Practice
> Manual V3; ASTTBC), with URLs and access dates. One failed the check: the
> **2.0 mg/L dissolved-oxygen "regulatory minimum"** is not in any BC regulation or
> standard. It is an operational threshold from SepticScribe's own unsourced corpus
> (`sourceUrl: null`), and the word REGULATORY in that output is a defect — still live
> in the product, disclosed in CASE-STUDY.md §5.10. **This prototype emits
> `BELOW OPERATIONAL THRESHOLD` instead** (`src/guardrails.js`), which is what the
> product should say. That the product's regulatory ground truth is unsourced is one
> of this project's real findings — a finding about the *pipeline*, not about the
> origin of the rule above.

So "inspection" is not a style preference. It is a term of art naming a different
service. A report saying *"your inspection revealed..."* asserts — under that
technician's name and registration number — that a service was performed which was
not performed, regardless of which endorsements the signer holds. The people harmed
are, in order: the contractor whose registration is exposed, and the homeowner or
buyer who relies on a document that was never what it appeared to be.

Three things enforce it here, because any one alone is insufficient:

1. An explicit **negative** constraint in the system prompt (not just positive framing).
2. A clean few-shot exemplar.
3. A **blocking** output gate.

**Getting the gate right is harder than it looks, and I got it wrong first.** The
naive version is `grep -i inspect`, and it immediately blocked a perfectly good
report over *"a qualified technician must **inspect** the pump discharge line"* — a
forward-looking recommendation using the ordinary English verb. A gate that
over-blocks gets switched off, and a gate that is switched off enforces nothing.

So the check is two-tier: text asserting the regulated act occurred (the **nouns**,
and the past participle used attributively — *"components inspected during this
visit"*) **blocks**; a **forward-looking recommendation** — including the passive
*"must be inspected"* and the causative *"have this inspected"* — is **advisory**;
and `"inspection port"`, a physical opening in the tank, is allowed.

The second tier is where the first version failed. It blocked *every* past
participle, which swept up the passive-voice recommendations — semantically
identical to the advisory carve-out, just not in the active voice. That inflated the
measured leak rate by roughly 7x. **Deciding whether a given "inspected" asserts or
advises is a clause-level judgement, and the classifier is a heuristic over English,
not a parser.** It is deliberately conservative: it blocks the noun unconditionally,
so it also blocks *"the pump needs immediate inspection"* — a legitimate future
recommendation. Measured cost of that conservatism: 1/12 and 1/12 of the unguarded
trials over-blocked, where the corrective regeneration simply rewords them. That is
the right trade for a blocking control, but it is a trade, and the numbers for it are
in `fixtures/experiment-terminology.json` alongside everything else.

This is why the raw outputs are committed. The honest position is not "the gate is
correct" — it is "here is every output, here is how I classified it, and here is the
script that lets you disagree."

---

## Honest limitations

Read this section before believing anything above.

- **This is not an evaluation.** There is no eval set, no golden outputs, no
  scored benchmark. The comparison is three visits and a validator I wrote
  myself. It demonstrates a *mechanism*; it does not measure an *effect size*.
  I have not claimed a hallucination-reduction percentage anywhere, because I
  have not earned one.
- **The terminology measurement (0% clean / 50% poisoned) is measured on this
  prototype**, on one visit, one model, n=12 per condition, at temperature 0.3 — a
  faithful reconstruction of production's prompt configuration, not production
  itself. It is strong evidence that the defect was real and frequent. It is **not**
  a production incidence rate.
- **An earlier version of this README reported 58–67%, and it was wrong.** The
  classifier counted forward-looking repair recommendations ("the pump must be
  inspected by a technician") as regulatory violations. The corrected figures are
  above; the raw outputs are committed so the correction can be checked rather than
  taken on trust. I am leaving this in the limitations section deliberately: the
  project's own thesis is that a control which looks like it works and is quietly
  measuring the wrong thing is the most dangerous kind, and I shipped one.
- **The validator can be satisfied without the report being good.** It checks that
  a severity word survived into the prose. A model could carry the word and still
  write a bad report around it. Mechanical checks bound the failure; they do not
  guarantee quality.
- **Three hand-written correlation rules do not scale.** The cross-component
  diagnostics are a demonstration of the pattern, not a rules engine.
- **The human approval gate is the real backstop, and nothing here measures
  whether it is real.** The report is fluent, structured, confident and instant.
  A tired technician at 6pm approves it because it reads right — and their
  registration number goes on it. Liability transfers to the human; the reasoning
  did not. Approval latency, correction rate and edit distance are all unmeasured.
  That is the honest answer to "what would you build next."

---

## Defects this prototype found in the production system — and what happened to them

The prototype is a faithful port of SepticScribe's technique, deliberately diverging
where production was wrong. Each defect was verified in the source, and **defects 1,
2 and 4 have since been fixed in SepticScribe itself** (commit `c391dc5`,
2026-07-14). The prototype was the reference implementation for those fixes: it is
where the redaction step and the two-tier gate were designed and tested before they
were ported into the product.

| # | In production | Here | Status upstream |
|---|---|---|---|
| 1 | The terminology rule was enforced on UI copy and the PDF template, but **not in the generative path**. No negative constraint, no output check, and `Backend/exemplars/comprehensive.txt:219` contained, in homeowner-facing prose, *"Your inspection revealed elevated scum levels..."* — inside the few-shot the model is told to imitate. | Explicit prohibition + blocking gate + clean exemplar. 0/24 assertions measured. | **Fixed** in `c391dc5`: exemplars scrubbed, negative constraint added, blocking two-tier gate, CI gate over exemplars + prompt literals. |
| 2 | `validateReportOutput()` was explicitly *"Phase 1: log-only, non-blocking."* Errors were logged and **the report shipped anyway.** | Errors block. | **Fixed** for terminology in `c391dc5`: a violation triggers one corrective regeneration, then degrades to the deterministic template, which cannot produce the word at all. Other checks remain log-only. |
| 3 | Solids thresholds are defined in **three places that disagree** (25% vs 33%). At 28% solids the model receives an authoritative "monitor" and a guideline saying "pump". | One `THRESHOLDS` constant, read by both the classifier and the prompt text. | **Open.** Reported, not yet fixed. |
| 4 | Customer **property address, BC land-title parcel ID, and technician name were transmitted to the model** on every generation — and were never needed, since the document re-composes them locally. | Stripped before the prompt is built. Enforced by `test/privacy.test.js`. | **Fixed** in `c391dc5`: `preprocessReportData` strips the identity fields; the PROPERTY INFORMATION block is now composed deterministically from the local record, exactly as the certification block already was. Pinned by a test asserting no identity value can appear in any built prompt. |
| 5 | The guardrails were **silently dead on real data** until 2026-06-16: findings are stored prefixed (`septic_tank_0_scum_inches`), the classifiers read bare ids, so they matched nothing and returned `''`. The prompt section vanished with no error and the model went back to doing the arithmetic itself. | `getFinding()` handles both shapes, and a regression test pins it. | Fixed upstream 2026-06-16 (`9cf8686`), before this project. |

Defect #5 is the one worth carrying into the case study, because it is the
lesson: **a guardrail that fails open is worse than no guardrail**, since it
manufactures confidence. It was well-designed, well-documented, prominently
labelled AUTHORITATIVE — and it returned an empty string.

I reproduced that class of bug *twice while building this*, and left both fixed
with regression tests (`test/guardrails.test.js`, the two `REGRESSION:` cases):
once by scanning prompt prose for severity words and matching the boilerplate
instead of a real classification, and once by requiring the literal words
`"PARTIAL DATA"` in prose, which blocked a *correct* report. Both times the check
reported something it had not actually computed. It is an easy mistake, and it is
invisible.

---

## Privacy

SepticScribe is **pre-beta and has no customers**, so there is no customer data to leak. Everything
here is synthetic regardless, and would be either way.

- All three visits are invented. Streets are fictional, the towns are real, no
  person is named, phone/email formats use reserved fiction blocks.
- Parcel IDs use a `000-` sentinel that **cannot** collide with a real BC
  land-title PID.
- **No R.O.W.P. registration number appears anywhere.** Publishing a sample report
  displaying one would *assert a certification* — the exact misrepresentation this
  project is about.
- Identity fields never reach the model at all (`redactForModel`).
- `test/privacy.test.js` enforces all of the above, including a tripwire scan.

---

## Layout

```
src/guardrails.js    deterministic classifiers + refusals   (the technique)
src/prompt.js        system/user split, terminology constraint, PII redaction
src/validate.js      blocking output checks                 (the enforcement)
src/client.js        Claude Haiku 4.5 + prompt caching + replay
src/experiment.js    the terminology leak measurement
src/index.js         CLI

fixtures/visits/     3 synthetic visits
fixtures/replay/     6 REAL captured model responses (never hand-written)
fixtures/experiment-terminology.json   measured leak rates

test/                60 tests
```

Every file in `fixtures/replay/` records the model that produced it, when, its
real token usage and its real latency. None of the model output quoted in this
README was written by me — including, especially, the bad output.

**One provenance note, because a captured fixture cannot be retro-edited without
becoming a fake.** All fixtures in `fixtures/replay/` and `fixtures/experiment-raw/`
were captured on 2026-07-14, *before* the dissolved-oxygen relabel described above
(`REGULATORY MINIMUM` → `OPERATIONAL THRESHOLD`). Some of them therefore contain
model prose carrying the old, wrong word — because that is what the model was handed
at the time. They are left exactly as captured. Re-running would draw a fresh sample
and destroy the hand-verification the published terminology numbers rest on, and the
relabel touches one line of MEASUREMENT GUIDELINES and no terminology text. **A
transcript is evidence; edited to look better, it is nothing.**
