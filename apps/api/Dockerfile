# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json tsconfig.base.json ./

# Copy shared package (API depends on it at compile time)
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src/ packages/shared/src/
COPY packages/shared/tsconfig.json packages/shared/

# Copy API package
COPY apps/api/package.json apps/api/
COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src/ apps/api/src/

# Install all workspace dependencies
RUN npm ci --workspace=apps/api --workspace=packages/shared --include-workspace-root

# Build the API (tsc → dist/)
RUN npm run build --workspace=apps/api

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace root
COPY package.json package-lock.json ./

# Copy shared package source (imported at runtime via workspace link)
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src/ packages/shared/src/

# Copy API package.json for workspace resolution
COPY apps/api/package.json apps/api/

# Install production deps only
RUN npm ci --workspace=apps/api --workspace=packages/shared --include-workspace-root --omit=dev

# Copy compiled JS from builder
COPY --from=builder /app/apps/api/dist/ apps/api/dist/

EXPOSE 3001

# No request timeout — WebSocket voice calls can last several minutes
CMD ["node", "apps/api/dist/index.js"]
