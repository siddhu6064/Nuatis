# Nuatis API — Azure Container Apps Deployment

## Prerequisites

- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) installed and authenticated (`az login`)
- Docker installed (for local testing only — ACR builds remotely)
- Azure subscription with Container Apps resource provider registered

## Quick Start

```bash
# 1. Deploy the container app
./deploy.sh

# 2. Set environment variables
./update-env.sh

# 3. (Optional) Configure custom domain
./custom-domain.sh

# 4. (Optional) Set up budget alerts
./budget-alert.sh
```

## Step-by-Step

### 1. Initial Deployment

```bash
cd infra/azure
./deploy.sh
```

This creates:

- Resource group `nuatis-prod` in `southcentralus` (Texas)
- Azure Container Registry `nuatisacr`
- Container Apps Environment `nuatis-env`
- Container App `nuatis-api` (1-3 replicas, 1 CPU, 2GB RAM)

The script prints the FQDN when done.

### 2. Environment Variables

```bash
./update-env.sh
```

You'll be prompted for each variable. Press Enter to skip any.

### 3. Custom Domain (api.nuatis.com)

Before running:

1. Go to your DNS provider (Cloudflare, Route53, etc.)
2. Create a CNAME record: `api.nuatis.com` → `<your-app>.azurecontainerapps.io`
3. Wait for DNS propagation (typically 1-5 minutes)

```bash
./custom-domain.sh
```

Azure will automatically provision a TLS certificate.

### 4. Budget Alerts

```bash
./budget-alert.sh
```

Creates a $200/month budget with 80% threshold alert.

## Operations

### View Logs

```bash
az containerapp logs show \
  --name nuatis-api \
  --resource-group nuatis-prod \
  --follow
```

### Check Health

```bash
curl https://api.nuatis.com/health
```

### Redeploy (after code changes)

```bash
cd infra/azure
./deploy.sh v2  # tag with version
```

### Scale manually

```bash
az containerapp update \
  --name nuatis-api \
  --resource-group nuatis-prod \
  --min-replicas 2 --max-replicas 5
```

### Check Azure Credit Usage

```bash
az consumption usage list \
  --start-date $(date -v-30d +%Y-%m-%d) \
  --end-date $(date +%Y-%m-%d) \
  --query "[].{Service:consumedService,Cost:pretaxCost}" \
  --output table
```

Or visit: https://portal.azure.com → Cost Management + Billing → Cost Analysis

## Cost Estimate

| Component                                    | Monthly Cost      |
| -------------------------------------------- | ----------------- |
| Container Apps (1 replica, consumption plan) | ~$20-30           |
| Container Registry (Basic)                   | ~$5               |
| Ingress/networking                           | ~$2-5             |
| **Total**                                    | **~$27-40/month** |

With the $5K Azure credits (expires Dec 2026), this covers 10+ years of operation.

## Architecture Notes

- **WebSocket support**: Azure Container Apps supports WebSocket connections natively. Voice calls connect via `wss://api.nuatis.com/voice/stream`.
- **Always-on**: Minimum 1 replica ensures instant availability for incoming calls.
- **Auto-scale**: Scales to 3 replicas under load (HTTP concurrent requests trigger).
- **BullMQ workers**: Run inside the same container process — no separate worker deployment needed.
- **TLS**: Managed automatically by Azure for both the default FQDN and custom domains.
