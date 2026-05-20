import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// NOTE: Uses select-then-update which has a theoretical race condition at very
// high concurrency. Acceptable for invoice generation rates in this codebase.
export async function generateInvoiceNumber(tenantId: string): Promise<string> {
  const supabase = getSupabase()

  // Read current counter
  const { data: tenant, error: selectErr } = await supabase
    .from('tenants')
    .select('invoice_counter')
    .eq('id', tenantId)
    .single()

  if (selectErr || !tenant) {
    throw new Error(`Tenant not found: ${selectErr?.message}`)
  }

  const nextCounter = (tenant.invoice_counter ?? 1000) + 1

  // Increment counter
  const { error: updateErr } = await supabase
    .from('tenants')
    .update({ invoice_counter: nextCounter })
    .eq('id', tenantId)

  if (updateErr) {
    throw new Error(`Failed to increment invoice counter: ${updateErr.message}`)
  }

  return `INV-${nextCounter}`
}
