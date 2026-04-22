import { createClient } from '@supabase/supabase-js'

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

type ActorType = 'ai' | 'user' | 'system' | 'contact'

interface LogActivityParams {
  tenantId: string
  contactId?: string
  type: ActivityType
  body: string
  metadata?: Record<string, unknown>
  actorType?: ActorType
  actorId?: string
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

/**
 * Fire-and-forget activity logger.
 * Never throws — safe to call without await.
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const supabase = getSupabase()
    await supabase.from('activity_log').insert({
      tenant_id: params.tenantId,
      contact_id: params.contactId ?? null,
      type: params.type,
      body: params.body,
      metadata: params.metadata ?? {},
      actor_type: params.actorType ?? 'system',
      actor_id: params.actorId ?? null,
    })
  } catch (err) {
    console.error('[activity] failed to log activity:', err)
  }
}
