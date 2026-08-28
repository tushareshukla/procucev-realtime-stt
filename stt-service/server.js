/**
 * Speech-to-text inference service.
 *
 * Two engines behind one HTTP contract, selected by STT_ENGINE:
 *
 *   chirp   (default) — Google Cloud Speech-to-Text v2, model chirp_2.
 *                       Mean WER ~2% on the eval fixtures.
 *   whisper           — self-hosted whisper via transformers.js. No external
 *                       dependency, but ~115% mean WER on Hindi/Hinglish.
 *
 * The NestJS backend calls this and does not care which engine is active.
 */
import express from 'express';
import { GoogleAuth } from 'google-auth-library';
import { toBcp47 } from './languages.js';
import { synthesize, synthesizeStream, listVoices, engineFor, installedLanguages, UnsupportedLanguageError } from './tts.js';

const ENGINE = (process.env.STT_ENGINE ?? 'chirp').toLowerCase();
const PORT = Number(process.env.PORT ?? 8080);
const SAMPLE_RATE = 16_000;

// Chirp 2 is region-bound; us-central1 is where it is published.
const GCP_PROJECT = process.env.GOOGLE_CLOUD_PROJECT ?? '';
const SPEECH_LOCATION = process.env.SPEECH_LOCATION ?? 'us-central1';
const SPEECH_MODEL = process.env.SPEECH_MODEL ?? 'chirp_2';

/** Below this RMS the window is silence. Both engines hallucinate on silence. */
const SILENCE_RMS = Number(process.env.SILENCE_RMS ?? 0.005);

/**
 * Whisper emits a small set of stock phrases when it hears near-silence or
 * background noise — these are its training-data artifacts, not speech. On a
 * quiet window they are always hallucinations, so they are dropped.
 */
const HALLUCINATIONS = new Set([
  'you', 'thank you', 'thank you.', 'thanks for watching', 'thanks for watching!',
  'you.', 'bye', 'bye.', 'bye!', 'oh', 'oh.', 'oh, oh', 'oh, oh.', 'okay', 'okay.',
  'the', '.', '..', '...', 'um', 'uh', 'hmm', 'mm', 'so', 'yeah', 'yeah.',
  'please subscribe', 'subtitles by the amara.org community',
  'शुक्रिया', 'धन्यवाद', 'धन्यवाद।', 'नमस्कार', 'ठीक है।',
]);

/** Quiet enough that a stock phrase is far more likely noise than speech. */
const HALLUCINATION_RMS = Number(process.env.HALLUCINATION_RMS ?? 0.02);

function isLikelyHallucination(text, rmsLevel) {
  if (!text) return false;
  if (rmsLevel >= HALLUCINATION_RMS) return false;
  const key = text.toLowerCase().trim().replace(/\s+/g, ' ');
  return HALLUCINATIONS.has(key);
}
const MIN_SECONDS = Number(process.env.MIN_SECONDS ?? 0.3);

const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
let authClient = null;

async function accessToken() {
  authClient ??= await auth.getClient();
  const { token } = await authClient.getAccessToken();
  return token;
}

// ── Chirp engine ─────────────────────────────────────────────────────────────

