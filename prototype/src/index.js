#!/usr/bin/env node
/**
 * CLI — septic maintenance report prototype
 *
 *   node src/index.js list
 *   node src/index.js guardrails --visit dry-running-pump      (free, no API, no network)
 *   node src/index.js run        --visit dry-running-pump [--no-guardrails] [--offline]
 *   node src/index.js compare    --visit dry-running-pump [--offline]   <- THE DEMO
 *   node src/index.js tokens                                   (needs API key)
 *
 * With no ANTHROPIC_API_KEY set, everything falls back to --offline replay
 * automatically. A reviewer can clone this and run `npm run demo` with zero
 * setup and zero cost.
 */

import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeGuardrails } from './guardrails.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { validateReport } from './validate.js';
import { generateReport, countTokens, hasApiKey, replayPath, MODEL_CONFIG } from './client.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const VISITS_DIR = join(HERE, '..', 'fixtures', 'visits');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[36m', magenta: '\x1b[35m',
};
const paint = (c, s) => `${C[c]}${s}${C.reset}`;

function rule(title = '', color = 'dim') {
  const width = 78;
  if (!title) return paint(color, '-'.repeat(width));
  const pad = Math.max(0, width - title.length - 4);
  return paint(color, `-- ${title} ${'-'.repeat(pad)}`);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

async function loadVisit(id) {
  const path = join(VISITS_DIR, `${id}.json`);
  if (!existsSync(path)) {
    const available = (await readdir(VISITS_DIR)).map((f) => f.replace('.json', ''));
    throw new Error(`Unknown visit "${id}". Available: ${available.join(', ')}`);
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

async function listVisits() {
  const files = await readdir(VISITS_DIR);
  return Promise.all(
    files.filter((f) => f.endsWith('.json')).map((f) => loadVisit(f.replace('.json', '')))
  );
}

function printGuardrails(guardrails) {
  console.log(rule('DETERMINISTIC FACTS (computed in JavaScript, not by the model)', 'blue'));
  if (!guardrails.text) {
    console.log(paint('dim', '  (no guardrails fired for this visit)'));
    return;
  }
  console.log(guardrails.text);
  console.log();
  console.log(paint('dim', `  guardrails fired: ${guardrails.fired.join(', ')}`));
  console.log(paint('dim', `  severities the model MUST carry through: ${guardrails.assertedSeverities.join(', ') || '(none)'}`));
  if (guardrails.refusals.length) {
    console.log(paint('dim', `  refusals the model MUST NOT fill in: ${guardrails.refusals.map((r) => `${r.subject} (${r.because})`).join('; ')}`));
  }
}

function printValidation(result) {
  const head = result.ok
    ? paint('green', 'PASS  report accepted')
    : paint('red', `BLOCKED  ${result.errors.length} error(s) -- report rejected, not delivered`);
  console.log(rule('VALIDATION (blocking, unlike production which only logs)', result.ok ? 'green' : 'red'));
  console.log('  ' + head);
  for (const e of result.errors) {
    console.log(paint('red', `  [${e.code}] ${e.message}`));
    if (e.context) console.log(paint('dim', `      ...${e.context}...`));
  }
  for (const w of result.warnings) {
    console.log(paint('yellow', `  [warn ${w.code}] ${w.message}`));
    if (w.context) console.log(paint('dim', `      ...${w.context}...`));
  }
}

function printUsage(result) {
  const u = result.usage ?? {};
  const bits = [
    `source: ${result.source}`,
    result.model ? `model: ${result.model}` : null,
    result.latencyMs ? `latency: ${(result.latencyMs / 1000).toFixed(1)}s` : null,
    u.inputTokens != null ? `in: ${u.inputTokens}` : null,
    u.outputTokens != null ? `out: ${u.outputTokens}` : null,
    u.cacheCreationInputTokens ? `cache-write: ${u.cacheCreationInputTokens}` : null,
    u.cacheReadInputTokens ? `cache-read: ${u.cacheReadInputTokens}` : null,
  ].filter(Boolean);
  console.log(paint('dim', `  ${bits.join('  |  ')}`));
}

async function runOne(visit, { withGuardrails, offline, record, poison, terminologyRule = true }) {
  const guardrails = computeGuardrails(visit);
  const systemPrompt = buildSystemPrompt({ poison, terminologyRule });
  const userPrompt = buildUserPrompt(visit, { withGuardrails, guardrails });
  const mode = withGuardrails ? 'guarded' : 'unguarded';

  const result = await generateReport({
    visit, systemPrompt, userPrompt, mode,
    offline: offline || (!hasApiKey() && !record),
    record,
  });

  /**
   * NOTE: the validator ALWAYS receives the computed guardrails, even in the
   * --no-guardrails ablation.
   *
   * The deterministic facts are ground truth about the visit. They do not stop
   * being true just because we declined to show them to the model. Validating
   * the ablation against `null` -- as an earlier draft of this file did -- let
   * the unguarded report "pass" simply because nothing was checking it, which
   * inverted the entire demo.
   *
   * What the --no-guardrails flag changes is what the MODEL SEES (buildUserPrompt),
   * never what the TRUTH IS.
   */
  const validation = validateReport(result.markdown, { guardrails, visit });

  return { guardrails, result, validation, mode };
}

// ---------------------------------------------------------------- commands

async function cmdList() {
  const visits = await listVisits();
  console.log(rule('SYNTHETIC VISITS', 'bold'));
  for (const v of visits) {
    const guarded = existsSync(replayPath(v.id, 'guarded'));
    const unguarded = existsSync(replayPath(v.id, 'unguarded'));
    const replay = guarded && unguarded ? paint('green', 'replay: both')
      : guarded || unguarded ? paint('yellow', 'replay: partial')
      : paint('red', 'replay: none');
    console.log(`\n  ${paint('bold', v.id)}   ${replay}`);
    console.log(`  ${v.title}`);
    console.log(paint('dim', `  teaches: ${v.teaches}`));
  }
  console.log();
}

async function cmdGuardrails(args) {
  const visit = await loadVisit(args.visit);
  console.log(rule(visit.id.toUpperCase(), 'bold'));
  console.log(visit.title + '\n');
  printGuardrails(computeGuardrails(visit));
  console.log('\n' + paint('dim', '  (no model was called; this is pure JavaScript, free and instant)'));
}

async function cmdRun(args) {
  const visit = await loadVisit(args.visit);
  const withGuardrails = !args['no-guardrails'];

  console.log(rule(`${visit.id} -- ${withGuardrails ? 'WITH' : 'WITHOUT'} GUARDRAILS`, 'bold'));
  const { guardrails, result, validation } = await runOne(visit, {
    withGuardrails,
    offline: Boolean(args.offline),
    record: Boolean(args.record),
    poison: Boolean(args.poison),
    terminologyRule: !args['no-terminology-rule'],
  });

  if (withGuardrails) { printGuardrails(guardrails); console.log(); }
  console.log(rule('MODEL OUTPUT', 'magenta'));
  console.log(result.markdown);
  console.log();
  printUsage(result);
  console.log();
  printValidation(validation);
  process.exitCode = validation.ok ? 0 : 1;
}

/**
 * The headline demo. Runs the same visit through the same model twice -- once
 * with the deterministic facts injected, once without -- and puts the two
 * outputs next to the ground truth.
 */
async function cmdCompare(args) {
  const visit = await loadVisit(args.visit);
  const offline = Boolean(args.offline) || !hasApiKey();

  console.log('\n' + rule(`${visit.id.toUpperCase()}`, 'bold'));
  console.log(paint('bold', visit.title));
  console.log(paint('dim', `\n${visit.teaches}\n`));

  const guardrails = computeGuardrails(visit);
  printGuardrails(guardrails);

  const off = await runOne(visit, { withGuardrails: false, offline, record: Boolean(args.record) });
  const on = await runOne(visit, { withGuardrails: true, offline, record: Boolean(args.record) });

  console.log('\n' + rule('A. WITHOUT THE GUARDRAIL -- the model does its own arithmetic and judgement', 'red'));
  console.log(off.result.markdown);
  console.log();
  printUsage(off.result);
  console.log();
  printValidation(off.validation);

  console.log('\n' + rule('B. WITH THE GUARDRAIL -- the model narrates conclusions it was handed', 'green'));
  console.log(on.result.markdown);
  console.log();
  printUsage(on.result);
  console.log();
  printValidation(on.validation);

  console.log('\n' + rule('VERDICT', 'bold'));
  const line = (label, v) => `  ${label.padEnd(34)} ${v}`;
  console.log(line('Without guardrails:', v(off.validation)));
  console.log(line('With guardrails:', v(on.validation)));
  console.log();
  function v(res) {
    return res.ok
      ? paint('green', 'PASS')
      : paint('red', `BLOCKED (${res.errors.map((e) => e.code).join(', ')})`);
  }
}

/**
 * Measure the system prompt against Haiku 4.5's 4096-token minimum cacheable
 * prefix, using Anthropic's real tokenizer rather than a chars/4 heuristic.
 */
async function cmdTokens() {
  if (!hasApiKey()) {
    console.error(paint('red', 'tokens requires ANTHROPIC_API_KEY (it calls the real tokenizer).'));
    process.exitCode = 1;
    return;
  }
  const visit = await loadVisit('dry-running-pump');
  const guardrails = computeGuardrails(visit);
  const systemPrompt = buildSystemPrompt({});
  const userPrompt = buildUserPrompt(visit, { withGuardrails: true, guardrails });

  const total = await countTokens({ systemPrompt, userPrompt });
  const systemOnly = await countTokens({ systemPrompt, userPrompt: 'x' });

  const CACHE_FLOOR = 4096; // Haiku 4.5 minimum cacheable prefix
  const share = ((systemOnly / total) * 100).toFixed(1);

  console.log(rule('TOKEN MEASUREMENT (real tokenizer, not chars/4)', 'bold'));
  console.log(`  model:                       ${MODEL_CONFIG.model}`);
  console.log(`  system prompt (cacheable):   ${systemOnly} tokens`);
  console.log(`  full request:                ${total} tokens`);
  console.log(`  system prompt share:         ${share}% of all input tokens`);
  console.log();
  console.log(`  Haiku 4.5 min cacheable prefix: ${CACHE_FLOOR} tokens`);
  if (systemOnly >= CACHE_FLOOR) {
    console.log('  ' + paint('green', `CLEARS THE FLOOR by ${systemOnly - CACHE_FLOOR} tokens -- prompt caching will engage.`));
  } else {
    console.log('  ' + paint('red', `BELOW THE FLOOR by ${CACHE_FLOOR - systemOnly} tokens -- caching SILENTLY does nothing.`));
    console.log(paint('dim', '  No error is raised. cache_creation_input_tokens comes back 0 and you pay full price forever.'));
  }
}

// ---------------------------------------------------------------- entry

const HELP = `
septic maintenance report prototype -- deterministic-fact injection as a hallucination guardrail

  node src/index.js list
  node src/index.js guardrails --visit <id>          show the deterministic facts (free, no API)
  node src/index.js compare    --visit <id>          THE DEMO: same model, with vs without guardrails
  node src/index.js run        --visit <id> [--no-guardrails]
  node src/index.js tokens                           measure the system prompt vs the cache floor

Flags:
  --offline          use recorded model responses (default when no API key is set)
  --record           make a live call and save the response as a new replay fixture
  --poison           swap in a few-shot exemplar contaminated with the word "inspection"
                     (reproduces the live defect found in SepticScribe's exemplars)
`;

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

try {
  switch (command) {
    case 'list':        await cmdList(); break;
    case 'guardrails':  await cmdGuardrails(args); break;
    case 'run':         await cmdRun(args); break;
    case 'compare':     await cmdCompare(args); break;
    case 'tokens':      await cmdTokens(); break;
    default:            console.log(HELP);
  }
} catch (err) {
  console.error('\n' + paint('red', `error: ${err.message}`));
  process.exitCode = 1;
}
