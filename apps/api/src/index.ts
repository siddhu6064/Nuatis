import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import 'dotenv/config'
import tenantsRouter from './routes/tenants.js'
import googleAuthRouter from './routes/google-auth.js'

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

app.get('/', (_req, res) => {
  res.json({ message: 'Nuatis API — Phase 1 build in progress' })
})

app.listen(PORT, () => {
  console.info(`Nuatis API running on http://localhost:${PORT}`)
})

export default app
