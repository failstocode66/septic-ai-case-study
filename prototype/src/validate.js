/**
 * OUTPUT VALIDATION
 * =================
 * Deterministic, zero-API-cost checks run against the model's markdown.
 *
 * DIVERGENCE FROM PRODUCTION, ON PURPOSE: SepticScribe's validateReportOutput()
 * is explicitly "Phase 1: log-only, non-blocking" (aiReportService.js:1451).
 * Its errors are written to the logger and the report ships anyway. That is
 * detection, not enforcement.
 *
 * Here, an error BLOCKS. A report that fails validation is never returned.
 * If you cannot mechanically guarantee the regulated word is absent, you do not
 * have a control -- you have a hope.
 */

/**
 * The only legitimate use of the root "inspect" in this domain: the fixed
 * industry name for a physical opening in the tank. Not a service
 * classification at all.
 */
const TERMINOLOGY_ALLOWLIST = [/inspection\s+ports?/gi];

/**
 * ~45 real septic-industry manufacturers. If the model names a brand that
 * appears nowhere in the source data, it invented it. Cheap and effective.
 */
const KNOWN_BRANDS = [
  'Zoeller', 'Orenco', 'Norweco', 'Infiltrator', 'Liberty', 'Goulds', 'Hydromatic',
  'Myers', 'Little Giant', 'Sta-Rite', 'Grundfos', 'Franklin Electric', 'Barnes',
  'Jet Inc', 'Clearstream', 'Aquaklear', 'Bio-Microbics', 'Hoot', 'Singulair',
  'Presby', 'Eljen', 'Geoflow', 'Netafim', 'Polylok', 'Tuf-Tite', 'Salcor',
  'Wedeco', 'Fuji', 'Nayadic', 'Multi-Flo', 'Ecoflo', 'Waterloo', 'Advantex',
  'Alderon', 'SJE Rhombus', 'Anua', 'Premier Tech', 'Enviro-Septic',
];

const PROHIBITED_SECTIONS = ['CERTIFICATION', 'PHOTO DOCUMENTATION'];

/**
 * TERMINOLOGY GATE -- and why a blunt grep is not good enough.
 *
 * The naive implementation of this check is `grep -i inspect`, blocking on any
 * hit. That is what this file did first, and it immediately blocked an
 * otherwise-correct report over the sentence:
 *
 *     "A qualified technician must inspect the pump discharge line."
 *
 * That is a forward-looking recommendation that someone go and LOOK at
 * something, using "inspect" in its ordinary English sense. It does not assert
 * that this maintenance visit was a regulated inspection. Blocking it would
 * make the gate unusable -- you cannot write maintenance recommendations in
 * English without the verb.
 *
 * The regulated claim is narrower and sharper than "the string appears". The
 * violation is ASSERTING THAT AN INSPECTION OCCURRED, or that this document is
 * an inspection report. Hence two tiers:
 *
 *   BLOCKING  the nouns ("inspection", "inspections", "inspector") and the past
 *             tense used ATTRIBUTIVELY or ACTIVELY -- "components inspected
 *             during this visit", "we inspected the tank", "the tank was
 *             inspected". These assert the regulated act happened.
 *             "Your inspection revealed..." was the exact sentence sitting in
 *             SepticScribe's production few-shot exemplar
 *             (Backend/exemplars/comprehensive.txt:219, fixed in c391dc5).
 *
 *   ADVISORY  the bare verb ("inspect", "inspects", "inspecting") AND the
 *             passive/causative future ("must be inspected", "has been
 *             inspected", "have this inspected"). These recommend future work.
 *             Ambiguous rather than false. Surfaced, not blocked.
 *
 *   ALLOWED   "inspection port" / "inspection ports".
 *
 * THE PAST PARTICIPLE IS THE HARD CASE, AND AN EARLIER VERSION OF THIS FILE GOT
 * IT WRONG. The first implementation blocked every "inspected", which silently
 * swept up passive recommendations -- "the pump must be inspected by a service
 * technician" -- that assert nothing about what this visit was. They are the
 * same advisory usage the carve-out below exists to permit, merely in the
 * passive voice. Counting them inflated the measured leak rate substantially.
 * The instrument has to measure the claim you are actually making, or the number
 * it produces is worse than no number: it is a number that looks earned.
 *
 * Drawing this line is the entire difficulty of mechanising a compliance rule,
 * and it deserves to be said plainly: the rule is easy to state and hard to
 * enforce. A gate that over-blocks gets switched off, and a gate that is
 * switched off enforces nothing.
 */

