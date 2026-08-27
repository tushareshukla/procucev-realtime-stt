import { pipeline, env } from '@huggingface/transformers';
import fs from 'fs';

env.cacheDir = './.models';
const wav = fs.readFileSync('testdata/hinglish.wav').subarray(44);
const audio = new Float32Array(wav.length / 2);
for (let i = 0; i < audio.length; i++) audio[i] = wav.readInt16LE(i * 2) / 32768;

const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { dtype: 'q8' });

const cases = [
  ['unset (current)',        { task: 'transcribe' }],
  ['language: hi',           { task: 'transcribe', language: 'hi' }],
  ['language: null',         { task: 'transcribe', language: null }],
  ['no task, lang hi',       { language: 'hi' }],
];

for (const [label, opts] of cases) {
  try {
    const out = await asr(audio, { return_timestamps: false, ...opts });
    console.log(`\n### ${label}\n${JSON.stringify(out.text)}`);
  } catch (e) {
    console.log(`\n### ${label}\nERROR: ${e.message}`);
  }
}
