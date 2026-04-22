/**
 * Pure helper functions extracted from inventory.ts for unit testing.
 * No Supabase, no Express — only deterministic input/output logic.
 */

export const VALID_UNITS = ['each', 'box', 'kg', 'L', 'bag', 'roll', 'other'] as const
export type Unit = (typeof VALID_UNITS)[number]

export interface InventoryCreateValidation {
  ok: true
  name: string
  sku: string | null
  quantity: number
  reorder_threshold: number
  unit_cost: number | null
  unit: Unit
  supplier: string | null
  notes: string | null
}

export interface InventoryValidationError {
  ok: false
  error: string
}

export function validateInventoryCreate(
  b: Record<string, unknown>
): InventoryCreateValidation | InventoryValidationError {
  const name = typeof b['name'] === 'string' ? b['name'].trim() : ''
  if (!name) return { ok: false, error: 'name is required' }

  const qty = b['quantity']
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) {
    return { ok: false, error: 'quantity must be a number >= 0' }
  }

  const unit = typeof b['unit'] === 'string' ? b['unit'] : 'each'
  if (!(VALID_UNITS as readonly string[]).includes(unit)) {
    return { ok: false, error: `unit must be one of ${VALID_UNITS.join(', ')}` }
  }

  const reorder =
    typeof b['reorder_threshold'] === 'number' && b['reorder_threshold'] >= 0
      ? b['reorder_threshold']
      : 5
  const unitCost = typeof b['unit_cost'] === 'number' && b['unit_cost'] >= 0 ? b['unit_cost'] : null
  const sku = typeof b['sku'] === 'string' ? b['sku'].trim() || null : null
  const supplier = typeof b['supplier'] === 'string' ? b['supplier'].trim() || null : null
  const notes = typeof b['notes'] === 'string' ? b['notes'] : null

  return {
    ok: true,
    name,
    sku,
    quantity: qty,
    reorder_threshold: reorder,
    unit_cost: unitCost,
    unit: unit as Unit,
    supplier,
    notes,
  }
}

export interface AdjustResult {
  newQuantity: number
  clamped: boolean
}

/**
 * Compute the new quantity after applying a delta. Quantity is clamped at 0 —
 * never goes negative. Returns whether the result was clamped.
 */
export function applyQuantityAdjustment(current: number, delta: number): AdjustResult {
  const raw = current + delta
  const clamped = raw < 0
  return { newQuantity: Math.max(0, raw), clamped }
}
