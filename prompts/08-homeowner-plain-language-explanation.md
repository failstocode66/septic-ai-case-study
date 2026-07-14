# 08 — Plain-language explanation for the homeowner

| | |
|---|---|
| **Origin** | **HARVESTED** — the HOMEOWNER GUIDANCE instruction (`Backend/aiReportService.js:590`, injected at `:772-775`) and the rule-based topic selector `buildHomeownerEducationContext()` (`:119-171`). **Extended** here with a closed-fact-set constraint and a reading-level target. |
| **Serves** | The homeowner — the only reader in this system who is not a professional, and the one who actually controls the outcome. |

---

## 1. Use case

A septic system is destroyed by its owner, slowly, through ordinary domestic habits. Not
maliciously — because nobody ever explained the causal link between what goes down the drain and
the thing in the yard.

- "Flushable" wipes do not dissolve. They build a crust that will not break down and eventually
  ride over the outlet baffle into the field.
- Bleach and antibacterial cleaners kill the bacteria in an aerobic unit. The unit is *made of*
  bacteria. Sterilising it stops the treatment.
- Doing five loads of laundry on Saturday sends a hydraulic surge through a tank sized for a
  household's normal flow, pushing solids out of the tank before they can settle.
- Parking on the drainfield crushes the distribution pipe.

Every one of these is cheap to prevent and expensive to repair. **The most valuable thing in the
report, measured in dollars saved, is the section a homeowner will actually read.**

But this section is also the **highest-risk prose in the document**, for a reason that is not
obvious:

Plain-language explanation is exactly the register where a language model is most fluent, most
confident, and most likely to **invent**. The technical sections are anchored — they have tables,
measurements, pre-computed classifications, an authoritative severity. The homeowner section has
none of that scaffolding. It is free prose about how septic systems work in general, and the model
has read the entire internet's worth of that. Given the slightest opening it will drift from *this
system* into *septic systems generally*, and start explaining features this property does not have,
recommending additives nobody assessed, and — the specific defect found in the live system — calling
the visit an **inspection**.

> The one confirmed terminology violation in production
> (`Backend/exemplars/comprehensive.txt:219`) is in the **HOMEOWNER GUIDANCE** section of the
> exemplar. Of course it is. That is where the prose is loosest, the audience is least expert, and
> the model is least constrained. **The riskiest text is the friendliest text.** See prompt 05.

---

## 2. The prompt

### 2a. Topic selection is deterministic (HARVESTED — the key design decision)

The model does **not** choose what to teach the homeowner. `buildHomeownerEducationContext()`
(`:119-171`) inspects the findings and selects topics from a fixed set, each keyed to a real
observed condition:

| Trigger (from actual findings) | Topic injected |
|---|---|
| `solidsAnalysis.householdPracticeChanges` (thick crust) | **WASTE MANAGEMENT** — wipes, feminine products, grease, harsh chemicals, rapid-dissolve paper, rest time between heavy usage |
| Filter pressure differential ≥ 3 psi, or a dirty/clogged filter | **FILTER CARE** — spread laundry across the week, liquid over powder detergent, stagger showers, clean lint traps |
| `effluent_filter_condition` in (damaged, fail) | **FILTER CARE** (the damage variant) |
| Findings mention breakout / ponding / saturated / standing water | **DRAINFIELD PROTECTION** — no vehicles, no deep-rooted planting, divert roof runoff, conserve water |
| `dissolved_oxygen` measured and `< 2.0 mg/L` | **CHEMICAL USAGE** — antibacterial soap and bleach kill the biology; no paint, solvents, medications |
| *any* of the above fired | **GENERAL MAINTENANCE** — know your components, keep access ports clear, keep records, call at first sign (slow drains, gurgling, odours, wet ground) |

If nothing fired, `shouldInclude: false` and **the section does not exist**. There is no generic
homeowner advice section. Advice appears only when this visit produced evidence for it.

That is the whole safety property of this prompt: **the topic list is a closed set, selected by
deterministic rules from measured findings.** The model is never asked "what should this homeowner
know?" — a question it would answer beautifully and unfalsifiably.

### 2b. The production instruction (verbatim, `:590`)

```text
9. HOMEOWNER GUIDANCE: When instructed in the ADDITIONAL INSTRUCTIONS, include a
   "## HOMEOWNER GUIDANCE" section after Recommendations (and after Changes Since Last Maintenance
   if present). Write in an approachable but professional tone regardless of the overall report
   tone. Each topic: brief paragraph (2-4 sentences) with a clear ### header. Do NOT include this
   section unless specifically instructed
```

