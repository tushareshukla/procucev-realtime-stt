FROM node:22-slim

WORKDIR /srv
ENV NODE_ENV=production

COPY package.json ./
# Chirp needs no model weights, so the image stays small and cold starts fast.
# --omit=optional skips the whisper stack; build with STT_ENGINE=whisper only if
# you need the fully self-hosted path.
RUN npm install --omit=dev --omit=optional

COPY server.js languages.js ./

ENV PORT=8080 STT_ENGINE=chirp
EXPOSE 8080
CMD ["node", "server.js"]
