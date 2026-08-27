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
