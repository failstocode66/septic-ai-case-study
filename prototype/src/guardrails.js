/**
 * DETERMINISTIC FACT INJECTION
 * =============================
 * The central technique this prototype demonstrates.
 *
 * Thesis: an LLM is unreliable at arithmetic and — more dangerously — is biased
 * toward *reassurance*. Asked to write a "professional maintenance report", it
 * will smooth an alarming reading into comfortable prose. So we move every
 * judgement that carries consequence OUT of the model and into JavaScript, and
 * inject the *results* as facts the model is forbidden to relitigate.
 *
 * The model's remaining job is narrative prose, formatting, and tone.
 *
 * Ported from SepticScribe's Backend/aiReportService.js (production):
 *   - computeAmpDrawDiagnostics        (aiReportService.js:211-272)
 *   - computeNumericalClassifications  (aiReportService.js:283-339)
 *   - computeSystemCorrelations        (aiReportService.js:350-391)
 *   - getFinding                       (aiReportService.js:191-200)
 *
 * DELIBERATE DIVERGENCE FROM PRODUCTION (documented in README "Known defects"):
 * production defines the solids thresholds in three places that disagree with
 * each other (25% vs 33%). Here they are defined ONCE, in THRESHOLDS, and both
 * the classifier and the prompt's guideline text read from it.
 */

/**
 * Single source of truth for every threshold. Production scatters these across
 * aiReportService.js, solidsAnalysisService.js, and the system prompt text —
 * and they disagree. One constant, read by both the classifier and the prompt.
 */
export const THRESHOLDS = {
  solids: { monitor: 25, pump: 33 },          // percent of fluid depth
  filterPressure: { dirty: 3, clogged: 5 },   // PSI differential
  dissolvedOxygen: { minimum: 2.0, critical: 1.0 }, // mg/L
};

/**
 * 7-tier amp-draw severity scale, measured against the pump's manufacturer
 * nameplate Full Load Amps (FLA). Each tier carries a causal explanation so the
 * model has something true to narrate instead of inventing a story.
 *
 * The 125% ceiling is the NEC 430.32 overload-trip threshold.
 */
const AMP_SEVERITY_TIERS = [
  { min: 0, max: 30, label: 'CRITICAL - No Load',
    detail: 'Pump running but no hydraulic load detected. Possible causes: dry run (no fluid), broken or missing impeller, severed or disconnected discharge line. Motor damage risk from overheating without fluid cooling.' },
  { min: 30, max: 50, label: 'CRITICAL - Severe Underload',
    detail: 'Pump drawing far below normal operating current. Possible causes: damaged or eroded impeller, air lock in pump or discharge line, broken discharge pipe allowing free flow, check valve failure.' },
  { min: 50, max: 70, label: 'WARNING - Underload',
    detail: 'Pump drawing below normal operating range. Possible causes: worn impeller reducing efficiency, partial air lock, abnormally low discharge head, partially open bypass.' },
  { min: 70, max: 100, label: 'Normal Operating Range',
    detail: 'Pump operating within expected parameters. Optimal range is 80-90% FLA for residential effluent pumps.' },
  { min: 100, max: 115, label: 'Elevated - Service Factor Range',
    detail: 'Drawing above nameplate but within typical service factor range. Acceptable short-term if motor service factor is 1.15 or greater. Monitor on subsequent visits.' },
  { min: 115, max: 125, label: 'WARNING - Overload',
    detail: 'Pump drawing significantly above nameplate rating. Possible causes: clogged impeller or discharge, debris in pump, worn bearings increasing friction, excessive discharge head from pipe restrictions.' },
  { min: 125, max: Infinity, label: 'CRITICAL - Overload',
    detail: 'Motor damage imminent or occurring. Exceeds the NEC 430.32 trip threshold of 125% FLA. Possible causes: seized or binding impeller, severe pipe obstruction, failed bearing, locked rotor condition approaching.' },
];

