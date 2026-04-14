#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="nuatis-prod"
CONTAINER_APP_NAME="nuatis-api"

# Prompt for values or read from env
echo "Setting environment variables for ${CONTAINER_APP_NAME}..."
echo "(Press Enter to skip any variable and keep its current value)"
echo ""

read -rp "SUPABASE_URL: " SUPABASE_URL
read -rp "SUPABASE_SERVICE_ROLE_KEY: " SUPABASE_SERVICE_ROLE_KEY
read -rp "GEMINI_API_KEY: " GEMINI_API_KEY
read -rp "TELNYX_API_KEY: " TELNYX_API_KEY
read -rp "TELNYX_TENANT_MAP: " TELNYX_TENANT_MAP
read -rp "REDIS_URL: " REDIS_URL
read -rp "GOOGLE_CLIENT_ID: " GOOGLE_CLIENT_ID
read -rp "GOOGLE_CLIENT_SECRET: " GOOGLE_CLIENT_SECRET
read -rp "GOOGLE_REDIRECT_URI: " GOOGLE_REDIRECT_URI
read -rp "AUTH_SECRET: " AUTH_SECRET
read -rp "RESEND_API_KEY: " RESEND_API_KEY
read -rp "OPS_COPILOT_URL: " OPS_COPILOT_URL
read -rp "SENTRY_DSN: " SENTRY_DSN
read -rp "ADMIN_API_KEY: " ADMIN_API_KEY
read -rp "VOICE_WS_URL [wss://api.nuatis.com/voice/stream]: " VOICE_WS_URL
VOICE_WS_URL="${VOICE_WS_URL:-wss://api.nuatis.com/voice/stream}"

# Build --set-env-vars args (skip empty)
ENV_ARGS=""
[ -n "$SUPABASE_URL" ] && ENV_ARGS+="SUPABASE_URL=$SUPABASE_URL "
[ -n "$SUPABASE_SERVICE_ROLE_KEY" ] && ENV_ARGS+="SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY "
[ -n "$GEMINI_API_KEY" ] && ENV_ARGS+="GEMINI_API_KEY=$GEMINI_API_KEY "
[ -n "$TELNYX_API_KEY" ] && ENV_ARGS+="TELNYX_API_KEY=$TELNYX_API_KEY "
[ -n "$TELNYX_TENANT_MAP" ] && ENV_ARGS+="TELNYX_TENANT_MAP=$TELNYX_TENANT_MAP "
[ -n "$REDIS_URL" ] && ENV_ARGS+="REDIS_URL=$REDIS_URL "
[ -n "$GOOGLE_CLIENT_ID" ] && ENV_ARGS+="GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID "
[ -n "$GOOGLE_CLIENT_SECRET" ] && ENV_ARGS+="GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET "
[ -n "$GOOGLE_REDIRECT_URI" ] && ENV_ARGS+="GOOGLE_REDIRECT_URI=$GOOGLE_REDIRECT_URI "
[ -n "$AUTH_SECRET" ] && ENV_ARGS+="AUTH_SECRET=$AUTH_SECRET "
[ -n "$RESEND_API_KEY" ] && ENV_ARGS+="RESEND_API_KEY=$RESEND_API_KEY "
[ -n "$OPS_COPILOT_URL" ] && ENV_ARGS+="OPS_COPILOT_URL=$OPS_COPILOT_URL "
[ -n "$SENTRY_DSN" ] && ENV_ARGS+="SENTRY_DSN=$SENTRY_DSN "
[ -n "$ADMIN_API_KEY" ] && ENV_ARGS+="ADMIN_API_KEY=$ADMIN_API_KEY "
ENV_ARGS+="VOICE_WS_URL=$VOICE_WS_URL "
ENV_ARGS+="NODE_ENV=production "
ENV_ARGS+="SCANNERS_ENABLED=true "
ENV_ARGS+="PORT=3001 "

echo ""
echo "==> Updating environment variables..."
# shellcheck disable=SC2086
az containerapp update \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --set-env-vars $ENV_ARGS \
  --output none

echo "==> Environment variables updated."
