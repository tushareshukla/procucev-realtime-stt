# Real-time Multilingual Speech-to-Text

NestJS + Mastra service that transcribes live speech — including code-mixed
Hindi/English (Hinglish) — over a WebSocket, persists every segment, and exposes
CRUD over the transcription history.

## Stack

| Concern | Choice | Why |
|---|---|---|
| API | NestJS 11 | Requested; DI keeps the STT/agent layers separable |
| STT | Google Chirp 2 (Speech-to-Text v2), Whisper selectable | 2.3% mean WER vs 115% for whisper-small |
| Agent | Mastra + Gemini | Transcript cleanup / summarise / Q&A |
| DB | TypeORM — SQLite locally, Postgres in prod | Swap via `DATABASE_URL`, no code change |
| Transport | raw `ws` | Browser streams binary PCM16 frames |

## Run

```bash
pnpm install
pnpm build
node dist/main.js          # http://localhost:8080
```

First boot downloads ~260 MB of ONNX weights into `.models/` (~37 s), then
loads in <1 s.

## Configuration

| Env | Default | Notes |
|---|---|---|
| `DATABASE_URL` | _(unset → SQLite)_ | `postgres://…` switches dialect |
| `STT_ENGINE` | `chirp` | `whisper` for a fully self-hosted path |
| `SPEECH_MODEL` | `chirp_2` | Google STT v2 model |
| `SPEECH_LOCATION` | `us-central1` | Chirp 2 is region-bound |
| `WHISPER_MODEL` | `Xenova/whisper-small` | Only when `STT_ENGINE=whisper` |
| `WHISPER_LANGUAGE` | `en` | Default session language |
| `GOOGLE_GENERATIVE_AI_API_KEY` | _(unset)_ | Enables the Mastra agent endpoints |
| `REFRESH_MS` | `900` | Partial-transcript cadence |
| `SILENCE_COMMIT_S` | `0.8` | Pause length that commits a segment |

## API

- `WS /ws/transcribe` — send 16 kHz mono PCM16 binary frames; receive
  `{type:'partial'}` / `{type:'final'}`. Send `{"type":"config","language":"hi"}`
  to set the language, or `flush` to force a commit.
- `GET|POST /api/session` — identity. The name lives in a server-side session
  behind an httpOnly cookie (persisted to the DB, so restarts don't sign anyone
  out); the page never holds identity in browser storage.
- `GET|POST|PUT|DELETE /api/transcriptions[/:id]` — CRUD over history, scoped
  to the session's user. `GET /:id/audio` streams the stored recording.
- `POST /api/transcriptions/transcribe` — one-shot transcription of a finished
  recording (`{audioBase64, language}`); backs the UI's "Generate transcript"
  button. Answers `503` with a reason while the inference service is cold.
- `POST /api/tts/stream` — `{text, language}`; streams length-prefixed WAV
  chunks per sentence across 13 languages. `422` lists supported languages if
  asked for one with no installed voice. `GET /api/tts/voices` lists voices.
- `POST /api/agent/{ask,cleanup/:sid,summarize/:sid}` — Mastra agent
  (gated on `GOOGLE_GENERATIVE_AI_API_KEY`; reports `enabled:false` without it).

## Two things worth knowing

**Whisper's language must be set explicitly.** transformers.js does *not*
auto-detect — with no language it silently defaults to English, and Whisper then
*translates* Hindi speech into English instead of transcribing it. In `hi` mode
embedded English words are transcribed in Devanagari (`office` → `अफिस`), which
is what Hinglish input needs. Hence the language selector in the UI.

**Streaming is approximated.** Whisper is not a streaming model. A rolling
window is re-transcribed every `REFRESH_MS` for partials and committed on a
silence threshold, keeping a 1 s overlap tail so words spanning a boundary keep
their context.

## Tests

```bash
pnpm test          # 31 unit tests, 3 suites
pnpm test:cov      # with coverage
```

Covers the rolling-window commit logic (silence gating, overlap tail, flush),
the STT HTTP client (explicit-language contract, failure handling), and CRUD
against in-memory SQLite. Several are regression tests for bugs this system
actually shipped — see the comments marked `Regression:`.

## Evals

```bash
pnpm eval                                    # against deployed Cloud Run
EVAL_STT_URL=http://localhost:9000 pnpm eval # against a local service
```

Runs fixture audio through the inference service and scores it on accuracy
(WER/CER), the failure modes this system has hit, and latency. Exits non-zero
on regression, so it works in CI.

What it checks, and why each case exists:

| Case | Guards against |
|---|---|
| `hinglish-code-mix` | Translation instead of transcription — the core requirement |
| `hindi-only` | Devanagari output quality |
| `english-only` | English still works when selected |
| `short-utterance` | Repeated-token degeneration on short windows |
| `silence-produces-nothing` | Whisper hallucinating words from silence |

**Current results** (Chirp 2, `us-central1`):

| Case | WER | CER |
|---|---|---|
| Hinglish code-mix | **0.0%** | 0.0% |
| English | **0.0%** | 0.0% |
| Short utterance | **0.0%** | 0.0% |
| Hindi | 9.1% | 2.6% |
| **Mean** | **2.3%** | — |

Real-time factor ~1.0x. Silence returns empty rather than a hallucinated
phrase.

For comparison, self-hosted whisper-small on the same fixtures: 82% WER on
Hinglish, 64% on Hindi, 115% mean, 5.7x slower than real time. It remains
available via `STT_ENGINE=whisper` for a fully self-hosted deployment.

## Deployment

| Component | Where | Resources |
|---|---|---|
| Inference (`stt-service`) | Cloud Run `asia-south1` | 2 vCPU / 1 GiB, scales to zero |
| Backend + frontend | Dokploy → `prakriya-staging-app` | ~200 MB, no ML deps |
| Postgres | Dokploy, same VM | `postgres:17-alpine` |

`GET /readyz` reports database dialect, connection state, and the upstream
engine and model, so a misconfigured deploy is visible without shelling in.

### Two operational notes

**`/healthz` is unreachable through some network paths.** Requests to that
exact path 404 with a Google frontend page while `/transcribe` on the same
revision serves normally, and the container logs show them never arriving.
The readiness probe therefore POSTs a 2-byte body to `/transcribe`, which
exercises the real code path and echoes the configuration back.

**Chirp 2 is not available in `asia-south1`.** Inference runs in Cloud Run
Mumbai but calls the Speech API in `us-central1`, which is where the model is
published. Multi-language recognition (several `languageCodes` at once) is only
offered in the `eu`/`global`/`us` multi-regions and is mutually exclusive with
Chirp 2, so the UI selects one language per session instead.