/**
 * Resolve a finding by its bare registry field id, tolerant of the stored key
 * shape. Findings arrive PREFIXED as `<componentType>_<index>_<fieldId>`
 * (e.g. `septic_tank_0_scum_inches`), but classifiers reference bare ids
 * (`scum_inches`).
 *
 * THIS FUNCTION IS THE WHOLE LESSON. In production, the classifiers read bare
 * ids directly against prefixed data, so they matched nothing and returned ''.
 * The prompt section simply vanished — no error, no alarm, no log line — and
 * the model quietly went back to doing the arithmetic itself. The reports still
 * looked perfect. A guardrail that fails OPEN is worse than no guardrail,
 * because it manufactures false confidence.
 *
 * (Fixed in SepticScribe commit 9cf8686, 2026-06-16. See test/guardrails.test.js
 * — `bare-key lookup silently returns nothing on prefixed data` — which pins the
 * regression so it cannot come back.)
 */
export function getFinding(findings, fieldId) {
  if (!findings || typeof findings !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(findings, fieldId)) return findings[fieldId];
  const escaped = fieldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffix = new RegExp(`_\\d+_${escaped}$`);
  for (const key of Object.keys(findings)) {
    if (suffix.test(key)) return findings[key];
  }
  return undefined;
}

/**
 * (a) PUMP AMP DRAW — the flagship guardrail.
 *
 * The failure this prevents is NOT arithmetic error. It is the model's
 * regression-to-normal instinct: a pump drawing 22% of nameplate FLA is a
 * dry-running motor about to burn out, and an LLM writing "professional
 * maintenance report" prose will happily render that as "pump amp draw was low;
 * continue to monitor." The guardrail removes the *judgement* and leaves only
 * the *prose*.
 *
 * Note the no-nameplate branch: if FLA is not configured we instruct the model
 * to report the raw reading WITHOUT classification and explicitly not to guess.
 * Refusing to classify beats classifying badly.
 */
export function computeAmpDrawDiagnostics({ findings = {}, components = [] }) {
  const readings = [];
  for (const [key, value] of Object.entries(findings)) {
    const match = key.match(/^pump_(\d+)_pump_current_draw$/);
    if (!match) continue;
    const measuredAmps = parseFloat(value);
    if (!Number.isNaN(measuredAmps) && measuredAmps > 0) {
      readings.push({ pumpIndex: parseInt(match[1], 10), measuredAmps });
    }
  }
  if (readings.length === 0) return { text: '', severities: [], refusals: [] };

  const pumps = components.filter((c) => c.type === 'pump');
  const lines = [];
  const severities = [];
  const refusals = [];

  for (const reading of readings) {
    const nameplateAmps = parseFloat(pumps[reading.pumpIndex]?.specs?.nameplateAmps);

    // Designed refusal: no nameplate => no classification, and say so.
    if (!nameplateAmps || nameplateAmps <= 0) {
      lines.push(
        `Pump ${reading.pumpIndex}: Measured ${reading.measuredAmps}A -- nameplate FLA is not configured for this pump, so the reading CANNOT be classified against the severity scale. Report the amp draw reading as-is, with no severity classification. State that nameplate data is required for a proper assessment. Do NOT guess or assume an FLA value.`
      );
      refusals.push({
        subject: `pump ${reading.pumpIndex} amp draw`,
        because: 'nameplate FLA is not on file',
        // The report must ACKNOWLEDGE the gap...
        mustMention: 'nameplate',
        // ...and must not then quietly FILL it. Acknowledging a missing
        // nameplate and then adding "3.1A is within the typical range for a
        // 0.5 hp pump" is still an unfounded normalcy judgement -- there is
        // nothing to compare the reading against. Scoped to sentences that
        // actually discuss the pump, so a legitimate "solids within normal
        // range" elsewhere in the report does not false-positive.
        subjectPattern: /amp|current draw|\bpump\b/i,
        mustNotAssert: /typical range|within normal|normal range|normal operating|operating normally|appears normal|acceptable range|no concern/i,
      });
      continue;
    }

    const percentage = (reading.measuredAmps / nameplateAmps) * 100;
    const tier = AMP_SEVERITY_TIERS.find((t) => percentage >= t.min && percentage < t.max);
    if (tier) {
      lines.push(
        `Pump ${reading.pumpIndex}: ${reading.measuredAmps}A measured / ${nameplateAmps}A nameplate = ${percentage.toFixed(1)}% FLA -- ${tier.label}. ${tier.detail}`
      );
      if (tier.label.startsWith('CRITICAL')) severities.push('CRITICAL');
      else if (tier.label.startsWith('WARNING')) severities.push('WARNING');
    }
  }

  if (lines.length === 0) return { text: '', severities: [], refusals: [] };

  const text = `PUMP AMP DRAW DIAGNOSTIC (pre-computed from manufacturer nameplate data -- AUTHORITATIVE, DO NOT override):
${lines.join('\n')}

IMPORTANT: These classifications are computed server-side from manufacturer nameplate data and industry-standard thresholds (NEC 430, DOE motor efficiency standards). You MUST use these exact severity classifications in your report. Do NOT rationalize, downplay, soften, or reinterpret any CRITICAL or WARNING classification -- they indicate real equipment problems requiring immediate attention. If a classification says CRITICAL, the report says CRITICAL.`;

  return { text, severities, refusals };
}

