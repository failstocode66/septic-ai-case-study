/**
 * MODEL CLIENT
 * ============
 * Three execution modes, in priority order:
 *
 *   --offline   Load a canned response from fixtures/replay/. Zero setup, zero
 *               cost, zero network. This is the default when no API key is
 *               present, so a reviewer can run the whole demo with `npm run demo`
 *               and see everything.
 *
 *   live        Call Claude Haiku 4.5 -- the SAME model SepticScribe runs in
 *               production (claude-haiku-4-5-20251001, temperature 0.3,
 *               maxTokens 8000, streaming, ephemeral cache on the system block).
 *
 *   --record    Live call, and persist the response + real usage + real latency
 *               into fixtures/replay/ as the new canned response.
 *
 * EVERY replay fixture in this repo is a REAL captured model response. Nothing
 * in fixtures/replay/ was written by hand. The "what goes wrong without the
 * guardrail" output is not a strawman I composed -- it is what the model
 * actually said. See each fixture's `capturedAt` and `usage` fields.
 */

import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPLAY_DIR = join(HERE, '..', 'fixtures', 'replay');

/**
 * Matches SepticScribe's production MODEL_CONFIG.primary exactly
 * (Backend/aiReportService.js:53-61). Deliberately not "upgraded" -- the point
 * of the prototype is to demonstrate the real system, and the guardrail
 * technique matters MORE on a small fast model, not less.
 */
export const MODEL_CONFIG = {
  model: 'claude-haiku-4-5',
  maxTokens: 8000,
  temperature: 0.3,
};

export function replayPath(visitId, mode) {
  return join(REPLAY_DIR, `${visitId}__${mode}.json`);
}

export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function loadReplay(visitId, mode) {
  const path = replayPath(visitId, mode);
  if (!existsSync(path)) {
    throw new Error(
      `No replay fixture for visit "${visitId}" mode "${mode}".\n` +
      `  Expected: ${path}\n` +
      `  Either run with an ANTHROPIC_API_KEY set, or pick a visit that has a recorded fixture (\`node src/index.js list\`).`
    );
  }
  const raw = JSON.parse(await readFile(path, 'utf8'));
  return { ...raw, source: 'replay' };
}

async function saveReplay(visitId, mode, payload) {
  await mkdir(REPLAY_DIR, { recursive: true });
  await writeFile(replayPath(visitId, mode), JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

/**
 * Generate a report.
 *
 * The system prompt carries `cache_control: {type: 'ephemeral'}`. It is the
 * stable, cacheable unit; the per-visit user prompt sits after it and is never
 * cached. Watch `usage.cache_creation_input_tokens` on the first call and
 * `usage.cache_read_input_tokens` on the second.
 *
 * IMPORTANT CAVEAT, MEASURED: the minimum cacheable prefix for Haiku 4.5 is
 * 4096 tokens. Below that, caching silently does nothing -- no error, and
 * cache_creation_input_tokens comes back 0. `node src/index.js tokens` measures
 * our system prompt against that floor with the real tokenizer.
 */
export async function generateReport({
  visit,
  systemPrompt,
  userPrompt,
  mode,
  offline = false,
  record = false,
}) {
  if (offline || (!hasApiKey() && !record)) {
    return loadReplay(visit.id, mode);
  }

  if (!hasApiKey()) {
    throw new Error('ANTHROPIC_API_KEY is not set, so --record cannot make a live call.');
  }

  const client = new Anthropic();
  const started = Date.now();

  // Streaming: production streams to capture usage and detect empty responses
  // early. It also keeps us well clear of HTTP timeouts on long reports.
  const stream = client.messages.stream({
    model: MODEL_CONFIG.model,
    max_tokens: MODEL_CONFIG.maxTokens,
    temperature: MODEL_CONFIG.temperature,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });

  const message = await stream.finalMessage();
  const latencyMs = Date.now() - started;

  const markdown = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  if (!markdown.trim()) {
    throw new Error(`Model returned an empty response (stop_reason: ${message.stop_reason}).`);
  }

  const payload = {
    visitId: visit.id,
    mode,
    model: message.model,
    capturedAt: new Date().toISOString(),
    stopReason: message.stop_reason,
    latencyMs,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    },
    markdown,
    note: 'Real captured model output. Not hand-written.',
  };

  if (record) await saveReplay(visit.id, mode, payload);

  return { ...payload, source: 'live' };
}

/**
 * Count tokens with Anthropic's real tokenizer -- NOT a chars/4 heuristic.
 *
 * This matters: SepticScribe's own estimateTokens() is `Math.ceil(len / 4)`,
 * so every token figure in the codebase is an estimate. The 4096-token cache
 * floor for Haiku 4.5 cannot be resolved by a heuristic that is itself the
 * source of the uncertainty. This measures it.
 */
export async function countTokens({ systemPrompt, userPrompt }) {
  if (!hasApiKey()) throw new Error('ANTHROPIC_API_KEY required to count tokens.');
  const client = new Anthropic();
  const result = await client.messages.countTokens({
    model: MODEL_CONFIG.model,
    system: [{ type: 'text', text: systemPrompt }],
    messages: [{ role: 'user', content: userPrompt }],
  });
  return result.input_tokens;
}
