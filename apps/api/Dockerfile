# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy shared package (API depends on it at compile time + runtime)
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src/ packages/shared/src/

# Copy pos-core (routes/pos/* import @nuatis/pos-core at compile time + runtime).
# Missing here, tsc fails with TS2307 and the image never builds — which is
# exactly what happened once the POS routes landed.
COPY packages/pos-core/package.json packages/pos-core/
COPY packages/pos-core/tsconfig.json packages/pos-core/
COPY packages/pos-core/src/ packages/pos-core/src/

# Copy API package
COPY apps/api/package.json apps/api/
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src/ apps/api/src/

# Install all workspace dependencies
RUN npm ci --workspace=apps/api --workspace=packages/shared --workspace=packages/pos-core --include-workspace-root

# Build the packages first — the API's imports resolve to their dist/ output.
RUN npm run build --workspace=packages/shared
RUN npm run build --workspace=packages/pos-core

# Build the API (tsc → dist/)
#
# tsc needs a bigger heap than Node's default here. The ACR build agent aborted
# with SIGABRT (exit 134) once the codebase grew past roughly a month of
# additions — the same build completes in ~30s locally, so this is the agent's
# memory ceiling rather than anything in the source.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build --workspace=apps/api

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace root
COPY package.json package-lock.json ./

# Copy package manifests (workspace link resolution)
COPY packages/shared/package.json packages/shared/
COPY packages/pos-core/package.json packages/pos-core/

# Copy API package.json for workspace resolution
COPY apps/api/package.json apps/api/

# Install production deps only
RUN npm ci --workspace=apps/api --workspace=packages/shared --workspace=packages/pos-core --include-workspace-root --omit=dev

# Copy compiled shared JS from builder (shared "main" → dist/index.js)
COPY --from=builder --chown=node:node /app/packages/shared/dist/ packages/shared/dist/

# Copy compiled pos-core JS from builder (pos-core "main" → dist/index.js)
COPY --from=builder --chown=node:node /app/packages/pos-core/dist/ packages/pos-core/dist/

# Copy compiled API JS from builder
COPY --from=builder --chown=node:node /app/apps/api/dist/ apps/api/dist/

EXPOSE 3001

# DOCKER-01: drop root — run as the built-in non-root `node` user.
USER node

# No request timeout — WebSocket voice calls can last several minutes
CMD ["node", "apps/api/dist/index.js"]
