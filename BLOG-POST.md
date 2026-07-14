# The word a septic report is not allowed to say

*How we put a language model inside a document that carries a professional's registration number — and what we had to take away from it first.*

*Rainshadow Systems · draft, unpublished*

---

A septic maintenance report is not content. It is evidence.

It gets signed by a registered practitioner. It gets handed to a homeowner who will make decisions
about a $30,000 asset buried in their yard. It goes into a compliance file that an environmental
health officer may open years later. It can back a claim for public rebate money. And it is written,
in most of this industry, at the end of a long day, in a truck, by someone who is very good at
diagnosing a failing pump and reasonably ordinary at writing three pages of prose about it.

That gap — between the quality of the work and the quality of the record of the work — is the actual
problem in this trade. It is also exactly the shape of problem that a language model looks like it
should solve. Which is where it gets interesting, because the naive version of that solution is
genuinely dangerous, and the reason why is not the reason most people expect.

This is a write-up of how the AI reporting pipeline in **SepticScribe** — our maintenance app for
onsite-wastewater contractors — is actually built. It is deliberately honest about what we got wrong,
because we found a real compliance defect in our own system while writing it, and the defect turns out
to be the most useful thing in the whole story.

---

## The failure mode is not what you think

Everyone worries that an AI will make things up. Fair. But in a maintenance report, the dangerous
failure isn't fabrication. It's **reassurance.**

Here is a real example, from our own system, on synthetic test data.

A septic effluent pump has a nameplate rating — the current it draws when it is doing its job. Call
it 7.2 amps. On this visit, the technician measures **1.6 amps.** Every other reading on the site is
normal: tank looks fine, filter is clean, field is dry.

1.6 amps against a 7.2 amp nameplate means the pump is spinning and moving nothing. It is running
dry. It is, at that moment, destroying itself, and it will fail — probably at 2am, probably in
February, probably into somebody's basement.

We handed those raw numbers to a very capable model and asked it, in a well-written prompt, to produce
a professional maintenance report. It wrote:

> *This low amp draw relative to nameplate capacity is normal for a lightly loaded system and
> indicates the pump is operating efficiently without strain.*

That is a confident, fluent, well-structured, completely invented reassurance about a motor that is
cooking itself. The word "critical" appears nowhere in that report. A tired technician skims the
table, sees a row of "Good", and signs it.

Look at what the model actually did. It saw one alarming number surrounded by healthy ones, and it
**averaged.** It produced the document that a professional maintenance report usually *looks like*.
That is not a bug in the model; it is what the model is for. It is a machine for producing the most
plausible continuation, and the most plausible continuation of "professional maintenance report" is
overwhelmingly "everything is fine."

**In a regulated document, the model's instinct to smooth things over is the threat.** Not its
imagination.

---

## So we took the judgement away from it

The fix is unglamorous and, we think, correct: **compute every conclusion that carries consequence in
ordinary code, and hand the model the answers as facts it is forbidden to re-derive.**

Divide 1.6 by 7.2 in JavaScript. That's 22%. Look up 22% on a seven-tier severity scale built from
manufacturer nameplate data. That tier says: *no hydraulic load — critical.* Then put that conclusion
into the prompt, above the raw measurements, labelled **AUTHORITATIVE — DO NOT OVERRIDE**.

Same model. Same data. Same settings. Now it writes:

> *This maintenance visit identified a critical problem with the effluent pump. The pump is running
> but drawing only 22.2% of its nameplate amperage, indicating no hydraulic load. This is a failure
> condition requiring immediate professional attention. All other system components are in good
> condition.*

The arithmetic was never the hard part. **The judgement was.** So the judgement moved out of the
model.

This is the single organising principle of the whole system, and it applies far beyond septic tanks:

> **The model may never be the source of a claim that carries legal or financial weight.**

Health score, solids percentages, filter pressure, dissolved oxygen, trends across visits,
cross-component root-cause correlation — all of it is computed deterministically, in code we can test,
and injected into the prompt as settled fact. The model's remaining job is to write it up in plain,
professional English at the right level of detail for the reader. It narrates. It does not conclude.

And the most legally loaded part of the document — the certification block, the practitioner's name,
their registration number, the stamp — the model is not merely instructed to avoid. It is
**architecturally unable to produce it.** The prompt forbids it, a validator flags it if it tries, and
the certification block is rendered separately from verified profile data. The regulated assertion
never passes through the stochastic component at all.

If you take one thing from this: *find every claim in your document that carries legal weight, remove
all of them from the model's reach, render them from verified data, and let the model write the rest.*

---

## The word

Now the part we did not expect to be writing.

In British Columbia, **maintenance** and **inspection** are not synonyms. They are different,
separately-registered scopes of practice. The practitioners who use SepticScribe hold the maintenance
endorsement. An *inspection* — the kind that backs a property sale or a compliance verification — is a
different certification, and describing a maintenance visit as an inspection asserts a qualification
the technician does not hold, above their own registration number.

The harm is not abstract, and it does not land on us. A homeowner — or a buyer, or a lender — who
reads *"your inspection revealed…"* may reasonably rely on that document as an inspection report. It
is not one. Someone makes a decision on the strength of a document that never claimed to be what it
appeared to be. And the registration that an enforcement action attaches to belongs to our customer,
not to us. **The first person harmed by that bug is the person paying us.**

