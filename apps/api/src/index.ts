import { createServer } from 'http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import 'dotenv/config'
import { WebSocketServer } from 'ws'
import { initSentry, Sentry } from './lib/sentry.js'
import tenantsRouter from './routes/tenants.js'
import googleAuthRouter from './routes/google-auth.js'
import appointmentsRouter from './routes/appointments.js'
import knowledgeRouter from './routes/knowledge.js'
import callsRouter from './routes/calls.js'
import mayaSettingsRouter from './routes/maya-settings.js'
import webhooksRouter from './routes/webhooks.js'
import demoRouter from './routes/demo.js'
import insightsRouter from './routes/insights.js'
import provisioningRouter from './routes/provisioning.js'
import pushRouter from './routes/push.js'
import servicesRouter from './routes/services.js'
import quotesRouter from './routes/quotes.js'
import analyticsEventsRouter from './routes/analytics-events.js'
import locationsRouter from './routes/locations.js'
import npsRouter from './routes/nps.js'
import cpqSettingsRouter from './routes/cpq-settings.js'
import packagesRouter from './routes/packages.js'
import settingsModulesRouter from './routes/settings-modules.js'
import activityRouter from './routes/activity.js'
import tasksRouter from './routes/tasks.js'
import contactsRouter from './routes/contacts.js'
import searchRouter from './routes/search.js'
import savedViewsRouter from './routes/saved-views.js'
import importRouter from './routes/import.js'
import attachmentsRouter from './routes/attachments.js'
import smsRouter from './routes/sms.js'
import companiesRouter from './routes/companies.js'
import dealsRouter from './routes/deals.js'
import { securityHeaders } from './middleware/security-headers.js'
import { auditLoggerMiddleware } from './middleware/audit-logger.js'
import healthRouter from './routes/health.js'
import adminRouter from './routes/admin.js'
import { createClient } from '@supabase/supabase-js'
import { VOICE_WS_URL } from './config/urls.js'
import {
  registerVoiceWebSocket,
  prewarmGemini,
  rekeyPrewarmedSession,
  hangupDataStore,
  parseTenantMap,
  lookupTenant,
  setWssRef,
} from './voice/telnyx-handler.js'

// Initialize Sentry before Express
initSentry()

const app = express()
const PORT = process.env['PORT'] ?? 3001

app.use(securityHeaders)
app.use(helmet())
app.use(
  cors({
    origin:
      process.env['NODE_ENV'] === 'production' ? 'https://nuatis.com' : 'http://localhost:3000',
  })
)
app.use(express.json())
app.use(auditLoggerMiddleware)

// Health + admin (no auth required — admin uses its own key)
app.use('/health', healthRouter)
app.use('/admin', adminRouter)

