#!/usr/bin/env bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
RESOURCE_GROUP="nuatis-prod"
LOCATION="southcentralus"
CONTAINER_APP_NAME="nuatis-api"
CONTAINER_REGISTRY="nuatisacr"
ENVIRONMENT_NAME="nuatis-env"
IMAGE_TAG="${1:-latest}"

echo "==> Creating resource group: ${RESOURCE_GROUP} in ${LOCATION}"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "==> Creating Azure Container Registry: ${CONTAINER_REGISTRY}"
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$CONTAINER_REGISTRY" \
  --sku Basic \
  --admin-enabled true \
  --output none

echo "==> Building and pushing image via ACR"
az acr build \
  --registry "$CONTAINER_REGISTRY" \
  --image "nuatis-api:${IMAGE_TAG}" \
  --file apps/api/Dockerfile \
  .

echo "==> Creating Container Apps environment: ${ENVIRONMENT_NAME}"
az containerapp env create \
  --name "$ENVIRONMENT_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none 2>/dev/null || echo "    (environment already exists)"

echo "==> Deploying Container App: ${CONTAINER_APP_NAME}"
LOGIN_SERVER=$(az acr show --name "$CONTAINER_REGISTRY" --query loginServer -o tsv)
ACR_PASSWORD=$(az acr credential show --name "$CONTAINER_REGISTRY" --query "passwords[0].value" -o tsv)

# Update when the app already exists, create only on a first run — the same
# guard the nuatis-web block below has always had.
#
# `create` against an existing app aborts the script under `set -e`, so a
# routine redeploy would die here and never reach the web section. Worse, it
# describes the app from the flags on this command line alone: the API's ~47
# environment variables come from update-env.sh, and recreating around this
# command would drop every one of them. `update --image` changes the image and
# leaves the rest of the app alone, which is what a redeploy actually means.
if az containerapp show --name "$CONTAINER_APP_NAME" --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  echo "    (${CONTAINER_APP_NAME} already exists — updating image)"
  az containerapp update \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --image "${LOGIN_SERVER}/nuatis-api:${IMAGE_TAG}" \
    --output none
else
  az containerapp create \
    --name "$CONTAINER_APP_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ENVIRONMENT_NAME" \
    --image "${LOGIN_SERVER}/nuatis-api:${IMAGE_TAG}" \
    --registry-server "$LOGIN_SERVER" \
    --registry-username "$CONTAINER_REGISTRY" \
    --registry-password "$ACR_PASSWORD" \
    --target-port 3001 \
    --ingress external \
    --transport http \
    `# http transport on Azure Container Apps supports native WebSocket upgrades — required for voice pipeline` \
    --min-replicas 1 \
    --max-replicas 3 \
    --cpu 1.0 \
    --memory 2.0Gi \
    --output none
fi

FQDN=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "==> Deployment complete!"
echo "    FQDN: https://${FQDN}"
echo "    Health: https://${FQDN}/health"
echo ""
echo "Next steps:"
echo "  1. Run ./update-env.sh to set environment variables"
echo "  2. Run ./custom-domain.sh to configure api.nuatis.com"

# ── nuatis-web (Next.js) ──────────────────────────────────────

# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so
# they have to be real here — an empty NEXT_PUBLIC_SUPABASE_URL ships a broken
# reset-password page. Fail loudly rather than quietly building a broken bundle.
: "${NEXT_PUBLIC_SUPABASE_URL:?set NEXT_PUBLIC_SUPABASE_URL before deploying web}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?set NEXT_PUBLIC_SUPABASE_ANON_KEY before deploying web}"
: "${AUTH_SECRET:?set AUTH_SECRET before deploying web}"

echo "==> Building and pushing web image via ACR"
az acr build \
  --registry "$CONTAINER_REGISTRY" \
  --image "nuatis-web:${IMAGE_TAG}" \
  --file apps/web/Dockerfile \
  --build-arg "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}" \
  --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
  --build-arg "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-https://api.nuatis.com}" \
  --build-arg "SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY:-}" \
  --build-arg "AUTH_SECRET=${AUTH_SECRET}" \
  .

echo "==> Deploying Container App: nuatis-web"
if az containerapp show --name nuatis-web --resource-group "$RESOURCE_GROUP" --output none 2>/dev/null; then
  echo "    (nuatis-web already exists — updating image)"
  az containerapp update \
    --name nuatis-web \
    --resource-group "$RESOURCE_GROUP" \
    --image "${LOGIN_SERVER}/nuatis-web:${IMAGE_TAG}" \
    --output none
else
  az containerapp create \
    --name nuatis-web \
    --resource-group "$RESOURCE_GROUP" \
    --environment "$ENVIRONMENT_NAME" \
    --image "${LOGIN_SERVER}/nuatis-web:${IMAGE_TAG}" \
    --registry-server "$LOGIN_SERVER" \
    --registry-username "$CONTAINER_REGISTRY" \
    --registry-password "$ACR_PASSWORD" \
    --target-port 3000 \
    --ingress external \
    --min-replicas 1 \
    --max-replicas 3 \
    --cpu 0.5 \
    --memory 1.0Gi \
    --env-vars NODE_ENV=production NEXT_PUBLIC_API_URL=https://api.nuatis.com NEXTAUTH_URL=https://nuatis.com API_BACKEND_URL=https://api.nuatis.com \
    --output none
fi

WEB_FQDN=$(az containerapp show \
  --name nuatis-web \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "==> nuatis-web deployed!"
echo "    FQDN: https://${WEB_FQDN}"
