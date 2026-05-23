import { createClient } from '@supabase/supabase-js'
import Stripe from 'stripe'
import type { ToolCallRecord } from './post-call.js'
import { enqueueMayaMemoryExtraction } from '../lib/maya-memory-queue.js'

export interface VoiceSessionParams {
  tenantId: string
  streamId: string
  callControlId: string
  callerPhone: string
  callerName?: string
  duration: number
  firstResponseMs: number | null
  bookedAppointment: boolean
  appointmentId: string | null
  contactId: string | null
  escalated: boolean
  escalationReason: string | null
  vertical: string
  toolCallsMade: ToolCallRecord[]
  hangupSource: string | null
  hangupCause: string | null
  callQualityMos: number | null
  language?: string
  startedAt: Date
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function determineOutcome(params: VoiceSessionParams): string {
  if (params.bookedAppointment) return 'booking_made'
  if (params.escalated) return 'escalated'
  if (params.duration < 5) return 'abandoned'
  return 'inquiry_answered'
}

export async function persistVoiceSession(params: VoiceSessionParams): Promise<void> {
  try {
    const supabase = getSupabase()
    const outcome = determineOutcome(params)

    const { data, error } = await supabase
      .from('voice_sessions')
      .insert({
        tenant_id: params.tenantId,
        stream_id: params.streamId || null,
        call_control_id: params.callControlId || null,
        caller_phone: params.callerPhone || null,
        caller_name: params.callerName || null,
        direction: 'inbound',
        status: 'completed',
        started_at: params.startedAt.toISOString(),
        ended_at: new Date().toISOString(),
        duration_seconds: params.duration,
        first_response_ms: params.firstResponseMs,
        latency_ms: params.firstResponseMs,
        outcome,
        tool_calls_made: params.toolCallsMade,
        booked_appointment: params.bookedAppointment,
        appointment_id: params.appointmentId,
        contact_id: params.contactId,
        escalated: params.escalated,
        escalation_reason: params.escalationReason,
        call_quality_mos: params.callQualityMos,
        hangup_source: params.hangupSource,
        hangup_cause: params.hangupCause,
        language_detected: params.language ?? 'en',
        metadata: { vertical: params.vertical },
      })
      .select('id')
      .single()

    if (error) {
      console.error(`[call-logger] voice session insert error: ${error.message}`)
      return
    }

    console.info(
      `[call-logger] voice session persisted: id=${data.id} outcome=${outcome} duration=${params.duration}s tenant=${params.tenantId}`
    )

    // Enqueue memory extraction — fire and forget, must never affect call flow
    enqueueMayaMemoryExtraction(params.tenantId, data.id, params.callerPhone)

    // Maya minute tracking + Stripe overage reporting.
    // NEVER throw out of this — call-session persistence has already happened
    // and billing errors must not poison the call pipeline.
    try {
      await trackMayaMinutes(supabase, params.tenantId, params.duration)
    } catch (err) {
      console.warn('[call-logger] maya minute tracking failed:', err)
    }
  } catch (err) {
    console.error('[call-logger] error persisting voice session:', err)
  }
}

interface TenantBillingSnapshot {
  maya_minutes_used: number | null
  maya_minutes_limit: number | null
  stripe_overage_item_id: string | null
}

/**
 * Pure helper — given prior usage, this call's minutes, and the tier's
 * limit, returns how many minutes of *this call* fell into overage.
 * Returns 0 when no overage should be reported (e.g. unlimited tier, or
 * the call stayed inside the limit).
 */
export function calcOverageMinutes(
  prevUsed: number,
  callMinutes: number,
  limit: number | null
): number {
  if (limit == null) return 0
  const newUsed = prevUsed + callMinutes
  if (newUsed <= limit) return 0
  if (prevUsed >= limit) return callMinutes
  return newUsed - limit
}

// Use a loose type for the supabase client to avoid version-skew issues
// across the SDK's nested generics. The shape we actually need is small.
type LooseSupabase = ReturnType<typeof createClient<any, any, any>> // eslint-disable-line @typescript-eslint/no-explicit-any

async function trackMayaMinutes(
  supabase: LooseSupabase,
  tenantId: string,
  durationSeconds: number
): Promise<void> {
  const durationMins = Math.max(1, Math.ceil(durationSeconds / 60))

  const { data: tenant } = await supabase
    .from('tenants')
    .select('maya_minutes_used, maya_minutes_limit, stripe_overage_item_id')
    .eq('id', tenantId)
    .maybeSingle<TenantBillingSnapshot>()

  if (!tenant) return

  const prevUsed = tenant.maya_minutes_used ?? 0
  const newUsed = prevUsed + durationMins

  await supabase.from('tenants').update({ maya_minutes_used: newUsed }).eq('id', tenantId)

  const overageThisCall = calcOverageMinutes(prevUsed, durationMins, tenant.maya_minutes_limit)
  if (overageThisCall === 0) return
  if (!tenant.stripe_overage_item_id) return

  const stripeKey = process.env['STRIPE_SECRET_KEY']
  if (!stripeKey) return
  const stripe = new Stripe(stripeKey)

  // The .createUsageRecord helper moved between Stripe SDK versions; use
  // the resource directly via the SubscriptionItems namespace to stay
  // compatible across v22.x.
  const subscriptionItems = (
    stripe as unknown as {
      subscriptionItems: {
        createUsageRecord: (
          itemId: string,
          params: { quantity: number; timestamp: number; action: string }
        ) => Promise<unknown>
      }
    }
  ).subscriptionItems

  await subscriptionItems.createUsageRecord(tenant.stripe_overage_item_id, {
    quantity: overageThisCall,
    timestamp: Math.floor(Date.now() / 1000),
    action: 'increment',
  })

  console.info(
    `[call-logger] reported ${overageThisCall}m Maya overage to Stripe item=${tenant.stripe_overage_item_id} tenant=${tenantId}`
  )
}
