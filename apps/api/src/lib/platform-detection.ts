import { getServiceClient } from './supabase.js'
import { notifyPlatformTeam } from './notify-platform-team.js'
import { ackDueAt, generatePlatformReference } from './platform-incidents.js'

/**
 * Errors within one window before an incident is declared.
 *
 * **Uncalibrated.** This is a starting number, not a measured one — nobody has
 * compared it against real traffic yet. That is precisely why auto-detection
 * ships disabled: a tracker that declares its own incidents before anyone
 * trusts its thresholds trains the team to ignore it.
 */
export const AUTO_DETECT_ERROR_THRESHOLD = 100

/**
 * Whether error-rate auto-detection is switched on.
 *
 * Exact match only. '1', 'yes' and 'TRUE' all returning false is deliberate: a
 * flag this consequential should be switched on by someone who read the docs,
 * not by someone who guessed at the spelling.
 */
export function autoDetectionEnabled(): boolean {
  return process.env['PLATFORM_AUTO_DETECT'] === 'true'
}

/**
 * Declare a SEV3 from an error-rate spike, if auto-detection is enabled.
 *
 * Returns the new incident's id, or null when nothing was declared.
 *
 * Capped at SEV3 on purpose. A machine may say "something is wrong"; only a
 * human decides that merchants cannot take money, which is what SEV1 means.
 * Someone can always raise the severity by hand once they have looked.
 */
export async function maybeDeclareFromErrorRate(input: {
  windowMinutes: number
  errorCount: number
}): Promise<string | null> {
  if (!autoDetectionEnabled()) return null
  if (input.errorCount <= AUTO_DETECT_ERROR_THRESHOLD) return null

  try {
    const supabase = getServiceClient()

    // A spike lasting twenty minutes is one incident, not four. Any open
    // auto-declared incident suppresses another.
    const { data: existing } = await supabase
      .from('platform_incidents')
      .select('id')
      .eq('component', 'api')
      .not('status', 'in', '(resolved,postmortem_due,closed)')
      .limit(1)

    if (((existing ?? []) as { id: string }[]).length > 0) return null

    const now = new Date()
    const reference = await generatePlatformReference(now)
    const due = ackDueAt('sev3', now)

    const { data: incident, error } = await supabase
      .from('platform_incidents')
      .insert({
        reference,
        severity: 'sev3',
        status: 'detected',
        title: `Error rate spike — ${input.errorCount} errors in ${input.windowMinutes}m`,
        summary:
          'Declared automatically from the error rate. Raise the severity by hand if merchants are affected.',
        component: 'api',
        detected_at: now.toISOString(),
        ack_due_at: due ? due.toISOString() : null,
      })
      .select('id')
      .single<{ id: string }>()

    if (error || !incident) {
      console.error('[platform-detection] failed to declare:', error?.message)
      return null
    }

    // actor_kind 'system', so a reader can tell a threshold fired from a person
    // deciding something was wrong.
    await supabase.from('platform_incident_events').insert({
      incident_id: incident.id,
      actor_kind: 'system',
      actor_user_id: null,
      kind: 'detected',
      detail: {
        auto: true,
        error_count: input.errorCount,
        window_minutes: input.windowMinutes,
        threshold: AUTO_DETECT_ERROR_THRESHOLD,
      },
    })

    void notifyPlatformTeam('platform_incident_auto_declared', {
      title: `SEV3 auto-declared — ${reference}`,
      body: `${input.errorCount} errors in ${input.windowMinutes} minutes crossed the ${AUTO_DETECT_ERROR_THRESHOLD} threshold.`,
      url: `/admin-console/incidents/${incident.id}`,
    }).catch((err: unknown) => {
      console.error('[platform-detection] alert failed:', err)
    })

    return incident.id
  } catch (err) {
    console.error('[platform-detection] declaration failed:', err)
    return null
  }
}
