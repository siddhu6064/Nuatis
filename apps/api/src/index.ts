import { createServer } from 'http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import 'dotenv/config'
import { WebSocketServer } from 'ws'
import { initConversationsWs } from './lib/conversations-ws.js'
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
import pushMobileRouter from './routes/push-mobile.js'
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
import inventoryRouter from './routes/inventory.js'
import inventorySettingsRouter from './routes/inventory-settings.js'
import staffRouter from './routes/staff.js'
import usersRouter from './routes/users.js'
import emailIntegrationsRouter from './routes/email-integrations.js'
import emailTemplatesRouter from './routes/email-templates.js'
import emailTrackingRouter from './routes/email-tracking.js'
import bccLoggingRouter, { emailInboundWebhookRouter } from './routes/email-inbound.js'
import bookingPublicRouter from './routes/booking-public.js'
import bookingSettingsRouter from './routes/booking-settings.js'
import intakeFormsRouter from './routes/intake-forms.js'
import leadScoringRouter from './routes/lead-scoring.js'
import reportsRouter from './routes/reports.js'
import reviewSettingsRouter, { reviewTrackingRouter } from './routes/review-settings.js'
import notificationSettingsRouter from './routes/notification-settings.js'
import pipelinesRouter from './routes/pipelines.js'
import chatPublicRouter from './routes/chat-public.js'
import chatAgentRouter from './routes/chat-agent.js'
import chatSettingsRouter from './routes/chat-settings.js'
import dataExportRouter from './routes/data-export.js'
import calendarSettingsRouter, { calendarCallbackRouter } from './routes/calendar-settings.js'
import auditLogRouter from './routes/audit-log.js'
import smartListsRouter from './routes/smart-lists.js'
import followUpTemplatesRouter from './routes/follow-up-templates.js'
import mobileAuthRouter from './routes/mobile-auth.js'
import voiceTestRouter from './routes/voice-test.js'
import scheduledReportsRouter from './routes/scheduled-reports.js'
import paymentLinksRouter from './routes/payment-links.js'
import paymentsRouter from './routes/payments.js'
import availabilitySchedulesRouter from './routes/availability-schedules.js'
import calendarGroupsRouter from './routes/calendar-groups.js'
import googleReserveRouter from './routes/google-reserve.js'
import triggerLinksRouter, { triggerLinkPublicRouter } from './routes/trigger-links.js'
import smsWebhooksRouter from './routes/sms-webhooks.js'
import businessProfileRouter from './routes/business-profile.js'
import mayaKbRouter from './routes/maya-kb.js'
import reputationRouter from './routes/reputation.js'
import conversationsRouter from './routes/conversations.js'
import reviewRequestsRouter from './routes/review-requests.js'
import snippetsRouter from './routes/snippets.js'
import automationOverviewRouter from './routes/automation-overview.js'
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
      process.env['CORS_ORIGIN'] ??
      (process.env['NODE_ENV'] === 'production' ? 'https://nuatis.com' : 'http://localhost:3000'),
  })
)
app.use(express.json())
app.use(auditLoggerMiddleware)

// Health + admin (no auth required — admin uses its own key)
app.use('/health', healthRouter)
app.use('/admin', adminRouter)