/**
 * (b) NUMERICAL CLASSIFICATIONS — arithmetic and threshold comparison in JS.
 *
 * Handles partial data explicitly: if only some tank measurements exist, we say
 * so, pre-empting the model's urge to fill the gap. A missing measurement is
 * NOT zero.
 */
export function computeNumericalClassifications({ findings = {} }) {
  const out = [];
  const severities = [];
  const refusals = [];

  const scum = parseFloat(getFinding(findings, 'scum_inches'));
  const sludge = parseFloat(getFinding(findings, 'sludge_inches'));
  const depth = parseFloat(getFinding(findings, 'total_fluid_depth'));

  if (!Number.isNaN(scum) && !Number.isNaN(sludge) && !Number.isNaN(depth) && depth > 0) {
    const combined = scum + sludge;
    const pct = (combined / depth) * 100;
    const status =
      pct >= THRESHOLDS.solids.pump ? `EXCEEDS THRESHOLD (>=${THRESHOLDS.solids.pump}%) -- pumping recommended`
      : pct >= THRESHOLDS.solids.monitor ? `APPROACHING THRESHOLD (>=${THRESHOLDS.solids.monitor}%) -- monitor closely`
      : 'WITHIN NORMAL RANGE';
    if (pct >= THRESHOLDS.solids.pump) severities.push('EXCEEDS THRESHOLD');
    out.push(`SOLIDS: ${combined.toFixed(1)}" combined (${scum}" scum + ${sludge}" sludge) / ${depth}" fluid depth = ${pct.toFixed(1)}% -- ${status}`);
  } else if (!Number.isNaN(scum) || !Number.isNaN(sludge) || !Number.isNaN(depth)) {
    // Partial tank data. Name exactly what is missing; compute nothing.
    const have = [];
    const missing = [];
    if (!Number.isNaN(scum)) have.push(`scum: ${scum}"`); else missing.push('scum_inches');
    if (!Number.isNaN(sludge)) have.push(`sludge: ${sludge}"`); else missing.push('sludge_inches');
    if (!Number.isNaN(depth) && depth > 0) have.push(`total fluid depth: ${depth}"`); else missing.push('total_fluid_depth');
    out.push(`SOLIDS: PARTIAL DATA -- ${have.join(', ')} measured. The solids percentage CANNOT be computed because ${missing.join(' and ')} was not measured. Do NOT estimate, infer, or treat the missing value as zero. Report the measurements that exist and state plainly that the solids percentage could not be determined.`);
    // NOTE: "PARTIAL DATA" is deliberately NOT pushed as a severity.
    //
    // Severities are words the prose must carry VERBATIM ("CRITICAL" means the
    // report says CRITICAL). "PARTIAL DATA" is an internal classification label,
    // not something a well-written report would ever print at a homeowner. An
    // earlier draft required it verbatim and blocked a CORRECT report that had
    // properly written "sludge depth was not measured on this visit".
    //
    // A gap the model must ACKNOWLEDGE is a refusal, not a severity. Different
    // obligation, different check.
    refusals.push({
      subject: 'solids percentage',
      because: `${missing.join(' and ')} not measured`,
      mustMention: 'not measured',
    });
  }

  const pre = parseFloat(getFinding(findings, 'pre_filter_pressure'));
  const post = parseFloat(getFinding(findings, 'post_filter_pressure'));
  if (!Number.isNaN(pre) && !Number.isNaN(post)) {
    const diff = pre - post;
    const status =
      diff >= THRESHOLDS.filterPressure.clogged ? 'CLOGGED -- immediate cleaning required'
      : diff >= THRESHOLDS.filterPressure.dirty ? 'DIRTY -- plan cleaning at next service'
      : 'CLEAN -- filter in good condition';
    if (diff >= THRESHOLDS.filterPressure.clogged) severities.push('CLOGGED');
    out.push(`FILTER PRESSURE: ${pre} PSI (pre) - ${post} PSI (post) = ${diff.toFixed(1)} PSI differential -- ${status}`);
  }

  const dox = parseFloat(getFinding(findings, 'dissolved_oxygen_mgl'));
  if (!Number.isNaN(dox)) {
    const status =
      dox >= THRESHOLDS.dissolvedOxygen.minimum ? `MEETS REGULATORY MINIMUM (>=${THRESHOLDS.dissolvedOxygen.minimum} mg/L)`
      : dox >= THRESHOLDS.dissolvedOxygen.critical ? 'BELOW REGULATORY MINIMUM -- treatment impaired'
      : 'CRITICAL -- anaerobic conditions, treatment failure likely';
    if (dox < THRESHOLDS.dissolvedOxygen.critical) severities.push('CRITICAL');
    out.push(`DISSOLVED OXYGEN: ${dox} mg/L -- ${status}`);
  }

  if (getFinding(findings, 'liquid_level_relative') === 'Below Outlet') {
    out.push('LIQUID LEVEL: Below outlet -- ABNORMAL. Possible tank leak, recent heavy pumping, or downstream blockage. Recommend investigation of structural integrity.');
    severities.push('ABNORMAL');
  }

  if (out.length === 0) return { text: '', severities: [], refusals: [] };

  const text = `PRE-COMPUTED MEASUREMENT CLASSIFICATIONS (use these directly -- do NOT recompute):
${out.map((c) => `- ${c}`).join('\n')}

IMPORTANT: Every number and classification above was produced by deterministic calculation, not estimation. Use these values verbatim. Do NOT recalculate percentages, re-derive thresholds, or substitute your own judgement for a classification.`;

  return { text, severities, refusals };
}

