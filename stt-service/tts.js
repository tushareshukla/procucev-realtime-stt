/**
 * Open-source text-to-speech.
 *
 *   Kokoro-82M (Apache-2.0) — English, 28 voices. Excellent quality, and the
 *                             voice list is what gives real tone control.
 *   Piper      (MIT)        — Hindi and many others. Kokoro's ONNX build ships
 *                             en-us/en-gb only, so Piper covers everything else.
 *
 * Both run locally in this container. No hosted TTS API is involved.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const KOKORO_MODEL = process.env.KOKORO_MODEL ?? 'onnx-community/Kokoro-82M-v1.0-ONNX';
const KOKORO_DTYPE = process.env.KOKORO_DTYPE ?? 'q8';
const DEFAULT_KOKORO_VOICE = process.env.KOKORO_VOICE ?? 'af_heart';
const PIPER_BIN = process.env.PIPER_BIN ?? '/opt/piper/piper';
const PIPER_VOICE_DIR = process.env.PIPER_VOICE_DIR ?? '/opt/piper/voices';

let kokoro = null, kokoroLoading = null;

function loadKokoro() {
  kokoroLoading ??= (async () => {
    const { KokoroTTS, env: kokoroEnv } = await import('kokoro-js');
    // Voice embeddings live on the Hub; without this kokoro-js resolves them
    // against the working directory and fails with ENOENT.
    if (kokoroEnv) {
      kokoroEnv.allowLocalModels = false;
      if (process.env.MODEL_CACHE) kokoroEnv.cacheDir = process.env.MODEL_CACHE;
    }
    kokoro = await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: KOKORO_DTYPE });
    console.log(`kokoro ready (${Object.keys(kokoro.voices).length} voices)`);
  })();
  return kokoroLoading;
}

/** Which engine owns a language. */
export function engineFor(language) {
  return String(language || 'en').toLowerCase().startsWith('en') ? 'kokoro' : 'piper';
}

export async function listVoices(language) {
  if (engineFor(language) === 'kokoro') {
    if (!kokoro) await loadKokoro();
    return Object.entries(kokoro.voices).map(([id, v]) => ({
      id, name: v.name, language: v.language, gender: v.gender, engine: 'kokoro',
    }));
  }
  if (!fs.existsSync(PIPER_VOICE_DIR)) return [];
  return fs.readdirSync(PIPER_VOICE_DIR)
    .filter((f) => f.endsWith('.onnx'))
    .map((f) => {
      const id = f.replace(/\.onnx$/, '');
      return { id, name: id, language: id.split('_')[0], engine: 'piper' };
    });
}

async function speakKokoro(text, voice, speed) {
  if (!kokoro) await loadKokoro();
  const chosen = voice && kokoro.voices[voice] ? voice : DEFAULT_KOKORO_VOICE;
  const audio = await kokoro.generate(text, { voice: chosen, speed });
  // Kokoro emits IEEE-float WAV (format 3). Some players reject it, so
  // re-encode to 16-bit PCM, which is universally supported.
  return floatToPcm16Wav(audio.audio, audio.sampling_rate);
}

/** Wrap a Float32 waveform as a 16-bit PCM WAV. */
function floatToPcm16Wav(samples, sampleRate) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);            // PCM
  buf.writeUInt16LE(1, 22);            // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), 44 + i * 2);
  }
  return buf;
}

function speakPiper(text, voice, speed) {
  const model = path.join(PIPER_VOICE_DIR, `${voice}.onnx`);
  if (!fs.existsSync(PIPER_BIN)) throw new Error('piper binary not installed in this image');
  if (!fs.existsSync(model)) throw new Error(`piper voice not found: ${voice}`);

  return new Promise((resolve, reject) => {
    // length_scale is inverse to speed: 1/speed slows down as speed drops.
    const args = ['--model', model, '--output_file', '-', '--length_scale', String(1 / Math.max(0.1, speed))];
    const proc = spawn(PIPER_BIN, args);
    const chunks = [], errs = [];
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => errs.push(d));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolve(Buffer.concat(chunks))
                 : reject(new Error(`piper exited ${code}: ${Buffer.concat(errs).toString().slice(0, 200)}`)));
    proc.stdin.end(text);
  });
}

/** Returns a WAV buffer. */
export async function synthesize({ text, language = 'en', voice, speed = 1 }) {
  if (!text?.trim()) throw new Error('empty text');
  const engine = engineFor(language);
  const audio = engine === 'kokoro'
    ? await speakKokoro(text, voice, speed)
    : await speakPiper(text, voice || defaultPiperVoice(language), speed);
  return { audio, engine };
}

/**
 * Streaming synthesis: yields WAV chunks as each sentence is synthesised
 * instead of waiting for the whole passage. Playback can start on the first
 * chunk, which is the difference between "instant" and "waits then speaks".
 */
export async function* synthesizeStream({ text, language = 'en', voice, speed = 1 }) {
  if (!text?.trim()) throw new Error('empty text');

  if (engineFor(language) === 'kokoro') {
    if (!kokoro) await loadKokoro();
    const chosen = voice && kokoro.voices[voice] ? voice : DEFAULT_KOKORO_VOICE;

    // Passing a plain string to kokoro.stream() hangs: it builds an internal
    // TextSplitterStream and never closes it, so the iterator waits forever for
    // more input. Drive the splitter ourselves and close it explicitly.
    const { TextSplitterStream } = await import('kokoro-js');
    const splitter = new TextSplitterStream();
    // Push with separators intact so its own sentence detection can fire;
    // pushing pre-split fragments concatenates them into one utterance.
    splitter.push(text);
    splitter.close();

    for await (const { audio } of kokoro.stream(splitter, { voice: chosen, speed })) {
      yield floatToPcm16Wav(audio.audio, audio.sampling_rate);
    }
    return;
  }

  // Piper has no sentence-stream API, so split and synthesise per sentence.
  for (const sentence of splitSentences(text)) {
    yield await speakPiper(sentence, voice || defaultPiperVoice(language), speed);
  }
}

function splitSentences(text) {
  return text
    .split(/(?<=[.!?।])\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function defaultPiperVoice(language) {
  const lang = String(language).toLowerCase().slice(0, 2);
  if (!fs.existsSync(PIPER_VOICE_DIR)) return `${lang}_IN`;
  const match = fs.readdirSync(PIPER_VOICE_DIR)
    .filter((f) => f.endsWith('.onnx') && f.toLowerCase().startsWith(lang));
  return match.length ? match[0].replace(/\.onnx$/, '') : `${lang}_IN`;
}
