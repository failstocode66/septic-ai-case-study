import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { redactForModel, buildSystemPrompt, buildUserPrompt } from '../src/prompt.js';
import { computeGuardrails } from '../src/guardrails.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VISITS_DIR = join(HERE, '..', 'fixtures', 'visits');

async function allVisits() {
  const files = await readdir(VISITS_DIR);
  return Promise.all(
    files.filter((f) => f.endsWith('.json'))
      .map(async (f) => JSON.parse(await readFile(join(VISITS_DIR, f), 'utf8')))
  );
}

/**
 * SepticScribe currently transmits the customer's property address, BC
 * land-title parcel ID, and technician name to the third-party model on every
 * report generation (routes/reports.js:347-359 builds them into inspectionData;
 * preprocessReportData retains them; aiReportService YAML-dumps the whole object
 * into the user prompt).
 *
 * The model does not need any of it. This prototype strips them, and these
 * tests make that structural rather than aspirational.
 */
test('redactForModel strips every identity field', async () => {
  for (const visit of await allVisits()) {
    const safe = redactForModel(visit);
    for (const field of ['address', 'parcelId', 'ownerName', 'technician', 'orgName']) {
      assert.equal(safe[field], undefined, `${visit.id}: ${field} must not survive redaction`);
    }
    // ...while the engineering payload survives intact.
    assert.ok(safe.findings, `${visit.id}: findings must survive`);
    assert.ok(safe.components, `${visit.id}: components must survive`);
    assert.ok(safe.serviceDate, `${visit.id}: serviceDate must survive`);
  }
});

test('NO identity value reaches the model, in any prompt, for any visit', async () => {
  for (const visit of await allVisits()) {
    const guardrails = computeGuardrails(visit);
    const prompts = [
      buildSystemPrompt({}),
      buildSystemPrompt({ poison: true, terminologyRule: false }),
      buildUserPrompt(visit, { withGuardrails: true, guardrails }),
      buildUserPrompt(visit, { withGuardrails: false, guardrails }),
    ].join('\n');

    for (const field of ['address', 'parcelId', 'ownerName', 'technician', 'orgName']) {
      const value = visit[field];
      if (!value) continue;
      assert.ok(
        !prompts.includes(value),
        `${visit.id}: "${field}" value leaked into a prompt sent to the model`
      );
    }
  }
});

test('report quality survives redaction -- the model still gets everything it needs', async () => {
  for (const visit of await allVisits()) {
    const guardrails = computeGuardrails(visit);
    const userPrompt = buildUserPrompt(visit, { withGuardrails: true, guardrails });
    assert.match(userPrompt, /MAINTENANCE DATA/);
    assert.ok(userPrompt.includes(visit.serviceDate));
    assert.ok(userPrompt.includes(visit.systemType));
  }
});

test('every fixture is explicitly marked synthetic', async () => {
  for (const visit of await allVisits()) {
    assert.equal(visit.synthetic, true, `${visit.id} must be marked synthetic`);
  }
});

/**
 * STRUCTURAL tripwires.
 *
 * These deliberately match SHAPES, not identities. There is no list of real
 * customer names, real street names, or real email handles anywhere in this
 * file -- and that is not an oversight, it is the point.
 *
 * The first draft of this test hardcoded a literal denylist of specific
 * identifiers. Every one of those strings would then have been published, in a
 * public GitHub repo, inside the very file whose job is to prevent them being
 * published.
 *
 * A denylist that enumerates the identifiers it protects IS the disclosure.
 * The guard becomes the leak. It is the same shape as every other bug in this
 * project: a control that looks like it is working while doing the opposite.
 *
 * Identity-specific denylists belong in a PRIVATE pre-publication gate, run
 * against a fresh clone before announcing. They do not belong in the artifact.
 * What belongs here is structure -- which catches the same class of leak without
 * naming a single person.
 */
test('no credential-shaped or real-world-shaped string appears anywhere in the fixtures', async () => {
  const files = await readdir(VISITS_DIR);
  const corpus = (
    await Promise.all(files.map((f) => readFile(join(VISITS_DIR, f), 'utf8')))
  ).join('\n');

  const tripwires = [
    // A registration number ASSERTS a certification -- the exact
    // misrepresentation this case study is about. Never publish one.
    [/\bR\.?O\.?W\.?P\.?[- #]*\d/i, 'a ROWP registration number'],

    // Real-format BC land-title PID. Ours must use the impossible 000- block.
    [/\b(?!000-)\d{3}-\d{3}-\d{3}\b/, 'a real-format BC parcel ID'],

    // Real Vancouver Island phone. The 555 block is reserved for fiction.
    [/\(?250\)?[-. ]?(?!555)\d{3}[-. ]?\d{4}/, 'a real-format 250 phone number'],

    // RFC 2606 reserves example.com/.org/.net for documentation.
    [/[\w.+-]+@(?!example\.(com|org|net))[\w.-]+\.\w+/i, 'a non-reserved email domain'],

    // API keys / secrets of any provider shape.
    [/\b(sk-[A-Za-z0-9-]{8,}|pk_live|whsec_|ops_[A-Za-z0-9]{8,})/, 'a credential'],
  ];

  for (const [pattern, description] of tripwires) {
    const match = corpus.match(pattern);
    assert.ok(!match, `fixture corpus contains ${description}: ${match?.[0]}`);
  }
});

/**
 * Positive allowlist rather than denylist: every street in the fixtures must be
 * one we invented. Towns are real (that is what makes the demo read as credible
 * local domain work); streets never are.
 *
 * An allowlist leaks nothing, and it fails closed -- adding a new fixture with
 * an unvetted street name breaks this test rather than silently shipping.
 */
test('every street in the fixtures is on the invented-streets allowlist', async () => {
  const INVENTED_STREETS = ['Saltmarsh Way', 'Tideline Road', 'Millstone Avenue'];
  const REAL_TOWNS = ['Comox', 'Merville', 'Cumberland', 'Courtenay', 'Royston', 'Black Creek'];

  for (const visit of await allVisits()) {
    if (!visit.address) continue;
    assert.ok(
      INVENTED_STREETS.some((s) => visit.address.includes(s)),
      `${visit.id}: address "${visit.address}" uses a street that is not on the invented-streets allowlist`
    );
    assert.ok(
      REAL_TOWNS.some((t) => visit.address.includes(t)),
      `${visit.id}: address should name a real Comox Valley town`
    );
    assert.match(visit.address, /\(sample\)$/, `${visit.id}: address must be labelled (sample)`);
  }
});

test('sample parcel IDs use the impossible 000- sentinel block, so they cannot collide with a real parcel', async () => {
  for (const visit of await allVisits()) {
    if (!visit.parcelId) continue;
    assert.match(
      visit.parcelId, /^000-/,
      `${visit.id}: parcel IDs must start with 000- (no real BC PID does)`
    );
  }
});