/**
 * Deciding whether a given "inspected" ASSERTS or ADVISES is a clause-level
 * judgement, and a naive "is the previous word 'be'?" test is not enough. Real
 * model output, captured in this experiment, includes all of these:
 *
 *   "the pump must be stopped and inspected for impeller integrity"   <- advice
 *   "do not operate the system until the pump is inspected"           <- advice
 *   "until the pump has been inspected and repaired"                  <- advice
 *   "have this inspected as soon as possible"                         <- advice
 *   "all other components inspected during this visit are in good..." <- ASSERTION
 *   "the tank was inspected on arrival"                               <- ASSERTION
 *
 * So the participle is read in the context of its clause. It is ADVICE when the
 * clause is governed by a modal or an infinitive ("must/should/will/needs to/to
 * be ... inspected"), by a temporal or conditional subordinator that places the
 * act in the future ("until/before/once/unless/if ... is inspected"), or by a
 * causative ("have/get it inspected"). Otherwise it is a factual claim about
 * what was done -- an ASSERTION, and a violation.
 *
 * This is imperfect, and the honest thing is to say so: it is a heuristic over
 * English, not a parser. That is exactly why every raw model output from the
 * experiment is committed to fixtures/experiment-raw/ -- so the classification
 * can be audited, and re-scored against a different definition, by anyone who
 * doubts this one.
 */
const ADVISORY_GOVERNORS =
  /\b(?:must|should|shall|will|would|can|could|may|might|need|needs|needed to|has to|have to|had to|require|requires|required|recommend|recommends|recommended|advise|advises|advised|until|before|once|unless|whether|if|when|after|pending|awaiting|to be|to have)\b/i;

