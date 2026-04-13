import { createServer } from 'http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import 'dotenv/config'
import { WebSocketServer } from 'ws'
import tenantsRouter from './routes/tenants.js'
import googleAuthRouter from './routes/google-auth.js'
import appointmentsRouter from './routes/appointments.js'
import {
  registerVoiceWebSocket,
  prewarmGemini,
  rekeyPrewarmedSession,
} from './voice/telnyx-handler.js'

const app = express()
const PORT = process.env['PORT'] ?? 3001

app.use(helmet())
app.use(
  cors({
    origin:
      process.env['NODE_ENV'] === 'production' ? 'https://nuatis.com' : 'http://localhost:3000',
  })
)
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nuatis-api', timestamp: new Date().toISOString() })
})

app.use('/api/tenants', tenantsRouter)
app.use('/api/auth/google', googleAuthRouter)
app.use('/api/appointments', appointmentsRouter)

app.get('/', (_req, res) => {
  res.json({ message: 'Nuatis API — Phase 1 build in progress' })
})

app.post('/voice/inbound', (req, res) => {
  const event = req.body?.data?.event_type ?? req.body?.event_type ?? 'unknown'
  console.info(`[voice/inbound] event: ${event}`, JSON.stringify(req.body?.data ?? req.body))

  if (event === 'call.initiated') {
    const callControlId: string = req.body?.data?.payload?.call_control_id ?? ''
    const toNumber: string = req.body?.data?.payload?.to ?? ''
    const streamUrl = process.env['TELNYX_STREAM_URL'] ?? 'wss://voice.nuatis.com/voice/stream'
    const apiKey = process.env['TELNYX_API_KEY'] ?? ''

    console.info(`[voice/inbound] call.initiated call_control_id=${callControlId} to=${toNumber}`)

    // Respond immediately — Telnyx requires fast webhook response
    res.status(200).json({ received: true })

    // Pre-warm Gemini, then answer + streaming_start
    void (async () => {
      try {
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
    console.info('[voice/inbound] call hung up')
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

const server = createServer(app)

const wss = new WebSocketServer({ server, path: '/voice/stream' })
registerVoiceWebSocket(wss)

server.listen(PORT, () => {
  console.info(`Nuatis API running on http://localhost:${PORT}`)
  console.info(`Voice WebSocket listening at ws://localhost:${PORT}/voice/stream`)
})

export default app
