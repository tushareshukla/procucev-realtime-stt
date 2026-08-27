# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /srv
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
# pnpm's minimumReleaseAge policy rejects transitive deps published in the last
# ~24h. That guard is worth keeping for local installs, but it makes container
# builds fail non-deterministically based on when upstream last published, so
# it is relaxed here only — the lockfile still pins exact versions.
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
# Cloudflare caches /app.js at the edge for hours, so a deploy alone does not
# reach browsers — they keep running the previous build, which looks like the
# new code is broken. Stamping a per-build version into the asset URLs means a
# release always fetches a URL that was never cached.
ARG BUILD_ID=dev
RUN find ./public -type f \( -name '*.html' -o -name '*.js' \) \
      -exec sed -i "s/__BUILD__/${BUILD_ID}/g" {} + \
 && echo "stamped build ${BUILD_ID}"

# No model weights and no ONNX runtime here — Whisper lives in the separate
# Cloud Run service reached via STT_SERVICE_URL.
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/main.js"]
