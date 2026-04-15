import { createClient } from '@supabase/supabase-js'
import { logActivity } from './activity.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const STAGE_ORDER: string[] = [
  'subscriber',
  'lead',
  'marketing_qualified',
  'sales_qualified',
  'opportunity',
  'customer',
  'evangelist',
]

/**
 * Advance a contact's lifecycle stage only if targetStage is strictly ahead
 * of the current stage. Logs a lifecycle_change activity on success.
 *
 * Returns the new stage if advanced, null if no change was made.
 */
export async function maybeAdvanceLifecycle(
  tenantId: string,
  contactId: string,
  targetStage: string,
  actorId?: string
): Promise<string | null> {
  const supabase = getSupabase()

  const { data: contact, error } = await supabase
    .from('contacts')
    .select('lifecycle_stage')
    .eq('tenant_id', tenantId)
    .eq('id', contactId)
    .single()

  if (error || !contact) {
    console.error('[lifecycle] Failed to fetch contact:', error)
    return null
  }

  const currentStage: string = contact.lifecycle_stage ?? 'subscriber'
  const currentIndex = STAGE_ORDER.indexOf(currentStage)
  const targetIndex = STAGE_ORDER.indexOf(targetStage)

  // Only advance forward; unknown stages are treated as not advanceable
  if (targetIndex <= currentIndex || targetIndex === -1) {
    return null
  }

  const { error: updateError } = await supabase
    .from('contacts')
    .update({ lifecycle_stage: targetStage })
    .eq('tenant_id', tenantId)
    .eq('id', contactId)

  if (updateError) {
    console.error('[lifecycle] Failed to update lifecycle stage:', updateError)
    return null
  }

  await logActivity({
    tenantId,
    contactId,
    type: 'lifecycle_change',
    body: `Lifecycle stage advanced from ${currentStage} to ${targetStage}`,
    metadata: { from: currentStage, to: targetStage },
    actorType: actorId ? 'user' : 'system',
    actorId,
  })

  return targetStage
}
