import type { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'

export interface AuditEvent {
  tenantId: string
  userId?: string
  action: string
  resourceType: string
  resourceId?: string
  details?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) return null
  return createClient(url, key)
}

const SKIP_PATHS = ['/health', '/admin', '/api/auth', '/api/push', '/voice']
const METHOD_ACTION: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
}

function extractResourceType(path: string): string {
  const match = path.match(/^\/api\/([^/]+)/)
  return match?.[1] ?? 'unknown'
}

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    const supabase = getSupabase()
    if (!supabase) return

    await supabase.from('audit_log').insert({
      tenant_id: event.tenantId,
      user_id: event.userId ?? null,
      action: event.action,
      resource_type: event.resourceType,
      resource_id: event.resourceId ?? null,
      details: event.details ?? {},
      ip_address: event.ipAddress ?? null,
      user_agent: event.userAgent ?? null,
    })
  } catch (err) {
    console.error('[audit] log error:', err)
  }
}

export function auditLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Only log mutating requests
  const action = METHOD_ACTION[req.method]
  if (!action) {
    next()
    return
  }

  // Skip noisy paths
  if (SKIP_PATHS.some((p) => req.path.startsWith(p))) {
    next()
    return
  }

  // Log after response completes (fire-and-forget)
  res.on('finish', () => {
    const tenantId = (res.locals['tenantId'] as string) ?? ''
    if (!tenantId) return

    void logAuditEvent({
      tenantId,
      userId: (req as Record<string, unknown>)['userId'] as string | undefined,
      action,
      resourceType: extractResourceType(req.path),
      details: { method: req.method, path: req.path, status: res.statusCode },
      ipAddress: req.ip ?? req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    })
  })

  next()
}
