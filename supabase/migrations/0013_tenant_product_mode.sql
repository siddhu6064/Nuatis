-- 0013_tenant_product_mode.sql
-- Add product tier column for Maya Standalone vs Suite.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS product text NOT NULL DEFAULT 'suite';
-- product values: 'maya_only' (voice AI only) or 'suite' (full CRM)

COMMENT ON COLUMN tenants.product IS 'Product tier: maya_only (voice AI only) or suite (full CRM)';
