# 15 — Vendor / OEM knowledge grounding (RAG), and the brand-hallucination check

| | |
|---|---|
| **Origin** | **HARVESTED** — the `VERIFIED REFERENCE DATA` block (`Backend/aiReportService.js:804-816`), the two-pass retriever (`Backend/services/knowledgeService.js:443-594`), and the brand allowlist check (`aiReportService.js:1171-1204`). |
| **Serves** | The contractor — the difference between "the pump seems to be running a bit hot" and "the pump is drawing 130% of its rated 10.5 A." |

---

## 1. Use case

A septic system is an assembly of other people's equipment. A Zoeller pump, a Hiblow blower, an
Orenco filter, a Norweco treatment unit. Every one of them ships with a nameplate and a spec sheet,
and **the spec sheet is what turns a reading into a diagnosis**:

- 6.4 A means nothing. 6.4 A against a rated 7.2 A means 89% FLA and a healthy pump.
- A blower drawing 95 W against a rated 80 W is working too hard — a worn diaphragm or a blocked
  diffuser.
- Effluent filter rated at 800 GPD on a household that produces 900 GPD is undersized, and no amount
  of cleaning fixes that.

A model has *read about* septic pumps. It has absorbed forum posts, catalogue pages, and other
models' summaries. **It will produce a rated amperage for a named pump model if asked**, and it will
be confident, and it may be right, and there is no way for a technician holding the report to tell
which.

(Note the shape of the original version of this very instruction, fixed in `276cf32`: it used a real manufacturer and a
specific rated amperage as its formatting example -- a spec drawn from the same unsourced corpus
this document criticises. An example value in a prompt is an anchor the model can reach for. It has
been replaced with a placeholder, and the instruction now says explicitly that a rated value must
appear verbatim in the retrieved reference data or not be stated at all.)

A wrong rated value is worse than no rated value, because the whole point of the number is to be the
denominator of a judgement. A hallucinated denominator produces a confidently wrong percentage,
which produces a confidently wrong severity, which produces a truck.

---

## 2. The system

### The corpus (measured)

`Backend/knowledge/` — **131 files, 31,701 lines, ~1.8 MB**, ingested into **866 retrievable
chunks** across six domains:

| Domain | Chunks |
|---|---|
| vendor | 652 |
| diagnostic | 73 |
| hydraulic | 57 |
| electrical | 45 |
| maintenance | 23 |
| regulatory | 16 |
| **Total** | **866** |

The vendor half is the substance: **52 vendors → 582 products → 298 match aliases** (confirmed at
runtime — the service logs `Vendor knowledge loaded: 52 vendors, 582 products, 298 aliases`).

**None of it is in the prompt.** It is retrieved per report.

### Retrieval: two-pass hybrid (`knowledgeService.js:443-594`)

**Pass 1 — deterministic, structured.** For each installed component, filter chunks by exact
`domain` / `vendorId` / `productModel` / `category` match. Vendor strings are resolved through an
alias table (`resolveVendorFromString`), because a technician types "hiblow", "Hi-Blow", or
"HIBLOW HP-80" and all three must land on the same vendor record. If the exact vendor+model lookup
returns nothing, fall back to a category match.

**This is the right call, and it is the interesting one.** In this domain you are not *searching* —
**you know exactly which pump you are looking at.** Semantic similarity is the wrong tool for a
question you can answer with a primary key. Vector search is for when you don't know what you're
looking for; a structured filter is for when you do.

**Pass 1.5 — the unknown-vendor fallback (`:515-541`).** If a component has no recognised vendor,
the retriever injects chunks tagged `'unknown vendor'` — *generic* diagnostic guidance, explicitly
so the model has something to ground on that is **not a brand**. Without this, an unknown pump is a
vacuum, and a model abhors a vacuum: it will fill it with the most probable brand.

**Pass 2 — semantic, only if budget remains (`:548-584`).** Build a short synthetic query from the
component types and any keyword-detected critical findings, embed it (`text-embedding-3-small`,
1536-dim), and run brute-force cosine similarity over an in-memory `Float64Array` index loaded at
startup. `minScore: 0.35`.

Brute-force cosine over a few thousand vectors instead of a vector database is a sensible engineering
choice at this scale, not a limitation — and honesty about that is worth more than a name-drop.

**Everything is bounded by a token budget**, scaled by diagnostic depth: 4,500 / 5,500 / 6,000 tokens
and 15 / 18 / 20 max chunks. Chunk cost is estimated as `content.length / 4`.

### The injected block (verbatim, `aiReportService.js:804-816`)

