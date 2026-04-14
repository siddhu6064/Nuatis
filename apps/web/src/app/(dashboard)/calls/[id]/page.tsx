import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { notFound } from 'next/navigation'

interface ToolCallRecord {
  name: string
  timestamp: string
}

interface VoiceSession {
  id: string
  tenant_id: string
  stream_id: string | null
  call_control_id: string | null
  caller_phone: string | null
  caller_name: string | null
  direction: string | null
  status: string | null
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
  first_response_ms: number | null
  language_detected: string | null
  outcome: string | null
  transcript: string | null
  summary: string | null
  tool_calls_made: ToolCallRecord[] | null
  booked_appointment: boolean
  appointment_id: string | null
  contact_id: string | null
  escalated: boolean
  escalation_reason: string | null
  call_quality_mos: number | null
  hangup_source: string | null
  hangup_cause: string | null
  recording_url: string | null
  recording_duration_seconds: number | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const OUTCOME_BADGES: Record<string, { label: string; bg: string; text: string }> = {
  booking_made: { label: 'Booking Made', bg: 'bg-green-50', text: 'text-green-700' },
  inquiry_answered: { label: 'Inquiry', bg: 'bg-blue-50', text: 'text-blue-700' },
  escalated: { label: 'Escalated', bg: 'bg-amber-50', text: 'text-amber-700' },
  abandoned: { label: 'Abandoned', bg: 'bg-red-50', text: 'text-red-600' },
  general: { label: 'General', bg: 'bg-gray-100', text: 'text-gray-600' },
}

const TOOL_LABELS: Record<string, string> = {
  get_business_hours: 'Checked Business Hours',
  lookup_contact: 'Looked Up Contact',
  check_availability: 'Checked Availability',
  book_appointment: 'Booked Appointment',
  escalate_to_human: 'Escalated to Human',
  end_call: 'Ended Call',
}

const LANG_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Spanish',
  hi: 'Hindi',
  te: 'Telugu',
}

