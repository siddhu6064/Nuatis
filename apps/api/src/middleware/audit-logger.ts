import type { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'
import type { AuthenticatedRequest } from '../lib/auth.js'

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

const SUB_ACTIONS = new Set([
  'accept',
  'decline',
  'send',
  'test',
  'subscribe',
  'public',
  'inbound',
  'search',
  'export',
  'import',
  'preview',
  'upload',
])

function extractResourceType(url: string): string {
  const path = url.split('?')[0] ?? url
  const match = path.match(/^\/api\/([^/]+)/)
  return match?.[1] ?? 'unknown'
}

function extractResourceId(url: string): string | null {
  const path = url.split('?')[0] ?? url
  const segments = path.split('/').filter(Boolean)
  // segments[0] = 'api', segments[1] = resource_type, segments[2] = potential id
  const candidate = segments[2]
  if (candidate && !SUB_ACTIONS.has(candidate)) return candidate
  return null
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

export async function logBulkAction(params: {
  tenantId: string
  userId: string
  action: string
  resourceType: string
  contactCount: number
  successCount: number
  failCount: number
  details?: string
}): Promise<void> {
  await logAuditEvent({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.action,
    resourceType: params.resourceType,
    details: {
      contactCount: params.contactCount,
      successCount: params.successCount,
      failCount: params.failCount,
      details: params.details,
    },
  })
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
  // req.originalUrl is captured once at the top of the middleware stack and
  // is never rewritten by nested router dispatch, unlike req.path/req.url —
  // those get mount-relative inside a sub-router and are typically never
  // restored, since restoration is tied to a route handler calling next(),
  // which REST endpoints don't do after sending a response. Reading req.path
  // here (as this used to) meant every logged path was missing its /api/xxx
  // prefix, so extractResourceType() never matched and always fell back to
  // 'unknown'.
  const originalUrl = req.originalUrl

  res.on('finish', () => {
    const tenantId = (res.locals['tenantId'] as string) ?? ''
    if (!tenantId) return

    const authed = req as AuthenticatedRequest
    void logAuditEvent({
      tenantId,
      userId: authed.appUserId ?? authed.userId,
      action,
      resourceType: extractResourceType(originalUrl),
      resourceId: extractResourceId(originalUrl) ?? undefined,
      details: { method: req.method, path: originalUrl, status: res.statusCode },
      ipAddress: req.ip ?? req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    })
  })

  next()
}
