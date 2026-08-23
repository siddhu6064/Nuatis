import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'

const router = Router()

// GET /api/announcements — public, no auth
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('announcements')
    .select('id, title, body, type, cta_label, cta_url, starts_at, ends_at, created_at')
    .lte('starts_at', now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .order('created_at', { ascending: false })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ announcements: data ?? [] })
})

export default router
