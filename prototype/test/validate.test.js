import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateReport, findTerminologyViolations } from '../src/validate.js';
import { computeGuardrails } from '../src/guardrails.js';

// ------------------------------------------------- terminology (the ethics core)

/**
 * This is the exact sentence sitting in SepticScribe's production few-shot
 * exemplar today (Backend/exemplars/comprehensive.txt:219), in the
 * homeowner-facing section -- i.e. the prose the model is shown as correct and
 * told to imitate.
 */
test('BLOCKS the production exemplar sentence: "Your inspection revealed..."', () => {
  const md = '## HOMEOWNER GUIDANCE\nYour inspection revealed elevated scum levels.';
  const { blocking } = findTerminologyViolations(md);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].word.toLowerCase(), 'inspection');

  const result = validateReport(md);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'TERMINOLOGY');
});

test('BLOCKS the past tense: "components inspected during this visit"', () => {
  const { blocking } = findTerminologyViolations('All other components inspected during this visit were in good condition.');
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].word.toLowerCase(), 'inspected');
});

test('BLOCKS the noun form: "Visual inspection found no surface defects."', () => {
  const { blocking } = findTerminologyViolations('Visual inspection found no surface defects.');
  assert.equal(blocking.length, 1);
});

/**
 * THE FALSE-POSITIVE CLASS THAT INFLATED THE FIRST MEASUREMENT.
 *
 * These four sentences are real model outputs, captured verbatim in the first run
 * of the terminology experiment, where an earlier version of this classifier
 * counted every one of them as a regulatory violation. They are not. Each one
 * RECOMMENDS that someone go and look at the pump in future. None asserts that
 * this maintenance visit was a regulated inspection.
 *
 * They are the passive-voice twin of the advisory carve-out above, and blocking
 * them both over-blocked the gate and over-counted the leak rate. Pinned here so
 * the distinction cannot silently regress.
 */
const FUTURE_RECOMMENDATIONS = [
  'Do not continue operating the system until the pump has been inspected and repaired or replaced.',
  'Have this inspected and repaired as soon as possible.',
  'The pump must be inspected by a service technician as soon as possible.',
  'The pump must be inspected and repaired or replaced immediately.',
];

for (const sentence of FUTURE_RECOMMENDATIONS) {
  test(`ADVISORY, not blocking (recommends future work, asserts nothing): "${sentence.slice(0, 48)}..."`, () => {
    const { blocking, advisory } = findTerminologyViolations(sentence);
    assert.deepEqual(blocking, [], 'a future repair recommendation is not a claim that an inspection occurred');
    assert.ok(advisory.length > 0, 'but it should still be surfaced for review');
  });
}

test('BLOCKS the active past tense: "We inspected the tank"', () => {
  const { blocking } = findTerminologyViolations('We inspected the tank and the baffles.');
  assert.equal(blocking.length, 1);
});

test('BLOCKS the past passive asserting it happened: "The tank was inspected"', () => {
  const { blocking } = findTerminologyViolations('The tank was inspected on arrival.');
  assert.equal(blocking.length, 1);
});

test('ALLOWS "inspection port" -- the fixed industry name for a physical opening', () => {
  const md = 'The inspection port was located and the inspection ports were reseated.';
  const { blocking, advisory } = findTerminologyViolations(md);
  assert.deepEqual(blocking, []);
  assert.deepEqual(advisory, []);
  assert.equal(validateReport(md).ok, true);
});

/**
 * The blunt-grep trap. A gate that blocks this sentence blocks every legitimate
 * maintenance recommendation in English, gets switched off, and then enforces
 * nothing. Advisory, not blocking.
 */
test('does NOT block the forward-looking verb: "a technician must inspect the discharge line"', () => {
  const md = 'A qualified technician must inspect the pump discharge line for blockage.';
  const { blocking, advisory } = findTerminologyViolations(md);
  assert.deepEqual(blocking, [], 'recommending future work is not claiming an inspection occurred');
  assert.equal(advisory.length, 1);

  const result = validateReport(md);
  assert.equal(result.ok, true, 'advisory findings must not block a report');
  assert.equal(result.warnings[0].code, 'TERMINOLOGY_VERB');
});

test('a clean maintenance report passes the terminology gate', () => {
  const md = 'This maintenance visit recorded a scum layer of 3.0 inches. The filter was cleaned.';
  assert.equal(validateReport(md).ok, true);
});

// ------------------------------------------------- prohibited sections

