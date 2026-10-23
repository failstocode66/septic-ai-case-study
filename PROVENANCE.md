# Provenance

What in this repository came from where, what a reader can check from this repository alone, and
what is reported rather than shown. Written 2026-10-22, against the repository as of commit
`15d89da`.

This file adds to the other documents; it does not replace them. Earlier wording of every document
here remains in this repository's Git history (for example, `git show 15d89da:README.md`), so a
correction made alongside this file is an addition to the record, not an erasure of it.

Nothing here is legal advice, and nothing here is a licensing determination.

---

## Notices

- **[LICENSE](LICENSE)** — MIT, *Copyright (c) 2026 Rainshadow Systems Ltd.* Unchanged.
- **[BLOG-POST.md](BLOG-POST.md)** carries its own byline: *Rainshadow Systems · draft, unpublished*.
- **Quoted third-party material** — short extracts from BC Reg 326/2004, the Standard Practice Manual
  V3, and ASTTBC documents — is attributed to its publishers, with URLs, in [SOURCES.md](SOURCES.md).
  This file does not characterise its licensing.
- **The prototype's one dependency**, `@anthropic-ai/sdk`, is declared in `prototype/package.json`
  and is not vendored; it is fetched, under its own licence, by `npm install`.

---

## What each part of this repository is

| Category | Paths | Where it came from | What a reader can check here |
|---|---|---|---|
| **Independently reduced prototype** | `prototype/src/` (except `measure-production-prompt.js`), `prototype/test/` | Written for this repository. It re-implements the product's deterministic layer in reduced form; no product source file is vendored. `src/guardrails.js` names, in its header, the production functions it was ported from (file and line at the audited commit) and where it deliberately diverges; `src/prompt.js` and `src/validate.js` document their own divergences. | `npm test` in `prototype/` — offline, no API key, and no `npm install` needed: the tests import only Node built-ins and `src/guardrails.js`, `src/prompt.js`, `src/validate.js`. |
| **Synthetic inputs** | `prototype/fixtures/visits/`, `prototype/fixtures/production/worked-example.json`, the example payloads in `prompts/` | Invented for this repository. No real person, property, business, or credential number. | Read them; `prototype/test/privacy.test.js` pins the sentinel conventions. |
| **Adapted prompt text** | `prompts/01`–`04`, `07`, `08`, `15` — the seven marked HARVESTED (`07` and `08` also extended) | Quoted from the product's prompt layer at the audited commit `a37c4d9` (2026-07-13), with file and line citations, then annotated. The other eight prompt files are newly designed for this case study. | The quotations are here. The source they cite is private, so the citations cannot be followed from this repository. |
| **Captured model output** | `prototype/fixtures/replay/` (6 responses), `prototype/fixtures/experiment-raw/` (48 responses), `prototype/fixtures/experiment-terminology.json` (the scored summary) | Produced by `claude-haiku-4-5` on 2026-07-14 — each replay fixture records `capturedAt` and `model`; the summary records `measuredAt` — and committed unedited. They are evidence, not prose written for the documents. | Re-score them offline with `node src/rescore.js` (it rewrites the summary file), or replay them with the demo after `npm install`. That they came from the model is recorded, not provable from the bytes. |
| **Audit-time production transcripts** | Deterministic-injector output quoted in `CASE-STUDY.md` §3.4 and in `prompts/02`, `10`, `13` | Verbatim from the product as audited, including wording later reported fixed (for example `BELOW REGULATORY MINIMUM`). Left as captured, on purpose. | They are quotations; they cannot be regenerated here. |
| **Private-only measurements** | `CASE-STUDY.md` §4.1 (test counts, coverage, knowledge-base and chunk counts, prompt sizes); `prototype/src/measure-production-prompt.js` | Measured against the private product. §4.1 is dated to `a37c4d9`, except the two prompt-size figures, which come from a post-`c391dc5` checkout (the script's own redaction check cannot pass against an earlier one). | Not reproducible from this repository. The script needs a private checkout and exits without one; neither `npm test` nor `npm run demo` runs or imports it. |
| **Regulatory sources** | [SOURCES.md](SOURCES.md) | Primary sources, read on 2026-07-14. | The URLs are public. They have **not** been re-checked since 2026-07-14, and nothing here claims they are current. |
| **Practitioner knowledge** | The maintenance/inspection boundary (`CASE-STUDY.md` §2.3) | The author's own experience in the trade, labelled as such. | It is attested, not cited. |

---

## Reported product fixes — dated status

Every *fixed in `<commit>`* in this repository refers to a commit in the private SepticScribe
repository. Each is the author's report as of the date shown. None is independently verified here,
and none has been re-checked since.

| Defect (where described) | As audited, `a37c4d9` (2026-07-13) | Reported fix | What this repository shows directly |
|---|---|---|---|
| The regulated word *inspection* in the few-shot exemplar; no prompt rule; a log-only output check (`CASE-STUDY.md` §6.2, `prompts/05`) | Present | `c391dc5`, 2026-07-14 | The measured effect (48 committed outputs), and the prototype's blocking two-tier check, pinned by `prototype/test/validate.test.js`. |
| Property address, parcel ID, and technician name sent to the model provider (§6.5) | Present | `c391dc5`, 2026-07-14 | The prototype's redaction, pinned by `prototype/test/privacy.test.js`. |
| An authoritative prompt block attributing the severity scale to a standard it does not come from (§3.4) | Present | `c391dc5`, 2026-07-14 | The prototype's corrected attribution (`prototype/src/guardrails.js` header). |
| A deterministic guardrail silently dead on the system it was written for (§5.8) | Present | `276cf32`, 2026-07-14 | Nothing beyond the description. |
| Dissolved oxygen below 2.0 mg/L labelled `BELOW REGULATORY MINIMUM` (§5.10) | Present | `b2f9ef2`, 2026-07-15 | The prototype emits `BELOW OPERATIONAL THRESHOLD` (`prototype/src/guardrails.js`). No prototype test pins that label. |
| A regulatory corpus that cites no sources (§2.3, §6.3) | Present | **None reported** — open as of the last report | — |

### Text written before a later report

Some files were written on 2026-07-14, before the dissolved-oxygen fix was reported, and still
describe the label as an open or live defect: `prompts/02` (the note under §2d), `prompts/05` (its
closing section), `prompts/07` (two places), `prompts/09` (§6), `prototype/README.md` (the threshold
note), and a code comment in `prototype/src/guardrails.js`. They were accurate when written and are
left as dated text. Where they disagree with the table above, the table is the later status.
