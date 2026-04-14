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
  --min-replicas 1 \
  --max-replicas 3 \
  --cpu 1.0 \
  --memory 2.0Gi \
  --output none

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