app.use('/api/tenants', tenantsRouter)
app.use('/api/auth/google', googleAuthRouter)
app.use('/api/appointments', appointmentsRouter)
app.use('/api/knowledge', knowledgeRouter)
app.use('/api/calls', callsRouter)
app.use('/api/maya-settings', mayaSettingsRouter)
app.use('/api/webhooks', webhooksRouter)
app.use('/api/demo', demoRouter)
app.use('/api/insights', insightsRouter)
app.use('/api/provisioning', provisioningRouter)
app.use('/api/push', pushRouter)
app.use('/api/services', servicesRouter)
app.use('/api/quotes', quotesRouter)
app.use('/api/analytics', analyticsEventsRouter)
app.use('/api/locations', locationsRouter)
app.use('/api/nps', npsRouter)
app.use('/api/cpq', cpqSettingsRouter)
app.use('/api/packages', packagesRouter)
app.use('/api/settings/modules', settingsModulesRouter)
app.use('/api', activityRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/contacts', contactsRouter)
app.use('/api/search', searchRouter)
app.use('/api/views', savedViewsRouter)
app.use('/api/import', importRouter)
app.use('/api/contacts', attachmentsRouter)
app.use('/api', smsRouter)
app.use('/api/companies', companiesRouter)
app.use('/api/deals', dealsRouter)

app.get('/', (_req, res) => {
  res.json({ message: 'Nuatis API — Front Office AI', status: 'running' })
})

app.post('/voice/inbound', async (req, res) => {
  const event = req.body?.data?.event_type ?? req.body?.event_type ?? 'unknown'
  console.info(`[voice/inbound] event: ${event}`, JSON.stringify(req.body?.data ?? req.body))

  if (event === 'call.initiated') {
    const callControlId: string = req.body?.data?.payload?.call_control_id ?? ''
    const toNumber: string = req.body?.data?.payload?.to ?? ''
    const streamUrl = process.env['TELNYX_STREAM_URL'] ?? VOICE_WS_URL
    const apiKey = process.env['TELNYX_API_KEY'] ?? ''

    console.info(`[voice/inbound] call.initiated call_control_id=${callControlId} to=${toNumber}`)

    // Respond immediately — Telnyx requires fast webhook response
    res.status(200).json({ received: true })

    // Pre-warm Gemini, then answer + streaming_start
    void (async () => {
      try {
        // Check if Maya is enabled for this tenant before answering
        const tenantMapRaw = process.env['TELNYX_TENANT_MAP'] ?? ''
        const tenantMap = parseTenantMap(tenantMapRaw)
        const resolvedTenantId =
          lookupTenant(toNumber, tenantMap) ?? process.env['VOICE_DEV_TENANT_ID'] ?? null

        if (resolvedTenantId) {
          const sbUrl = process.env['SUPABASE_URL']
          const sbKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
          if (sbUrl && sbKey) {
            const sb = createClient(sbUrl, sbKey)
            const { data: loc } = await sb
              .from('locations')
              .select('maya_enabled')
              .eq('tenant_id', resolvedTenantId)
              .eq('is_primary', true)
              .maybeSingle()

            if (loc && loc.maya_enabled === false) {
              console.info(
                `[voice/inbound] Maya disabled for tenant=${resolvedTenantId} — skipping`
              )
              return
            }
          }
        }

        const prewarmStart = Date.now()
        await prewarmGemini(callControlId, toNumber)
        console.info(`[latency] gemini_prewarm_ms=${Date.now() - prewarmStart}`)

        const base = `https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions`
        const headers = {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        }

        const answerRes = await fetch(`${base}/answer`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ preferred_codecs: 'PCMU' }),
        })
        console.info(`[voice/inbound] answer status=${answerRes.status}`)

        // Start recording (fire-and-forget)
        void fetch(`${base}/record_start`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ format: 'mp3', channels: 'dual' }),
        })
          .then((r) => {
            console.info(
              `[voice/recording] started recording for call_control_id=${callControlId} status=${r.status}`
            )
          })
          .catch((err) => {
            console.warn('[voice/recording] record_start failed:', err)
          })

        const streamRes = await fetch(`${base}/streaming_start`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            stream_url: streamUrl,
            stream_track: 'both_tracks',
            codec: 'PCMU',
            stream_bidirectional_mode: 'rtp',
            stream_bidirectional_codec: 'PCMU',
          }),
        })
        console.info(`[voice/inbound] streaming_start status=${streamRes.status}`)

        if (streamRes.ok) {
          try {
            const streamBody = await streamRes.json()
            console.info('[debug] streaming_start response body:', JSON.stringify(streamBody))
            const streamId = (streamBody as { data?: { stream_id?: string } })?.data?.stream_id
            if (streamId) {
              rekeyPrewarmedSession(callControlId, streamId)
              console.info(`[voice/inbound] streaming_start stream_id=${streamId}`)
            } else {
              console.warn(
                '[voice/inbound] streaming_start response missing stream_id — waiting for streaming.started webhook'
              )
            }
          } catch {
            console.warn('[voice/inbound] failed to parse streaming_start response')
          }
        }
      } catch (err) {
        console.error('[voice/inbound] call control API error', err)
      }
    })()
    return
  }

  if (event === 'call.answered') {
    console.info('[voice/inbound] call answered')
    res.sendStatus(200)
    return
  }

  if (event === 'call.hangup') {
    const payload = req.body?.data?.payload ?? {}
    const hangupCallControlId: string = payload.call_control_id ?? ''
    const hangupSource: string = payload.hangup_source ?? null
    const hangupCause: string = payload.hangup_cause ?? null
    const mos: number | null =
      payload.call_quality_stats?.inbound?.mos != null
        ? Number(payload.call_quality_stats.inbound.mos)
        : null

    if (hangupCallControlId) {
      hangupDataStore.set(hangupCallControlId, {
        hangupSource,
        hangupCause,
        callQualityMos: mos,
      })
      console.info(
        `[call-logger] hangup data captured: call_control_id=${hangupCallControlId} source=${hangupSource} cause=${hangupCause} mos=${mos}`
      )
    }

    res.sendStatus(200)
    return
  }

  if (event === 'call.recording.saved') {
    const payload = req.body?.data?.payload ?? {}
    const recCallControlId: string = payload.call_control_id ?? ''
    const recordingUrl: string =
      payload.recording_urls?.mp3 ?? payload.public_recording_urls?.mp3 ?? ''
    const recDuration: number | null =
      payload.duration_secs != null ? Math.round(Number(payload.duration_secs)) : null

    if (recCallControlId && recordingUrl) {
      // Update voice_session with recording URL
      const sbUrl = process.env['SUPABASE_URL']
      const sbKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
      if (sbUrl && sbKey) {
        const sb = createClient(sbUrl, sbKey)
        const { data: session } = await sb
          .from('voice_sessions')
          .select('id, language_detected')
          .eq('call_control_id', recCallControlId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (session) {
          await sb
            .from('voice_sessions')
            .update({
              recording_url: recordingUrl,
              recording_duration_seconds: recDuration,
            })
            .eq('id', session.id)

          console.info(
            `[voice/recording] saved recording for session=${session.id} url=${recordingUrl.slice(0, 60)}...`
          )

          // Fire-and-forget transcription
          void (async () => {
            try {
              const { transcribeRecording } = await import('./services/transcription.js')
              const transcript = await transcribeRecording(
                recordingUrl,
                session.language_detected ?? undefined
              )
              if (transcript) {
                await sb.from('voice_sessions').update({ transcript }).eq('id', session.id)
                console.info(`[transcription] saved transcript for session ${session.id}`)
              }
            } catch (err) {
              console.error('[transcription] error:', err)
            }
          })()
        }
      }
    }

    res.sendStatus(200)
    return
  }

  if (event === 'streaming.started') {
    const callControlId: string = req.body?.data?.payload?.call_control_id ?? ''
    const streamId: string = req.body?.data?.payload?.stream_id ?? ''
    if (callControlId && streamId) {
      rekeyPrewarmedSession(callControlId, streamId)
      console.info(`[prewarm] rekeyed via webhook ${callControlId} → ${streamId}`)
    } else {
      console.warn(
        `[voice/inbound] streaming.started missing ids — call_control_id=${callControlId} stream_id=${streamId}`
      )
    }
    res.sendStatus(200)
    return
  }

  console.info(`[voice/inbound] unhandled event type: ${event}`)
  res.sendStatus(200)
})