/**
 * (c) CROSS-COMPONENT CORRELATIONS — the most conceptually interesting one.
 *
 * The model treats each component in isolation. These hand-coded multi-signal
 * rules connect symptoms across components to name a ROOT CAUSE, so the report
 * says "the drainfield is stressed because treatment upstream has failed"
 * rather than listing two unrelated problems.
 *
 * Honest limitation: three hand-written rules do not scale. This is a
 * demonstration of the pattern, not a rules engine.
 */
export function computeSystemCorrelations({ findings = {}, components = [] }) {
  const out = [];

  const dox = parseFloat(getFinding(findings, 'dissolved_oxygen_mgl'));
  const blower = components.find((c) => c.type === 'air_blower');
  const clarity = getFinding(findings, 'effluent_clarity');

  // 1. Treatment effectiveness: low DO + non-clear effluent => treatment degradation.
  if (!Number.isNaN(dox) && dox < THRESHOLDS.dissolvedOxygen.minimum && clarity && clarity !== 'Clear') {
    const blowerNote = blower && blower.condition !== 'Good'
      ? `The blower condition is "${blower.condition}". The root cause is most likely the blower -- addressing it should restore dissolved oxygen and effluent quality.`
      : 'The blower appears functional, so chemical interference or excessive organic loading may be suppressing biological activity.';
    out.push(`TREATMENT SYSTEM: Low dissolved oxygen (${dox} mg/L) + ${String(clarity).toLowerCase()} effluent = TREATMENT DEGRADATION. ${blowerNote}`);
  }

  // 2. Filter lifecycle: heavy soiling + high solids reinforce each other.
  const scum = parseFloat(getFinding(findings, 'scum_inches'));
  const sludge = parseFloat(getFinding(findings, 'sludge_inches'));
  const depth = parseFloat(getFinding(findings, 'total_fluid_depth'));
  let solidsPct = NaN;
  if (!Number.isNaN(scum) && !Number.isNaN(sludge) && !Number.isNaN(depth) && depth > 0) {
    solidsPct = ((scum + sludge) / depth) * 100;
  }
  if (getFinding(findings, 'effluent_filter_soiling') === 'Heavy' && !Number.isNaN(solidsPct) && solidsPct > 30) {
    out.push(`FILTER / SOLIDS: Heavy filter soiling + ${solidsPct.toFixed(1)}% solids = the system is under excessive load. These two conditions reinforce each other: high solids pass through a stressed filter, accelerating downstream fouling.`);
  }

  // 3. Drainfield stress is DOWNSTREAM of treatment failure, not soil age.
  const surfaceText = JSON.stringify(findings).toLowerCase();
  const hasSurfaceIssue = /breakout|ponding|saturated|standing water/.test(surfaceText);
  if (hasSurfaceIssue && !Number.isNaN(dox) && dox < THRESHOLDS.dissolvedOxygen.minimum) {
    out.push(`DRAINFIELD + TREATMENT: Surface water issues observed AND low dissolved oxygen (${dox} mg/L). Poor treatment quality accelerates biomat formation. The drainfield stress is likely CAUSED BY the upstream treatment failure -- do NOT attribute it to field age or soil conditions.`);
  }

  if (out.length === 0) return { text: '', severities: [], refusals: [] };

  const text = `CROSS-CORRELATED SYSTEM DIAGNOSTICS (pre-computed -- use these as authoritative findings):
${out.map((c) => `- ${c}`).join('\n')}

IMPORTANT: These correlations identify ROOT CAUSES across components. Do not report the correlated symptoms as if they were independent, unrelated problems.`;

  // TREATMENT DEGRADATION is a named root-cause finding the prose must carry.
  const severities = out.some((c) => c.includes('TREATMENT DEGRADATION'))
    ? ['TREATMENT DEGRADATION']
    : [];

  return { text, severities, refusals: [] };
}

