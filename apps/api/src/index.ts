import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import 'dotenv/config'
import tenantsRouter from './routes/tenants.js'

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

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nuatis-api', timestamp: new Date().toISOString() })
})

// ── Routes ────────────────────────────────────────────────────
app.use('/api/tenants', tenantsRouter)

// Phase 2: /api/calls, /api/voice
// Phase 3: /api/pipeline, /api/automations, /api/knowledge

app.get('/', (_req, res) => {
  res.json({ message: 'Nuatis API — Phase 1 build in progress' })
})

app.listen(PORT, () => {
  console.info(`Nuatis API running on http://localhost:${PORT}`)
})

export default app
