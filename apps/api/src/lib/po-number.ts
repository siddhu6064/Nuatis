import { getServiceClient } from './supabase.js'

// NOTE: select-then-update — same theoretical race condition as
// generateOrderNumber, same tradeoff (acceptable at this order volume).
export async function generatePoNumber(tenantId: string): Promise<string> {
  const supabase = getServiceClient()

  const { data: tenant, error: selectErr } = await supabase
    .from('tenants')
    .select('po_counter')
    .eq('id', tenantId)
    .single()

  if (selectErr || !tenant) {
    throw new Error(`Tenant not found: ${selectErr?.message}`)
  }

  const nextCounter = (tenant.po_counter ?? 1000) + 1

  const { error: updateErr } = await supabase
    .from('tenants')
    .update({ po_counter: nextCounter })
    .eq('id', tenantId)

  if (updateErr) {
    throw new Error(`Failed to increment PO counter: ${updateErr.message}`)
  }

  return `PO-${nextCounter}`
}
