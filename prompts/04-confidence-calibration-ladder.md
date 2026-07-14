# 04 — Confidence calibration: a four-tier epistemic ladder

| | |
|---|---|
| **Origin** | **HARVESTED** — `Backend/aiReportService.js:641-646` (system prompt), supported by the DIAGNOSTIC REASONING block at `:634-639` |
| **Serves** | The contractor (whose registration is exposed by an overclaim) and any Environmental Health Officer or Regional District reviewer who later reads the document |

---

## 1. Use case

A maintenance report contains sentences of wildly different epistemic status, and they all look the
same on the page:

- *"The scum layer measured 4.5 inches."* — a number read off a stick.
- *"The low amp draw indicates a probable impeller failure."* — an inference from two correlated
  readings.
- *"Slightly elevated turbidity may indicate early-stage treatment degradation."* — a hunch worth
  a follow-up.
- *"Treatment effectiveness cannot be assessed."* — an honest nothing.

A language model writing "professional" prose will **flatten all four into the same confident
register**, because confident declarative prose is what professional documents look like in its
training data. The measured 4.5 inches and the guessed impeller failure will be delivered in the
same voice.

That flattening is the single most dangerous stylistic tendency an LLM brings to a regulated
document, and it is invisible: the report reads *better* after the flattening. It reads like a
technician who knows exactly what is going on.

This block forces the model to keep the four registers apart, and — critically — **gives it the
words for each one**.

---

## 2. The prompt

Verbatim, `aiReportService.js:641-646`:

```text
CONFIDENCE CALIBRATION:
- CONFIRMED (directly measured/observed): Use definitive language. "The scum layer measured 4.5 inches"
- INDICATED (strongly supported by correlated evidence): Use qualified language. "The combination of
  low amp draw and absence of discharge flow indicates a probable impeller failure"
- POSSIBLE (suggested by limited evidence): Use conditional language. "The slightly elevated
  turbidity may indicate early-stage treatment degradation. Recommend monitoring at next service."
- INCONCLUSIVE (insufficient data): State what is missing. "Dissolved oxygen was not measured during
  this visit. Without DO readings, treatment effectiveness cannot be assessed."
- NEVER present an inference as a measurement. NEVER present a single-visit observation as a trend.
```

It works together with the block immediately above it (`:634-639`):

```text
DIAGNOSTIC REASONING:
- Always correlate findings across components. If multiple symptoms are present, identify the root
  cause rather than treating each symptom independently.
- Trace upstream: If the drainfield is failing, check if ATU treatment quality has declined (DO,
  clarity). If ATU is struggling, check if influent quality has changed (effluent filter condition,
  tank solids).
- Trace downstream: If a pump fails, assess impact on downstream distribution (LPP head, drip zone
  pressures, drainfield loading).
- When a critical finding exists, explain the likely cause chain and timeline for cascading effects
  if not addressed.
- Distinguish between confirmed diagnoses (sufficient data to determine root cause) and findings
  that require further investigation (recommend specific follow-up tests).
```

…and with the persona's flat prohibition at the top of the system prompt (`:577`):

```text
You NEVER guess. If data is insufficient to draw a conclusion, you state what additional testing
or observation would be needed.
```

---

## 3. Techniques used

| Technique | How it is applied |
|---|---|
| **Epistemic calibration ladder** | Four named tiers, ordered by evidentiary strength: CONFIRMED → INDICATED → POSSIBLE → INCONCLUSIVE. Not "be careful" — a taxonomy with a decision rule per rung. |
| **Worked phrasing per tier (few-shot at the sentence level)** | Each rung ships with a *sentence*, not a description of a sentence. This is the whole trick. "Use qualified language" is a nudge a model will drift away from within two paragraphs; *"The combination of low amp draw and absence of discharge flow **indicates a probable** impeller failure"* is a template it can pattern-match against. Models imitate examples far more reliably than they obey adjectives. |
| **Two absolute negative constraints** | "NEVER present an inference as a measurement." — the report/reality boundary. "NEVER present a single-visit observation as a trend." — a domain-specific overreach the model makes constantly: one 26% solids reading becomes "solids are accumulating rapidly." One reading is a point. Two readings are a line. The model does not naturally respect that. |
| **Refusal made speakable** | INCONCLUSIVE gets a worked example too, and it *names what is missing*: "Dissolved oxygen was not measured… Without DO readings, treatment effectiveness cannot be assessed." Refusal is given a professional register, so admitting a gap does not read as incompetence. If you do not give a model a graceful way to say "I don't know", it will say something else. |
| **Coupling to the deterministic layer** | CONFIRMED maps exactly onto what the deterministic injectors supply (prompt 02): measured values and their classifications. INDICATED maps onto the cross-correlation block (prompt 07). The ladder is not free-floating rhetoric — its top two rungs are anchored to actual computed facts. |

