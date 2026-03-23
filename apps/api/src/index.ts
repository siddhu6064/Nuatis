import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import 'dotenv/config'

const app = express()
const PORT = process.env['PORT'] ?? 3001

// ── Middleware ───────────────────────────────────────────────
app.use(helmet())
app.use(
  cors({
    origin:
      process.env['NODE_ENV'] === 'production' ? 'https://nuatis.com' : 'http://localhost:3000',
  })
)
app.use(express.json())

// ── Health check ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nuatis-api', timestamp: new Date().toISOString() })
})

// ── Routes (added phase by phase) ────────────────────────────
// Phase 1: /api/contacts, /api/appointments, /api/billing, /api/auth
// Phase 2: /api/calls, /api/voice
// Phase 3: /api/pipeline, /api/automations, /api/knowledge

app.get('/', (_req, res) => {
  res.json({ message: 'Nuatis API — Phase 1 build in progress' })
})

// ── Start server ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.info(`Nuatis API running on http://localhost:${PORT}`)
})

export default app
