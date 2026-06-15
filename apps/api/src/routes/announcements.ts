import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/announcements — public, no auth
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const supabase = getSupabase()
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
