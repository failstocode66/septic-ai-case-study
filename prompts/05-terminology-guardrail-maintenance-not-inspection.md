# 05 — The terminology guardrail: maintenance, never "inspection"

| | |
|---|---|
| **Origin** | **NEWLY DESIGNED for this case study — and it fixed a real defect in production.** Shipped in SepticScribe commit `c391dc5` (2026-07-14): this prompt block, the two-tier output gate, and the CI gate below are now the production controls. |
| **Serves** | The contractor, whose professional registration is what an overclaim actually puts at risk. Downstream: the homeowner or buyer who may rely on the document. |
| **Status in production** | **As audited (`a37c4d9`):** enforced in hand-written UI copy and the PDF wrapper, but **not in the AI generation path** — and the few-shot exemplar the model is told to imitate contained the violation. **Now (`c391dc5`):** negative constraint in the prompt, blocking two-tier output check, clean exemplars, CI gate. Everything below describes the defect as found, then the fix. |

---

## 1. Use case — and why this is not a style preference

In British Columbia, onsite wastewater systems are governed by the **Sewerage System Regulation**
under the Public Health Act, and only an **Authorized Person** may file records. For a
non-engineer, that means a **Registered Onsite Wastewater Practitioner (R.O.W.P.)**, registered
through ASTTBC — and R.O.W.P. registration is **divided into separate specialization categories with
distinct scopes of practice**, each with its own supervised-experience requirement and its own
registration. Two of them matter here:

| Endorsement | Scope |
|---|---|
| **Maintenance Provider** | Ongoing system maintenance, monitoring, and reporting. **This is the SepticScribe user.** |
| **Private Inspector** | Assessment of existing systems for **property transactions and compliance verification**. |

A practitioner holding the Maintenance Provider endorsement is **not** thereby authorized to
practise as a Private Inspector.

So "inspection" is not a more official-sounding synonym for "maintenance". **It is a term of art
naming a regulated scope of practice that the person signing the document does not hold.**

### What actually goes wrong

A generated report that says *"Your inspection revealed elevated scum levels"* is not a wording
infelicity. It is a document, carrying a technician's name and R.O.W.P. number, asserting that a
regulated act was performed under a certification they do not have.

1. **It misrepresents an uncertified service** — a misrepresentation by the practitioner, of the
   practitioner's own scope of practice, in their own name.
2. **It exposes the practitioner's registration.** Registration can be suspended or revoked for
   Code of Ethics violations. The first person harmed by this bug is the paying customer.
3. **It creates false reliance — this is the real harm vector.** A Private Inspector's *inspection*
   is what backs **property transactions**. A homeowner, a buyer, or a lender reading "your
   inspection revealed…" may reasonably rely on the document as a real-estate or compliance
   inspection. It is not one, and it never claimed not to be. Someone buys a house on the strength
   of a record that was never what it appeared to be.
4. **It corrupts a public-funds claim.** The regional maintenance rebate program funds
   *maintenance* performed by a R.O.W.P. A record describing an *inspection* describes work the
   program does not fund.
5. **It taints an audit record.** These reports are read by Environmental Health Officers during
   compliance audits.

### And the model is biased *toward* the violation

