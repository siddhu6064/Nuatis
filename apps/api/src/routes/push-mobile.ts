import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// POST /register — register or update an Expo push token
router.post('/register', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authed = req as AuthenticatedRequest
    const { token, platform, deviceName } = req.body

    if (!token || !platform) {
      res.status(400).json({ error: 'token and platform required' })
      return
    }

    if (!['ios', 'android'].includes(platform)) {
      res.status(400).json({ error: 'platform must be ios or android' })
      return
    }

    const supabase = getSupabase()
    const { error } = await supabase.from('mobile_push_tokens').upsert(
      {
        tenant_id: authed.tenantId,
        user_id: authed.userId,
        expo_token: token,
        platform,
        device_name: deviceName || null,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'expo_token' }
    )

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Push register error:', err)
    res.status(500).json({ error: 'Failed to register' })
  }
})

// DELETE /register — unregister push token (on logout)
router.delete('/register', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authed = req as AuthenticatedRequest
    const { token } = req.body

    if (!token) {
      res.status(400).json({ error: 'token required' })
      return
    }

    const supabase = getSupabase()
    await supabase
      .from('mobile_push_tokens')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('expo_token', token)
      .eq('user_id', authed.userId)

    res.json({ success: true })
  } catch (err) {
    console.error('Push unregister error:', err)
    res.status(500).json({ error: 'Failed to unregister' })
  }
})

export default router