test('BLOCKS a model-generated CERTIFICATION section', () => {
  const md = '## CERTIFICATION\nI certify this system was serviced. R.O.W.P. #12345';
  const result = validateReport(md);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'PROHIBITED_SECTION'));
});

test('BLOCKS a model-generated PHOTO DOCUMENTATION section', () => {
  const result = validateReport('## PHOTO DOCUMENTATION\nFigure 1: the tank.');
  assert.ok(result.errors.some((e) => e.code === 'PROHIBITED_SECTION'));
});

// ------------------------------------------------- severity carried through

const CRITICAL_PUMP_VISIT = {
  findings: { pump_0_pump_current_draw: 1.6 },
  components: [{ type: 'pump', label: 'Effluent Pump', specs: { nameplateAmps: 7.2 } }],
};

test('BLOCKS a report that softens a CRITICAL classification into reassurance', () => {
  const guardrails = computeGuardrails(CRITICAL_PUMP_VISIT);
  // The real unguarded model output said exactly this.
  const md = '## PUMP\n| Effluent Pump | Good | Amp draw 1.6A; normal operating range |';
  const result = validateReport(md, { guardrails, visit: CRITICAL_PUMP_VISIT });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'SEVERITY_DROPPED'));
});

test('ACCEPTS a report that carries the CRITICAL classification through', () => {
  const guardrails = computeGuardrails(CRITICAL_PUMP_VISIT);
  const md = '## PUMP ASSESSMENT\nThe effluent pump is CRITICAL: 1.6A against a 7.2A nameplate indicates no hydraulic load.';
  const result = validateReport(md, { guardrails, visit: CRITICAL_PUMP_VISIT });
  assert.equal(result.ok, true);
});

// ------------------------------------------------- refusals

const NO_NAMEPLATE_VISIT = {
  findings: { pump_0_pump_current_draw: 3.1 },
  components: [{ type: 'pump', label: 'Effluent Pump', specs: { horsepower: 0.5 } }],
};

test('BLOCKS a report that never acknowledges the missing nameplate', () => {
  const guardrails = computeGuardrails(NO_NAMEPLATE_VISIT);
  const md = '## PUMP\nThe pump drew 3.1A and is operating as expected.';
  const result = validateReport(md, { guardrails, visit: NO_NAMEPLATE_VISIT });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'REFUSAL_IGNORED'));
});

/**
 * The subtle one. The model acknowledged the gap AND THEN FILLED IT ANYWAY.
 * This is the real captured unguarded output.
 */
test('BLOCKS a report that acknowledges the missing nameplate and then judges anyway', () => {
  const guardrails = computeGuardrails(NO_NAMEPLATE_VISIT);
  const md = [
    '## PUMP',
    'Nameplate full-load amps are not recorded in the equipment file.',
    'The reading of 3.1 A is within the typical range for a 0.5 horsepower 115-volt pump.',
  ].join('\n');
  const result = validateReport(md, { guardrails, visit: NO_NAMEPLATE_VISIT });
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => e.code === 'REFUSAL_OVERRIDDEN'),
    'acknowledging a gap does not license filling it'
  );
});

test('ACCEPTS a report that declines to classify, as instructed', () => {
  const guardrails = computeGuardrails(NO_NAMEPLATE_VISIT);
  const md = [
    '## PUMP ASSESSMENT',
    'Measured amp draw: 3.1A. The pump nameplate full-load amperage is not recorded in the equipment file.',
    'Without this nameplate data, the reading cannot be classified against severity standards.',
    'Recommend obtaining and recording the nameplate rating.',
  ].join('\n');
  const result = validateReport(md, { guardrails, visit: NO_NAMEPLATE_VISIT });
  assert.equal(result.ok, true);
});

// ------------------------------------------------- hallucinated equipment

test('BLOCKS a manufacturer that appears nowhere in the source data', () => {
  const visit = { components: [{ type: 'pump', label: 'Effluent Pump' }] };
  const md = '## PUMP\nThe Zoeller effluent pump was serviced.';
  const result = validateReport(md, { visit });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === 'HALLUCINATED_BRAND'));
});

test('ALLOWS a manufacturer that is actually present in the source data', () => {
  const visit = { components: [{ type: 'pump', label: 'Effluent Pump', specs: { manufacturer: 'Zoeller' } }] };
  const md = '## PUMP\nThe Zoeller effluent pump was serviced.';
  assert.equal(validateReport(md, { visit }).ok, true);
});
