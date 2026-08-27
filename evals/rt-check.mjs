import fs from 'fs';
import { parseWav } from './tts-metrics.mjs';
import { wer, cer } from './metrics.mjs';
const URL = 'https://stt-service-468044672171.asia-south1.run.app';
const REF = 'नमस्ते आज मौसम बहुत अच्छा है';

async function rt(file, label) {
  const { samples, sampleRate } = parseWav(fs.readFileSync(file));
  const ratio = sampleRate / 16000;
  const out = Buffer.alloc(Math.floor(samples.length / ratio) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    const s = Math.floor(i * ratio), e = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0; for (let j = s; j < e; j++) sum += samples[j];
    const v = Math.max(-1, Math.min(1, sum / Math.max(1, e - s)));
    out.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), i * 2);
  }
  const res = await fetch(`${URL}/transcribe?language=hi`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: out,
    signal: AbortSignal.timeout(240000),
  });
  const text = ((await res.json()).text ?? '').trim();
  console.log(`  ${label.padEnd(26)} WER ${(wer(REF, text) * 100).toFixed(0)}%  CER ${(cer(REF, text) * 100).toFixed(0)}%`);
  console.log(`     ${text.slice(0, 80)}`);
}
await rt('/tmp/hi_IN-pratham-medium.wav', 'piper pratham');
await rt('/tmp/hi_IN-priyamvada-medium.wav', 'piper priyamvada');
await rt('fixtures/hindi.wav', 'macOS Lekha (control)');