…and the injected topic block (`:772-775`), e.g.:

```text
- HOMEOWNER GUIDANCE SECTION: Include a "## HOMEOWNER GUIDANCE" section. Only cover topics relevant
  to THIS maintenance visit's findings. Topics to address:
  CHEMICAL USAGE: Low dissolved oxygen detected in treatment unit. Educate on: avoiding
  antibacterial soaps and bleach-heavy cleaning products that kill beneficial bacteria in the
  treatment system, using septic-safe cleaning alternatives, never pouring paint, solvents, or
  medications down drains.
  GENERAL MAINTENANCE: Remind homeowner to: know the location of all system components, maintain
  easy access to inspection ports and keep maintenance records, contact their service provider at
  first sign of problems (slow drains, gurgling sounds, odors, wet areas over drainfield), and
  understand their system type and recommended maintenance schedule.
```

### 2c. The extension (NEWLY DESIGNED — the constraints production is missing)

```text
HOMEOWNER GUIDANCE — WRITING CONSTRAINTS

Audience: the property owner. Not a technician, not a regulator. Assume no technical background and
no prior knowledge of how a septic system works. Assume they are intelligent and busy.

CLOSED FACT SET (the most important rule):
You may reference ONLY the conditions actually observed during this maintenance visit, as recorded
in the maintenance data. You may explain the general mechanism behind an observed condition -- that
is the point of this section -- but you may NOT introduce a condition, component, or risk that was
not observed.
  ALLOWED:     "The crust layer in your tank measured 6.5 inches. Crust like this builds up when
                material that does not break down -- wipes, grease, heavy toilet paper -- goes down
                the drain."   [observed condition + its mechanism]
  NOT ALLOWED: "You should also have your drainfield checked for root intrusion."
                [no root intrusion was observed; this is a new claim]
  NOT ALLOWED: "Consider adding a bacterial additive to restore your system."
                [additives were not assessed; this is a product recommendation, not a finding]

STYLE:
- Each topic gets a ### header and 2-4 sentences. No lists inside topics. No jargon.
- Target a general-reader reading level. Explain any term you cannot avoid, in the same sentence.
  Say "the crust layer that forms on top of the liquid in your tank", not "the scum stratum".
- Every piece of advice must be tied to something FOUND HERE. State the finding, then the habit,
  then the consequence -- in that order. A homeowner will not change a habit because a document
  told them to; they will change it because they understand what it did to their tank.
- Never blame. State the mechanism. "Wipes do not break down" is useful; "you have been flushing
  wipes" is an accusation the data does not support.

HARD PROHIBITIONS:
- NEVER call this visit an "inspection". It was a maintenance visit, performed under a Maintenance
  Provider certification. "Inspection" names a different, separately certified service. Write
  "this maintenance visit found..." -- never "your inspection revealed...".
  ("Inspection port" is a hardware component name and is permitted.)
- NEVER state or imply that the system passed, is compliant, is certified, or is approved. This
  document records maintenance performed; it certifies nothing.
- NEVER recommend a specific commercial product or brand.
- NEVER give a cost or a price. The office quotes work; this report does not.
- NEVER promise an outcome ("this will fix it", "your field will recover"). State what the action
  addresses and what will be checked next visit.
- If a topic in the list above is not supported by a finding in the data, OMIT it. Do not pad.
```

---

## 3. Techniques used

| Technique | How |
|---|---|
| **Deterministic topic selection (the load-bearing control)** | The model does not choose subject matter. Six topics, each gated on a real finding, selected in JS. This converts an open-ended generative task ("advise this homeowner") into a bounded rewriting task ("explain these three specific things"). Bounding the *task* is worth more than any number of instructions about the *output*. |
| **Closed fact set with contrastive examples** | ALLOWED / NOT ALLOWED pairs, showing the exact boundary between *explaining an observed condition's mechanism* (the whole value of the section) and *introducing an unobserved condition* (fabrication). The line is subtle, so it is drawn with examples rather than described. |
| **Audience shift without a fact shift** | Same facts, different register. The tone changes; the evidence set does not. This is the single hardest thing to hold — a model that shifts audience will happily shift epistemics with it, because friendly prose is *confident* prose. |
| **Ordered explanation template** | finding → habit → consequence. Not "give advice" — a fixed causal sentence shape. It is also the shape that actually changes behaviour. |
| **Negative constraint on blame** | "State the mechanism, never the accusation." The data shows a crust; it does not show who flushed what. This is an epistemic constraint wearing a manners costume. |
| **Hard prohibitions on the five ways this section can hurt someone** | Compliance claim; certification implication; product endorsement; price; promised outcome. Each is a real harm, each is a natural thing for a fluent model to write. |
| **Terminology guardrail, restated locally** | Because *this is the section where it failed in production*. A rule stated once at the top of a 17,000-character system prompt is not stated where it is needed. Repeating it at the point of risk is not redundancy — it is placement. |
| **Omission over padding** | "If a topic is not supported by a finding, OMIT it." The section is allowed to be short, or absent entirely. |

