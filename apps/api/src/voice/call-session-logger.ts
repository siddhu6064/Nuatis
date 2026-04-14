import { createClient } from '@supabase/supabase-js'
import type { ToolCallRecord } from './post-call.js'

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
  } catch (err) {
    console.error('[call-logger] error persisting voice session:', err)
  }
}
