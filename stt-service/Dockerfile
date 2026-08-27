FROM node:22-slim

WORKDIR /srv
ENV NODE_ENV=production MODEL_CACHE=/models

COPY package.json ./
RUN npm install --omit=dev

# Bake the weights in. Downloading at boot would exceed Cloud Run's startup
# probe and re-pull ~260MB on every cold start.
ARG WHISPER_MODEL=Xenova/whisper-small
ENV WHISPER_MODEL=${WHISPER_MODEL}
RUN node -e "\
import('@huggingface/transformers').then(async ({pipeline, env}) => { \
  env.cacheDir='/models'; \
  await pipeline('automatic-speech-recognition', process.env.WHISPER_MODEL, {dtype:'q8'}); \
  console.log('model baked'); \
})"

COPY server.js ./
ENV PORT=8080
CMD ["node", "server.js"]