/** Causative: "have this inspected", "get the pump inspected". */
const CAUSATIVE = /\b(?:have|has|had|having|get|gets|getting|got)\s+(?:[\w'-]+\s+){0,3}$/i;

/** Immediately passive: "be/been/being [coordinated verb and] inspected". */
const PASSIVE_HEAD = /\b(?:be|been|being)\b(?:\s+[\w'-]+){0,3}\s+(?:and\s+|or\s+)?$/i;

/**
 * @param {string} clause - text of the sentence/clause up to (not including) the match
 * @returns {boolean} true if this "inspected" advises future work rather than asserting
 */
function isAdvisoryParticiple(clause) {
  return PASSIVE_HEAD.test(clause) || CAUSATIVE.test(clause) || ADVISORY_GOVERNORS.test(clause);
}

export function findTerminologyViolations(markdown) {
  // Blank out allowlisted phrases so their internal "inspection" cannot match,
  // preserving offsets so the context snippets stay accurate.
  let scannable = markdown;
  for (const allowed of TERMINOLOGY_ALLOWLIST) {
    scannable = scannable.replace(allowed, (m) => ' '.repeat(m.length));
  }

  const snippet = (index, len) => {
    const start = Math.max(0, index - 55);
    const end = Math.min(markdown.length, index + len + 55);
    return markdown.slice(start, end).replace(/\s+/g, ' ').trim();
  };

  const blocking = [];
  const advisory = [];
  let m;

  // Tier 1a: the past participle. Blocking ONLY when it is not a passive/causative
  // future -- i.e. "components inspected during this visit" blocks, but
  // "the pump must be inspected by a technician" is advice and does not.
  const inspected = /\binspected\b/gi;
  while ((m = inspected.exec(scannable)) !== null) {
    // The governing clause: back to the previous sentence boundary, semicolon,
    // bullet or line break. That is the scope in which the modal / subordinator
    // that makes this advice rather than a claim would appear.
    const before = scannable.slice(0, m.index);
    const clauseStart = Math.max(
      before.lastIndexOf('. '), before.lastIndexOf('.\n'), before.lastIndexOf('!'),
      before.lastIndexOf('?'), before.lastIndexOf(';'), before.lastIndexOf('\n'),
      before.lastIndexOf('- ')
    );
    const clause = before.slice(clauseStart + 1);
    const entry = { word: m[0], index: m.index, context: snippet(m.index, m[0].length) };
    (isAdvisoryParticiple(clause) ? advisory : blocking).push(entry);
  }

  // Tier 1b (blocking): the nouns. These always name the regulated act or document class.
  const nouns = /\binspect(?:ions?|ors?)\b/gi;
  while ((m = nouns.exec(scannable)) !== null) {
    blocking.push({ word: m[0], index: m.index, context: snippet(m.index, m[0].length) });
  }

  // Tier 2 (advisory): bare verb, typically a forward-looking recommendation.
  const verbs = /\binspect(?:ing|s)?\b/gi;
  while ((m = verbs.exec(scannable)) !== null) {
    advisory.push({ word: m[0], index: m.index, context: snippet(m.index, m[0].length) });
  }

  return { blocking, advisory };
}

export function validateReport(markdown, { guardrails = null, visit = null } = {}) {
  const errors = [];
  const warnings = [];

  // ---- regulated terminology --------------------------------------------
  const term = findTerminologyViolations(markdown);
  for (const v of term.blocking) {
    errors.push({
      code: 'TERMINOLOGY',
      message: `Report uses "${v.word}" to describe the work or its findings. That asserts a Private Inspector certification the technician does not hold.`,
      context: v.context,
    });
  }
  for (const v of term.advisory) {
    warnings.push({
      code: 'TERMINOLOGY_VERB',
      message: `Report uses the verb "${v.word}". Ambiguous rather than false -- it recommends future work rather than claiming an inspection occurred. Prefer "examine", "check" or "assess".`,
      context: v.context,
    });
  }

  // ---- prohibited sections (legally-loaded content) ----------------------
  for (const section of PROHIBITED_SECTIONS) {
    const re = new RegExp(`^#{1,3}\\s*${section}\\b`, 'im');
    if (re.test(markdown)) {
      errors.push({
        code: 'PROHIBITED_SECTION',
        message: `Report generated a ${section} section. This content carries the technician's registration number and must be rendered from verified profile data, never by the model.`,
      });
    }
  }

  // ---- dropped or softened severity --------------------------------------
  // The core guardrail contract, and the check that catches
  // hallucination-as-reassurance. If the deterministic layer computed CRITICAL,
  // the prose must say CRITICAL. Silence here IS the failure mode.
  //
  // This runs against ground truth whether or not the facts were injected into
  // the prompt -- that is what makes the --no-guardrails ablation meaningful.
  if (guardrails?.assertedSeverities?.length) {
    const upper = markdown.toUpperCase();
    for (const severity of guardrails.assertedSeverities) {
      if (!upper.includes(severity)) {
        errors.push({
          code: 'SEVERITY_DROPPED',
          message: `The deterministic layer computed "${severity}" for this visit, but the report never uses that classification. The model softened, averaged away, or omitted an authoritative finding.`,
        });
      }
    }
  }

  // ---- refusal not honoured ----------------------------------------------
  // Where the deterministic layer DECLINED to conclude (no nameplate on file,
  // sludge never measured), the model must acknowledge the gap, not fill it.
  for (const refusal of guardrails?.refusals ?? []) {
    // (a) The gap must be acknowledged.
    if (!markdown.toLowerCase().includes(refusal.mustMention.toLowerCase())) {
      errors.push({
        code: 'REFUSAL_IGNORED',
        message: `The deterministic layer declined to conclude on ${refusal.subject} (${refusal.because}), and the report never acknowledges that gap. A missing measurement must never read as a normal one.`,
      });
    }

    // (b) And it must not then be quietly filled. Acknowledging a missing
    // nameplate and then writing "within the typical range for a 0.5 hp pump"
    // is still a normalcy judgement with nothing behind it. Checked only in
    // sentences that actually discuss the refused subject.
    if (refusal.mustNotAssert && refusal.subjectPattern) {
      const sentences = markdown.split(/(?<=[.!?])\s+|\n/);
      for (const sentence of sentences) {
        if (!refusal.subjectPattern.test(sentence)) continue;
        if (!refusal.mustNotAssert.test(sentence)) continue;
        errors.push({
          code: 'REFUSAL_OVERRIDDEN',
          message: `The deterministic layer declined to classify ${refusal.subject} (${refusal.because}), but the report asserts a normalcy judgement anyway. The model supplied a conclusion it had no basis for.`,
          context: sentence.replace(/\s+/g, ' ').trim().slice(0, 150),
        });
        break;
      }
    }
  }

  // ---- hallucinated manufacturer -----------------------------------------
  const sourceText = JSON.stringify(visit ?? {}).toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    const escaped = brand.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(markdown) && !sourceText.includes(brand.toLowerCase())) {
      errors.push({
        code: 'HALLUCINATED_BRAND',
        message: `Report names manufacturer "${brand}", which appears nowhere in the source data. The model invented equipment.`,
      });
    }
  }

  // ---- unmentioned component (warning) ------------------------------------
  // Match on the component's distinguishing noun, not its full label -- a
  // report that says "the tank" has plainly not omitted the Primary Tank.
  for (const component of visit?.components ?? []) {
    const noun = (component.type || '').split('_').pop();
    if (!noun) continue;
    if (!markdown.toLowerCase().includes(noun.toLowerCase())) {
      warnings.push({
        code: 'COMPONENT_UNMENTIONED',
        message: `Component "${component.label || component.type}" was serviced but is not mentioned in the report.`,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checked: {
      terminology: true,
      prohibitedSections: true,
      severityCarriedThrough: Boolean(guardrails?.assertedSeverities?.length),
      refusalsHonoured: Boolean(guardrails?.refusals?.length),
      brands: true,
    },
  };
}
