import { getServiceClient } from './supabase.js'

interface ShiftRow {
  user_id: string
  starts_at: string
  ends_at: string
  is_override: boolean
}

/**
 * Who should pick up an incident detected at `when`.
 *
 * Shifts are half-open intervals `[starts_at, ends_at)`, so a handover at 17:00
 * belongs to the incoming shift and two adjacent shifts can never both claim
 * the same instant.
 *
 * Returns null when nobody is on call, deliberately rather than falling back to
 * an arbitrary person: a wrong name on an incident is worse than an empty
 * field, because it looks owned and so nobody picks it up.
 */
export async function whoIsOnCallAt(when: Date): Promise<string | null> {
  try {
    const supabase = getServiceClient()
    const at = when.toISOString()

    const { data, error } = await supabase
      .from('platform_oncall_shifts')
      .select('user_id, starts_at, ends_at, is_override')
      .lte('starts_at', at)
      .gt('ends_at', at)

    if (error) {
      console.error('[oncall] rota query failed:', error.message)
      return null
    }

    const covering = (data ?? []) as ShiftRow[]
    if (covering.length === 0) return null

    // An override wins over a regular shift for the same instant, whichever
    // order the rows came back in.
    const override = covering.find((s) => s.is_override)
    return (override ?? covering[0]!).user_id
  } catch (err) {
    console.error('[oncall] rota lookup failed:', err)
    return null
  }
}
