import { Router, type Request, type Response } from 'express'
import { randomBytes } from 'crypto'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, requireRole, type AuthenticatedRequest } from '../lib/auth.js'
import { hashApiKey } from '../lib/api-key-auth.js'

const router = Router()

// ── POST /api/api-keys — generate a new key ──────────────────────────────────
// Owner/admin only — a key grants script-level access to this tenant's
// webhook-subscription management endpoints (see lib/api-key-auth.ts).
router.post(
  '/',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const name =
      typeof (req.body as Record<string, unknown>)['name'] === 'string'
        ? ((req.body as Record<string, unknown>)['name'] as string).trim()
        : ''

    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }

    const rawKey = `nuatis_${randomBytes(24).toString('hex')}`
    const keyHash = hashApiKey(rawKey)
    const keyPrefix = rawKey.slice(0, 14)

    const { data, error } = await supabase
      .from('api_keys')
      .insert({
        tenant_id: authed.tenantId,
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        created_by_user_id: authed.appUserId,
      })
      .select('id, name, key_prefix, created_at')
      .single()

    if (error) {
      console.error(`[api-keys] create error: ${error.message}`)
      res.status(500).json({ error: 'Failed to create API key' })
      return
    }

    // The only time the plaintext key is ever returned — not retrievable
    // again after this response, matching how every other API-key product
    // handles it (only the hash is stored).
    res.status(201).json({ ...data, key: rawKey })
  }
)

// ── GET /api/api-keys — list this tenant's keys (prefix only, never the full key)
router.get(
  '/',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data, error } = await supabase
      .from('api_keys')
      .select('id, name, key_prefix, last_used_at, revoked_at, created_at')
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error(`[api-keys] list error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch API keys' })
      return
    }

    res.json({ keys: data ?? [] })
  }
)

// ── DELETE /api/api-keys/:id — revoke a key ──────────────────────────────────
router.delete(
  '/:id',
  requireAuth,
  requireRole('owner', 'admin'),
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { error } = await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)

    if (error) {
      console.error(`[api-keys] revoke error: ${error.message}`)
      res.status(500).json({ error: 'Failed to revoke API key' })
      return
    }

    res.json({ revoked: true })
  }
)

export default router
