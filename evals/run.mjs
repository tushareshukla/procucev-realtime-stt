#!/usr/bin/env node
/**
 * Speech-to-text eval harness.
 *
 * Runs fixture audio through the inference service and scores the output on
 * accuracy (WER/CER), the specific failure modes this system has hit before
 * (translation instead of transcription, repeated-token degeneration, phantom
 * segments from silence), and latency.
 *
 *   node evals/run.mjs
 *   EVAL_STT_URL=http://localhost:9000 node evals/run.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wer, cer, script, looksTranslated, repetitionRun, REPETITION_THRESHOLD } from './metrics.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STT_URL = (process.env.EVAL_STT_URL
  ?? 'https://stt-service-468044672171.asia-south1.run.app').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS ?? 180_000);

const cases = JSON.parse(fs.readFileSync(path.join(DIR, 'cases.json'), 'utf8'));

const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', bold: '\x1b[1m', off: '\x1b[0m' };
const pct = (n) => `${(n * 100).toFixed(1)}%`;

async function transcribe(wavPath, language) {
  const pcm = fs.readFileSync(wavPath).subarray(44); // strip RIFF header
  const durationS = pcm.length / (16000 * 2);
  const t0 = Date.now();
  const res = await fetch(`${STT_URL}/transcribe?language=${encodeURIComponent(language)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: pcm,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const latencyS = (Date.now() - t0) / 1000;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return { text: (body.text ?? '').trim(), durationS, latencyS };
}

/** Returns a list of failure strings; empty means the case passed. */
function check(a, text, reference) {
  const fails = [];
  if (a.mustBeEmpty && text) fails.push(`expected empty output, got ${JSON.stringify(text.slice(0, 60))}`);
  if (a.mustBeEmpty) return fails;

  if (!text) { fails.push('empty transcript'); return fails; }
  if (a.mustNotBeTranslated && looksTranslated(text)) fails.push('TRANSLATED instead of transcribed (no Devanagari)');
  if (a.mustBeScript && script(text) !== a.mustBeScript) fails.push(`script was ${script(text)}, expected ${a.mustBeScript}`);
  if (a.noRepetitionLoop && repetitionRun(text) >= REPETITION_THRESHOLD) fails.push(`repetition loop (run=${repetitionRun(text)})`);
  if (a.maxWer != null) {
    const w = wer(reference, text);
    if (w > a.maxWer) fails.push(`WER ${pct(w)} > budget ${pct(a.maxWer)}`);
  }
  return fails;
}

const results = [];
console.log(`${C.bold}STT evals${C.off} ${C.dim}→ ${STT_URL}${C.off}\n`);

for (const c of cases) {
  process.stdout.write(`  ${c.id.padEnd(28)} `);
  try {
    const { text, durationS, latencyS } = await transcribe(path.join(DIR, 'fixtures', c.audio), c.language);
    const fails = check(c.assert ?? {}, text, c.reference);
    const rtf = latencyS / durationS;
    // RTF is meaningless on very short clips — fixed API round-trip overhead
    // dominates. Judge those on wall-clock latency instead.
    const SHORT_CLIP_S = 2;
    if (durationS < SHORT_CLIP_S) {
      const budget = c.assert?.maxLatencyS ?? 5;
      if (latencyS > budget) fails.push(`latency ${latencyS.toFixed(1)}s > budget ${budget}s`);
    } else if (c.assert?.maxRtf != null && rtf > c.assert.maxRtf) {
      fails.push(`RTF ${rtf.toFixed(2)}x > budget ${c.assert.maxRtf}x`);
    }
    results.push({ ...c, text, latencyS, durationS, rtf, fails });
    console.log(fails.length ? `${C.red}FAIL${C.off}` : `${C.grn}pass${C.off}`
      + `  ${C.dim}${latencyS.toFixed(1)}s  RTF ${rtf.toFixed(2)}x${C.off}`);
  } catch (err) {
    results.push({ ...c, error: err.message, fails: [`request failed: ${err.message}`] });
    console.log(`${C.red}ERROR${C.off} ${err.message}`);
  }
}

console.log(`\n${C.bold}Detail${C.off}`);
for (const r of results) {
  console.log(`\n  ${C.bold}${r.id}${C.off}  ${C.dim}${r.why}${C.off}`);
  if (r.error) { console.log(`    ${C.red}${r.error}${C.off}`); continue; }
  if (r.reference) console.log(`    ref : ${r.reference}`);
  console.log(`    got : ${r.text || C.dim + '(empty)' + C.off}`);
  if (r.reference || r.text) {
    const w = wer(r.reference, r.text);
    let line = `    WER ${pct(w)}  CER ${pct(cer(r.reference, r.text))}  script=${script(r.text)}`;
    if (r.target?.maxWer != null && w > r.target.maxWer) {
      line += `  ${C.yel}(above quality target ${pct(r.target.maxWer)})${C.off}`;
    }
    console.log(line);
  }
  for (const f of r.fails) console.log(`    ${C.red}✗ ${f}${C.off}`);
}

const failed = results.filter((r) => r.fails.length);
const scored = results.filter((r) => !r.error && r.reference);
const avgWer = scored.length ? scored.reduce((s, r) => s + wer(r.reference, r.text), 0) / scored.length : 0;
const timed = results.filter((r) => r.rtf != null);
const avgRtf = timed.length ? timed.reduce((s, r) => s + r.rtf, 0) / timed.length : 0;

console.log(`\n${C.bold}Summary${C.off}`);
console.log(`  cases    : ${results.length - failed.length}/${results.length} passed`);
console.log(`  mean WER : ${pct(avgWer)}`);
console.log(`  mean RTF : ${avgRtf.toFixed(2)}x ${avgRtf > 1 ? C.yel + '(slower than real time)' + C.off : C.grn + '(real-time capable)' + C.off}`);

if (failed.length) {
  console.log(`\n${C.red}${failed.length} case(s) failed:${C.off} ${failed.map((f) => f.id).join(', ')}`);
  process.exit(1);
}
console.log(`\n${C.grn}All evals passed.${C.off}`);
