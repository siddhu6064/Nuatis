import { createServer } from 'http'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import 'dotenv/config'
import { WebSocketServer } from 'ws'
import tenantsRouter from './routes/tenants.js'
import googleAuthRouter from './routes/google-auth.js'
import appointmentsRouter from './routes/appointments.js'
import { registerVoiceWebSocket } from './voice/telnyx-handler.js'

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
    const webhookUrl = process.env['VOICE_WEBHOOK_URL'] ?? ''
    const streamUrl = webhookUrl
      .replace('/voice/inbound', '/voice/stream')
      .replace(/^http:\/\//, 'ws://')
      .replace(/^https:\/\//, 'wss://')

    const texml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`

    res.setHeader('Content-Type', 'application/xml')
    res.status(200).send(texml)
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
