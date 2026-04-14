#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="nuatis-prod"
CONTAINER_APP_NAME="nuatis-api"
ENVIRONMENT_NAME="nuatis-env"
CUSTOM_DOMAIN="api.nuatis.com"

echo "==> Adding custom domain: ${CUSTOM_DOMAIN}"
echo ""
echo "PREREQUISITE: Before running this script, create a DNS CNAME record:"
echo ""
echo "  ${CUSTOM_DOMAIN}  →  CNAME  →  <your-container-app>.azurecontainerapps.io"
echo ""

FQDN=$(az containerapp show \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query "properties.configuration.ingress.fqdn" -o tsv)

echo "  Your Container App FQDN: ${FQDN}"
echo "  Set CNAME: ${CUSTOM_DOMAIN} → ${FQDN}"
echo ""
read -rp "Press Enter after DNS is configured..."

echo "==> Binding hostname..."
az containerapp hostname add \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --hostname "$CUSTOM_DOMAIN" \
  --output none

echo "==> Configuring managed TLS certificate..."
az containerapp hostname bind \
  --name "$CONTAINER_APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --hostname "$CUSTOM_DOMAIN" \
  --environment "$ENVIRONMENT_NAME" \
  --validation-method CNAME \
  --output none

echo "==> Custom domain configured: https://${CUSTOM_DOMAIN}"
echo "    Health check: https://${CUSTOM_DOMAIN}/health"
