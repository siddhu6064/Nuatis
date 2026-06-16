# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Copy workspace root manifests
COPY package.json package-lock.json tsconfig.base.json ./

# Copy shared package (web depends on it at build time)
COPY packages/shared/ packages/shared/

# Copy web app
COPY apps/web/ apps/web/

# Install all workspace deps
RUN npm ci --workspace=apps/web --include-workspace-root

# Build shared first — web imports resolve @nuatis/shared to dist/index.js
RUN npm run build --workspace=packages/shared

# Build-time public env vars — inlined into the Next.js client bundle.
ARG NEXT_PUBLIC_DEMO_EMAIL=""
ARG NEXT_PUBLIC_DEMO_PASSWORD=""
ENV NEXT_PUBLIC_DEMO_EMAIL=$NEXT_PUBLIC_DEMO_EMAIL
ENV NEXT_PUBLIC_DEMO_PASSWORD=$NEXT_PUBLIC_DEMO_PASSWORD
ARG NEXT_PUBLIC_POSTHOG_KEY=""
ARG NEXT_PUBLIC_POSTHOG_HOST=""
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST

# Build Next.js (produces .next/standalone via output: 'standalone')
RUN npm run build --workspace=apps/web

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public

EXPOSE 3000

# DOCKER-01: drop root — run as the built-in non-root `node` user.
USER node

CMD ["node", "apps/web/server.js"]
