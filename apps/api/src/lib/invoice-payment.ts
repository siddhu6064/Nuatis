import type { getServiceClient } from './supabase.js'
import { dispatchWebhook } from './webhook-dispatcher.js'

const ALLOWED_STATUSES = ['sent', 'due', 'overdue']

export type ApplyInvoicePaymentResult =
  | { kind: 'ok'; invoice: Record<string, unknown> }
  | { kind: 'not_found' }
  | { kind: 'invalid_status'; status: string }

/**
 * Applies a payment to an invoice — increments amount_paid, and flips status
 * to 'received' + stamps paid_at once the balance clears. Shared between the
 * authenticated POST /:id/record-payment route and the Stripe webhook
 * handler for online payments (checkout.session.completed), so both paths
 * enforce the same allowed-status gate and can't double-apply a payment to
 * an invoice that's already 'received' (the webhook's replay/idempotency
 * guard — Stripe redelivers events, and this makes a redelivery a no-op).
 */
export async function applyInvoicePayment(
  supabase: ReturnType<typeof getServiceClient>,
  invoiceId: string,
  tenantId: string,
  amount: number
): Promise<ApplyInvoicePaymentResult> {
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, amount_paid, total, status')
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .single()

  if (!invoice) return { kind: 'not_found' }

  if (!ALLOWED_STATUSES.includes(invoice.status as string)) {
    return { kind: 'invalid_status', status: invoice.status as string }
  }

  const newAmountPaid = Number((Number(invoice.amount_paid ?? 0) + amount).toFixed(2))
  const total = Number(invoice.total)

  const updateFields: Record<string, unknown> = {
    amount_paid: newAmountPaid,
    updated_at: new Date().toISOString(),
  }
  if (newAmountPaid >= total) {
    updateFields['status'] = 'received'
    updateFields['paid_at'] = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updateFields)
    .eq('id', invoice.id)
    .select('*')
    .single()

  if (error || !data) return { kind: 'not_found' }

  if (updateFields['status'] === 'received') {
    void dispatchWebhook(tenantId, 'invoice.paid', {
      invoice_id: invoice.id,
      invoice_number: (data as Record<string, unknown>)['invoice_number'],
      total: Number(invoice.total),
      contact_id: (data as Record<string, unknown>)['contact_id'],
    })
  }

  return { kind: 'ok', invoice: data }
}
