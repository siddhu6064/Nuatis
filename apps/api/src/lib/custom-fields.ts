import type { SupabaseClient } from '@supabase/supabase-js'
import { VERTICALS } from '@nuatis/shared'

export const CUSTOM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'boolean',
] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

export interface CustomFieldDef {
  key: string
  label: string
  type: CustomFieldType
  required: boolean
  options?: string[]
}

// Never editable/creatable via the custom-fields UI — written by other
// subsystems that assume this exact key (booking-public.ts's auto-enrich).
export const RESERVED_KEYS = ['enrichment_suggested_company']

export const MAX_CUSTOM_FIELDS = 30

export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/

async function getTenantVertical(
  supabase: SupabaseClient,
  tenantId: string
): Promise<string | null> {
  const { data } = await supabase.from('tenants').select('vertical').eq('id', tenantId).single()
  return (data?.vertical as string | null) ?? null
}

/**
 * The tenant's live, editable field-definitions list. Backed by
 * vertical_configs.field_definitions (seeded at signup from the static
 * VERTICALS[...] list, per migration 0002 — previously written but never
 * read back). Lazily creates the row, seeded from the static list, if it's
 * missing — e.g. a tenant that has since switched vertical (demo mode) and
 * never had a row for the new one.
 */
export async function getFieldDefinitions(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ vertical: string; fields: CustomFieldDef[] }> {
  const vertical = await getTenantVertical(supabase, tenantId)
  if (!vertical) return { vertical: '', fields: [] }

  const { data: config } = await supabase
    .from('vertical_configs')
    .select('field_definitions')
    .eq('tenant_id', tenantId)
    .eq('vertical_slug', vertical)
    .maybeSingle()

  if (config) {
    return { vertical, fields: (config.field_definitions as CustomFieldDef[]) ?? [] }
  }

  const seeded = (VERTICALS[vertical]?.fields as CustomFieldDef[] | undefined) ?? []
  await supabase.from('vertical_configs').insert({
    tenant_id: tenantId,
    vertical_slug: vertical,
    field_definitions: seeded,
  })
  return { vertical, fields: seeded }
}

export async function saveFieldDefinitions(
  supabase: SupabaseClient,
  tenantId: string,
  vertical: string,
  fields: CustomFieldDef[]
): Promise<void> {
  await supabase
    .from('vertical_configs')
    .update({ field_definitions: fields })
    .eq('tenant_id', tenantId)
    .eq('vertical_slug', vertical)
}

/**
 * Validates one custom-field value against its declared type. Returns an
 * error message, or null if valid. Unknown keys (not in the tenant's current
 * definitions) are left alone — vertical_data may carry values from a field
 * that was since soft-deleted, and that's fine, not this function's concern.
 */
export function validateCustomFieldValue(def: CustomFieldDef, value: unknown): string | null {
  if (value === null || value === undefined || value === '') {
    return def.required ? `${def.label} is required` : null
  }
  switch (def.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `${def.label} must be a number`
      }
      return null
    case 'boolean':
      if (typeof value !== 'boolean') return `${def.label} must be true or false`
      return null
    case 'date':
      if (typeof value !== 'string' || isNaN(Date.parse(value))) {
        return `${def.label} must be a valid date`
      }
      return null
    case 'select':
      if (typeof value !== 'string' || !(def.options ?? []).includes(value)) {
        return `${def.label} must be one of: ${(def.options ?? []).join(', ')}`
      }
      return null
    case 'text':
    case 'textarea':
      if (typeof value !== 'string') return `${def.label} must be text`
      return null
    default:
      return null
  }
}
