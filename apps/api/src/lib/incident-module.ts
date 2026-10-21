import type { Request, Response, NextFunction } from 'express'
import { isModuleEnabled } from './modules.js'
import type { AuthenticatedRequest } from './auth.js'

/**
 * Incidents module gate. Mirrors requirePos in routes/pos/menu.ts —
 * entitlement only, no subscription_status opinion.
 *
 * Deliberately NOT applied to the POS report routes: basic incident capture
 * rides with the `pos` module so a pos_only merchant can log a comp without
 * buying anything. This gate protects the tracker — queue, assignment, SLA,
 * rules — which is what the module actually sells.
 */
export async function requireIncidents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'incidents')
  if (!enabled) {
    res.status(403).json({ error: 'Incidents module is not enabled' })
    return
  }
  next()
}