So we treat the word as a hard boundary. We had swept the app for it: the buttons, the menus, the
emails, the PDF headers, the App Store permission strings. The data model calls the thing a
*maintenance event*. The mobile app has a code comment that literally reads *"Copy is MAINTENANCE
language throughout — never 'inspection'."* We were, we thought, thorough.

**We had missed the prompt.**

To teach the model our house style, we show it an example report to imitate. And inside that
example — in the section written directly to the homeowner — was the sentence:

> *"Your inspection revealed elevated scum levels…"*

The model was being shown a document that broke the rule, and told: write like this.

Nothing downstream would have caught it. The prompt never actually said *don't use that word* — it
only used the right word itself and hoped. The output checker looked for fabricated brand names and
missing sections, but not for terminology. It was logging warnings, not blocking anything. And our
build pipeline, which already automatically checks route contracts and diagnostic thresholds, had no
check for the single most important compliance rule in the product. **The strongest rule we had was
the only one left entirely to human discipline.**

---

## We measured it rather than assuming it

Finding the sentence is not the same as proving it matters. So we ran the experiment: four prompt
configurations, twelve report generations each, one synthetic visit, and then we read all
forty-eight outputs by hand and counted.

| Prompt configuration | Reports asserting an inspection occurred |
|---|---|
| Good example, no explicit rule | **0 of 12** |
| **Poisoned example** (this was production), no explicit rule | **6 of 12** |
| Poisoned example + explicit prohibition | **0 of 12** |
| Good example + explicit prohibition | **0 of 12** |

With a clean example, the model never once claimed the visit was an inspection. Poison **one
sentence** of that example, and it does so in **half of all reports** — and two of those six
reproduced the poisoned sentence almost word for word, in the homeowner-facing section.

**A few-shot example is imitated, not merely read.** It is not documentation. It is instruction, and
it outweighs polite framing elsewhere in the prompt.

There is a second lesson buried in that table, and it is the one we would rather not have learned.
**Our first attempt at scoring the experiment was wrong.** It counted sentences like *"the pump must
be inspected by a technician"* — an ordinary recommendation for future work, claiming nothing about
what this visit was — as regulatory violations. That inflated the leak rate roughly sevenfold and
would have produced the *opposite* conclusion: that the poisoned example didn't matter much. We caught
it, rebuilt the classifier, hand-checked every output, and published all forty-eight raw responses so
that anyone can re-score them and disagree with us.

A number that looks earned and isn't is worse than no number at all. We nearly shipped one, in a
document about not trusting confident output.

---

## What we changed

We scrubbed the examples. We added an explicit prohibition to the prompt — production had none. We
built a two-tier checker that distinguishes *asserting the regulated act occurred* (blocked) from
*recommending future work with the ordinary English verb* (allowed). We promoted that check from
"logs a warning" to **blocking**: a violating report triggers one corrective rewrite, and if that
fails, the system falls back to a plain deterministic template that cannot produce the word at all —
so a violating report can never reach a customer, and the contractor still walks away with a record.
And we added an automated gate to the build, because the next human sweep will be done by a different
human next year and it will miss the prompt again.

We also report what the fix cost, because a guardrail must be described by what it *does*, not by what
it was meant to do: under the explicit rule, the model stopped using the verb "inspect" **at all**,
including in the legitimate forward-looking recommendations the two-tier design was specifically built
to permit. It substitutes cleanly — *"a qualified technician must **examine** the pump impeller and
**assess** whether repair is necessary"* — so the reports don't read worse. But over-suppression is
over-suppression, and we would rather say so than let you find it.

While we were in there, we found and fixed three more: customer property details were being sent to
the model provider even though the finished report reassembles them locally anyway (they now aren't);
one of the deterministic guardrails was silently doing nothing on the exact system type it was written
for, because it was reading a field name that system doesn't use; and an "authoritative" prompt block
was citing an American electrical standard it doesn't actually derive from, in the wrong country.

Every one of those shipped as a fix **before** this was written down.

---

## The honest limitations

Because a case study without them is a brochure.

**We have no eval harness.** No golden outputs, no scored benchmark, no accuracy rate. We can describe
the mechanisms above and demonstrate them; we cannot tell you they reduced hallucination by N percent,
because we have never measured it, and inventing that number would be the exact sin this whole
document is about. It is the obvious next thing to build.

**We have no production performance data.** Latency, token cost, cache hit rates — the system computes
all of them and then throws them away. So we don't quote them.

**The deepest risk is the one we cannot engineer away.** The report is fluent, structured, confident,
and instant. A technician at 6pm, on their ninth job, approves it because it *reads right* — and the
approval gate quietly degrades into a rubber stamp, with their registration number on the bottom of
the page. **Liability transfers to the human. The reasoning did not.** Nothing in our system currently
measures whether that review was real. A human in the loop is only a control if the human is actually
looking.

That is the honest state of it: a system built on the principle that the model must never be the
source of a consequential claim, holding up well against the failure mode it was designed for, and
still resting — as every one of these systems ultimately does — on someone's attention at the end of a
long day.

---

*The full technical case study, all fifteen documented prompts, and a runnable offline prototype are
published in a companion repository. All examples use synthetic data; no customer information appears
in any of it.*

*Nothing here is legal or regulatory advice. Practitioners should confirm their scope of practice with
their registering body.*
