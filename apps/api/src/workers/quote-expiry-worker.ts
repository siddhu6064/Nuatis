import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { sendPushNotification } from '../lib/push-client.js'

const QUEUE_NAME = 'quote-expiry'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function scan(): Promise<void> {
  console.info('[quote-expiry] scanning for expired quotes...')

  try {
    const supabase = getSupabase()
    const now = new Date().toISOString()

    const { data: expired, error } = await supabase
      .from('quotes')
      .select('id, tenant_id, quote_number, status')
      .in('status', ['draft', 'sent', 'viewed'])
      .lt('valid_until', now)

    if (error) {
      console.error(`[quote-expiry] query error: ${error.message}`)
      return
    }

    if (!expired || expired.length === 0) {
      console.info('[quote-expiry] no expired quotes found')
      return
    }

    for (const q of expired) {
      await supabase.from('quotes').update({ status: 'expired' }).eq('id', q.id)

      console.info(
        `[quote-expiry] expired quote ${q.quote_number} tenant=${q.tenant_id} (was ${q.status})`
      )

      void sendPushNotification(q.tenant_id, {
        title: 'Quote Expired',
        body: `Quote ${q.quote_number} has expired`,
        url: `/quotes/${q.id}`,
      })
    }

    console.info(`[quote-expiry] expired ${expired.length} quotes`)
  } catch (err) {
    console.error('[quote-expiry] scan error:', err)
  }
}

export function createQuoteExpiryWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection })

  worker.on('failed', (job, err) => {
    console.error(`[quote-expiry] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
