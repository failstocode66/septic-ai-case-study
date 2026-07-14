import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getFinding,
  computeAmpDrawDiagnostics,
  computeNumericalClassifications,
  computeSystemCorrelations,
  computeGuardrails,
  THRESHOLDS,
} from '../src/guardrails.js';

// ---------------------------------------------------------------- getFinding

test('getFinding resolves a bare field id against prefixed finding keys', () => {
  const findings = { septic_tank_0_scum_inches: 3.0 };
  assert.equal(getFinding(findings, 'scum_inches'), 3.0);
});

test('getFinding prefers an exact bare key when one exists', () => {
  const findings = { scum_inches: 1.0, septic_tank_0_scum_inches: 9.0 };
  assert.equal(getFinding(findings, 'scum_inches'), 1.0);
});

/**
 * REGRESSION PIN — the production bug (SepticScribe commit 9cf8686).
 *
 * Findings are stored prefixed. The classifiers referenced bare ids. A naive
 * direct lookup therefore matched NOTHING on real data, the guardrail returned
 * an empty string, the prompt section silently vanished, and the model went
 * back to doing the arithmetic itself -- with no error and no alarm.
 *
 * This test exists to make that failure loud forever.
 */
test('REGRESSION: a naive bare-key lookup silently finds nothing on prefixed data', () => {
  const findings = { septic_tank_0_scum_inches: 3.0 };
  assert.equal(findings['scum_inches'], undefined, 'the naive lookup returns undefined');
  assert.equal(getFinding(findings, 'scum_inches'), 3.0, 'getFinding must still resolve it');
});

// ---------------------------------------------------------------- amp draw

test('amp draw at 22% of nameplate FLA classifies CRITICAL - No Load', () => {
  const result = computeAmpDrawDiagnostics({
    findings: { pump_0_pump_current_draw: 1.6 },
    components: [{ type: 'pump', specs: { nameplateAmps: 7.2 } }],
  });
  assert.match(result.text, /22\.2% FLA/);
  assert.match(result.text, /CRITICAL - No Load/);
  assert.deepEqual(result.severities, ['CRITICAL']);
});

test('amp draw at 84% of nameplate FLA is normal and asserts no severity', () => {
  const result = computeAmpDrawDiagnostics({
    findings: { pump_0_pump_current_draw: 5.4 },
    components: [{ type: 'pump', specs: { nameplateAmps: 6.4 } }],
  });
  assert.match(result.text, /84\.4% FLA -- Normal Operating Range/);
  assert.deepEqual(result.severities, []);
});

test('amp draw at 130% of nameplate FLA classifies CRITICAL - Overload (NEC 430.32)', () => {
  const result = computeAmpDrawDiagnostics({
    findings: { pump_0_pump_current_draw: 9.4 },
    components: [{ type: 'pump', specs: { nameplateAmps: 7.2 } }],
  });
  assert.match(result.text, /CRITICAL - Overload/);
  assert.deepEqual(result.severities, ['CRITICAL']);
});

test('DESIGNED REFUSAL: no nameplate on file means no classification, and no severity', () => {
  const result = computeAmpDrawDiagnostics({
    findings: { pump_0_pump_current_draw: 3.1 },
    components: [{ type: 'pump', specs: { horsepower: 0.5 } }],
  });
  assert.match(result.text, /CANNOT be classified/);
  assert.match(result.text, /Do NOT guess or assume an FLA value/);
  assert.deepEqual(result.severities, [], 'refusing to classify must not assert a severity');
  assert.equal(result.refusals.length, 1);
  assert.equal(result.refusals[0].mustMention, 'nameplate');
});

// ------------------------------------------------------- numerical classifiers

test('solids percentage is computed in JS, not left to the model', () => {
  const result = computeNumericalClassifications({
    findings: {
      septic_tank_0_scum_inches: 3.0,
      septic_tank_0_sludge_inches: 8.0,
      septic_tank_0_total_fluid_depth: 48.0,
    },
  });
  // (3 + 8) / 48 = 22.9%
  assert.match(result.text, /22\.9% -- WITHIN NORMAL RANGE/);
  assert.deepEqual(result.severities, []);
});

test('solids above the pump threshold asserts EXCEEDS THRESHOLD', () => {
  const result = computeNumericalClassifications({
    findings: {
      septic_tank_0_scum_inches: 6.5,
      septic_tank_0_sludge_inches: 14.0,
      septic_tank_0_total_fluid_depth: 46.0,
    },
  });
  assert.match(result.text, /44\.6%/);
  assert.ok(result.severities.includes('EXCEEDS THRESHOLD'));
});

