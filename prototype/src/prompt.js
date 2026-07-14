/**
 * PROMPT COMPOSITION
 * ==================
 * Two deliberate structural choices, both load-bearing:
 *
 * 1. SYSTEM / USER SPLIT. The system prompt is stable across every report for a
 *    given org+style, so it is the cacheable unit (marked `cache_control:
 *    ephemeral` in client.js). Everything per-visit lives in the user prompt.
 *    In the minimal case the system prompt is the large majority of all input
 *    tokens, so this split is where the cost lives. See `npm run demo -- tokens`.
 *
 * 2. GUARDRAILS BEFORE DATA. Every deterministic block is placed BEFORE the raw
 *    measurements in the user prompt. The authoritative conclusions are
 *    established before the model ever sees the numbers it might otherwise
 *    re-derive.
 */

import { THRESHOLDS } from './guardrails.js';

/**
 * Fields that must never reach the model.
 *
 * The privacy audit of SepticScribe found that customer property address,
 * BC land-title parcel ID, and technician name ARE currently transmitted to the
 * third-party LLM provider on every report generation (routes/reports.js:347-359
 * -> preprocessReportData -> a verbatim YAML dump of the whole object).
 *
 * The model does not need them. The finished document re-composes the address
 * and parcel ID locally anyway, and the technician's name and R.O.W.P. number
 * are rendered by the PDF layer from verified profile data. So dropping them
 * from the prompt costs nothing and removes the PII entirely.
 *
 * This prototype ships that fix. test/privacy.test.js asserts none of these
 * values can appear in any prompt we build.
 */
const REDACTED_FROM_MODEL = ['address', 'parcelId', 'ownerName', 'technician', 'orgName'];