---

## 4. Expected output shape

Register discipline inside the normal Markdown narrative. The tiers are **never labelled in the
output** — no "(CONFIRMED)" tags. They surface as *verb choice*:

```markdown
## SERVICE FINDINGS

The scum layer measured 3.0 inches and sludge 7.5 inches against a total fluid depth of 40 inches.
[CONFIRMED -- flat declarative, a measured value]

Dissolved oxygen measured 1.4 mg/L, below the 2.0 mg/L minimum, and effluent clarity was recorded
as cloudy. Together these indicate degraded biological treatment, most probably reduced aeration.
[INDICATED -- "indicate", "most probably"; two correlated readings, one inference]

The moderate filter soiling may reflect elevated household loading between visits. Recommend
confirming usage patterns with the owner at the next service.
[POSSIBLE -- "may", plus a follow-up action]

Total fluid depth was not measured during this visit. Without it, solids percentage cannot be
calculated and pumping need cannot be assessed from this visit's data.
[INCONCLUSIVE -- names the gap, names the consequence, claims nothing]
```

---

## 5. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| **Register flattening** — inference written as measurement | The report asserts a fact that was never observed. Under a professional's signature. | The four-tier ladder with worked phrasing; the explicit NEVER | The model can still drift, especially late in a long report where it is furthest from the instruction. **Nothing detects it.** No validator check exists for register. |
| **Single reading reported as a trend** | "Solids are accumulating rapidly" from one visit → an unnecessary pump-out sold. Or the reverse: a real acceleration missed. | Explicit second NEVER; and trend data, when it exists, is computed deterministically and injected (prompt 12) | Moderate. The prohibition is the only defence when there is no history. |
| **False INCONCLUSIVE (over-hedging)** | Everything becomes "may indicate", the report says nothing, the homeowner is not warned about a real problem. Hedging is *also* a failure. | The ladder is symmetric — CONFIRMED demands *definitive* language for measured values. Prompt 02's injected severities are marked AUTHORITATIVE precisely so the model cannot hedge them away. | The interaction is right: measured + classified → no hedging permitted. |
| Certainty language on a RAG-sourced regulatory threshold | An EHO reads a confidently mis-cited regulation | Prompt 15's "do not invent thresholds or cite values not present in the reference data" | See prompt 09 — and note that the reference corpus is itself unsourced. |

---

## 6. Provenance and verification

- CONFIDENCE CALIBRATION — `Backend/aiReportService.js:641-646`, in the system prompt, between the
  DIAGNOSTIC REASONING block and the diagnostic-depth instruction.
- DIAGNOSTIC REASONING — `:634-639`.
- "You NEVER guess" — `:577`, in the persona.

**Honest limitation.** This is a *prose-level* control with **no enforcement whatsoever**. Unlike
the prohibited-section rule (which the validator checks) or the arithmetic (which never reaches the
model), register discipline is verified by nobody. `validateReportOutput()` (`:1137-1207`) checks
for prohibited sections, missing components, and hallucinated brands — it does not and cannot check
whether "indicates" was used where "measured" belonged.

There is no eval set, no golden output, no scored benchmark anywhere in the repository, so **the
effectiveness of this block has never been measured** and no number is offered here. The mechanism
is real and describable. The effect size is unknown. Anyone who tells you a confidence-calibration
prompt "reduced overclaiming by 40%" without an eval harness is making it up.

The obvious next build — and the honest answer to "what would you do next" — is an eval set of
synthetic visits with known-ambiguous evidence, scored on whether the generated report used the
correct rung. That is buildable in a day and it is the only path to a defensible number.
