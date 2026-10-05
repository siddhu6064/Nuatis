# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

# Copy workspace root manifests
COPY package.json package-lock.json tsconfig.base.json ./

# Copy shared package (web depends on it at build time)
COPY packages/shared/ packages/shared/

# Copy design tokens. Imported from apps/web/src and from the Tailwind config,
# so Turbopack fails with "Cannot find module '@nuatis/design-tokens'" without
# it. No build step — the package is plain files with main: ./tokens.js.
COPY packages/design-tokens/ packages/design-tokens/

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
ARG NEXT_PUBLIC_APP_URL=""
ARG NEXT_PUBLIC_SQUARE_ENVIRONMENT=""
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SQUARE_ENVIRONMENT=$NEXT_PUBLIC_SQUARE_ENVIRONMENT
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY

# Next evaluates server modules while collecting page data, and
# app/api/auth/[...nextauth] builds a Supabase client at module scope — without
# these the build dies with "supabaseUrl is required". They are build-time
# inputs only; the running container gets its real values from its own
# environment, and nothing here should be treated as a production secret.
#
# NEXT_PUBLIC_SUPABASE_URL and _ANON_KEY are also read by a client component
# (the reset-password page), so whatever is passed here is inlined into the
# browser bundle. A deploy must pass the real values — the empty defaults exist
# so CI can prove the image builds, not so production can ship without them.
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ARG NEXT_PUBLIC_API_URL=""
ARG SUPABASE_SERVICE_ROLE_KEY=""
ARG AUTH_SECRET=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY
ENV AUTH_SECRET=$AUTH_SECRET
ENV NEXTAUTH_SECRET=$AUTH_SECRET

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
