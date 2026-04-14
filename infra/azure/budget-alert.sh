#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="nuatis-prod"
BUDGET_NAME="nuatis-monthly"
BUDGET_AMOUNT=200
ALERT_EMAIL="sid@nuatis.com"

echo "==> Getting subscription ID..."
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

echo "==> Creating monthly budget: \$${BUDGET_AMOUNT}/month"
az consumption budget create \
  --budget-name "$BUDGET_NAME" \
  --amount "$BUDGET_AMOUNT" \
  --time-grain Monthly \
  --category Cost \
  --resource-group "$RESOURCE_GROUP" \
  --start-date "$(date +%Y-%m-01)" \
  --end-date "2026-12-31" \
  --output none

echo "==> Budget created: \$${BUDGET_AMOUNT}/month for resource group ${RESOURCE_GROUP}"
echo "    Alert threshold: 80% (\$$(( BUDGET_AMOUNT * 80 / 100 )))"
echo "    Notification email: ${ALERT_EMAIL}"
echo ""
echo "NOTE: Configure alert notification in Azure Portal:"
echo "  1. Go to Cost Management + Billing → Budgets"
echo "  2. Click '${BUDGET_NAME}'"
echo "  3. Add alert condition at 80% (Actual)"
echo "  4. Add notification recipient: ${ALERT_EMAIL}"
