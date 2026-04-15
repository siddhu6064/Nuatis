import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { logActivity } from '../lib/activity.js'
import { enqueueScoreCompute } from '../lib/lead-score-queue.js'

const router = Router()

const TRACKING_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function sendGif(res: Response): void {
  res.set({
    'Content-Type': 'image/gif',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  })
  res.send(TRACKING_GIF)
}

// GET /:token — tracking pixel (PUBLIC, no auth)
router.get('/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params

    // Loose validation — just check it exists and is long enough
    if (!token || token.length < 8) {
      sendGif(res)
      return
    }

    const supabase = getSupabase()

    const { data: message, error } = await supabase
      .from('email_messages')
      .select('id, subject, open_count, opened_at, tenant_id, contact_id')
      .eq('tracking_token', token)
      .maybeSingle()

    if (error || !message) {
      sendGif(res)
      return
    }

    const isFirstOpen = message.open_count === 0
    const newOpenCount = (message.open_count ?? 0) + 1

    const updatePayload: Record<string, unknown> = {
      open_count: newOpenCount,
    }

    if (isFirstOpen) {
      updatePayload['opened_at'] = new Date().toISOString()
    }

    await supabase.from('email_messages').update(updatePayload).eq('id', message.id)

    if (isFirstOpen) {
      logActivity({
        tenantId: message.tenant_id,
        contactId: message.contact_id ?? undefined,
        type: 'email',
        body: `Opened email: ${message.subject}`,
        metadata: {
          email_message_id: message.id,
          open_count: newOpenCount,
        },
        actorType: 'contact',
      })
      if (message.contact_id)
        enqueueScoreCompute(message.tenant_id, message.contact_id, 'email_opened')
    }
  } catch (err) {
    console.error('[email-tracking] error:', err)
  }

  sendGif(res)
})

export default router
