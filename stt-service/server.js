/**
 * Whisper inference service.
 *
 * Deployed to Cloud Run and called by the NestJS backend over HTTP. Kept
 * separate so the ~2GB model process scales to zero independently of the API,
 * and never has to share a VM with anything else.
 */
import express from 'express';
import { pipeline, env } from '@huggingface/transformers';

const MODEL_ID = process.env.WHISPER_MODEL ?? 'Xenova/whisper-small';
const DTYPE = process.env.WHISPER_DTYPE ?? 'q8';
const PORT = Number(process.env.PORT ?? 8080);
const SAMPLE_RATE = 16_000;

env.cacheDir = process.env.MODEL_CACHE ?? '/models';
env.allowLocalModels = true;

let asr = null;
let loading = null;

function load() {
  if (!loading) {
    loading = (async () => {
      const t0 = Date.now();
      console.log(`loading ${MODEL_ID} (${DTYPE}) …`);
      asr = await pipeline('automatic-speech-recognition', MODEL_ID, { dtype: DTYPE });
      console.log(`model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    })();
  }
  return loading;
}

const app = express();
// Audio arrives as raw little-endian PCM16 — not JSON, not multipart.
app.use('/transcribe', express.raw({ type: '*/*', limit: '25mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true, ready: Boolean(asr), model: MODEL_ID }));

app.post('/transcribe', async (req, res) => {
  try {
    if (!asr) await load();

    // Whisper needs an explicit language. transformers.js does NOT auto-detect:
    // with none it defaults to English and *translates* rather than transcribes,
    // which destroys code-mixed Hinglish. The caller always sends one.
    const language = req.query.language || process.env.WHISPER_LANGUAGE || 'hi';

    const buf = req.body;
    if (!buf?.length || buf.length < SAMPLE_RATE * 0.3 * 2) {
      return res.json({ text: '', language, confidence: 0 });
    }

    const audio = new Float32Array(buf.length / 2);
    for (let i = 0; i < audio.length; i++) audio[i] = buf.readInt16LE(i * 2) / 32768;

    const out = await asr(audio, {
      task: 'transcribe',
      language,
      return_timestamps: false,
      chunk_length_s: 30,
      stride_length_s: 5,
      // Whisper degenerates into repeated-token loops on short or noisy
      // windows ("करुँँँँँ…"). These bound it without hurting normal output.
      no_repeat_ngram_size: 3,
      repetition_penalty: 1.15,
      num_beams: 1,
    });

    const text = String(out?.text ?? '').trim();
    res.json({ text, language, confidence: text ? 1 : 0 });
  } catch (err) {
    console.error('transcribe failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`stt-service listening on ${PORT}`);
  load().catch((e) => console.error('preload failed:', e.message));
});
