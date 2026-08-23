import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

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

    const supabase = getServiceClient()
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
      // MASS-01: scope conflict resolution to the tenant (see migration 0132).
      { onConflict: 'tenant_id,expo_token' }
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

    const supabase = getServiceClient()
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