async function transcribeChirp(pcm, language) {
  const token = await accessToken();
  const host = `https://${SPEECH_LOCATION}-speech.googleapis.com`;
  const url = `${host}/v2/projects/${GCP_PROJECT}/locations/${SPEECH_LOCATION}/recognizers/_:recognize`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      config: {
        model: SPEECH_MODEL,
        languageCodes: [toBcp47(language)],
        features: { enableAutomaticPunctuation: true },
        // Input is raw PCM with no container, so decoding must be explicit.
        explicitDecodingConfig: {
          encoding: 'LINEAR16',
          sampleRateHertz: SAMPLE_RATE,
          audioChannelCount: 1,
        },
      },
      content: pcm.toString('base64'),
    }),
    signal: AbortSignal.timeout(Number(process.env.SPEECH_TIMEOUT_MS ?? 60_000)),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`speech api ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  const parts = [];
  let confidence = 0, n = 0;
  for (const r of data.results ?? []) {
    const alt = r.alternatives?.[0];
    if (!alt?.transcript) continue;
    parts.push(alt.transcript.trim());
    if (typeof alt.confidence === 'number') { confidence += alt.confidence; n++; }
  }
  return { text: parts.join(' ').trim(), confidence: n ? confidence / n : 1 };
}

// ── Whisper engine (fallback / fully self-hosted mode) ───────────────────────

let asr = null, whisperLoading = null;

function loadWhisper() {
  whisperLoading ??= (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = process.env.MODEL_CACHE ?? '/models';
    env.allowLocalModels = true;
    asr = await pipeline('automatic-speech-recognition',
      process.env.WHISPER_MODEL ?? 'Xenova/whisper-small',
      { dtype: process.env.WHISPER_DTYPE ?? 'q8' });
    console.log('whisper ready');
  })();
  return whisperLoading;
}

async function transcribeWhisper(pcm, language) {
  if (!asr) await loadWhisper();
  const audio = new Float32Array(pcm.length / 2);
  for (let i = 0; i < audio.length; i++) audio[i] = pcm.readInt16LE(i * 2) / 32768;
  const out = await asr(audio, {
    task: 'transcribe',
    language: String(language || 'en').split('-')[0],
    return_timestamps: false,
    chunk_length_s: 30,
    stride_length_s: 5,
    no_repeat_ngram_size: 3,
    repetition_penalty: 1.15,
    num_beams: 1,
  });
  return { text: String(out?.text ?? '').trim(), confidence: 1 };
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

const app = express();
app.use('/transcribe', express.raw({ type: '*/*', limit: '25mb' }));

// GET is answered too, but some network paths in front of Cloud Run drop GET
// while passing POST, so health must be reachable either way.
const statusPayload = () => ({
  ok: true,
  engine: ENGINE,
  model: ENGINE === 'chirp' ? SPEECH_MODEL : (process.env.WHISPER_MODEL ?? 'Xenova/whisper-small'),
  location: SPEECH_LOCATION,
});

// `/healthz` is intercepted by infrastructure in front of Cloud Run on some
// network paths, so the same payload is served from `/status`, and a tiny
// `/transcribe` body doubles as a liveness probe.
app.all(['/healthz', '/status'], (_req, res) => res.json(statusPayload()));

app.post('/transcribe', async (req, res) => {
  const started = Date.now();
  const language = req.query.language || process.env.STT_LANGUAGE || 'en';
  const pcm = req.body;

  try {
    if (!pcm?.length || pcm.length < SAMPLE_RATE * MIN_SECONDS * 2) {
      // Doubles as a liveness probe: echoes engine/model so a caller can
      // verify configuration without a separate reachable endpoint.
      return res.json({ text: '', language, confidence: 0, skipped: 'too-short', ...statusPayload() });
    }

    // Both engines invent words from digital silence. Gate before spending a call.
    let sum = 0;
    const n = pcm.length / 2;
    for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2) / 32768; sum += v * v; }
    const level = Math.sqrt(sum / n);
    if (level < SILENCE_RMS) {
      return res.json({ text: '', language, confidence: 0, skipped: 'silence' });
    }

    const { text, confidence } =
      ENGINE === 'whisper' ? await transcribeWhisper(pcm, language)
                           : await transcribeChirp(pcm, language);

    if (isLikelyHallucination(text, level)) {
      return res.json({
        text: '', language, confidence: 0, skipped: 'hallucination',
        engine: ENGINE, ms: Date.now() - started,
      });
    }

    res.json({ text, language, confidence, engine: ENGINE, ms: Date.now() - started });
  } catch (err) {
    console.error('transcribe failed:', err.message);
    res.status(502).json({ error: err.message, engine: ENGINE });
  }
});

// ── text to speech ───────────────────────────────────────────────────────────

app.get('/tts-languages', (_req, res) => res.json({ languages: installedLanguages() }));

app.get('/voices', async (req, res) => {
  try {
    res.json({ voices: await listVoices(req.query.language ?? 'en'),
               engine: engineFor(req.query.language ?? 'en') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/speak', express.json({ limit: '256kb' }), async (req, res) => {
  const { text, language = 'en', voice, speed } = req.body ?? {};
  try {
    const { audio, engine } = await synthesize({
      text, language, voice, speed: Number(speed) || 1,
    });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-TTS-Engine', engine);
    res.send(audio);
  } catch (err) {
    if (err instanceof UnsupportedLanguageError) {
      // A missing voice is a bad request, not an upstream fault.
      return res.status(422).json({ error: err.message, available: err.available });
    }
    console.error('speak failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * Streaming TTS. Emits length-prefixed WAV chunks so the client can start
 * playing the first sentence while later ones are still being synthesised.
 * Framing: 4-byte big-endian length, then that many bytes of WAV.
 */
app.post('/speak/stream', express.json({ limit: '256kb' }), async (req, res) => {
  const { text, language = 'en', voice, speed } = req.body ?? {};
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-TTS-Engine', engineFor(language));
  try {
    for await (const wav of synthesizeStream({ text, language, voice, speed: Number(speed) || 1 })) {
      const header = Buffer.alloc(4);
      header.writeUInt32BE(wav.length, 0);
      res.write(header);
      res.write(wav);
    }
    res.end();
  } catch (err) {
    if (err instanceof UnsupportedLanguageError && !res.headersSent) {
      return res.status(422).json({ error: err.message, available: err.available });
    }
    console.error('speak/stream failed:', err.message);
    if (!res.headersSent) res.status(502).json({ error: err.message });
    else res.end();
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`stt-service listening on ${PORT} · engine=${ENGINE} · model=${ENGINE === 'chirp' ? SPEECH_MODEL : process.env.WHISPER_MODEL}`);
  if (ENGINE === 'whisper') loadWhisper().catch((e) => console.error('whisper preload failed:', e.message));
});

// Cloud Run sends SIGTERM before stopping the instance; finish in-flight work.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