/**
 * Run every guardrail and return both the injectable prompt text and a
 * structured record of what fired. The structured record is what the validator
 * later checks the model's prose against, and what the CLI renders side-by-side.
 */
export function computeGuardrails(visit) {
  const blocks = {
    ampDraw: computeAmpDrawDiagnostics(visit),
    measurements: computeNumericalClassifications(visit),
    correlations: computeSystemCorrelations(visit),
  };

  const text = Object.values(blocks)
    .map((b) => b.text)
    .filter(Boolean)
    .join('\n\n');

  /**
   * Severities the model is contractually obliged to carry into the prose.
   *
   * These are collected FROM THE CLASSIFIERS AS THEY COMPUTE, never by
   * regex-scanning the assembled prompt text. An earlier draft of this file did
   * scan the text -- and matched the words "CRITICAL or WARNING" inside the
   * boilerplate instruction paragraph, so it cheerfully asserted that a CRITICAL
   * severity had fired on a visit where the pump was in fact REFUSED
   * classification for want of a nameplate.
   *
   * That is this project's own thesis biting the project: a check that reports
   * a result it did not actually compute is worse than no check, because it
   * manufactures confidence. Severities now come from the tier objects
   * themselves. test/guardrails.test.js pins it.
   */
  const assertedSeverities = [...new Set(Object.values(blocks).flatMap((b) => b.severities))];

  // Things the deterministic layer explicitly DECLINED to conclude. The model
  // must not quietly supply the missing judgement.
  const refusals = Object.values(blocks).flatMap((b) => b.refusals);

  return {
    blocks,
    text,
    assertedSeverities,
    refusals,
    fired: Object.entries(blocks).filter(([, v]) => v.text).map(([k]) => k),
  };
}
