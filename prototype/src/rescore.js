#!/usr/bin/env node
/**
 * RE-SCORE THE EXPERIMENT, OFFLINE
 * ================================
 * Reads every raw model output in fixtures/experiment-raw/ and re-computes the
 * result table with the CURRENT classifier in validate.js. No API calls, no cost.
 *
 * This exists because the first version of this experiment shipped a number that its
 * own instrument did not support: the classifier counted "the pump must be inspected
 * by a technician" -- a repair recommendation -- as a claim that a regulated
 * inspection had occurred, and so reported a leak rate several times the true one.
 *
 * The durable fix is not a better regex. It is publishing the raw outputs, so the
 * instrument can be challenged and the run re-scored by anyone, without paying to
 * re-run it. That is what this script does.
 *
 * Usage:
 *   node src/rescore.js            re-compute the table
 *   node src/rescore.js --audit    also print EVERY occurrence with its label, for
 *                                  human adjudication of the classifier
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { findTerminologyViolations } from './validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(HERE, '..', 'fixtures', 'experiment-raw');
const SUMMARY = join(HERE, '..', 'fixtures', 'experiment-terminology.json');
const audit = process.argv.includes('--audit');

const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json')).sort();
const byCondition = new Map();

for (const file of files) {
  const trial = JSON.parse(await readFile(join(RAW_DIR, file), 'utf8'));
  const term = findTerminologyViolations(trial.markdown);
  if (!byCondition.has(trial.condition)) byCondition.set(trial.condition, []);
  byCondition.get(trial.condition).push({ file, trial, term });
}

const summary = JSON.parse(await readFile(SUMMARY, 'utf8'));

console.log(`\nRe-scored ${files.length} stored model outputs with the current classifier.`);
console.log('A leak = ASSERTING an inspection occurred. Future-work recommendations counted separately.\n');

for (const [key, runs] of byCondition) {
  const asserted = runs.filter((r) => r.term.blocking.length > 0).length;
  const advisory = runs.filter((r) => r.term.advisory.length > 0).length;
  const rate = Math.round((asserted / runs.length) * 100);
  const label = summary.conditions[key]?.label ?? key;

  console.log(`  ${label.padEnd(48)} ${asserted}/${runs.length} asserted (${rate}%)   [${advisory}/${runs.length} advisory verb]`);

  if (summary.conditions[key]) {
    Object.assign(summary.conditions[key], {
      assertedInspection: asserted,
      assertionRatePct: rate,
      advisoryVerbTrials: advisory,
      assertionExamples: [...new Set(runs.flatMap((r) => r.term.blocking.map((v) => v.context)))].slice(0, 4),
      advisoryExamples: [...new Set(runs.flatMap((r) => r.term.advisory.map((v) => v.context)))].slice(0, 4),
    });
  }

  if (audit) {
    for (const r of runs) {
      for (const v of r.term.blocking) console.log(`      [ASSERTION] ${r.file}  ...${v.context}`);
      for (const v of r.term.advisory) console.log(`      [advice   ] ${r.file}  ...${v.context}`);
    }
    console.log('');
  }
}

summary.rescoredAt = new Date().toISOString();
await writeFile(SUMMARY, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log('\n  summary updated: fixtures/experiment-terminology.json\n');
