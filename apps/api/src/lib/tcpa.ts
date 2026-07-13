import { createClient } from '@supabase/supabase-js'
import { logAuditEvent } from '../middleware/audit-logger.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

export async function checkTcpaOptIn(contactId: string, tenantId: string): Promise<boolean> {
  try {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('contacts')
      .select('sms_opt_in')
      .eq('id', contactId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (error) {
      console.error(`[tcpa] checkTcpaOptIn error contactId=${contactId}:`, error)
      return false
    }

    if (!data || (data as { sms_opt_in?: boolean | null }).sms_opt_in !== true) {
      console.info(`[tcpa] SMS suppressed contactId=${contactId} — sms_opt_in not true`)
      return false
    }

    return true
  } catch (err) {
    console.error(`[tcpa] checkTcpaOptIn unexpected error contactId=${contactId}:`, err)
    return false
  }
}

export async function grantTcpaOptIn(
  contactId: string,
  tenantId: string,
  appUserId?: string | null,
  /** NextAuth token subject — keeps the granter identifiable when the
   *  appUserId claim is missing (stale pre-claim sessions). */
  actorSub?: string | null
): Promise<void> {
  try {
    const supabase = getSupabase()
    const { error } = await supabase
      .from('contacts')
      .update({ sms_opt_in: true })
      .eq('id', contactId)
      .eq('tenant_id', tenantId)

    if (error) {
      console.error(`[tcpa] grantTcpaOptIn update error contactId=${contactId}:`, error)
    } else {
      console.info(`[tcpa] SMS opt-in granted contactId=${contactId}`)
      // Consent-grant audit trail. logAuditEvent swallows its own errors and
      // the outer catch backstops it — a logging failure never blocks the send.
      try {
        // user_id is never null — 'unresolved' keeps the column greppable in a
        // "who granted consent" query; details carry the token subject so the
        // granter stays identifiable even without the domain id.
        await logAuditEvent({
          tenantId,
          userId: appUserId ?? 'unresolved',
          action: 'sms_opt_in_granted',
          resourceType: 'contact',
          resourceId: contactId,
          details: {
            rationale:
              'agent-initiated consent — deliberate SMS send to a contact with no explicit opt-out establishes a business relationship under TCPA',
            actor_appuserid: appUserId ?? null,
            actor_sub: actorSub ?? null,
          },
        })
      } catch (auditErr) {
        console.warn(`[tcpa] opt-in audit log failed contactId=${contactId}:`, auditErr)
      }
    }
  } catch (err) {
    console.error(`[tcpa] grantTcpaOptIn unexpected error contactId=${contactId}:`, err)
  }
}
