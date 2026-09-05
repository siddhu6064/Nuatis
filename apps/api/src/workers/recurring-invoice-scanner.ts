import { randomUUID } from 'node:crypto'
import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { logActivity } from '../lib/activity.js'
import { generateInvoiceNumber } from '../lib/invoice-number.js'
import { sendEmail } from '../lib/email-client.js'
import { buildInvoiceEmailHtml } from '../lib/email-templates/invoice.js'

const QUEUE_NAME = 'recurring-invoice-scanner'

interface RecurringInvoice {
  id: string
  tenant_id: string
  contact_id: string
  deal_id: string | null
  description: string
  amount: number
  tax_rate: number | null
  due_days: number
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'annually'
  day_of_week: number | null
  day_of_month: number | null
  month_of_year: number | null
  last_generated_at: string | null
}

// Identical cadence logic to recurring-expense-scanner.ts's isDue() — kept as
// a plain copy rather than a shared import, since the two tables' column
// shapes could diverge later and a shared helper would then need its own
// abstraction over both.
function isDue(r: RecurringInvoice): boolean {
  const now = new Date()
  const dow = now.getDay()
  const dom = now.getDate()
  const moy = now.getMonth() + 1

  if (r.frequency === 'weekly') {
    if (r.day_of_week === null || r.day_of_week !== dow) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 6 * 86400000
  }
  if (r.frequency === 'monthly') {
    if (r.day_of_month === null || r.day_of_month !== dom) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 25 * 86400000
  }
  if (r.frequency === 'quarterly') {
    if (r.day_of_month === null || r.day_of_month !== dom) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 80 * 86400000
  }
  if (r.frequency === 'annually') {
    if (r.day_of_month === null || r.month_of_year === null) return false
    if (r.day_of_month !== dom || r.month_of_year !== moy) return false
    if (!r.last_generated_at) return true
    return now.getTime() - new Date(r.last_generated_at).getTime() >= 350 * 86400000
  }
  return false
}

export async function scanRecurringInvoices(): Promise<void> {
  console.info('[recurring-invoice-scanner] scanning...')

  try {
    const supabase = getServiceClient()

    const { data: rules, error } = await supabase
      .from('recurring_invoices')
      .select(
        'id, tenant_id, contact_id, deal_id, description, amount, tax_rate, due_days, frequency, day_of_week, day_of_month, month_of_year, last_generated_at'
      )
      .eq('enabled', true)
      .is('deleted_at', null)

    if (error) {
      console.error(`[recurring-invoice-scanner] query error: ${error.message}`)
      return
    }

    const due = ((rules ?? []) as RecurringInvoice[]).filter(isDue)
    if (due.length === 0) {
      console.info('[recurring-invoice-scanner] no rules due')
      return
    }

    for (const rule of due) {
      let invoiceNumber: string
      try {
        invoiceNumber = await generateInvoiceNumber(rule.tenant_id)
      } catch (err) {
        console.error(`[recurring-invoice-scanner] invoice number failed rule=${rule.id}:`, err)
        continue
      }

      const now = new Date()
      const issueDate = now.toISOString().slice(0, 10)
      const dueDate = new Date(now.getTime() + rule.due_days * 86400000).toISOString().slice(0, 10)
      const taxRate = rule.tax_rate ?? 0
      const taxAmount = Number(((rule.amount * taxRate) / 100).toFixed(2))
      const total = Number((rule.amount + taxAmount).toFixed(2))

      const { data: invoice, error: insertErr } = await supabase
        .from('invoices')
        .insert({
          tenant_id: rule.tenant_id,
          contact_id: rule.contact_id,
          deal_id: rule.deal_id,
          recurring_invoice_id: rule.id,
          invoice_number: invoiceNumber,
          share_token: randomUUID(),
          status: 'sent',
          issue_date: issueDate,
          due_date: dueDate,
          subtotal: rule.amount,
          tax_rate: taxRate,
          tax_amount: taxAmount,
          total,
          amount_paid: 0,
          sent_at: now.toISOString(),
        })
        .select('*')
        .single()

      if (insertErr || !invoice) {
        console.error(
          `[recurring-invoice-scanner] insert failed rule=${rule.id}: ${insertErr?.message}`
        )
        continue
      }

      await supabase.from('invoice_line_items').insert({
        invoice_id: invoice.id,
        tenant_id: rule.tenant_id,
        description: rule.description,
        quantity: 1,
        unit_price: rule.amount,
        sort_order: 0,
      })

      await supabase
        .from('recurring_invoices')
        .update({ last_generated_at: now.toISOString() })
        .eq('id', rule.id)
        .eq('tenant_id', rule.tenant_id)

      void logActivity({
        tenantId: rule.tenant_id,
        contactId: rule.contact_id,
        type: 'system',
        body: `Recurring invoice generated: ${invoiceNumber} — $${total.toFixed(2)}`,
        metadata: { invoice_id: invoice.id, recurring_invoice_id: rule.id },
        actorType: 'system',
      })

      // Auto-send by email, same content as the manual POST /:id/send route —
      // a recurring invoice with no one telling the customer isn't billing
      // them, just quietly accumulating draft rows.
      try {
        const [{ data: contact }, { data: tenant }] = await Promise.all([
          supabase
            .from('contacts')
            .select('full_name, email')
            .eq('id', rule.contact_id)
            .maybeSingle(),
          supabase.from('tenants').select('name').eq('id', rule.tenant_id).maybeSingle(),
        ])

        if (contact?.email) {
          const webUrl = process.env['WEB_URL'] ?? 'http://localhost:3000'
          const publicUrl = `${webUrl}/invoices/public/${invoice.share_token as string}`
          void sendEmail({
            to: contact.email as string,
            subject: `Invoice ${invoiceNumber} from ${(tenant?.name as string) ?? ''}`,
            html: buildInvoiceEmailHtml({
              contactName: (contact.full_name as string) ?? 'Customer',
              businessName: (tenant?.name as string) ?? '',
              invoiceNumber,
              invoiceTotal: `$${total.toFixed(2)}`,
              invoiceUrl: publicUrl,
              dueDate: new Date(dueDate).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              }),
            }),
            tenantId: rule.tenant_id,
          }).catch((err) => console.error('[recurring-invoice-scanner] send email error:', err))
        }
      } catch (err) {
        console.error(`[recurring-invoice-scanner] email lookup failed rule=${rule.id}:`, err)
      }
    }

    console.info(`[recurring-invoice-scanner] generated ${due.length} invoice(s)`)
  } catch (err) {
    console.error('[recurring-invoice-scanner] scan error:', err)
  }
}

export function createRecurringInvoiceScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scanRecurringInvoices(), {
    connection,
    skipVersionCheck: true,
  })

  worker.on('failed', (job, err) => {
    console.error(`[recurring-invoice-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
