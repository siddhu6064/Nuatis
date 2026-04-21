import { createClient } from '@supabase/supabase-js'

export interface CallerContext {
  matched: boolean
  contactId?: string
  name?: string
  lastContact?: string
  customFields?: Record<string, unknown>
  pipelineStage?: string
}

const LOOKUP_TIMEOUT_MS = 400

function normalizeE164(raw: string): string | null {
  if (!raw) return null
  const stripped = raw.replace(/[\s\-()]/g, '')
  if (!stripped) return null
  const withPlus = stripped.startsWith('+') ? stripped : `+${stripped}`
  if (!/^\+\d{7,15}$/.test(withPlus)) return null
  return withPlus
}

export function maskPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  const last4 = digits.slice(-4).padStart(4, '*')
  return `****${last4}`
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

/**
 * Look up an existing contact by tenant + E.164 phone number.
 * Hard 400ms timeout — never delays the call flow. Returns matched:false on
 * miss, invalid input, timeout, or any error.
 */
export async function lookupCaller(tenantId: string, phoneE164: string): Promise<CallerContext> {
  const start = Date.now()
  const phoneMasked = maskPhone(phoneE164)
  const normalized = normalizeE164(phoneE164)

  if (!normalized || !tenantId) {
    console.info('[pre-call-lookup]', {
      tenantId,
      phoneMasked,
      matched: false,
      durationMs: Date.now() - start,
      reason: !tenantId ? 'missing_tenant' : 'invalid_e164',
    })
    return { matched: false }
  }

  const digitsOnly = normalized.replace(/\+/, '')

  const queryPromise = (async (): Promise<CallerContext> => {
    try {
      const supabase = getSupabase()
      const { data, error } = await supabase
        .from('contacts')
        .select('id, full_name, last_contacted, vertical_data, lifecycle_stage')
        .eq('tenant_id', tenantId)
        .or(`phone.eq.${normalized},phone.eq.${digitsOnly}`)
        .eq('is_archived', false)
        .order('last_contacted', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error('[pre-call-lookup] db error:', error.message)
        return { matched: false }
      }
      if (!data) return { matched: false }

      const row = data as {
        id: string
        full_name: string | null
        last_contacted: string | null
        vertical_data: Record<string, unknown> | null
        lifecycle_stage: string | null
      }

      const ctx: CallerContext = { matched: true, contactId: row.id }
      if (row.full_name) ctx.name = row.full_name
      if (row.last_contacted) ctx.lastContact = row.last_contacted
      if (row.vertical_data && typeof row.vertical_data === 'object') {
        ctx.customFields = row.vertical_data
      }
      if (row.lifecycle_stage) ctx.pipelineStage = row.lifecycle_stage
      return ctx
    } catch (err) {
      console.error('[pre-call-lookup] query threw:', err)
      return { matched: false }
    }
  })()

  const timeoutPromise = new Promise<CallerContext>((resolve) => {
    setTimeout(() => resolve({ matched: false }), LOOKUP_TIMEOUT_MS)
  })

  const result = await Promise.race([queryPromise, timeoutPromise])
  const durationMs = Date.now() - start

  if (!result.matched && durationMs >= LOOKUP_TIMEOUT_MS) {
    console.warn('[pre-call-lookup] timeout — falling back to baseline prompt')
  }

  console.info('[pre-call-lookup]', {
    tenantId,
    phoneMasked,
    matched: result.matched,
    durationMs,
  })
  return result
}

/**
 * Build a system-prompt suffix describing the caller. Returns '' on miss so
 * the baseline prompt is unchanged.
 */
export function buildSystemPromptSuffix(ctx: CallerContext): string {
  if (!ctx.matched) return ''

  const truncate = (s: string): string => (s.length > 60 ? s.slice(0, 60) + '…' : s)

  const name = ctx.name ? truncate(ctx.name) : 'unknown'
  const lastContact = ctx.lastContact ? truncate(ctx.lastContact) : 'unknown'
  const stage = ctx.pipelineStage ? truncate(ctx.pipelineStage) : 'unknown'

  const fieldPairs = Object.entries(ctx.customFields ?? {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 4)
    .map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return `${k}: ${truncate(s)}`
    })
  const fieldsStr = fieldPairs.length > 0 ? fieldPairs.join(', ') : 'none'

  return (
    '\n\n--- CALLER CONTEXT ---\n' +
    'This is a returning caller.\n' +
    `Name: ${name}\n` +
    `Last contact: ${lastContact}\n` +
    `Known fields: ${fieldsStr}\n` +
    `Pipeline stage: ${stage}\n` +
    'Instruction: Greet the caller by first name. Reference their history naturally if relevant. Do NOT read out their internal data verbatim.\n'
  )
}