function formatPhone(phone: string | null): string {
  if (!phone) return 'Unknown'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m} min ${s} sec`
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function CallDetailPage({ params }: Props) {
  const { id } = await params
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()
  const { data: call, error } = await supabase
    .from('voice_sessions')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single<VoiceSession>()

  if (error || !call) notFound()

  const badge = OUTCOME_BADGES[call.outcome ?? 'general'] ?? OUTCOME_BADGES.general
  const toolCalls: ToolCallRecord[] = Array.isArray(call.tool_calls_made)
    ? call.tool_calls_made
    : []

  return (
    <div className="px-8 py-8 max-w-4xl">
      {/* Back link */}
      <Link
        href="/calls"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors mb-6"
      >
        <span>&larr;</span> Back to Call Log
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
            <span className="text-teal-700 text-sm font-bold">
              {(call.caller_name ?? call.caller_phone ?? '?').charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">
                {call.caller_name || formatPhone(call.caller_phone)}
              </h1>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge!.bg} ${badge!.text}`}
              >
                {badge!.label}
              </span>
            </div>
            {call.caller_name && (
              <p className="text-sm text-gray-500 mt-0.5">{formatPhone(call.caller_phone)}</p>
            )}
            <p className="text-sm text-gray-400 mt-1">
              {new Date(call.started_at).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              <span className="mx-1">&middot;</span>
              {new Date(call.started_at).toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
              })}
              <span className="mx-1">&middot;</span>
              {formatDuration(call.duration_seconds)}
            </p>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Duration</p>
          <p className="text-lg font-semibold text-gray-900">
            {formatDuration(call.duration_seconds)}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">First Response</p>
          <p className="text-lg font-semibold text-gray-900">
            {call.first_response_ms != null ? `${call.first_response_ms}ms` : '--'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Language</p>
          <p className="text-lg font-semibold text-gray-900">
            {call.language_detected
              ? (LANG_NAMES[call.language_detected] ?? call.language_detected.toUpperCase())
              : '--'}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Call Quality</p>
          <p className="text-lg font-semibold text-gray-900">
            {call.call_quality_mos != null
              ? `${Number(call.call_quality_mos).toFixed(2)} MOS`
              : '--'}
          </p>
        </div>
      </div>

      {/* Tool calls timeline */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-8">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Tool Calls</h2>
        {toolCalls.length === 0 ? (
          <p className="text-sm text-gray-400">No tool calls during this session</p>
        ) : (
          <div className="space-y-0">
            {toolCalls.map((tc, i) => (
              <div key={i} className="flex items-start gap-3 relative">
                {/* Vertical line */}
                {i < toolCalls.length - 1 && (
                  <div className="absolute left-[7px] top-4 w-px h-full bg-gray-100" />
                )}
                {/* Dot */}
                <div className="w-[15px] h-[15px] rounded-full border-2 border-teal-500 bg-white shrink-0 mt-0.5 relative z-10" />
                <div className="pb-4 min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {TOOL_LABELS[tc.name] ?? tc.name}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(tc.timestamp).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                      hour12: true,
                    })}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Booking / escalation details */}
        {call.booked_appointment && call.appointment_id && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-50 text-green-700">
                Appointment Booked
              </span>
              <Link
                href={`/appointments`}
                className="text-xs text-teal-600 font-medium hover:text-teal-700"
              >
                View appointment &rarr;
              </Link>
            </div>
          </div>
        )}
        {call.escalated && call.escalation_reason && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
                Escalated
              </span>
              <span className="text-xs text-gray-500">{call.escalation_reason}</span>
            </div>
          </div>
        )}
      </div>

      {/* Call Recording */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-8">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Call Recording</h2>
        {call.recording_url ? (
          <div>
            <audio controls src={call.recording_url} className="w-full" />
            {call.recording_duration_seconds != null && (
              <p className="text-xs text-gray-400 mt-1">
                Duration: {Math.floor(call.recording_duration_seconds / 60)}m{' '}
                {call.recording_duration_seconds % 60}s
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">Recording not available</p>
        )}
      </div>

      {/* Transcript */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 mb-8">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Transcript</h2>
        {call.transcript ? (
          <pre className="text-sm text-gray-600 whitespace-pre-wrap font-sans leading-relaxed">
            {call.transcript}
          </pre>
        ) : call.recording_url ? (
          <p className="text-sm text-gray-400">Transcript processing&hellip;</p>
        ) : (
          <p className="text-sm text-gray-400">
            No recording or transcript available &mdash; audio-only mode
          </p>
        )}
      </div>

      {/* Call metadata */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">Call Metadata</h2>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
          <div>
            <dt className="text-xs text-gray-400">Stream ID</dt>
            <dd className="text-sm text-gray-600 font-mono truncate">{call.stream_id ?? '--'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">Call Control ID</dt>
            <dd className="text-sm text-gray-600 font-mono truncate">
              {call.call_control_id ?? '--'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">Hangup Source</dt>
            <dd className="text-sm text-gray-600">{call.hangup_source ?? '--'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">Hangup Cause</dt>
            <dd className="text-sm text-gray-600">{call.hangup_cause ?? '--'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">Direction</dt>
            <dd className="text-sm text-gray-600 capitalize">{call.direction ?? '--'}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">Status</dt>
            <dd className="text-sm text-gray-600 capitalize">{call.status ?? '--'}</dd>
          </div>
          {call.contact_id && (
            <div>
              <dt className="text-xs text-gray-400">Contact</dt>
              <dd>
                <Link
                  href="/contacts"
                  className="text-sm text-teal-600 font-medium hover:text-teal-700"
                >
                  View contact &rarr;
                </Link>
              </dd>
            </div>
          )}
          {call.appointment_id && (
            <div>
              <dt className="text-xs text-gray-400">Appointment</dt>
              <dd>
                <Link
                  href="/appointments"
                  className="text-sm text-teal-600 font-medium hover:text-teal-700"
                >
                  View appointment &rarr;
                </Link>
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}