// ── Telnyx inbound SMS webhook ──────────────────────────────────────────────
app.post('/webhooks/telnyx/sms', async (req, res) => {
  const eventType = req.body?.data?.event_type ?? ''
  if (eventType !== 'message.received') {
    res.sendStatus(200)
    return
  }

  const payload = req.body?.data?.payload ?? {}
  const fromNumber: string = payload.from?.phone_number ?? ''
  const toNumber: string = payload.to?.[0]?.phone_number ?? payload.to ?? ''
  const body: string = payload.text ?? ''
  const telnyxMessageId: string = payload.id ?? ''

  console.info(`[sms-webhook] message.received from=${fromNumber} to=${toNumber}`)

  const sb = createClient(
    process.env['SUPABASE_URL'] ?? '',
    process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? ''
  )

  // Dedup check
  if (telnyxMessageId) {
    const { data: existing } = await sb
      .from('inbound_sms')
      .select('id')
      .eq('telnyx_message_id', telnyxMessageId)
      .maybeSingle()
    if (existing) {
      res.sendStatus(200)
      return
    }
  }

  // Find tenant by to_number
  const normalizedTo = toNumber.replace(/\D/g, '').slice(-10)
  const { data: location } = await sb
    .from('locations')
    .select('tenant_id')
    .ilike('telnyx_number', `%${normalizedTo}%`)
    .limit(1)
    .maybeSingle()

  if (!location) {
    console.warn(`[sms-webhook] no tenant found for number ${toNumber}`)
    res.sendStatus(200)
    return
  }

  const tenantId = location.tenant_id

  // Find contact by from_number
  const normalizedFrom = fromNumber.replace(/\D/g, '').slice(-10)
  let contactId: string | null = null
  let contactName: string | null = null

  const { data: matchedContact } = await sb
    .from('contacts')
    .select('id, full_name')
    .eq('tenant_id', tenantId)
    .ilike('phone', `%${normalizedFrom}%`)
    .limit(1)
    .maybeSingle()

  if (matchedContact) {
    contactId = matchedContact.id
    contactName = matchedContact.full_name
  } else {
    // Create new contact
    const { data: newContact } = await sb
      .from('contacts')
      .insert({
        tenant_id: tenantId,
        full_name: `Unknown - ${fromNumber}`,
        phone: fromNumber,
        source: 'sms',
      })
      .select('id, full_name')
      .single()
    if (newContact) {
      contactId = newContact.id
      contactName = newContact.full_name
    }
  }

  // Insert SMS record
  await sb.from('inbound_sms').insert({
    tenant_id: tenantId,
    contact_id: contactId,
    from_number: fromNumber,
    to_number: toNumber,
    body,
    direction: 'inbound',
    telnyx_message_id: telnyxMessageId || null,
    status: 'received',
  })

  // Log activity
  if (contactId) {
    const { logActivity: logAct } = await import('./lib/activity.js')
    void logAct({
      tenantId,
      contactId,
      type: 'sms',
      body: `SMS received: "${body.slice(0, 80)}${body.length > 80 ? '...' : ''}"`,
      actorType: 'contact',
    })
  }

  // Push notification
  const { sendPushNotification: pushNotif } = await import('./lib/push-client.js')
  void pushNotif(tenantId, {
    title: `New SMS from ${contactName || fromNumber}`,
    body: body.slice(0, 60),
    url: contactId ? `/contacts/${contactId}?tab=messages` : '/inbox',
  })

  res.sendStatus(200)
})

// Sentry error handler — must be after all routes
Sentry.setupExpressErrorHandler(app)

const server = createServer(app)

const wss = new WebSocketServer({ server, path: '/voice/stream' })
registerVoiceWebSocket(wss)
setWssRef(wss)

// ── Background workers ──────────────────────────────────────────────────────
import { startWorkers, stopWorkers } from './workers/index.js'

server.listen(PORT, () => {
  console.info(`Nuatis API running on http://localhost:${PORT}`)
  console.info(`Voice WebSocket listening at ws://localhost:${PORT}/voice/stream`)

  // Start BullMQ scanners (best-effort — don't block server start)
  startWorkers().catch((err) => console.error('[workers] failed to start:', err))
})

// Graceful shutdown
function gracefulShutdown(signal: string): void {
  console.info(`[shutdown] ${signal} received — closing workers and server`)
  void stopWorkers()
    .then(() => Sentry.close(2000))
    .then(() => {
      server.close(() => {
        console.info('[shutdown] server closed')
        process.exit(0)
      })
    })
    .catch(() => {
      process.exit(1)
    })
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

export default app
