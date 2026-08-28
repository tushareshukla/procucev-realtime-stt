FROM node:22-slim

WORKDIR /srv
ENV NODE_ENV=production MODEL_CACHE=/models

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils libgomp1 \
    && rm -rf /var/lib/apt/lists/*

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
RUN node -e "\
import('@huggingface/transformers').then(async ({pipeline, env}) => { \
  env.cacheDir='/models'; \
  await pipeline('automatic-speech-recognition', process.env.WHISPER_MODEL, {dtype: process.env.WHISPER_DTYPE}); \
  console.log('whisper baked:', process.env.WHISPER_DTYPE); \
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
ARG PIPER_VERSION=2023.11.14-2
RUN mkdir -p /opt/piper/voices && cd /tmp \
 && curl -sfL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" -o piper.tgz \
 && tar -xzf piper.tgz -C /opt && rm piper.tgz \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/pratham/medium/hi_IN-pratham-medium.onnx" -o /opt/piper/voices/hi_IN-pratham-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/hi/hi_IN/pratham/medium/hi_IN-pratham-medium.onnx.json" -o /opt/piper/voices/hi_IN-pratham-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/bn/bn_BD/google/medium/bn_BD-google-medium.onnx" -o /opt/piper/voices/bn_BD-google-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/bn/bn_BD/google/medium/bn_BD-google-medium.onnx.json" -o /opt/piper/voices/bn_BD-google-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/te/te_IN/maya/medium/te_IN-maya-medium.onnx" -o /opt/piper/voices/te_IN-maya-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/te/te_IN/maya/medium/te_IN-maya-medium.onnx.json" -o /opt/piper/voices/te_IN-maya-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/mr/mr_IN/google/medium/mr_IN-google-medium.onnx" -o /opt/piper/voices/mr_IN-google-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/mr/mr_IN/google/medium/mr_IN-google-medium.onnx.json" -o /opt/piper/voices/mr_IN-google-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/ml/ml_IN/arjun/medium/ml_IN-arjun-medium.onnx" -o /opt/piper/voices/ml_IN-arjun-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/ml/ml_IN/arjun/medium/ml_IN-arjun-medium.onnx.json" -o /opt/piper/voices/ml_IN-arjun-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/ur/ur_PK/aegis_female/medium/ur_PK-aegis_female-medium.onnx" -o /opt/piper/voices/ur_PK-aegis_female-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/ur/ur_PK/aegis_female/medium/ur_PK-aegis_female-medium.onnx.json" -o /opt/piper/voices/ur_PK-aegis_female-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx" -o /opt/piper/voices/ar_JO-kareem-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx.json" -o /opt/piper/voices/ar_JO-kareem-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx" -o /opt/piper/voices/es_ES-davefx-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json" -o /opt/piper/voices/es_ES-davefx-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/mls/medium/fr_FR-mls-medium.onnx" -o /opt/piper/voices/fr_FR-mls-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/mls/medium/fr_FR-mls-medium.onnx.json" -o /opt/piper/voices/fr_FR-mls-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/mls/medium/de_DE-mls-medium.onnx" -o /opt/piper/voices/de_DE-mls-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/mls/medium/de_DE-mls-medium.onnx.json" -o /opt/piper/voices/de_DE-mls-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/chaowen/medium/zh_CN-chaowen-medium.onnx" -o /opt/piper/voices/zh_CN-chaowen-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/chaowen/medium/zh_CN-chaowen-medium.onnx.json" -o /opt/piper/voices/zh_CN-chaowen-medium.onnx.json \ && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/ja/ja_JA/hi_fi_captain/medium/ja_JA-hi_fi_captain-medium.onnx" -o /opt/piper/voices/ja_JA-hi_fi_captain-medium.onnx \
 && curl -sfL "https://huggingface.co/rhasspy/piper-voices/resolve/main/ja/ja_JA/hi_fi_captain/medium/ja_JA-hi_fi_captain-medium.onnx.json" -o /opt/piper/voices/ja_JA-hi_fi_captain-medium.onnx.json \
 && ls -la /opt/piper/voices | head -30

COPY server.js languages.js tts.js ./

ENV PORT=8080 \
    STT_ENGINE=whisper \
    PIPER_BIN=/opt/piper/piper \
    PIPER_VOICE_DIR=/opt/piper/voices \
    LD_LIBRARY_PATH=/opt/piper
EXPOSE 8080
CMD ["node", "server.js"]