```text
VERIFIED REFERENCE DATA:
The following reference data has been retrieved from verified sources (OEM specifications,
regulatory documents, engineering references). Use this data to ground your technical statements.
Do not contradict or fabricate beyond what is provided here.

When comparing field measurements to manufacturer specs from this data:
- Blower: compare measured wattage/amps to rated values. Significant deviation = diaphragm wear or obstruction
- Flow rates: compare observed flow to rated capacity. Reduced flow at normal amps = worn impeller;
  reduced flow at high amps = discharge restriction
- Head pressure: compare operating head to rated max head. Operating near max = system stress,
  reduced margin for fouling
- Burial depth: compare to manufacturer maximum. Exceeding max voids warranty and may compromise
  structural integrity
- Filter capacity: compare rated GPD to estimated household demand
- Pressure readings: compare field readings to manufacturer published operating range
- When vendor data is available: cite manufacturer name and model when referencing rated values,
  and take the value ONLY from the reference data above (e.g., "<Manufacturer> <Model>, rated at
  <value from the reference data>"). Never state a rated value that does not appear verbatim in the
  reference data -- do not supply one from memory. Use OEM maintenance notes and common issues to
  inform recommendations

[EQUIPMENT SPECIFICATIONS]
• <chunk title> (<source>):
<chunk content>

[DIAGNOSTIC REFERENCE]
• <chunk title>:
<chunk content>
```

This is more than "here are some documents." It is a **comparison protocol**: six explicit
instructions for *what to do with a spec once you have it*. Retrieval without a use is just context
stuffing — the model gets a spec sheet and describes it. These six lines turn a retrieved number
into a diagnosis.

### The negative constraint (`aiReportService.js:661`)

```text
4. UNKNOWN MANUFACTURERS: If a component's manufacturer is listed as "Unknown" in the INSTALLED
   EQUIPMENT SPECIFICATIONS section, NEVER fabricate or guess a manufacturer name. Report the
   component by its type and any available model/spec data only.
```

### The detection (`aiReportService.js:1171-1204`)

A hardcoded list of ~50 real septic brands — `zoeller`, `liberty`, `grundfos`, `goulds`, `myers`,
`hiblow`, `secoh`, `orenco`, `norweco`, `infiltrator`, `polylok`, `eljen`, `netafim`… If a brand
appears in **the report** but appears nowhere in **the source data or the RAG context**, flag it:

```js
for (const brand of KNOWN_BRANDS) {
  if (reportLower.includes(brand) && !knownManufacturers.has(brand)) {
    if (!sourceDataLower.includes(brand)) {
      warnings.push(`Possible hallucinated manufacturer: "${brand}" mentioned in report but not found in source data`);
    }
  }
}
```

Cheap, deterministic, zero API cost, and it catches the exact failure the negative constraint is
aimed at. This is a good idea and it costs nothing.

---

## 3. Techniques used

| Technique | How |
|---|---|
| **Hybrid retrieval: structured filter first, semantic only for leftovers** | You know the pump's make and model. Look it up. Semantic search fills remaining budget, not the primary need. Most RAG systems reach for the embedding first out of habit. |
| **Alias resolution before lookup** | 298 aliases across 52 vendors. Field-typed manufacturer strings are messy; normalising *before* retrieval is what makes the deterministic pass work at all. |
| **Generic fallback instead of a vacuum** | Unknown vendor → inject `'unknown vendor'`-tagged generic guidance. **Give the model something true to say, or it will find something plausible to say.** This is the most transferable idea in the file. |
| **Retrieval + a use protocol** | Six explicit comparison rules. Context without instructions for using it produces description, not diagnosis. |
| **Negative constraint on the specific fabrication** | "NEVER fabricate or guess a manufacturer name." |
| **Post-hoc allowlist detection** | ~50 real brands; flag any that appears in the output but not in the input. Deterministic, free. |
| **Token budgeting scaled by depth** | 4,500-6,000 tokens, 15-20 chunks. Retrieval that ignores the budget is how you get a 40k-token prompt and a truncation warning. |
| **Prompt-layer separation** | Retrieved chunks go in the **user** prompt (volatile, per-visit). The stable system prompt stays cacheable. |

---

## 4. Expected output shape

Woven into the technical narrative — the retrieved spec becomes the denominator of a judgement, not
a recital:

```markdown
## SERVICE FINDINGS

The effluent pump measured 6.4 A against a nameplate rating of 7.2 A -- 88.9% of full load
amperage, within the normal operating range for a residential effluent pump.

The air blower is drawing 95 W against a rated 80 W. Operating above rated wattage in a linear
diaphragm blower typically indicates diaphragm wear or a restriction in the air path, and it is
consistent with the reduced air pressure and low dissolved oxygen recorded at the treatment unit.
```

And when the vendor is unknown — the honest version:

```markdown
The effluent pump measured 6.4 A. The manufacturer and model of this pump are not recorded, so the
reading cannot be compared to a nameplate rating and no severity classification can be made.
Recording the pump's nameplate data at the next maintenance visit would allow amp draw to be
assessed against its rated value on all future visits.
```

