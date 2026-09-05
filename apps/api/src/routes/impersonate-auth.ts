import { Router, type Request, type Response } from 'express'
import { redeemImpersonationExchangeCode } from '../lib/impersonation.js'

const router = Router()

// POST /api/impersonate/redeem — server-to-server only, called by the
// Next.js "impersonate" Credentials provider. Same trust model as the SSO
// exchange code: the code itself is the credential (random, single-use,
// short TTL).
router.post('/redeem', async (req: Request, res: Response): Promise<void> => {
  const { exchangeCode } = req.body as { exchangeCode?: string }
  if (!exchangeCode) {
    res.status(400).json({ error: 'exchangeCode is required' })
    return
  }

  const claims = await redeemImpersonationExchangeCode(exchangeCode)
  if (!claims) {
    res.status(400).json({ error: 'Invalid or expired exchange code' })
    return
  }

  res.json(claims)
})

export default router
