FROM node:22-slim

WORKDIR /srv
ENV NODE_ENV=production MODEL_CACHE=/models

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils libgomp1 python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# piper1-gpl rather than the 2023 binary: that release cannot handle voices
# whose phoneme map contains multi-codepoint entries, so Bengali, Marathi,
# Urdu, Chinese and Japanese all failed with
#   "aɪ" is not a single codepoint
# The maintained Python distribution synthesises them correctly.
RUN python3 -m venv /opt/piper-venv \
 && /opt/piper-venv/bin/pip install --no-cache-dir piper-tts

COPY package.json ./
RUN npm install --omit=dev

# ── STT: Whisper large-v3-turbo (MIT) ────────────────────────────────────────
# Baked in: downloading at boot would exceed Cloud Run's startup probe and
# re-pull ~900MB on every cold start.
ARG WHISPER_MODEL=onnx-community/whisper-large-v3-turbo
# The baked dtype MUST match the runtime dtype, or the container downloads a
# different set of weights on first request and blows past the startup probe.
# fp32, deliberately. Measured on Cloud Run (x86) with these fixtures:
#   q8   — mean WER 39.9%, RTF 2.6x   (int8 kernels degrade badly on x86;
#                                       the same q8 build scores 13.2% on ARM)
#   fp16 — mean WER 13.2%, RTF 4.8x   (no CPU acceleration, so it is emulated)
#   fp32 — mean WER 13.2%, RTF 3.2x   <- best accuracy AND fastest of the two
ARG WHISPER_DTYPE=fp32
ENV WHISPER_MODEL=${WHISPER_MODEL} WHISPER_DTYPE=${WHISPER_DTYPE}
# The fp32 weights are ~3GB and the transfer intermittently drops mid-download
# ("SocketError: other side closed"), which fails the whole build. Retry a few
# times; the library resumes from its cache so a retry is cheap.
RUN for attempt in 1 2 3 4 5; do \
      echo "baking whisper (attempt $attempt)"; \
      node -e "import('@huggingface/transformers').then(async ({pipeline, env}) => { \
        env.cacheDir='/models'; \
        await pipeline('automatic-speech-recognition', process.env.WHISPER_MODEL, {dtype: process.env.WHISPER_DTYPE}); \
        console.log('whisper baked:', process.env.WHISPER_DTYPE); \
      })" && break; \
      echo "attempt $attempt failed; retrying"; sleep 5; \
    done; \
    node -e "import('@huggingface/transformers').then(async ({pipeline, env}) => { \
      env.cacheDir='/models'; env.allowRemoteModels=false; \
      await pipeline('automatic-speech-recognition', process.env.WHISPER_MODEL, {dtype: process.env.WHISPER_DTYPE}); \
      console.log('verified from cache'); \
    })"

# ── TTS: Kokoro-82M (Apache-2.0), English ────────────────────────────────────
# kokoro-js resolves voice embeddings from <cwd>/../voices and never falls back
# to fetching, so they must exist on disk at that path.
RUN node -e "\
import('kokoro-js').then(async ({KokoroTTS}) => { \
  await KokoroTTS.from_pretrained(process.env.KOKORO_MODEL || 'onnx-community/Kokoro-82M-v1.0-ONNX', {dtype:'q8'}); \
  console.log('kokoro baked'); \
})" || true
COPY voices /voices

# ── TTS: Piper (MIT), every non-English language the UI offers ───────────────
# One medium-quality voice per language. Piper has no Tamil, Gujarati, Kannada
# or Punjabi voice, so those are transcription-only and the UI does not offer
# them for synthesis.
ENV PIPER_VOICES="hi/hi_IN/pratham/medium/hi_IN-pratham-medium bn/bn_BD/google/medium/bn_BD-google-medium te/te_IN/maya/medium/te_IN-maya-medium mr/mr_IN/google/medium/mr_IN-google-medium ml/ml_IN/arjun/medium/ml_IN-arjun-medium ur/ur_PK/aegis_female/medium/ur_PK-aegis_female-medium ar/ar_JO/kareem/medium/ar_JO-kareem-medium es/es_ES/davefx/medium/es_ES-davefx-medium fr/fr_FR/mls/medium/fr_FR-mls-medium de/de_DE/mls/medium/de_DE-mls-medium zh/zh_CN/chaowen/medium/zh_CN-chaowen-medium ja/ja_JA/hi_fi_captain/medium/ja_JA-hi_fi_captain-medium"
RUN set -eu; \
    mkdir -p /opt/piper/voices; cd /tmp; \
    base="https://huggingface.co/rhasspy/piper-voices/resolve/main"; \
    for v in ${PIPER_VOICES}; do \
      name="${v##*/}"; \
      curl -sfL --retry 3 --retry-delay 2 "${base}/${v}.onnx"      -o "/opt/piper/voices/${name}.onnx"; \
      curl -sfL --retry 3 --retry-delay 2 "${base}/${v}.onnx.json" -o "/opt/piper/voices/${name}.onnx.json"; \
      echo "voice ${name}"; \
    done; \
    ls /opt/piper/voices | wc -l

COPY server.js languages.js tts.js ./

ENV PORT=8080 \
    STT_ENGINE=whisper \
    PIPER_BIN=/opt/piper-venv/bin/python \
    PIPER_VOICE_DIR=/opt/piper/voices \
EXPOSE 8080
CMD ["node", "server.js"]
