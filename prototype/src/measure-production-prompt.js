#!/usr/bin/env node
/**
 * MEASURE THE REAL PRODUCTION PROMPT
 * ==================================
 * Builds SepticScribe's ACTUAL prompt -- by requiring its real `buildReportPrompt` and
 * `preprocessReportData`, not a reimplementation -- against the committed synthetic
 * record in fixtures/production/worked-example.json, and prints the sizes quoted in
 * CASE-STUDY.md §4.1.
 *
 * This exists so that every number in that table can be re-derived by a reader, rather
 * than taken on trust. It touches no customer data and makes no API calls.
 *
 * Usage:
 *   node src/measure-production-prompt.js [--septic <path to Septic-Project-Root>]
 *
 * Default path: ../../Septic-Project-Root relative to this repo.
 *
 * NOTE: importing the module pulls in SepticScribe's config validator, which requires a
 * JWT secret and a database URL to be present. Both are stubbed below purely so the
 * module will load. Nothing connects to anything: buildReportPrompt is pure string
 * assembly, and no customer data or database is touched.
 */

process.env.JWT_SECRET ||= 'not-a-secret-module-load-only-0000000000000000';
process.env.DATABASE_URL ||= 'postgres://user:pass@127.0.0.1:5432/none';
process.env.NODE_ENV ||= 'test';

import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const flag = process.argv.indexOf('--septic');
const SEPTIC = resolve(flag !== -1 ? process.argv[flag + 1] : join(HERE, '..', '..', '..', 'Septic-Project-Root'));
const BACKEND = join(SEPTIC, 'Backend');

if (!existsSync(join(BACKEND, 'aiReportService.js'))) {
  console.error(`SepticScribe backend not found at ${BACKEND}`);
  console.error('This measurement requires the (private) product repo. Pass --septic <path>.');
  process.exit(1);
}

const {
  buildReportPrompt,
  computeAmpDrawDiagnostics,
  computeNumericalClassifications,
  computeSystemCorrelations,
} = require(join(BACKEND, 'aiReportService.js'));
const { preprocessReportData } = require(join(BACKEND, 'reportDataPreprocessor.js'));

const visit = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'production', 'worked-example.json'), 'utf8'));

// The record as the route would assemble it -- including the identity fields, so that we
// are measuring the real path. preprocessReportData is what strips them (commit c391dc5).
const record = {
  address: '760 Saltmarsh Way (sample), Comox BC',
  parcelId: '000-555-0142',
  technician: 'A. Technician',
  date: visit.date,
  systemType: visit.systemType,
  healthScore: visit.healthScore,
  components: visit.components,
  findings: visit.findings,
};

const { textData } = preprocessReportData(record);

// The three deterministic injectors. generateReportContent computes these and passes them
// into buildReportPrompt as options, so a faithful measurement has to do the same.
const ampDrawDiagnostic = computeAmpDrawDiagnostics(textData);
const numericalClassifications = computeNumericalClassifications(textData);
const systemCorrelations = computeSystemCorrelations(textData);

for (const [name, block] of Object.entries({ ampDrawDiagnostic, numericalClassifications, systemCorrelations })) {
  if (!block) {
    console.error(`\nFAIL: injector "${name}" produced an empty string -- it did not fire.`);
    console.error('That is the fail-open bug this case study is about. Fix the fixture or the finding keys.\n');
    process.exit(1);
  }
}

const { systemPrompt, userPrompt } = buildReportPrompt(textData, {
  preferences: {},
  ampDrawDiagnostic,
  numericalClassifications,
  systemCorrelations,
});

const wire = `${systemPrompt}\n${userPrompt}`;
for (const value of ['760 Saltmarsh', '000-555-0142', 'A. Technician']) {
  if (wire.includes(value)) {
    console.error(`\nFAIL: identity value "${value}" reached the prompt. The redaction is broken.\n`);
    process.exit(1);
  }
}

const total = systemPrompt.length + userPrompt.length;
console.log('\nProduction prompt, built from Backend/aiReportService.js against fixtures/production/worked-example.json');
console.log('(all three deterministic injectors firing; identity fields redacted per c391dc5)\n');
console.log(`  system prompt : ${systemPrompt.length.toLocaleString()} characters`);
console.log(`  user prompt   : ${userPrompt.length.toLocaleString()} characters`);
console.log(`  total         : ${total.toLocaleString()} characters`);
console.log(`  system share  : ${((systemPrompt.length / total) * 100).toFixed(0)}% of the input -- and it is the cacheable half\n`);
console.log('  no identity value appears in either prompt (checked above)\n');