This is the non-obvious part, and it is the reason a positive framing ("you are a maintenance
technician") is not sufficient.

**"Inspection" is the higher-status, higher-frequency, more authoritative-sounding word.** The
training distribution is saturated with it — home inspections, vehicle inspections, safety
inspections, building inspections. "Maintenance report" is the rarer phrase. When a model is asked
for professional, authoritative prose about someone visiting a property and looking at a system,
the gradient runs *toward* "inspection".

> **Left alone, a language model will upgrade the claim.**

Not because it is careless — because the upgraded claim is the more probable sentence. Any
compliance constraint that runs against the grain of the training distribution needs a *negative*
constraint and an *output gate*, not a hopeful positive framing.

---

## 2. The defect, in the live system

I verified this chain end to end, in source.

**(a) The rule is enforced everywhere except where it matters.**

| Layer | Evidence | Status |
|---|---|---|
| Data model | `Backend/constants/index.js`; the table is `maintenance_events` | ✅ correct |
| Mobile UI | `Mobile/src/navigation/InspectionsStack.tsx:25` — route internally named `InspectionsList`, user-visible prop `options={{ title: 'Maintenance' }}` | ✅ correct (and a perfect one-line illustration: legacy identifier inside, constraint honoured outside) |
| Mobile copy rule | `Mobile/src/Screens/ChecklistCustomizationEditorScreen.tsx:30` — code comment: *"Copy is MAINTENANCE language throughout — never 'inspection'."* | ✅ correct |
| iOS store metadata | `Mobile/app.json:20-21` — "during maintenance visits" / "to maintenance records" | ✅ fixed in a prior sweep |
| PDF container | `Backend/pdfService.js:90-92, 269` — PDF `Title: 'Septic System Maintenance Report'`; page eyebrow renders `MAINTENANCE REPORT` | ✅ correct |
| System prompt persona | `aiReportService.js:570, 582` — "Senior Septic **Maintenance** Technician… formal **maintenance** report" | ✅ positive framing only |
| **AI-generated narrative** | — | ❌ **was not enforced** — this is the gap. Now closed (`c391dc5`). |

**(b) The few-shot exemplar teaches the violation.**

- `aiReportService.js:81-84` loads `Backend/exemplars/{thin,standard,comprehensive}.txt` at module init.
- `aiReportService.js:683` appends the selected exemplar **to the end of the system prompt**, as the
  document the model is instructed to imitate.
- **`Backend/exemplars/comprehensive.txt:219`**, inside the `---BEGIN SAMPLE---` body, in the
  HOMEOWNER GUIDANCE section — i.e. in homeowner-facing prose:

  > **"Your inspection revealed elevated scum levels, which can indicate that non-biodegradable
  > materials…"**

A few-shot exemplar is the strongest stylistic signal a model receives. It is not read; it is
**imitated**.

**(c) The prompt itself uses the word.** `:599` "use threshold overrides from the **inspection
context**"; `:654` "the FIELDS NOT MEASURED… section in the **inspection data**"; `:755` "based on
current **inspection readings**… what maintenance occurred between **routine inspections**"; and
all three exemplars at line 4, "actual vendor data is provided per-inspection."

**(d) There is no negative constraint.** The prompt never says "never use the word 'inspection'."

**(e) The validator does not check for it.** `validateReportOutput()` (`:1137-1207`) checks
prohibited sections, urgency reflection, component coverage, and hallucinated manufacturers. The
word is not checked anywhere.

**(f) Validation is non-blocking anyway** (`:1131`, `:1451-1458`) — even `errors` are logged and the
report ships.

**(g) There is no CI gate.** `.github/workflows/ci.yml` runs `lint`, `mobile-route-check`,
`unit-tests`, `integration-tests`. The project *already gates route contracts and diagnostic
threshold drift* in CI — machine-enforced invariants are an established practice here. The
strongest compliance rule in the product is the one invariant left entirely to human discipline.

### The lesson, which is the case study's thesis in one line

> **The compliance sweep checked the UI and the output template. The regulated word was hiding in
> the few-shot example.**

A terminology sweep is a *traditional QA activity*: grep the source, fix the strings, ship. It is
complete for a hand-written UI. It is **structurally incomplete for a generative system**, because
in a generative system the prompt is a surface that produces customer-facing prose, and the QA
checklist does not know that. The exemplar is not code and it is not copy — it is *training-by-
example at inference time*, and nothing in a normal engineering process treats it as either.

**A compliance constraint enforced in the UI layer but not in the generative layer is not
enforced.**

---

## 3. The prompt (the fix — four layers, because one is not enough)

### Layer 1 — Negative constraint in the system prompt

Inserted immediately after the persona (`aiReportService.js:577`), *before* the exemplar can
contradict it, and written to be un-drift-able:

```text
REGULATORY TERMINOLOGY (ABSOLUTE — this overrides the style of any example you are shown):

The work documented here is MAINTENANCE, performed by a Registered Onsite Wastewater Practitioner
holding a Maintenance Provider endorsement.

In British Columbia, "inspection" names a DIFFERENT and SEPARATELY CERTIFIED scope of practice
(Private Inspector), used for property transactions and compliance verification. The technician
signing this report does not hold that certification. Describing this visit as an "inspection"
would assert, under their name and registration, that a regulated act was performed which was not.

Therefore, in the report body you produce:

1. NEVER use the words "inspection", "inspected", "inspector", or "inspect" to describe this visit,
   the work performed, the technician, or the resulting document. This applies to every section
   including any homeowner-facing narrative.
2. USE INSTEAD: "maintenance visit", "service visit", "maintenance", "serviced", "assessed",
   "measured", "observed", "the technician", "this maintenance report".
3. NEVER state or imply that this document certifies compliance, verifies regulatory conformance,
   or is suitable for a property transaction. It is a record of maintenance performed.
4. If an EXAMPLE REPORT shown to you uses the word "inspection", that example is DEFECTIVE in that
   respect. Imitate its structure and tone; do NOT imitate that word.

The single permitted exception is the industry component name "inspection port" (the physical
access port in the tank lid). That is a noun naming a piece of hardware, not a description of the
service performed.

Rewrite examples:
  WRONG: "Your inspection revealed elevated scum levels."
  RIGHT: "This maintenance visit found elevated scum levels."
  WRONG: "During the inspection, the effluent filter was found to be dirty."
  RIGHT: "During the maintenance visit, the effluent filter was found to be dirty."
  WRONG: "The inspector noted surface ponding over the drainfield."
  RIGHT: "The technician noted surface ponding over the drainfield."
  WRONG: "This inspection confirms the system is in compliance."
  RIGHT: "This maintenance record documents the work performed and the conditions observed."
  ALLOWED: "The inspection port was accessible and the lid was intact."
```

### Layer 2 — Exemplar hygiene (the actual root cause)

The exemplars must be scrubbed. `comprehensive.txt:219` becomes:

```text
This maintenance visit found elevated scum levels, which can indicate that non-biodegradable
materials...
```

…and the header line 4 of all three exemplars — *"actual vendor data is provided per-inspection"* —
becomes *"per maintenance visit"*. Fixing the exemplar is worth more than the entire negative
constraint above, because imitation beats instruction. **Layer 1 exists to defend against exemplars
you have not yet noticed are dirty.**

### Layer 3 — A deterministic output gate (blocking)

Added to `validateReportOutput()` (`aiReportService.js:1137-1207`), and — unlike everything else in
that function today — **promoted to blocking**:

```js
// Regulatory terminology gate. "Inspection" names a separately-certified scope of practice
// (ROWP Private Inspector) that the signing technician does not hold. Emitting it in a
// customer-facing maintenance record misrepresents an uncertified service.
// This is the ONE check that blocks: an overclaim of certification is not a warning.
const TERMINOLOGY_ALLOWLIST = [/inspection\s+port/i];   // hardware, not a service
const FORBIDDEN_TERMS = /\b(inspection|inspected|inspector|inspect|inspecting)\b/gi;

function checkTerminology(markdown) {
  const violations = [];
  let m;
  while ((m = FORBIDDEN_TERMS.exec(markdown)) !== null) {
    const context = markdown.slice(Math.max(0, m.index - 40), m.index + 40);
    if (TERMINOLOGY_ALLOWLIST.some(rx => rx.test(context))) continue;
    violations.push({ term: m[0], index: m.index, context: context.replace(/\s+/g, ' ') });
  }
  return violations;
}
```

On a violation the report is **not shipped as-is**. Two acceptable behaviours, in order of
preference:

1. **Regenerate once**, appending the violation to the prompt:
   `TERMINOLOGY VIOLATION in your previous draft: you wrote "<context>". Rewrite without the word
   "inspection". This is a regulatory requirement, not a style note.`
2. If it violates again — **fall back to the deterministic non-AI template**
   (`buildFallbackReportContent`, `:1239-1305`), which is rule-generated from recorded data and
   cannot produce the word. A contractor always gets a record; it is just not an AI-written one.

Note what this costs: essentially nothing. A regex over ~8 KB of Markdown, at zero API cost. The
reason it does not exist is not expense — it is that nobody thought of the prompt as a
customer-facing surface.

### Layer 4 — A CI gate (prevents recurrence)

The bug was introduced by *editing an exemplar*, which no test covers. Add to
`.github/workflows/ci.yml`, alongside the existing `mobile-route-check` and threshold-drift gates:

```yaml
terminology-check:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - name: Regulated terminology must not appear in prompt-layer text
      run: |
        # Exemplars are imitated by the model, so they are customer-facing prose.
        # 'inspection port' is the only permitted form (a hardware noun).
        if grep -rIniE '\b(inspection|inspected|inspector)\b' Backend/exemplars/ \
             | grep -viE 'inspection[ _-]?port'; then
          echo "::error::Regulated term 'inspection' found in a few-shot exemplar."
          echo "Exemplars are imitated by the model and reach the homeowner. Use maintenance language."
          exit 1
        fi
```

---

## 4. Companion prompt — LLM-as-judge for terminology drift

The regex catches the word. It does not catch a *paraphrase of the claim*: "this visit verifies the
system meets regulatory requirements" contains no forbidden word and makes exactly the forbidden
assertion. So a second, semantic check runs as an advisory judge (see prompt 13 for the general
pattern):

```text
SYSTEM:
You are a compliance reviewer for onsite wastewater maintenance records in British Columbia.

Legal background: a "maintenance" record documents work performed by a ROWP Maintenance Provider.
An "inspection" is a separately certified scope of practice (ROWP Private Inspector) used for
property transactions and compliance verification. A maintenance record must not describe itself as
an inspection, must not claim to verify regulatory compliance, and must not present itself as
suitable for a property transaction.

You will be given a maintenance report. Identify EVERY passage that:
  (A) uses inspection/inspected/inspector to describe the visit, the work, the technician, or the
      document. ("inspection port" is a hardware component name -- NOT a violation.)
  (B) claims or implies the document certifies, verifies, or confirms regulatory compliance.
  (C) claims or implies the document is suitable for a property transaction or real-estate purpose.
  (D) implies the technician holds a certification beyond Maintenance Provider.

Quote each violating passage exactly. Do not paraphrase. Do not comment on anything else --
not tone, not formatting, not technical accuracy. If there are no violations, return an empty array.

Output JSON only:
{
  "violations": [
    { "category": "A" | "B" | "C" | "D",
      "quote": "<exact text from the report>",
      "why": "<one sentence>",
      "suggested_rewrite": "<the same sentence, corrected>" }
  ]
}

USER:
<the generated report markdown>
```

**Why category (B) matters more than (A):** (A) is a word, and a regex is strictly better than an
LLM at finding words — cheaper, deterministic, no false negatives. The judge earns its cost only on
(B), (C), (D), which are *claims*, not strings. Use the cheap deterministic check for the cheap
deterministic problem, and spend the model on the part that actually needs judgement. A judge that
duplicates a regex is theatre.

---

## 5. Techniques used

| Technique | How |
|---|---|
| **Negative constraint with a stated rationale** | The rule explains *why* (a different certification), not just *what*. A model given a reason generalises the rule to phrasings the rule-writer did not enumerate. |
| **Explicit override of the few-shot signal** | Rule 4 — *"if an example uses the word, that example is DEFECTIVE; imitate structure, not that word."* This is the unusual move. It is normally an error to ship an exemplar you have to warn the model about — but production prompts accrete, exemplars get edited by people who do not know the rule, and a prompt that assumes its own examples are clean is brittle. This is **defence in depth against your own prompt.** |
| **Contrastive rewrite pairs (WRONG/RIGHT)** | Four wrong/right pairs and one ALLOWED. Contrastive examples are far stronger than a prohibition, because the model needs a *replacement behaviour*, not just a suppressed one. Tell a model what not to say and it needs somewhere to go. |
| **Scoped exception, stated explicitly** | "inspection port" is permitted and the reason is given (a hardware noun). Without this the model either violates the rule or mangles the industry term. Every real negative constraint has an exception; enumerate it or the model will invent its own. |
| **Deterministic output gate (blocking)** | A regex is strictly better than a model at finding a word. Cheap, exact, no false negatives, zero API cost. |
| **Graceful degradation on violation** | Regenerate once → else fall back to the deterministic template. The system prefers a *plainer* record to a *non-compliant* one. |
| **CI gate on the prompt layer** | Treats the exemplar as what it is: customer-facing prose. |
| **LLM-as-judge, scoped to what only a judge can do** | Semantic overclaims only. |

---

## 6. Expected output shape

Unchanged Markdown — the guardrail's success is an *absence*:

```markdown
## HOMEOWNER GUIDANCE

### Waste Management

This maintenance visit found elevated scum levels, which can indicate that non-biodegradable
materials are entering the tank...
```

The validator's output, however, becomes structured and blocking:

```json
{
  "errors":   [{ "code": "TERMINOLOGY", "term": "inspection",
                 "context": "...Your inspection revealed elevated scum levels, which can..." }],
  "warnings": [],
  "valid":    false,
  "action":   "REGENERATE"
}
```

---

## 7. Failure modes and mitigations

| Failure mode | Mitigation | Residual risk |
|---|---|---|
| Model copies "inspection" from a dirty exemplar | Layer 2 (scrub) + Layer 1 rule 4 + Layer 3 (blocking regex) | Low once all four ship. **Today: this is happening.** |
| Model paraphrases the claim without the word ("verifies compliance") | Layer 4 judge, categories B/C/D | Moderate — a judge is not a proof. But this is genuinely beyond a regex. |
| Regex false-positive on "inspection port" | Allowlist with ±40 chars of context | Low. |
| Someone edits an exemplar next year and reintroduces it | Layer 4 CI gate | Low — this is exactly what CI is for. |
| The rule blocks a legitimate report at 6pm on a Friday | Regenerate-once, then deterministic-template fallback. A contractor is never left without a record. | Low, and the degradation is honest: the PDF footer already discloses "(template mode — AI narrative unavailable)". |
| **Rubber-stamping** — the technician approves without reading | **None of the four layers help.** See below. | **Real, unmitigated.** |

## 8. The limitation this prompt cannot fix

The report is fluent, structured, confident, and instant. A technician at 6pm approves it because
it *reads right*. The approval gate (`Pending → Approved / Corrections`) degrades into a rubber
stamp — and the technician's name and R.O.W.P. number go on it.

**Liability transfers to the human; the reasoning did not.** The person who bears the professional
consequence is not the entity that formed the conclusion.

Nothing in the system measures whether the review is real. Approval latency, correction rate, and
edit distance between the generated draft and the approved document are all **uncollected**. The
honest position for the case study is not "human-in-the-loop solves this" — it is:

> We built an approval gate and we have no evidence anyone is using it as one. The instrumentation
> to find out is three columns and a dashboard, and it does not exist.

That, not a fabricated accuracy percentage, is the honest "what I would build next".

---

## 9. Provenance and verification

Every claim in §2 was verified in source at commit `a37c4d9`:

- `Backend/exemplars/comprehensive.txt:219` — the violating sentence, inside the sample body, in
  the HOMEOWNER GUIDANCE section.
- Exemplar load `aiReportService.js:81-84`; appended to the system prompt at `:683`.
- Prompt-layer occurrences: `:599`, `:654`, `:755`; exemplar headers line 4.
- `validateReportOutput()` `:1137-1207` — no terminology check exists.
- Non-blocking: `:1131` ("Phase 1: Log-only"), enforcement site `:1451-1458`.
- CI: `.github/workflows/ci.yml` — jobs are `lint`, `mobile-route-check`, `unit-tests`,
  `integration-tests`. No terminology gate.

**The empirical demonstration — done.** The chain above is static analysis, which is not good enough
for the load-bearing claim of the case study, so the experiment was run: reproduce the production
prompt configuration, generate real reports, count how often the model actually says it.
`claude-haiku-4-5`, temperature 0.3, four conditions, n=12 each
(`prototype/src/experiment.js`; all 48 raw outputs committed in `prototype/fixtures/experiment-raw/`).

| Configuration | Asserts an inspection occurred |
|---|---|
| Positive framing only, clean exemplar | **0 / 12** |
| Positive framing only, poisoned exemplar — *this was production* | **6 / 12 (50%)** |
| This prompt's prohibition, poisoned exemplar | **0 / 12** |
| This prompt's prohibition, clean exemplar | **0 / 12** |

**The poisoned exemplar is the root cause.** With a clean few-shot the model never once claimed the
visit was an inspection; with the contaminated one it did so in half of all runs — and two of those
six reproduced the exemplar's own sentence, *"Your inspection revealed solids at 22.9 percent…"*,
near-verbatim, in the homeowner-facing section. A few-shot exemplar is imitated, not merely read.

**A caution about the instrument, because it nearly ruined this result.** The violation is *asserting
that the regulated act occurred*. It is **not** a violation to recommend future work with the ordinary
verb — *"the pump must be inspected by a technician"* asserts nothing about what this visit was. The
first classifier counted those repair recommendations as violations and reported a leak rate roughly
seven times the true one, which inverted the conclusion: it made the poisoned exemplar look
irrelevant. Define the violation before you measure it, and publish the raw outputs so someone can
check you.

**And an honest cost of the fix:** the prohibition is blunter than designed. Under it, the model
stopped using the inspect-verb *entirely* — advisory usage fell from 12/12 trials to 0/24 — including
in the forward-looking recommendations the two-tier gate was carefully built to permit. It substitutes
cleanly (*"a qualified technician must **examine** the pump impeller… and **assess** whether repair is
necessary"*), so the reports do not read worse. But a guardrail must be reported for what it does, not
what it was meant to do.

**Regulatory caveat, stated because this document is public:** the certification-boundary facts in
§1 are drawn from the system's own knowledge base
(`Backend/knowledge/domains/bc-health-authority-regulations.json`), which carries `"sourceUrl":
null` and a self-assigned confidence rating. **It is synthesized content, not a citation.** Before
publication, the four R.O.W.P. categories and the Maintenance-Provider/Private-Inspector boundary
must be re-verified against ASTTBC directly. Publishing a regulatory claim sourced from an
LLM-written RAG corpus — inside a case study about not trusting LLMs near regulatory documents —
would be a self-inflicted wound, and it is exactly the kind of thing this whole document is about.
