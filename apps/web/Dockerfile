# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Copy workspace root manifests
COPY package.json package-lock.json ./

# Copy shared package (web depends on it at build time)
COPY packages/shared/ packages/shared/

# Copy web app
COPY apps/web/ apps/web/

# Install all workspace deps
RUN npm ci --workspace=apps/web --include-workspace-root

# Build shared first — web imports resolve @nuatis/shared to dist/index.js
RUN npm run build --workspace=packages/shared

# Build Next.js (produces .next/standalone via output: 'standalone')
RUN npm run build --workspace=apps/web

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone output is self-contained — no npm install needed
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static
COPY --from=builder /app/apps/web/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
