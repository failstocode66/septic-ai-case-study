#!/usr/bin/env node
/**
 * TERMINOLOGY LEAK EXPERIMENT
 * ===========================
 * Measures how often Claude Haiku 4.5 describes a maintenance visit as an
 * "inspection" -- the regulated word the technician is not certified to use --
 * under four prompt configurations.
 *
 *   rule OFF / clean exemplar    <- positive framing only ("you are a
 *                                   maintenance technician writing a
 *                                   maintenance report"), clean few-shot
 *   rule OFF / poisoned exemplar <- SEPTICSCRIBE PRODUCTION AS IT ACTUALLY IS:
 *                                   no negative constraint, and a few-shot
 *                                   exemplar that literally contains
 *                                   "Your inspection revealed..."
 *                                   (Backend/exemplars/comprehensive.txt:219)
 *   rule ON  / poisoned exemplar <- the fix, stress-tested against the
 *                                   contaminated example
 *   rule ON  / clean exemplar    <- this prototype's default
 *
 * WHAT COUNTS AS A LEAK -- and why this definition was corrected.
 *
 * A leak is an ASSERTION that the regulated act occurred: the nouns
 * ("inspection"/"inspector"), or the past participle used attributively or
 * actively ("components inspected during this visit"). That, and only that,
 * misrepresents the technician's scope of practice.
 *
 * It is NOT a leak when the model recommends future work -- "the pump must be
 * inspected by a service technician". That is the ordinary English verb, in the
 * passive voice, asserting nothing about what this visit was.
 *
 * The first run of this experiment counted those recommendations as violations
 * and reported a leak rate roughly seven times the true one. The instrument has
 * to measure the claim actually being made. Both tiers are now reported
 * separately, and EVERY RAW MODEL OUTPUT IS WRITTEN TO DISK
 * (fixtures/experiment-raw/) so that anyone can re-score the run against their
 * own definition instead of taking this one on trust.
 *
 * Usage:  node src/experiment.js [--trials 12]
 * Writes: fixtures/experiment-terminology.json  (+ fixtures/experiment-raw/*.json)
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { computeGuardrails } from './guardrails.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { findTerminologyViolations } from './validate.js';
import { MODEL_CONFIG } from './client.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const CONDITIONS = [
  { key: 'rule-off_clean',   terminologyRule: false, poison: false, label: 'rule OFF / clean exemplar' },
  { key: 'rule-off_poison',  terminologyRule: false, poison: true,  label: 'rule OFF / poisoned exemplar  <- PRODUCTION' },
  { key: 'rule-on_poison',   terminologyRule: true,  poison: true,  label: 'rule ON  / poisoned exemplar  <- the fix, stressed' },
  { key: 'rule-on_clean',    terminologyRule: true,  poison: false, label: 'rule ON  / clean exemplar     <- prototype default' },
];

const trials = Number(process.argv.includes('--trials')
  ? process.argv[process.argv.indexOf('--trials') + 1]
  : 10);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY required.');
  process.exit(1);
}

const client = new Anthropic();
const visit = JSON.parse(
  await readFile(join(HERE, '..', 'fixtures', 'visits', 'dry-running-pump.json'), 'utf8')
);
const guardrails = computeGuardrails(visit);
const userPrompt = buildUserPrompt(visit, { withGuardrails: true, guardrails });

async function once(condition) {
  const systemPrompt = buildSystemPrompt({
    poison: condition.poison,
    terminologyRule: condition.terminologyRule,
  });
  const stream = client.messages.stream({
    model: MODEL_CONFIG.model,
    max_tokens: MODEL_CONFIG.maxTokens,
    temperature: MODEL_CONFIG.temperature,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userPrompt }],
  });
  const message = await stream.finalMessage();
  const markdown = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const term = findTerminologyViolations(markdown);
  return {
    markdown,
    blocking: term.blocking.length,
    advisory: term.advisory.length,
    assertionExamples: term.blocking.slice(0, 2).map((v) => v.context),
    advisoryExamples: term.advisory.slice(0, 2).map((v) => v.context),
    usage: {
      inputTokens: message.usage?.input_tokens ?? null,
      outputTokens: message.usage?.output_tokens ?? null,
    },
  };
}

const results = {
  measuredAt: new Date().toISOString(),
  model: MODEL_CONFIG.model,
  temperature: MODEL_CONFIG.temperature,
  trialsPerCondition: trials,
  visit: visit.id,
  scope: 'One synthetic visit, one model, one temperature. A mechanism demonstration, not an efficacy guarantee.',
  definition: {
    assertion: 'THE LEAK. The model asserts the regulated act occurred: the nouns ("inspection"/"inspections"/"inspector"), or the past participle used attributively/actively ("components inspected during this visit", "we inspected the tank"). This is what misrepresents the technician\'s scope of practice.',
    recommendation: 'NOT a leak, counted separately. A forward-looking recommendation using the ordinary verb, including the passive ("the pump must be inspected by a technician") and the causative ("have this inspected"). Asserts nothing about what this visit was.',
    allowed: '"inspection port(s)" -- a fixed industry name for a physical opening in the tank.',
  },
  rawOutputs: 'fixtures/experiment-raw/<condition>-<trial>.json -- every model response, verbatim, so this run can be re-scored against any other definition.',
  conditions: {},
};

const RAW_DIR = join(HERE, '..', 'fixtures', 'experiment-raw');
await mkdir(RAW_DIR, { recursive: true });

console.log(`\nTerminology leak rate -- ${MODEL_CONFIG.model}, temp ${MODEL_CONFIG.temperature}, n=${trials} per condition`);
console.log('A leak = ASSERTING an inspection occurred. Future-work recommendations are counted separately.\n');

for (const condition of CONDITIONS) {
  const runs = [];
  process.stdout.write(`  ${condition.label.padEnd(46)} `);
  for (let i = 0; i < trials; i++) {
    const r = await once(condition);
    runs.push(r);
    await writeFile(
      join(RAW_DIR, `${condition.key}-${String(i + 1).padStart(2, '0')}.json`),
      JSON.stringify({
        condition: condition.key,
        trial: i + 1,
        terminologyRule: condition.terminologyRule,
        poisonedExemplar: condition.poison,
        assertions: r.blocking,
        recommendations: r.advisory,
        usage: r.usage,
        markdown: r.markdown,
      }, null, 2) + '\n',
      'utf8'
    );
    process.stdout.write(r.blocking > 0 ? 'X' : '.');
  }
  const leaked = runs.filter((r) => r.blocking > 0).length;
  const advisory = runs.filter((r) => r.advisory > 0).length;
  const rate = ((leaked / trials) * 100).toFixed(0);
  console.log(`  ${leaked}/${trials} asserted an inspection (${rate}%)   [${advisory}/${trials} used the advisory verb]`);

  results.conditions[condition.key] = {
    label: condition.label,
    terminologyRule: condition.terminologyRule,
    poisonedExemplar: condition.poison,
    trials,
    // THE LEAK: trials asserting the regulated act occurred.
    assertedInspection: leaked,
    assertionRatePct: Number(rate),
    assertionExamples: [...new Set(runs.flatMap((r) => r.assertionExamples))].slice(0, 4),
    // NOT the leak: trials recommending future work with the ordinary verb.
    advisoryVerbTrials: advisory,
    advisoryExamples: [...new Set(runs.flatMap((r) => r.advisoryExamples))].slice(0, 4),
  };
}

console.log('\n  X = at least one ASSERTION that an inspection occurred   . = no assertion\n');

await writeFile(
  join(HERE, '..', 'fixtures', 'experiment-terminology.json'),
  JSON.stringify(results, null, 2) + '\n',
  'utf8'
);
console.log('  written: fixtures/experiment-terminology.json\n');
