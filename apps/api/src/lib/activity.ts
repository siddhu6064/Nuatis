import { getServiceClient } from './supabase.js'

type ActivityType =
  | 'call'
  | 'note'
  | 'email'
  | 'sms'
  | 'appointment'
  | 'quote'
  | 'stage_change'
  | 'task'
  | 'system'
  | 'lead_score'
  | 'lifecycle_change'
  | 'inventory_adjust'
  | 'low_stock_alert'
  | 'revenue_drop_alert'
  | 'order'
  | 'order_status_change'
  | 'expense'

type ActorType = 'ai' | 'user' | 'system' | 'contact'

interface LogActivityParams {
  tenantId: string
  contactId?: string
  companyId?: string
  type: ActivityType
  body: string
  metadata?: Record<string, unknown>
  actorType?: ActorType
  actorId?: string
}

/**
 * Fire-and-forget activity logger.
 * Never throws — safe to call without await.
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const supabase = getServiceClient()
    // `|| null` (not `??`) on the uuid columns: an empty string is not
    // nullish, so `?? null` lets it straight through to Postgres, which
    // rejects it (22P02) — and since supabase-js resolves with {error} on a
    // DB-level failure rather than rejecting, that error was never being
    // checked below, so it silently vanished. Root cause of the empty string
    // itself (a proxy.ts auth bug) is fixed separately; this is defense in
    // depth so the same failure mode can't recur silently from here.
    const { error } = await supabase.from('activity_log').insert({
      tenant_id: params.tenantId,
      contact_id: params.contactId || null,
      company_id: params.companyId || null,
      type: params.type,
      body: params.body,
      metadata: params.metadata ?? {},
      actor_type: params.actorType ?? 'system',
      actor_id: params.actorId || null,
    })
    if (error) {
      console.error('[activity] insert failed:', error)
    }
  } catch (err) {
    console.error('[activity] failed to log activity:', err)
  }
}