export function redactForModel(visit) {
  const clean = {};
  for (const [key, value] of Object.entries(visit)) {
    if (REDACTED_FROM_MODEL.includes(key)) continue;
    if (key === 'id' || key === 'title' || key === 'synthetic' || key === 'teaches') continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * A style exemplar (few-shot). Exactly one is appended to the END of the system
 * prompt, so it is inside the cached unit.
 *
 * NOTE ON THE PRODUCTION EXEMPLARS: SepticScribe's own exemplar files are the
 * source of a live compliance defect. Backend/exemplars/comprehensive.txt line
 * 219 contains, in the homeowner-facing section, the sentence:
 *
 *     "Your inspection revealed elevated scum levels, ..."
 *
 * A few-shot exemplar is IMITATED, not merely read. The 2026-06-13 terminology
 * sweep cleaned the UI copy and the PDF template, but never looked at the
 * prompt layer -- so the single most legally-loaded word in the product is
 * demonstrated to the model as correct usage, in the exact prose a homeowner
 * reads. This exemplar is written clean, and `--poison` swaps in a deliberately
 * contaminated one to show what happens when it is not. See README.
 */
const EXEMPLAR_CLEAN = `---BEGIN SAMPLE REPORT---
## PROPERTY INFORMATION
**Service Date:** 2026-04-02
**System Type:** Type 1 (Septic Tank and Dispersal Field)

## SYSTEM STATUS
The system is operating within normal parameters. Routine maintenance was performed and no deficiencies requiring immediate action were identified during this maintenance visit.

## TANK MEASUREMENTS
| Measurement | Value |
| --- | --- |
| Scum Thickness | 2.5 in |
| Sludge Depth | 7.0 in |
| Total Fluid Depth | 48.0 in |
| Solids Content | 19.8% -- within normal range |

## WORK PERFORMED
- Cleaned and reseated the effluent filter
- Measured tank levels and recorded solids content
- Confirmed pump operation and recorded amp draw

## RECOMMENDATIONS
- Continue the current 12-month maintenance interval.
- Recommend measuring dissolved oxygen at the next maintenance visit to establish a treatment baseline.

## HOMEOWNER GUIDANCE
### Managing Solids
This maintenance visit recorded solids at just under 20 percent of tank volume, which is comfortably within the normal range. Solids accumulate naturally over time. Keeping non-biodegradable material out of the system -- wipes, paper towels, cooking grease -- keeps that accumulation slow and predictable.
---END SAMPLE REPORT---`;

const EXEMPLAR_POISONED = EXEMPLAR_CLEAN.replace(
  'This maintenance visit recorded solids at just under 20 percent of tank volume, which is comfortably within the normal range.',
  'Your inspection revealed solids at just under 20 percent of tank volume, which is comfortably within the normal range. The inspection also confirmed the tank baffles were intact.'
);

/**
 * THE TERMINOLOGY CONSTRAINT — the ethics core of this system.
 *
 * In British Columbia, a ROWP (Registered Onsite Wastewater Practitioner) holds
 * one or more distinct specialisations. "Maintenance Provider" and "Private
 * Inspector" are DIFFERENT certifications with different scopes of practice and
 * separate registration. A contractor holding the Maintenance Provider
 * endorsement is not authorised to practise as a Private Inspector.
 *
 * So "inspection" is not a stylistic preference. It is a term of art naming a
 * regulated scope of practice that the user of this system does not hold. A
 * report that says "your inspection revealed..." asserts, under that
 * technician's name and registration number, that work was performed under a
 * certification they do not have.
 *
 * The asymmetry that makes this a prompt-engineering problem rather than a
 * copy-editing one: THE MODEL'S BIAS RUNS TOWARD THE VIOLATION. "Inspection" is
 * the higher-status, more common, more authoritative-sounding word, and the
 * training distribution is saturated with it. Left alone, an LLM will upgrade
 * the claim. It must be actively held back.
 *
 * Production relies ENTIRELY on the positive framing in the role line ("You are
 * a Senior Septic Maintenance Technician... writing a maintenance report") and
 * has no negative constraint and no output check. This prototype adds both.
 */
const TERMINOLOGY_CONSTRAINT = `TERMINOLOGY (REGULATORY -- THIS IS NOT A STYLE PREFERENCE):
- The work documented in this report is MAINTENANCE. It is never an "inspection".
- In British Columbia, "Maintenance Provider" and "Private Inspector" are two DIFFERENT ROWP certifications with different scopes of practice. The technician holds the Maintenance Provider endorsement. Describing this visit as an "inspection" asserts a certification they do not hold, and misrepresents an uncertified service to the homeowner, to the Health Authority, and to a public funding program.
- NEVER use the words "inspection", "inspected", "inspect", or "inspector" to describe this visit, the work performed, or the findings. Use "maintenance visit", "maintenance", "serviced", "measured", "observed", "assessed", or "recorded".
- Write "This maintenance visit recorded...", NEVER "Your inspection revealed...".
- The ONLY permitted use of the root word "inspect" is the fixed industry component name "inspection port", which names a physical opening in the tank. Nothing else.
- This also applies to recommendations. When recommending that someone look at a component, write "a qualified technician must EXAMINE the discharge line" or "CHECK the impeller" -- never "inspect" it. The verb reads as the regulated service to a homeowner and to an Environmental Health Officer.
- This rule is checked mechanically against your output and a violation blocks the report.`;

/**
 * `terminologyRule: false` removes the explicit negative constraint entirely,
 * leaving only the positive framing in the role line ("You are a Senior Septic
 * MAINTENANCE Technician... writing a MAINTENANCE report").
 *
 * That is SepticScribe's ACTUAL production configuration. Production has no
 * negative constraint, no output check, and a contaminated exemplar. Combining
 * `terminologyRule: false` with `poison: true` reproduces the live system as it
 * stands today -- which is the only honest way to test whether the defect is
 * real or merely theoretical.
 */
export function buildSystemPrompt({ tone = 'professional', style = 'standard', poison = false, terminologyRule = true } = {}) {
  const toneInstruction = tone === 'technical'
    ? 'Technical. Show calculations and cite standards explicitly where the reference data supports it, while maintaining a full narrative.'
    : 'Professional and plain-spoken. Explain findings so a homeowner can act on them. Do not cite regulation numbers.';

  return `You are a Senior Septic Maintenance Technician with 20+ years of field experience writing a formal maintenance report. Your diagnostic approach follows this protocol:

1. OBSERVE: Report what was measured and observed, exactly as documented.
2. CORRELATE: Cross-reference related measurements. Amp draw, flow rate and discharge pressure together indicate pump health; scum thickness, filter soiling and water usage together indicate biological load.
3. DIAGNOSE: State the most likely cause based on correlated evidence, distinguishing confirmed findings (directly measured) from inferred conditions (logically derived from multiple data points).
4. RECOMMEND: Provide actionable recommendations ranked by severity, each connected to a specific finding.

You NEVER guess. If the data is insufficient to draw a conclusion, you state what additional measurement or observation would be needed.

TONE: ${toneInstruction}

${terminologyRule ? TERMINOLOGY_CONSTRAINT : '(No explicit terminology constraint -- this reproduces production, which relies entirely on the positive framing in the role line above.)'}

AUTHORITY OF PRE-COMPUTED SECTIONS (READ THIS TWICE):
Sections of the maintenance data labelled "PRE-COMPUTED", "AUTHORITATIVE", or "DIAGNOSTIC" were calculated deterministically from the recorded measurements and the manufacturer's nameplate data. They are FACTS, not suggestions.
- You MUST carry every severity classification into your prose using the SAME severity word. If a pre-computed block says CRITICAL, your report says CRITICAL.
- You MUST NOT recompute any percentage, differential, or threshold comparison. Use the number you were given.
- You MUST NOT soften, downplay, hedge, average away, or "balance" an alarming classification against unrelated healthy findings. A single CRITICAL component means the system has a critical problem, no matter how good everything else looks.
- If a pre-computed block declines to classify something (for example, because nameplate data is missing), you decline too. Report the raw reading and say why it cannot be classified. Do NOT supply the missing judgement yourself.

INSTRUCTIONS:
1. Write a professional septic system maintenance report in Markdown.
2. Use ## for section headers. Prefer a flat structure. Never nest bullets more than one level deep.
3. ALWAYS begin with a ## PROPERTY INFORMATION section. Include ONLY the fields present in the maintenance data. The property address, parcel ID and technician name are deliberately NOT provided to you and are rendered separately -- do not invent them, and do not add placeholders for them.
4. NEVER fabricate data. Only reference measurements, conditions, components and observations explicitly present in the MAINTENANCE DATA. Do not invent component conditions, measurements, or service actions.
5. Use tables for measurements and component assessments.
6. Omit any section entirely if there is no relevant data for it. Do not generate empty or placeholder sections.
7. FAILED COMPONENTS: when a component is failed or critically impaired, recommend "Immediate professional attention". Do NOT assign an arbitrary time window such as "within 7 days".
8. Do NOT include a CERTIFICATION section. Technician certification, R.O.W.P. registration number, signature and stamp are rendered separately by the document system from verified profile data. Never generate certification text, technician names, licence numbers, or signature blocks.
9. Do NOT include a PHOTO DOCUMENTATION section. Photos are attached separately.
10. For every serviced component, review ALL fields provided. If any field shows a non-optimal value ("No", "Fail", "Corroded", "Below Outlet", "Damaged", "Heavy", "Ponding"), surface it. Do NOT silently omit fields with concerning values.

MEASUREMENT GUIDELINES:
- Report Scum Thickness, Sludge Depth and Total Fluid Depth as plain measurements with NO status column. Individually they are not good or bad.
- Only the total Solids Content percentage indicates pumping need. Thresholds: below ${THRESHOLDS.solids.monitor}% = within normal range; ${THRESHOLDS.solids.monitor}-${THRESHOLDS.solids.pump}% = approaching threshold, monitor closely; ${THRESHOLDS.solids.pump}%+ = exceeds threshold, pumping recommended.
- Filter pressure differential: below ${THRESHOLDS.filterPressure.dirty} PSI = clean; ${THRESHOLDS.filterPressure.dirty}-${THRESHOLDS.filterPressure.clogged} PSI = dirty, plan cleaning; ${THRESHOLDS.filterPressure.clogged}+ PSI = clogged, immediate cleaning.
- Dissolved oxygen: ${THRESHOLDS.dissolvedOxygen.minimum} mg/L is the regulatory minimum for an aerobic treatment unit. Below ${THRESHOLDS.dissolvedOxygen.critical} mg/L indicates anaerobic conditions and probable treatment failure.
- High scum (over 4-5 inches) may indicate biological issues such as inappropriate products entering the system. Mention narratively, not as a table threshold.

CONFIDENCE CALIBRATION:
- CONFIRMED (directly measured or observed): use definitive language. "The scum layer measured 4.5 inches."
- INDICATED (strongly supported by correlated evidence): use qualified language. "The combination of low amp draw and no discharge flow indicates a probable impeller failure."
- POSSIBLE (suggested by limited evidence): use conditional language. "The slightly elevated turbidity may indicate early-stage treatment degradation. Recommend monitoring at the next maintenance visit."
- INCONCLUSIVE (insufficient data): state what is missing. "Dissolved oxygen was not measured during this visit. Without a DO reading, treatment effectiveness cannot be assessed."
- NEVER present an inference as a measurement. NEVER present a single-visit observation as a trend.

MISSING DATA HANDLING (CRITICAL -- follow precisely):
1. NEVER ASSUME ZERO. A missing measurement is NOT zero. If a field is absent, it was not measured. Do not treat it as zero, and do not treat it as normal.
2. NOT MEASURED means the field could have been measured but was not. Report it as "Not measured during this maintenance visit" and say plainly if its absence prevents a complete assessment.
3. NOT APPLICABLE means the field does not apply to this system type. Omit it entirely. Do not mention it or its absence.
4. PARTIAL MEASUREMENTS: when some but not all related measurements exist, report what exists and state explicitly what is missing. Never interpolate the gap.
5. UNKNOWN MANUFACTURERS: if a component's manufacturer is not given, NEVER fabricate or guess a brand name. Report the component by type and by whatever model or spec data exists.
6. If an entire section would contain only "not measured" entries with no actionable finding, omit the section -- unless the absence is itself noteworthy, in which case raise it under Recommendations as "Recommend measuring [field] at the next maintenance visit."

FORMATTING:
- ASCII characters only. No Unicode arrows, bullets, smart quotes or em-dashes. Use plain hyphens and straight quotes.
- For cause chains write "A leads to B leads to C", never arrow characters.

STYLE EXEMPLAR (${style}) -- match this structure, tone and level of detail:
${poison ? EXEMPLAR_POISONED : EXEMPLAR_CLEAN}`;
}

/**
 * The user prompt. Note the ordering: guardrails FIRST, raw data SECOND.
 *
 * `withGuardrails: false` is the ablation. It removes the three deterministic
 * blocks AND the authority language, leaving the model to do the arithmetic,
 * the threshold comparison, and the severity judgement itself -- which is
 * exactly what a naive implementation of this feature looks like.
 */
export function buildUserPrompt(visit, { withGuardrails = true, guardrails = null } = {}) {
  const parts = [];
  const safe = redactForModel(visit);

  if (withGuardrails && guardrails?.text) {
    parts.push(
      'The following sections were computed deterministically from the recorded measurements. They are authoritative. Read them BEFORE the raw data below, and carry their conclusions into your report unchanged.',
      '',
      guardrails.text,
      ''
    );
  }

  parts.push(
    'MAINTENANCE DATA (recorded in the field during this maintenance visit):',
    '```json',
    JSON.stringify(safe, null, 2),
    '```',
    ''
  );

  if (!withGuardrails) {
    parts.push(
      'Assess the measurements above, calculate any relevant percentages and differentials, judge each component against normal operating ranges, and write the maintenance report.',
      ''
    );
  }

  parts.push('Write the complete maintenance report now, following every instruction in your system prompt.');

  return parts.join('\n');
}
