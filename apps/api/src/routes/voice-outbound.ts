import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { Queue } from 'bullmq'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { prewarmGemini, rekeyPrewarmedSession } from '../voice/telnyx-handler.js'
import { buildSignedStreamUrl } from '../lib/stream-token.js'

const router = Router()

// ── In-memory registry: call_control_id → outbound call metadata ─────────────
// Populated when call.initiated fires (which includes custom_headers).
// Consumed by streaming.started / streaming.failed which Telnyx sends WITHOUT
// custom_headers, making the X-Job-Id / X-Tenant-Id unavailable at that point.

interface OutboundWebhookMeta {
  jobId: string
  tenantId: string
  contactId: string
  fromNumber: string // tenant's Telnyx number (the "from" field in call.initiated)
  toNumber: string // contact's phone (the "to" field in call.initiated)
}

const outboundWebhookMeta = new Map<string, OutboundWebhookMeta>()

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
    const callControlId: string = payload.call_control_id ?? ''
    const customHeaders = payload.custom_headers as
      | Array<{ name: string; value: string }>
      | undefined

    console.info(`[voice-outbound] event=${event} call_control_id=${callControlId}`)

    // ── call.initiated ────────────────────────────────────────────────────────
    // custom_headers ARE present here — extract all metadata and cache it.
    // Also kick off Gemini prewarm so the session is ready when the call connects.
    if (event === 'call.initiated') {
      const jobId = getHeader(customHeaders, 'X-Job-Id') ?? ''
      const tenantId = getHeader(customHeaders, 'X-Tenant-Id') ?? ''
      const contactId = getHeader(customHeaders, 'X-Contact-Id') ?? ''
      const fromNumber: string = payload.from ?? '' // tenant's Telnyx number
      const toNumber: string = payload.to ?? '' // contact's phone

      if (jobId && callControlId) {
        outboundWebhookMeta.set(callControlId, {
          jobId,
          tenantId,
          contactId,
          fromNumber,
          toNumber,
        })
        // Auto-cleanup after 30 minutes
        setTimeout(
          () => {
            outboundWebhookMeta.delete(callControlId)
          },
          30 * 60 * 1000
        )
      }

      console.info(
        `[voice-outbound] call.initiated job=${jobId} tenant=${tenantId} callControlId=${callControlId}`
      )

      // Prewarm Gemini. getTenantByPhoneNumber uses fromNumber (the tenant's Telnyx
      // number) to resolve the tenant. toNumber (the contact's phone) is passed as
      // the "caller" for contact lookup.
      if (callControlId && fromNumber) {
        prewarmGemini(callControlId, fromNumber, toNumber || undefined).catch((err: unknown) => {
          console.warn('[voice-outbound] prewarm failed for outbound call:', err)
        })
      } else {
        console.warn(
          `[voice-outbound] call.initiated missing callControlId or fromNumber — skipping prewarm`
        )
      }
      return
    }

    // ── streaming.started ─────────────────────────────────────────────────────
    // custom_headers are NOT present. Look up metadata from the in-memory registry.
    if (event === 'streaming.started') {
      const streamId: string = payload.stream_id ?? ''
      const meta = outboundWebhookMeta.get(callControlId)
      console.info(
        `[voice-outbound] streaming.started callControlId=${callControlId} streamId=${streamId} job=${meta?.jobId ?? 'unknown'}`
      )
      if (callControlId && streamId) {
        rekeyPrewarmedSession(callControlId, streamId)
      } else {
        console.warn(
          `[voice-outbound] streaming.started missing ids — callControlId=${callControlId} streamId=${streamId}`
        )
      }
      return
    }

    // ── streaming.failed ──────────────────────────────────────────────────────
    // custom_headers are NOT present. Log using registry metadata.
    if (event === 'streaming.failed') {
      const meta = outboundWebhookMeta.get(callControlId)
      const reason: string = (payload.reason as string | undefined) ?? 'unknown'
      console.error(
        `[voice-outbound] streaming.failed callControlId=${callControlId} job=${meta?.jobId ?? 'unknown'} reason=${reason}`
      )
      return
    }

    // ── Remaining events: require jobId ───────────────────────────────────────
    // Telnyx includes custom_headers in call control events (answered, hangup, etc.).
    // Fall back to the in-memory registry if headers are missing.
    const jobId =
      getHeader(customHeaders, 'X-Job-Id') ?? outboundWebhookMeta.get(callControlId)?.jobId ?? ''
    if (!jobId) {
      console.warn(
        `[voice-outbound] no jobId for event=${event} callControlId=${callControlId} — skipping`
      )
      return
    }

    const supabase = getSupabase()

    if (event === 'call.answered') {
      await supabase.from('outbound_call_jobs').update({ status: 'connected' }).eq('id', jobId)
      console.info(`[voice-outbound] call.answered job=${jobId}`)

      // Start media streaming now that the contact has answered.
      // Mirrors the inbound flow: answer → streaming_start → WS open → start event.
      const streamUrl = process.env['TELNYX_STREAM_URL']
      const telnyxApiKey = process.env['TELNYX_API_KEY'] ?? ''
      if (!streamUrl) {
        console.error(
          `[voice-outbound] TELNYX_STREAM_URL not set — cannot start streaming for job=${jobId}`
        )
      } else {
        try {
          // Bind the stream_url to this tenant + call so the /voice/stream upgrade
          // can authenticate the outbound Telnyx connection (VOICE-01).
          const meta = outboundWebhookMeta.get(callControlId)
          const signedStreamUrl = buildSignedStreamUrl(
            streamUrl,
            meta?.tenantId ?? 'unknown',
            callControlId
          )
          const streamRes = await fetch(
            `https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/streaming_start`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${telnyxApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                stream_url: signedStreamUrl,
                stream_track: 'both_tracks',
                stream_type: 'websocket_v2',
                enable_dialogflow: false,
                stream_bidirectional_mode: 'rtp',
              }),
            }
          )
          if (!streamRes.ok) {
            const body = await streamRes.text()
            console.error(
              `[voice-outbound] streaming_start failed ${streamRes.status}: ${body} job=${jobId}`
            )
          } else {
            console.info(`[voice-outbound] streaming_start issued job=${jobId}`)
          }
        } catch (err) {
          console.error(`[voice-outbound] streaming_start threw job=${jobId}`, err)
        }
      }
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
