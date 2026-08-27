# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /srv
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN pnpm build && pnpm prune --prod

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production

COPY --from=build /srv/node_modules ./node_modules
COPY --from=build /srv/dist ./dist
COPY package.json ./
COPY public ./public

# No model weights and no ONNX runtime here — Whisper lives in the separate
# Cloud Run service reached via STT_SERVICE_URL.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/main.js"]
