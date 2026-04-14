import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import redis from '../lib/redis.js'

const router = Router()
const startedAt = Date.now()

async function checkSupabase(): Promise<boolean> {
  try {
    const url = process.env['SUPABASE_URL']
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
    if (!url || !key) return false
    const sb = createClient(url, key)
    const { error } = await sb.from('tenants').select('id').limit(1)
    return !error
  } catch {
    return false
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    if (!process.env['REDIS_URL']) return false
    const result = await redis.ping()
    return result === 'PONG'
  } catch {
    return false
  }
}

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const [supabase, redisOk] = await Promise.all([checkSupabase(), checkRedis()])

  res.json({
    status: 'healthy',
    version: '1.0.0',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    services: {
      supabase,
      redis: redisOk,
      gemini: !!process.env['GEMINI_API_KEY'],
    },
  })
})

export default router
