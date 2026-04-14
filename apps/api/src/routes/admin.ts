import { Router, type Request, type Response, type NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'

const router = Router()
const startedAt = Date.now()

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  const key = process.env['ADMIN_API_KEY']
  if (!key) {
    res.status(503).json({ error: 'Admin API not configured' })
    return
  }
  const provided = req.headers['x-admin-key']
  if (provided !== key) {
    res.status(401).json({ error: 'Invalid admin key' })
    return
  }
  next()
}

router.use(requireAdminKey)

// ── GET /admin/stats ─────────────────────────────────────────────────────────
router.get('/stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    const uptimeSeconds = Math.floor((Date.now() - startedAt) / 1000)

    // Active WebSocket connections
    let activeWebsockets = 0
    try {
      const { getActiveConnectionCount } = await import('../voice/telnyx-handler.js')
      activeWebsockets = getActiveConnectionCount()
    } catch {
      // telnyx-handler not available
    }

    // Calls today
    let totalCallsToday = 0
    try {
      const url = process.env['SUPABASE_URL']
      const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
      if (url && key) {
        const sb = createClient(url, key)
        const todayStart = new Date()
        todayStart.setHours(0, 0, 0, 0)
        const { count } = await sb
          .from('voice_sessions')
          .select('id', { count: 'exact', head: true })
          .gte('started_at', todayStart.toISOString())
        totalCallsToday = count ?? 0
      }
    } catch {
      // query failed
    }

    // Worker status
    let workers: Record<string, unknown> = {}
    try {
      const { getWorkerStatus } = await import('../workers/index.js')
      workers = getWorkerStatus()
    } catch {
      // workers not available
    }

    res.json({
      uptime_seconds: uptimeSeconds,
      active_websockets: activeWebsockets,
      total_calls_today: totalCallsToday,
      workers,
    })
  } catch (err) {
    console.error('[admin] stats error:', err)
    res.status(500).json({ error: 'Failed to collect stats' })
  }
})

export default router
