import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { Queue } from 'bullmq'
import { createBullMQConnection } from '../lib/bullmq-connection.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function getHeader(
  headers: Array<{ name: string; value: string }> | undefined,
  name: string
): string | null {
  return headers?.find((h) => h.name === name)?.value ?? null
}

router.post('/', async (req: Request, res: Response): Promise<void> => {
  // Always respond 200 immediately to Telnyx
  res.sendStatus(200)

  try {
    const event = (req.body?.data?.event_type ?? '') as string
    const payload = req.body?.data?.payload ?? {}
    const customHeaders = payload.custom_headers as
      | Array<{ name: string; value: string }>
      | undefined

    const jobId = getHeader(customHeaders, 'X-Job-Id')
    if (!jobId) {
      console.warn('[voice-outbound] no X-Job-Id in custom_headers, ignoring event:', event)
      return
    }

    const supabase = getSupabase()

    if (event === 'call.initiated') {
      // Status already set to 'dialing' by initiateOutboundCall — nothing to do
      console.info(`[voice-outbound] call.initiated job=${jobId}`)
      return
    }

    if (event === 'call.answered') {
      await supabase.from('outbound_call_jobs').update({ status: 'connected' }).eq('id', jobId)
      console.info(`[voice-outbound] call.answered job=${jobId}`)
      return
    }

    if (event === 'call.hangup') {
      // Fetch current job state
      const { data: job } = await supabase
        .from('outbound_call_jobs')
        .select('status, attempts, max_attempts')
        .eq('id', jobId)
        .single()

      if (!job) {
        console.warn(`[voice-outbound] call.hangup job not found: ${jobId}`)
        return
      }

      const wasConnected = (job as { status: string }).status === 'connected'
      const attempts = (job as { attempts: number }).attempts + 1
      const maxAttempts = (job as { max_attempts: number }).max_attempts

      if (wasConnected) {
        // Call was connected — mark completed
        await supabase
          .from('outbound_call_jobs')
          .update({ status: 'completed', completed_at: new Date().toISOString(), attempts })
          .eq('id', jobId)
        console.info(`[voice-outbound] call completed job=${jobId}`)
      } else {
        // No answer
        if (attempts < maxAttempts) {
          // Re-enqueue with 30min delay
          await supabase
            .from('outbound_call_jobs')
            .update({ status: 'pending', attempts })
            .eq('id', jobId)
          const queue = new Queue('outbound-calls', {
            connection: createBullMQConnection(),
            skipVersionCheck: true,
          })
          await queue.add('dial', { jobId }, { delay: 30 * 60 * 1000 })
          await queue.close()
          console.info(
            `[voice-outbound] no_answer — re-enqueued in 30min job=${jobId} attempt=${attempts}/${maxAttempts}`
          )
        } else {
          // Max attempts reached
          await supabase
            .from('outbound_call_jobs')
            .update({
              status: 'no_answer',
              completed_at: new Date().toISOString(),
              attempts,
            })
            .eq('id', jobId)
          console.info(`[voice-outbound] no_answer — max attempts reached job=${jobId}`)
        }
      }
      return
    }

    if (event === 'call.machine.detection.ended') {
      const result = payload.result as string | undefined
      if (result === 'machine') {
        // Answering machine detected — add voicemail note, mark completed
        await supabase
          .from('outbound_call_jobs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
            notes: 'Left voicemail',
          })
          .eq('id', jobId)
        console.info(`[voice-outbound] voicemail detected — marked completed job=${jobId}`)
      }
      return
    }

    console.info(`[voice-outbound] unhandled event ${event} for job=${jobId}`)
  } catch (err) {
    console.error('[voice-outbound] unexpected error', err)
  }
})

export default router
