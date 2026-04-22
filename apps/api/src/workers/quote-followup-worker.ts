import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { API_BASE_URL } from '../config/urls.js'

const QUEUE_NAME = 'quote-followup'

let _queue: Queue | null = null

/** Lazily create and return the shared followup queue (for enqueuing from routes). */
export function getFollowupQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, { connection: createBullMQConnection() })
  }
  return _queue
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface FollowupJobData {
  quoteId: string
  tenantId: string
  contactPhone: string
  contactName: string
  quoteNumber: string
  shareToken: string
}

export async function processFollowup(data: FollowupJobData): Promise<void> {
  const { quoteId, tenantId, contactPhone, contactName, quoteNumber, shareToken } = data
  const supabase = getSupabase()

  // Check 1: has the quote been viewed?
  const { count: viewCount } = await supabase
    .from('quote_views')
    .select('id', { count: 'exact', head: true })
    .eq('quote_id', quoteId)

  if ((viewCount ?? 0) > 0) {
    console.info(`[quote-followup] skipped — quote already viewed`)
    return
  }

  // Check 2: is the quote still in a sendable state?
  const { data: quote } = await supabase.from('quotes').select('status').eq('id', quoteId).single()

  if (!quote) {
    console.info(`[quote-followup] skipped — quote not found`)
    return
  }

  const terminalStatuses = ['accepted', 'declined', 'expired', 'deposit_paid']
  if (terminalStatuses.includes(quote.status)) {
    console.info(`[quote-followup] skipped — quote status=${quote.status}`)
    return
  }

  // Look up tenant's Telnyx number
  const { data: location } = await supabase
    .from('locations')
    .select('telnyx_number')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).single()

  const businessName = tenant?.name ?? ''
  const apiKey = process.env['TELNYX_API_KEY']

  if (!location?.telnyx_number || !apiKey) {
    console.warn(`[quote-followup] no Telnyx number or API key for tenant=${tenantId}`)
    return
  }

  const shareUrl = `${API_BASE_URL}/quotes/view/${shareToken}`

  await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: location.telnyx_number,
      to: contactPhone,
      text: `Hi ${contactName}, just following up — your quote ${quoteNumber} from ${businessName} is ready for review: ${shareUrl}`,
    }),
  })

  console.info(
    `[quote-followup] sent 48h follow-up SMS for quote=${quoteNumber} to=${contactPhone}`
  )
}

export function createQuoteFollowupWorker(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })
  // Store reference so getFollowupQueue() returns this instance when workers are running
  _queue = queue

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      await processFollowup(job.data as FollowupJobData)
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`[quote-followup] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
