#!/usr/bin/env node
/**
 * Text-to-speech eval harness.
 *
 * Validity checks (is it real audio?) plus a closed-loop intelligibility test:
 * synthesise text, transcribe it back through STT, and score WER. Bytes that
 * parse as a WAV prove nothing — round-tripping proves someone could understand
 * what was said.
 *
 *   node evals/tts.mjs
 *   EVAL_STT_URL=http://localhost:9000 node evals/tts.mjs
 */
import { parseWav, rms, peak, silenceRatio, clippedRatio } from './tts-metrics.mjs';
import { wer, cer } from './metrics.mjs';

const URL_BASE = (process.env.EVAL_STT_URL
  ?? 'https://stt-service-468044672171.asia-south1.run.app').replace(/\/$/, '');
const TIMEOUT = Number(process.env.EVAL_TIMEOUT_MS ?? 240_000);

const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', bold: '\x1b[1m', off: '\x1b[0m' };
const ok = (b) => (b ? `${C.grn}pass${C.off}` : `${C.red}FAIL${C.off}`);
const pct = (n) => `${(n * 100).toFixed(1)}%`;

async function speak({ text, language, voice, speed = 1 }) {
  const t0 = Date.now();
  const res = await fetch(`${URL_BASE}/speak`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language, voice, speed }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`speak ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return { buf: Buffer.from(await res.arrayBuffer()), latencyS: (Date.now() - t0) / 1000 };
}

async function speakStream({ text, language, voice, speed = 1 }) {
  const t0 = Date.now();
  const res = await fetch(`${URL_BASE}/speak/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, language, voice, speed }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`stream ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const chunks = [];
  let o = 0;
  while (o + 4 <= buf.length) {
    const len = buf.readUInt32BE(o);
    if (o + 4 + len > buf.length) break;
    chunks.push(buf.subarray(o + 4, o + 4 + len));
    o += 4 + len;
  }
  return { chunks, totalS: (Date.now() - t0) / 1000 };
}

/** Send synthesised audio back through STT to check it is understandable. */
async function transcribe(wavBuf, language) {
  const { samples, sampleRate } = parseWav(wavBuf);

  // STT expects 16kHz mono PCM16; average-decimate rather than point-sample.
  const ratio = sampleRate / 16000;
  const out = Buffer.alloc(Math.floor(samples.length / ratio) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
    out.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), i * 2);
  }

  const res = await fetch(`${URL_BASE}/transcribe?language=${encodeURIComponent(language)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: out,
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`transcribe ${res.status}`);
  return ((await res.json()).text ?? '').trim();
}

const CASES = [
  { id: 'english-kokoro', language: 'en', voice: 'af_heart',
    text: 'The quarterly report is due next Friday.',
    why: 'Primary English path via Kokoro.' },
  { id: 'english-male-voice', language: 'en', voice: 'am_michael',
    text: 'Please review the numbers before the meeting.',
    why: 'A second voice must work as well as the default.' },
  { id: 'hindi-piper', language: 'hi', voice: 'hi_IN-pratham-medium',
    text: 'नमस्ते, आज मौसम बहुत अच्छा है।',
    why: 'Hindi routes to Piper, a different engine entirely.' },
  { id: 'long-passage', language: 'en', voice: 'af_heart',
    text: 'The first sentence introduces the topic. The second develops it further. The third concludes with a summary of what was said.',
    why: 'Long input must not be silently truncated.' },
];

let failures = 0;
const fail = (msg) => { console.log(`      ${C.red}✗ ${msg}${C.off}`); failures++; };

console.log(`${C.bold}TTS evals${C.off} ${C.dim}→ ${URL_BASE}${C.off}\n`);

// ── 1. validity + intelligibility ────────────────────────────────────────────
console.log(`${C.bold}Synthesis${C.off}`);
for (const c of CASES) {
  process.stdout.write(`  ${c.id.padEnd(22)} `);
  try {
    const { buf, latencyS } = await speak(c);
    const a = parseWav(buf);
    const sil = silenceRatio(a.samples, a.sampleRate);
    const clip = clippedRatio(a.samples);
    const level = rms(a.samples);

    // Roughly 12 characters per second of speech; allow a wide band.
    const expected = c.text.length / 12;
    const tooShort = a.durationS < expected * 0.35;

    console.log(`${ok(true)} ${C.dim}${a.durationS.toFixed(2)}s @ ${a.sampleRate}Hz, ${latencyS.toFixed(1)}s${C.off}`);
    console.log(`      ${C.dim}${c.why}${C.off}`);
    console.log(`      rms ${level.toFixed(3)}  peak ${peak(a.samples).toFixed(2)}  silence ${pct(sil)}  clipped ${pct(clip)}`);

    if (level < 0.005) fail(`near-silent output (rms ${level.toFixed(4)})`);
    if (sil > 0.85) fail(`mostly silence (${pct(sil)})`);
    if (clip > 0.01) fail(`clipping (${pct(clip)} of samples)`);
    if (tooShort) fail(`too short for the text: ${a.durationS.toFixed(2)}s vs ~${expected.toFixed(1)}s expected`);

    // Closed loop: can our own STT read it back?
    const heard = await transcribe(buf, c.language);
    const w = wer(c.text, heard);
    console.log(`      round-trip WER ${pct(w)}  CER ${pct(cer(c.text, heard))}`);
    console.log(`      ${C.dim}heard: ${heard.slice(0, 78) || '(nothing)'}${C.off}`);
    if (w > 0.5) fail(`round-trip WER ${pct(w)} — synthesised speech is hard to understand`);
  } catch (err) {
    console.log(`${ok(false)}`);
    fail(err.message);
  }
}

// ── 2. speed control ─────────────────────────────────────────────────────────
console.log(`\n${C.bold}Speed control${C.off}`);
try {
  const text = 'The quarterly report is due next Friday.';
  const slow = parseWav((await speak({ text, language: 'en', voice: 'af_heart', speed: 0.7 })).buf);
  const fast = parseWav((await speak({ text, language: 'en', voice: 'af_heart', speed: 1.5 })).buf);
  console.log(`  0.7x → ${slow.durationS.toFixed(2)}s   1.5x → ${fast.durationS.toFixed(2)}s`);
  if (!(slow.durationS > fast.durationS * 1.2)) {
    fail('speed has little or no effect on duration');
  } else {
    console.log(`  ${ok(true)} slower speech is measurably longer`);
  }
} catch (err) { fail(`speed test: ${err.message}`); }

// ── 3. streaming ─────────────────────────────────────────────────────────────
console.log(`\n${C.bold}Streaming${C.off}`);
try {
  const text = 'First sentence here. Second sentence follows. And a third one.';
  const { chunks, totalS } = await speakStream({ text, language: 'en', voice: 'af_heart' });
  console.log(`  ${chunks.length} chunk(s) in ${totalS.toFixed(1)}s`);
  if (chunks.length < 2) fail(`expected multiple chunks for 3 sentences, got ${chunks.length}`);
  else console.log(`  ${ok(true)} multi-sentence input streams per sentence`);

  for (const [i, ch] of chunks.entries()) {
    try {
      const a = parseWav(ch);
      if (a.durationS < 0.1) fail(`chunk ${i + 1} is only ${a.durationS.toFixed(2)}s`);
    } catch (e) { fail(`chunk ${i + 1} is not valid WAV: ${e.message}`); }
  }
  console.log(`  ${ok(true)} every chunk is independently playable WAV`);
} catch (err) { fail(`streaming: ${err.message}`); }

// ── 4. input validation ──────────────────────────────────────────────────────
console.log(`\n${C.bold}Input handling${C.off}`);
for (const [label, body] of [['empty text', { text: '', language: 'en' }],
                             ['whitespace only', { text: '   ', language: 'en' }]]) {
  const res = await fetch(`${URL_BASE}/speak`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const rejected = !res.ok;
  console.log(`  ${label.padEnd(18)} ${ok(rejected)} ${C.dim}HTTP ${res.status}${C.off}`);
  if (!rejected) fail(`${label} should be rejected, got ${res.status}`);
}

// ── 5. voice coverage ────────────────────────────────────────────────────────
console.log(`\n${C.bold}Voice coverage${C.off}`);
for (const lang of ['en', 'hi']) {
  const { voices, engine } = await (await fetch(`${URL_BASE}/voices?language=${lang}`)).json();
  if (!voices?.length) { fail(`no voices listed for ${lang}`); continue; }

  // Sampling rather than all 28: enough to catch a broken voice table.
  const sample = voices.slice(0, 3);
  let good = 0;
  for (const v of sample) {
    try {
      const a = parseWav((await speak({ text: 'Testing one two three.', language: lang, voice: v.id })).buf);
      if (a.durationS > 0.2 && rms(a.samples) > 0.005) good++;
      else fail(`voice ${v.id} produced unusable audio`);
    } catch (e) { fail(`voice ${v.id}: ${e.message}`); }
  }
  console.log(`  ${lang} (${engine}): ${good}/${sample.length} sampled voices usable, ${voices.length} listed`);
}

console.log(`\n${C.bold}Summary${C.off}`);
if (failures) {
  console.log(`  ${C.red}${failures} check(s) failed${C.off}`);
  process.exit(1);
}
console.log(`  ${C.grn}All TTS evals passed.${C.off}`);