That second one is the system working. It is less impressive prose and it is a far better document.

---

## 5. Failure modes and mitigations

| Failure mode | Concrete harm | Mitigation | Residual risk |
|---|---|---|---|
| **Hallucinated brand** ("the Zoeller pump…" when no brand was recorded) | Wrong maintenance guidance, wrong parts ordered, a permanently wrong record | Unknown-vendor generic chunks + negative constraint + allowlist detection | **Moderate — and the allowlist is the weak link.** It has ~50 brands. A hallucinated brand that is *not on the list* is completely invisible. The check catches the *common* hallucination, not the *clever* one. |
| **Hallucinated spec value for a real brand** | A fabricated rated amperage becomes the denominator of a severity classification. Confidently wrong percentage → confidently wrong severity. | "Do not contradict or fabricate beyond what is provided here" | **This is the big one, and it is the least defended.** The allowlist checks that a *brand name* is grounded. **Nothing checks that a rated value is.** A report that names a real pump model and states a rated amperage which differs from the one in the retrieved chunk passes every check in the system. A numeric-containment check (every rated value cited in the report must appear verbatim in the retrieved context) is deterministic, cheap, and does not exist. |
| Retrieval returns nothing relevant | The model has no grounding and improvises | Pass 1.5 generic fallback; the RAG block is simply omitted if empty | Moderate — an *absent* block is silent. Same fail-open shape as prompt 02 §5: if retrieval quietly returns zero chunks, the prompt loses a whole section and nothing says so. **A liveness check belongs here too.** |
| Wrong vendor matched by an alias | Specs from the wrong product | Exact vendor+model first, category fallback second | Low. |
| Retrieved chunk is itself wrong | Faithfully grounded on bad data | — | **Real.** Chunk provenance is inconsistent across the corpus, and the regulatory domain in particular is unsourced (`"sourceUrl": null`). See prompt 09 §6. The word "VERIFIED" in `VERIFIED REFERENCE DATA` is a label, not a provenance chain. |
| Detection is log-only | The warning is written to a log nobody reads; the report ships | — | **Real.** Same as everything else in `validateReportOutput` (`:1131`). |

---

## 6. Honest assessment

**The retrieval half of this pipeline is competent and unremarkable.** Chunk → embed → cosine
similarity over an in-memory index → stuff top-k into the prompt. That is a 2023 RAG pipeline and it
works fine.

The two things worth showing a reader are not the vectors:

1. **The deterministic-first ordering.** When you know the primary key, use it. The semantic pass is
   a *budget filler*, not the mechanism. Most RAG systems get this backwards because embeddings are
   the interesting part and lookups are the boring part.
2. **The unknown-vendor fallback.** Injecting *generic* guidance specifically so the model is not
   tempted to guess a brand is a small, cheap, and genuinely thoughtful piece of hallucination
   design. It generalises: **whenever you take away a model's ability to fabricate, give it
   something true to say instead.** A prohibition with no alternative is a prohibition that will be
   violated.

And the honest gap is the one in the table above: the system carefully verifies that a **brand name**
came from the data, and does not verify that a **number attributed to that brand** did. The
hallucination that survives is the one wearing a real brand's clothes.

---

## 7. Provenance and verification

- Corpus: `Backend/knowledge/` — 131 files / 31,701 lines counted directly; **866 chunks across 6
  domains** counted from the source JSON. (This is the count of *ingestible* chunks in source. The
  live `knowledge_chunks` table was not queried — no database was accessed — so live chunk count and
  embedding coverage are unconfirmed.)
- Vendor knowledge: 52 vendors / 582 products / 298 aliases, confirmed at runtime from the service's
  own startup log line.
- Retrieval — `Backend/services/knowledgeService.js`: `retrieveForReport` `:443`; deterministic
  pass `:462-513`; unknown-vendor fallback `:515-541`; semantic pass `:548-584` (`minScore: 0.35`);
  `formatChunksForPrompt` `:602-639`.
- Budgets — `aiReportService.js:1395-1398`: 4,500 / 5,500 / 6,000 tokens; 15 / 18 / 20 chunks.
- Injected block — `:804-816`. Unknown-manufacturer constraint — `:661`. Brand allowlist —
  `:1182-1193`; detection `:1197-1204`.
- **Note:** regulatory chunks are **deliberately excluded from retrieval** (`knowledgeService.js:543-544`)
  — regulations are hardcoded in the system prompt instead, "more compact, always present,
  cacheable". So `VERIFIED REFERENCE DATA` in production carries vendor and diagnostic chunks, not
  regulatory ones.
- `knowledgeService.js` has **0% unit-test coverage.** The retriever — a component whose silent
  failure mode is "the grounding section is empty and nobody notices" — is not tested at all.
