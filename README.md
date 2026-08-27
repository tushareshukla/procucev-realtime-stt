# Real-time Multilingual Speech-to-Text

NestJS + Mastra service that transcribes live speech — including code-mixed
Hindi/English (Hinglish) — over a WebSocket, persists every segment, and exposes
CRUD over the transcription history.

## Stack

| Concern | Choice | Why |
|---|---|---|
| API | NestJS 11 | Requested; DI keeps the STT/agent layers separable |
| STT | Whisper small (`@huggingface/transformers`, ONNX q8) | Self-hosted, MIT, handles code-mixing |
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
| `WHISPER_MODEL` | `Xenova/whisper-small` | `whisper-large-v3` for best accuracy |
| `WHISPER_LANGUAGE` | `hi` | Default session language |
| `GOOGLE_GENERATIVE_AI_API_KEY` | _(unset)_ | Enables the Mastra agent endpoints |
| `REFRESH_MS` | `900` | Partial-transcript cadence |
| `SILENCE_COMMIT_S` | `0.8` | Pause length that commits a segment |

## API

- `WS /ws/transcribe` — send 16 kHz mono PCM16 binary frames; receive
  `{type:'partial'}` / `{type:'final'}`. Send `{"type":"config","language":"hi"}`
  to set the language, or `flush` to force a commit.
- `GET|PUT|DELETE /api/transcriptions[/:id]` — CRUD over history.
- `POST /api/agent/{ask,cleanup/:sid,summarize/:sid}` — Mastra agent.

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

**Current baseline** (whisper-small q8, 8 vCPU / 16 GiB, synthesised TTS audio):

| Metric | Value | Target |
|---|---|---|
| English WER | ~14% | <15% ✅ |
| Hindi WER | ~64% | <35% ❌ |
| Hinglish WER | ~82% | <35% ❌ |
| Real-time factor | ~1.8–2.5x | <1.0x ❌ |

WER budgets in `cases.json` sit just above measured baseline so the suite
catches regressions today; `target` records where quality needs to reach.
Closing the Hindi/Hinglish gap needs a larger checkpoint than whisper-small.
Note the fixtures are synthesised speech, which Whisper handles worse than real
human audio — treat these as a pessimistic floor.
