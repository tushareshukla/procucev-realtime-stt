#!/usr/bin/env node
/**
 * Compare Whisper checkpoints on the eval fixtures.
 *
 * Runs entirely locally so model selection doesn't cost a deploy cycle each.
 * Reports WER/CER per case plus real-time factor, which is the actual tradeoff:
 * bigger checkpoints are more accurate and slower.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wer, cer, script, looksTranslated, repetitionRun } from './metrics.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(fs.readFileSync(path.join(DIR, 'cases.json'), 'utf8'));

const MODELS = (process.env.BENCH_MODELS ??
  'Xenova/whisper-small,onnx-community/whisper-large-v3-turbo').split(',');
const DTYPE = process.env.BENCH_DTYPE ?? 'q8';

const { pipeline, env } = await import('@huggingface/transformers');
env.cacheDir = './.models';
env.allowLocalModels = true;

function audioOf(file) {
  const pcm = fs.readFileSync(path.join(DIR, 'fixtures', file)).subarray(44);
  const a = new Float32Array(pcm.length / 2);
  for (let i = 0; i < a.length; i++) a[i] = pcm.readInt16LE(i * 2) / 32768;
  return { audio: a, durationS: a.length / 16000 };
}

const table = [];
for (const model of MODELS) {
  process.stderr.write(`\nloading ${model} (${DTYPE}) …\n`);
  const t0 = Date.now();
  let asr;
  try {
    asr = await pipeline('automatic-speech-recognition', model, { dtype: DTYPE });
  } catch (e) {
    console.error(`  SKIP ${model}: ${e.message.slice(0, 120)}`);
    continue;
  }
  process.stderr.write(`  ready in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  for (const c of cases) {
    const { audio, durationS } = audioOf(c.audio);
    const s0 = Date.now();
    let text = '';
    try {
      const out = await asr(audio, {
        task: 'transcribe', language: c.language, return_timestamps: false,
        chunk_length_s: 30, stride_length_s: 5,
        no_repeat_ngram_size: 3, repetition_penalty: 1.15, num_beams: 1,
      });
      text = String(out?.text ?? '').trim();
    } catch (e) {
      text = `<error: ${e.message.slice(0, 40)}>`;
    }
    const latencyS = (Date.now() - s0) / 1000;
    table.push({
      model, id: c.id, text,
      wer: c.reference ? wer(c.reference, text) : null,
      cer: c.reference ? cer(c.reference, text) : null,
      rtf: latencyS / durationS,
      script: script(text),
      translated: looksTranslated(text, c.assert?.mustBeScript),
      repetition: repetitionRun(text),
    });
    process.stderr.write(`  ${c.id.padEnd(26)} ${latencyS.toFixed(1)}s\n`);
  }
}

const pct = (n) => (n == null ? '   -  ' : `${(n * 100).toFixed(1)}%`.padStart(6));
console.log('\n' + '='.repeat(96));
console.log('MODEL COMPARISON');
console.log('='.repeat(96));
for (const model of [...new Set(table.map((r) => r.model))]) {
  const rows = table.filter((r) => r.model === model);
  console.log(`\n${model}`);
  console.log('  case                        WER     CER    RTF   script      flags');
  for (const r of rows) {
    const flags = [r.translated && 'TRANSLATED', r.repetition >= 12 && 'REPEAT'].filter(Boolean).join(',') || '-';
    console.log(`  ${r.id.padEnd(26)} ${pct(r.wer)} ${pct(r.cer)} ${r.rtf.toFixed(2).padStart(5)}x  ${r.script.padEnd(11)} ${flags}`);
  }
  const scored = rows.filter((r) => r.wer != null);
  const mWer = scored.reduce((s, r) => s + r.wer, 0) / scored.length;
  const mCer = scored.reduce((s, r) => s + r.cer, 0) / scored.length;
  const mRtf = rows.reduce((s, r) => s + r.rtf, 0) / rows.length;
  console.log(`  ${'MEAN'.padEnd(26)} ${pct(mWer)} ${pct(mCer)} ${mRtf.toFixed(2).padStart(5)}x`);
}
console.log('\nTranscripts:');
for (const r of table.filter((x) => x.id === 'hinglish-code-mix')) {
  console.log(`  ${r.model}\n    ${r.text}`);
}