test('NEVER ASSUME ZERO: partial tank data refuses to compute a percentage', () => {
  const result = computeNumericalClassifications({
    findings: {
      septic_tank_0_scum_inches: 5.5,
      septic_tank_0_total_fluid_depth: 44.0,
      // sludge_inches deliberately absent
    },
  });
  assert.match(result.text, /PARTIAL DATA/);
  assert.match(result.text, /CANNOT be computed because sludge_inches was not measured/);
  assert.doesNotMatch(result.text, /12\.5%/, 'must not treat the missing sludge as zero');
  assert.equal(result.refusals.length, 1);
});

test('PARTIAL DATA is a refusal, not a severity the prose must echo verbatim', () => {
  const result = computeNumericalClassifications({
    findings: { septic_tank_0_scum_inches: 5.5, septic_tank_0_total_fluid_depth: 44.0 },
  });
  assert.deepEqual(
    result.severities, [],
    'requiring the literal words "PARTIAL DATA" in prose blocks correctly-written reports'
  );
});

// ---------------------------------------------------------------- correlations

test('low DO plus cloudy effluent plus a Fair blower names the blower as root cause', () => {
  const result = computeSystemCorrelations({
    findings: {
      air_blower_0_dissolved_oxygen_mgl: 0.8,
      air_blower_0_effluent_clarity: 'Cloudy',
    },
    components: [{ type: 'air_blower', condition: 'Fair' }],
  });
  assert.match(result.text, /TREATMENT DEGRADATION/);
  assert.match(result.text, /root cause is most likely the blower/);
  assert.ok(result.severities.includes('TREATMENT DEGRADATION'));
});

test('drainfield ponding plus low DO attributes the field stress upstream, not to soil age', () => {
  const result = computeSystemCorrelations({
    findings: {
      air_blower_0_dissolved_oxygen_mgl: 0.8,
      dispersal_field_0_surface_condition: 'Ponding at distribution box',
    },
    components: [],
  });
  assert.match(result.text, /CAUSED BY the upstream treatment failure/);
  assert.match(result.text, /do NOT attribute it to field age/);
});

// ---------------------------------------------------------------- aggregation

/**
 * REGRESSION PIN — this project's own fail-open bug.
 *
 * An earlier draft derived assertedSeverities by regex-scanning the assembled
 * prompt text. That text ends with a boilerplate paragraph containing the words
 * "CRITICAL or WARNING", so the aggregator cheerfully reported that a CRITICAL
 * severity had fired on a visit where the pump was in fact REFUSED
 * classification for want of a nameplate.
 *
 * A check that reports a result it did not compute is worse than no check.
 */
test('REGRESSION: severities come from the classifiers, never from scanning the prompt prose', () => {
  const guardrails = computeGuardrails({
    findings: { pump_0_pump_current_draw: 3.1 },
    components: [{ type: 'pump', specs: { horsepower: 0.5 } }], // no nameplateAmps
  });

  assert.match(
    guardrails.text, /CRITICAL or WARNING/,
    'the boilerplate does contain the word CRITICAL -- that is the trap'
  );
  assert.deepEqual(
    guardrails.assertedSeverities, [],
    'but nothing was actually classified, so no severity may be asserted'
  );
  assert.equal(guardrails.refusals.length, 1);
});

test('computeGuardrails reports which blocks fired', () => {
  const guardrails = computeGuardrails({
    findings: {
      pump_0_pump_current_draw: 1.6,
      septic_tank_0_scum_inches: 3.0,
      septic_tank_0_sludge_inches: 8.0,
      septic_tank_0_total_fluid_depth: 48.0,
    },
    components: [{ type: 'pump', specs: { nameplateAmps: 7.2 } }],
  });
  assert.deepEqual(guardrails.fired, ['ampDraw', 'measurements']);
  assert.deepEqual(guardrails.assertedSeverities, ['CRITICAL']);
});

// ---------------------------------------------------------------- thresholds

test('thresholds have a single source of truth', () => {
  // Production defines these in three places that disagree: the classifier says
  // 33% is the pumping threshold, the system prompt guideline says 25%, and
  // solidsAnalysisService names 25% "recommended" and 33% "critical". At 28%
  // solids the model receives an authoritative "monitor" and a guideline
  // saying "pump". Here there is one constant.
  assert.equal(THRESHOLDS.solids.monitor, 25);
  assert.equal(THRESHOLDS.solids.pump, 33);
  assert.ok(THRESHOLDS.solids.monitor < THRESHOLDS.solids.pump);
});
