import { pipeline, env, AutoProcessor, AutoModelForSpeechSeq2Seq } from '@huggingface/transformers';
import fs from 'fs';
env.cacheDir = './.models';

const wav = fs.readFileSync('testdata/hinglish.wav').subarray(44);
const audio = new Float32Array(wav.length / 2);
for (let i = 0; i < audio.length; i++) audio[i] = wav.readInt16LE(i * 2) / 32768;

const asr = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small', { dtype: 'q8' });

// Does the tokenizer expose whisper's language-detection helper?
const tok = asr.tokenizer;
console.log('tokenizer methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(tok)).filter(m=>/lang|decode_asr/i.test(m)).join(', ') || '(none)');
console.log('model has detect_language:', typeof asr.model?.detect_language);
console.log('pipeline keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(asr)).join(', '));

for (const lang of ['auto', 'en', 'hi']) {
  try {
    const out = await asr(audio, { task: 'transcribe', language: lang, return_timestamps: false });
    console.log(`\n### language: ${lang}\n${JSON.stringify(out.text)}`);
  } catch (e) {
    console.log(`\n### language: ${lang}\nERROR: ${e.message.slice(0,160)}`);
  }
}