app.use('/api/tenants', tenantsRouter)
app.use('/api/auth/google', googleAuthRouter)
app.use('/api/auth/mobile', mobileAuthRouter)
app.use('/api/appointments', appointmentsRouter)
app.use('/api/knowledge', knowledgeRouter)
app.use('/api/calls', callsRouter)
app.use('/api/maya-settings', mayaSettingsRouter)
app.use('/api/business-profile', businessProfileRouter)
app.use('/api/maya-kb', mayaKbRouter)
app.use('/api/reputation', reputationRouter)
app.use('/api/conversations', conversationsRouter)
app.use('/api/webhooks', webhooksRouter)
app.use('/api/demo', demoRouter)
app.use('/api/insights', insightsRouter)
app.use('/api/provisioning', provisioningRouter)
app.use('/api/push', pushRouter)
app.use('/api/push/mobile', pushMobileRouter)
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
app.use('/api/inventory', inventoryRouter)
app.use('/api/settings/inventory', inventorySettingsRouter)
app.use('/api/staff', staffRouter)
app.use('/api/users', usersRouter)
app.use('/api/email-integrations', emailIntegrationsRouter)
app.use('/api/email-templates', emailTemplatesRouter)
app.use('/api/email-tracking', emailTrackingRouter)
app.use('/api/settings/bcc-logging', bccLoggingRouter)
app.use('/api/webhooks/email-inbound', emailInboundWebhookRouter)
app.use('/api/booking', bookingPublicRouter)
app.use('/api/settings/booking', bookingSettingsRouter)
app.use('/api/intake-forms', intakeFormsRouter)
app.use('/api/lead-scoring', leadScoringRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/settings/review-automation', reviewSettingsRouter)
app.use('/api/review-tracking', reviewTrackingRouter)
app.use('/api/settings/notifications', notificationSettingsRouter)
app.use('/api/pipelines', pipelinesRouter)
app.use('/api/chat', cors({ origin: '*' }), chatPublicRouter)
app.use('/api/chat/sessions', chatAgentRouter)
app.use('/api/settings/chat-widget', chatSettingsRouter)
app.use('/api/settings/data-export', dataExportRouter)
app.use('/api/settings/calendar', calendarSettingsRouter)
app.use('/api/calendar', calendarCallbackRouter) // PUBLIC callback
app.use('/api/audit-log', auditLogRouter)
app.use('/api/smart-lists', smartListsRouter)
app.use('/api/follow-up-templates', followUpTemplatesRouter)
app.use('/api/voice', voiceTestRouter)
app.use('/api/scheduled-reports', scheduledReportsRouter)
app.use('/api/payment-links', paymentLinksRouter)
app.use('/api/payments', paymentsRouter)
app.use('/api/availability-schedules', availabilitySchedulesRouter)
app.use('/api/calendar-groups', calendarGroupsRouter)
app.use('/api/google-reserve', googleReserveRouter)
app.use('/t', triggerLinkPublicRouter)
app.use('/api/trigger-links', triggerLinksRouter)
app.use('/api/review-requests', reviewRequestsRouter)
app.use('/api/snippets', snippetsRouter)
app.use('/api/automation', automationOverviewRouter)

app.get('/', (_req, res) => {
  res.json({ message: 'Nuatis API — Front Office AI', status: 'running' })
})

app.post('/voice/inbound', async (req, res) => {
  const event = req.body?.data?.event_type ?? req.body?.event_type ?? 'unknown'
  console.info(`[voice/inbound] event: ${event}`, JSON.stringify(req.body?.data ?? req.body))

  if (event === 'call.initiated') {
    const callControlId: string = req.body?.data?.payload?.call_control_id ?? ''
    const toNumber: string = req.body?.data?.payload?.to ?? ''
    const fromNumber: string = req.body?.data?.payload?.from ?? ''
    const streamUrl = process.env['TELNYX_STREAM_URL'] ?? VOICE_WS_URL
    const apiKey = process.env['TELNYX_API_KEY'] ?? ''

    if (!callControlId) {
      console.warn('[voice/inbound] call.initiated missing call_control_id — skipping')
      res.sendStatus(200)
      return
    }

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
        await prewarmGemini(callControlId, toNumber, fromNumber || undefined)
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

    if (!hangupCallControlId) {
      console.warn('[voice/inbound] call.hangup missing call_control_id — skipping')
      res.sendStatus(200)
      return
    }

    hangupDataStore.set(hangupCallControlId, {
      hangupSource,
      hangupCause,
      callQualityMos: mos,
    })
    console.info(
      `[call-logger] hangup data captured: call_control_id=${hangupCallControlId} source=${hangupSource} cause=${hangupCause} mos=${mos}`
    )

    // Patch voice_sessions if the row was already inserted (WS closed before webhook arrived)
    const sbUrl = process.env['SUPABASE_URL']
    const sbKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
    if (sbUrl && sbKey) {
      const sb = createClient(sbUrl, sbKey)
      void sb
        .from('voice_sessions')
        .update({ hangup_source: hangupSource, hangup_cause: hangupCause, call_quality_mos: mos })
        .eq('call_control_id', hangupCallControlId)
        .then(({ error }) => {
          if (error) console.error('[voice/inbound] hangup update error:', error.message)
        })
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

    if (!recCallControlId) {
      console.warn('[voice/inbound] call.recording.saved missing call_control_id — skipping')
      res.sendStatus(200)
      return
    }

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
    if (!callControlId) {
      console.warn('[voice/inbound] streaming.started missing call_control_id — skipping')
      res.sendStatus(200)
      return
    }
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

// ── Telnyx SMS webhooks (message.received + message.finalized) ────────────────
app.use('/webhooks/telnyx/sms', smsWebhooksRouter)

// Sentry error handler — must be after all routes
Sentry.setupExpressErrorHandler(app)

const server = createServer(app)

const wss = new WebSocketServer({ server, path: '/voice/stream' })
registerVoiceWebSocket(wss)
setWssRef(wss)
initConversationsWs(server)

// ── Background workers ──────────────────────────────────────────────────────
import { startWorkers, stopWorkers } from './workers/index.js'

server.listen(PORT, () => {
  console.info(`Nuatis API running on http://localhost:${PORT}`)
  console.info(`Voice WebSocket listening at ws://localhost:${PORT}/voice/stream`)
  console.info(`Conversations WebSocket listening at ws://localhost:${PORT}/ws/conversations`)

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
