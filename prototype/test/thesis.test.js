/**
 * THE THESIS, PINNED.
 *
 * These tests run the REAL captured model outputs in fixtures/replay/ through
 * the validator and assert that the central claim of this prototype actually
 * holds:
 *
 *   Without deterministic-fact injection, the model produces a report that
 *   FAILS a deterministic check of the very findings it was reporting on.
 *   With it, the report passes.
 *
 * Nothing here is hand-written prose. Every markdown string under test is what
 * claude-haiku-4-5 actually emitted. If a future prompt change breaks the
 * demonstration, these tests go red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeGuardrails } from '../src/guardrails.js';
import { validateReport } from '../src/validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = (...p) => join(HERE, '..', ...p);

const VISITS = ['dry-running-pump', 'treatment-degradation', 'partial-data'];

async function load(visitId, mode) {
  const visit = JSON.parse(await readFile(root('fixtures', 'visits', `${visitId}.json`), 'utf8'));
  const replay = JSON.parse(await readFile(root('fixtures', 'replay', `${visitId}__${mode}.json`), 'utf8'));
  return { visit, replay };
}

for (const visitId of VISITS) {
  test(`[${visitId}] replay fixtures are real captured model output, not hand-written`, async () => {
    for (const mode of ['guarded', 'unguarded']) {
      const { replay } = await load(visitId, mode);
      assert.match(replay.model, /^claude-haiku-4-5/, 'must record the model that produced it');
      assert.ok(replay.capturedAt, 'must record when it was captured');
      assert.ok(replay.usage.inputTokens > 0, 'must carry real token usage');
      assert.ok(replay.usage.outputTokens > 0);
      assert.ok(replay.latencyMs > 0, 'must carry real measured latency');
      assert.ok(replay.markdown.length > 200);
    }
  });

  test(`[${visitId}] WITHOUT guardrails, the model's report FAILS the deterministic check`, async () => {
    const { visit, replay } = await load(visitId, 'unguarded');
    const guardrails = computeGuardrails(visit);
    const result = validateReport(replay.markdown, { guardrails, visit });

    assert.equal(
      result.ok, false,
      `the unguarded report should not survive validation -- if this passes, the demo is broken`
    );
    assert.ok(
      result.errors.some((e) =>
        ['SEVERITY_DROPPED', 'REFUSAL_OVERRIDDEN', 'REFUSAL_IGNORED'].includes(e.code)
      ),
      `expected a guardrail-contract failure, got: ${result.errors.map((e) => e.code).join(', ')}`
    );
  });

  test(`[${visitId}] WITH guardrails, the model's report PASSES`, async () => {
    const { visit, replay } = await load(visitId, 'guarded');
    const guardrails = computeGuardrails(visit);
    const result = validateReport(replay.markdown, { guardrails, visit });

    assert.equal(
      result.ok, true,
      `guarded report was rejected: ${result.errors.map((e) => `${e.code}: ${e.message}`).join(' | ')}`
    );
  });

  test(`[${visitId}] neither report ever calls the visit an inspection`, async () => {
    for (const mode of ['guarded', 'unguarded']) {
      const { replay } = await load(visitId, mode);
      const result = validateReport(replay.markdown, {});
      assert.ok(
        !result.errors.some((e) => e.code === 'TERMINOLOGY'),
        `${mode} report leaked the regulated word`
      );
    }
  });
}

/**
 * The specific, concrete failure this whole technique exists to prevent:
 * a pump at 22% of nameplate FLA -- a dry-running motor -- described as normal.
 */
test('the flagship failure is reproduced: the unguarded model called a dying pump "normal"', async () => {
  const { replay } = await load('dry-running-pump', 'unguarded');
  const md = replay.markdown;

  assert.match(
    md, /normal operating range|operating normally|does not indicate a fault|within normal/i,
    'the unguarded model reassured about the pump'
  );
  assert.doesNotMatch(md, /\bCRITICAL\b/, 'and never once said CRITICAL');
});

test('and the guarded model called it what it is', async () => {
  const { replay } = await load('dry-running-pump', 'guarded');
  const md = replay.markdown;

  assert.match(md, /\bCRITICAL\b/, 'the guarded report carries the severity through');
  assert.match(md, /22\.2%|no hydraulic load|impeller/i, 'and explains the actual failure');
});

/**
 * The measured terminology experiment. Present only after `node src/experiment.js`
 * has been run against a live key, so it is skipped rather than failed when absent.
 */
test('the terminology experiment shows the explicit constraint drives leakage to zero', async (t) => {
  const path = root('fixtures', 'experiment-terminology.json');
  if (!existsSync(path)) return t.skip('experiment not run (needs a live API key)');

  const data = JSON.parse(await readFile(path, 'utf8'));
  const offPoison = data.conditions['rule-off_poison'];  // production's actual config
  const offClean = data.conditions['rule-off_clean'];    // positive framing, clean example
  const onPoison = data.conditions['rule-on_poison'];    // the fix, stress-tested
  const onClean = data.conditions['rule-on_clean'];

  // A leak is an ASSERTION that the regulated act occurred -- NOT a forward-looking
  // recommendation ("the pump must be inspected by a technician"), which asserts
  // nothing about what this visit was. Counting those inflated the first measurement
  // roughly sevenfold. `assertionTrialsHandVerified` is the count after every
  // occurrence in all 48 stored outputs was read and classified by hand.
  assert.ok(
    offPoison.assertionTrialsHandVerified >= 4,
    'the poisoned exemplar puts the regulated word into the report in a large fraction of runs'
  );

  // The contaminated few-shot IS the root cause: with a clean exemplar the model
  // never once claimed the visit was an inspection. A few-shot is imitated, not read.
  assert.equal(
    offClean.assertionTrialsHandVerified, 0,
    'with a clean exemplar and no explicit rule, the model does not assert an inspection'
  );

  // And the explicit negative constraint holds even against the poisoned exemplar.
  assert.equal(onPoison.assertionTrialsHandVerified, 0, 'the explicit prohibition eliminates the assertion');
  assert.equal(onClean.assertionTrialsHandVerified, 0, 'and holds with a clean exemplar too');
});

test('the guarded configuration suppresses the advisory verb as well as the violation', async (t) => {
  const path = root('fixtures', 'experiment-terminology.json');
  if (!existsSync(path)) return t.skip('experiment not run (needs a live API key)');

  const data = JSON.parse(await readFile(path, 'utf8'));

  // An honest, unflattering result, pinned so it cannot quietly disappear: the
  // prohibition is blunter than designed. The advisory tier -- the carve-out built to
  // let legitimate recommendations through -- never fires under the rule. The model
  // stops using the verb entirely, including where it was permitted to.
  assert.ok(data.conditions['rule-off_clean'].advisoryVerbTrials > 0, 'unguarded, the model uses the ordinary verb freely');
  assert.equal(data.conditions['rule-on_clean'].advisoryVerbTrials, 0, 'guarded, it stops using it at all -- over-suppression, reported not hidden');
  assert.equal(data.conditions['rule-on_poison'].advisoryVerbTrials, 0);
});