---

## 4. Expected output shape

```markdown
## HOMEOWNER GUIDANCE

### Cleaning Products and Your Treatment System

Your system has a treatment unit that relies on living bacteria to clean the wastewater before it
reaches the ground. During this maintenance visit the oxygen level in that unit measured 1.4 mg/L,
below the 2.0 mg/L the bacteria need to stay active. Bleach, antibacterial soaps and strong drain
cleaners kill those bacteria, and the system cannot treat wastewater without them. Septic-safe
cleaning products, and keeping paint, solvents and unused medications out of the drains, let the
biology recover.

### Keeping Track of Your System

Knowing where your tank, treatment unit and dispersal field are -- and keeping the access ports
clear -- makes every future visit faster and cheaper. Keep your maintenance records together; they
are what shows the work was done. Call your service provider at the first sign of trouble: slow
drains, gurgling, odours, or wet ground over the dispersal field. Small problems in a septic system
are cheap. The same problems six months later are not.
```

Two topics, because two topics fired. No pump-out advice (solids were normal). No drainfield advice
(no surface issues). No filter advice (filter was clean). **The absence of the other four topics is
the prompt working.**

---

## 5. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| **"Your inspection revealed…"** | Misrepresents an uncertified regulated service, to the least expert reader in the chain, in the friendliest paragraph of the document | Local restatement of the terminology rule + prompt 05's blocking output gate | **This is the live defect.** The exemplar's homeowner section contains exactly this sentence. Unmitigated until prompt 05 ships. |
| **Generic septic advice drifting in** ("check for root intrusion", "consider an additive") | Advice with no basis in this visit, in a signed document. The homeowner spends money on a problem nobody observed. | Deterministic topic gating + the closed-fact-set rule with contrastive examples | Moderate. This is the most likely residual failure and the one prompt 13's judge should specifically hunt. |
| Implying compliance / a pass | The homeowner believes they hold a compliance document. They do not. | Hard prohibition | Moderate — a *paraphrase* of compliance ("everything checks out") evades a regex. Needs the semantic judge (prompt 05 §4, category B). |
| Product endorsement | Liability; and a maintenance report is not an advertisement | Hard prohibition | Low. |
| Quoting a price | A quote the contractor never authorised, under their name | Hard prohibition; pricing lives in prompt 10, from the org's own price book | Low. |
| Blame framing | Damages the relationship; and the data does not support the accusation | "State the mechanism, never the accusation" | Low. |
| Jargon leaking from the technical sections | The section is unread, and its entire value is that it gets read | Reading-level target + explain-in-the-same-sentence rule | Moderate. Unmeasured — no readability score is computed anywhere. A Flesch-Kincaid check in the validator would be trivial and does not exist. |

---

## 6. Provenance and verification

- Instruction 9 — `Backend/aiReportService.js:590` (numbered 9 in source; the instruction text
  itself refers to "instruction #12", a stale cross-reference — a small real inconsistency).
- `buildHomeownerEducationContext()` — `:119-171`. Six topics, all rule-triggered. Trigger
  thresholds: filter pressure differential ≥ 3 psi (`:134`), DO < 2.0 mg/L (`:158`), scum-driven
  `householdPracticeChanges` from `solidsAnalysisService`.
- Injected into the user prompt at `:772-775`, only when `shouldInclude` is true.
- **The section is genuinely optional in production** — `shouldInclude: topics.length > 0`
  (`:167-170`). No findings, no section. This is correct and worth calling out; most systems would
  have shipped a generic homeowner blurb on every report.
- **Newly designed here:** the closed-fact-set rule, the ALLOWED/NOT ALLOWED pairs, the
  finding→habit→consequence template, the reading-level target, and all six hard prohibitions.
  Production has the tone instruction ("approachable but professional") and the topic list, and
  nothing else.
