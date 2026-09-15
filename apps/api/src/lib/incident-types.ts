import { getServiceClient } from './supabase.js'
import type { Severity } from './incidents.js'

export interface IncidentTypeSeed {
  key: string
  label: string
  default_severity: Severity
  requires_cost: boolean
}

/**
 * Starting taxonomy per vertical, seeded once and then tenant-editable — the
 * same shape lib/custom-fields.ts uses for vertical_configs. A hard-coded enum
 * would mean a migration every time a merchant wants a category, which is how a
 * feature stops getting used.
 *
 * Keys match the vertical slugs in @nuatis/shared's VERTICALS registry, so
 * 'restaurant' here is the same string the rest of the platform uses.
 *
 * `key` is the stable identifier and what reports group by. Labels are
 * editable; keys are not, so renaming a category does not change last month's
 * numbers.
 */
export const SEEDED_TYPES: Record<string, IncidentTypeSeed[]> = {
  restaurant: [
    { key: 'wrong_item', label: 'Wrong item', default_severity: 'medium', requires_cost: true },
    {
      key: 'allergy',
      label: 'Allergy incident',
      default_severity: 'critical',
      requires_cost: false,
    },
    { key: 'dropped', label: 'Dropped / wastage', default_severity: 'low', requires_cost: true },
    { key: 'late', label: 'Late order', default_severity: 'medium', requires_cost: false },
    {
      key: 'equipment',
      label: 'Equipment failure',
      default_severity: 'high',
      requires_cost: false,
    },
    {
      key: 'complaint',
      label: 'Customer complaint',
      default_severity: 'medium',
      requires_cost: false,
    },
  ],
  default: [
    {
      key: 'service_failure',
      label: 'Service failure',
      default_severity: 'medium',
      requires_cost: false,
    },
    { key: 'damage', label: 'Damage', default_severity: 'high', requires_cost: true },
    { key: 'safety', label: 'Safety concern', default_severity: 'critical', requires_cost: false },
    {
      key: 'complaint',
      label: 'Customer complaint',
      default_severity: 'medium',
      requires_cost: false,
    },
    { key: 'other', label: 'Other', default_severity: 'low', requires_cost: false },
  ],
}

/**
 * Seed a tenant's types if it has none.
 *
 * Idempotent: re-running does nothing, and it never overwrites a type a tenant
 * has edited. Called lazily on first read rather than at signup, so tenants
 * created before this shipped get their types too.
 */
export async function seedIncidentTypes(tenantId: string, vertical: string | null): Promise<void> {
  const supabase = getServiceClient()

  const { data: existing } = await supabase
    .from('incident_types')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(1)

  if ((existing ?? []).length > 0) return

  const seeds = await chooseSeeds(supabase, tenantId, vertical)
  const { error } = await supabase
    .from('incident_types')
    .insert(seeds.map((s, i) => ({ tenant_id: tenantId, ...s, sort_order: i })))

  // A unique violation here is the expected outcome of a race, not a fault:
  // the register and the KDS both read types on boot, and whichever loses
  // finds the other's rows already in place. Anything else is a real failure
  // that would otherwise leave the register with no Report button and no
  // trace of why.
  if (error && error.code !== '23505') {
    console.error(`[incident-types] seeding failed for tenant ${tenantId}:`, error.message)
  }
}

/**
 * Which starting list this tenant gets.
 *
 * `vertical` is a self-declared signup field and it is routinely wrong — the
 * demo tenant is `sales_crm` with eighteen menu items and a burger register,
 * and a real merchant who picked the nearest-looking option at signup lands in
 * the same place. Handing a kitchen "Service failure / Damage / Safety concern"
 * is a bad enough first run that most people will never edit it, they will just
 * stop using the feature.
 *
 * So when the vertical has no list of its own, fall back to evidence: a tenant
 * with menu items has a kitchen, because menu_items carries kitchen_station.
 * An explicit vertical still wins — if the merchant said what they are, believe
 * them.
 */
async function chooseSeeds(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string,
  vertical: string | null
): Promise<IncidentTypeSeed[]> {
  if (vertical && SEEDED_TYPES[vertical]) return SEEDED_TYPES[vertical]

  const { data } = await supabase.from('menu_items').select('id').eq('tenant_id', tenantId).limit(1)

  if ((data ?? []).length > 0) return SEEDED_TYPES['restaurant']!
  return SEEDED_TYPES['default']!
}
