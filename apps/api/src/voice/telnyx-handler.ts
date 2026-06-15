import alawmulaw from 'alawmulaw'
const { mulaw } = alawmulaw
import type { WebSocketServer, WebSocket } from 'ws'
import { createClient } from '@supabase/supabase-js'
import { createGeminiLiveSession } from './gemini-live.js'
import { logCall } from './call-logger.js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'
import { handlePostCall, callSessionState } from './post-call.js'
import { persistVoiceSession } from './call-session-logger.js'
import type { LatencyBreakdown } from './maya-latency-tracker.js'
import { lookupCaller, buildSystemPromptSuffix, type CallerContext } from './pre-call-lookup.js'
import { Sentry } from '../lib/sentry.js'
import type { BusinessProfile } from '@nuatis/shared'
import { getTenantByPhoneNumber } from '../lib/telnyx-tenant-lookup.js'

// ── Hangup data registry ─────────────────────────────────────────────────────
// Populated by the call.hangup webhook, consumed by handleCallEnd.

export interface HangupData {
  hangupSource: string | null
  hangupCause: string | null
  callQualityMos: number | null
}

export const hangupDataStore = new Map<string, HangupData>()

// ── Audio transcoding ─────────────────────────────────────────────────────────

/**
 * Telnyx → Gemini
 * Decodes µ-law PCMU (8 kHz) to linear PCM 16-bit (16 kHz) by decoding
 * then duplicating each sample to upsample from 8 kHz to 16 kHz.
 */
export function pcmuToLinear16(pcmuBuffer: Buffer): Buffer {
  const samples8k = mulaw.decode(pcmuBuffer) // Int16Array at 8 kHz
  const samples16k = new Int16Array(samples8k.length * 2)
  for (let i = 0; i < samples8k.length; i++) {
    samples16k[i * 2] = samples8k[i]!
    samples16k[i * 2 + 1] = samples8k[i]!
  }
  return Buffer.from(samples16k.buffer)
}

/**
 * µ-law encoder: converts a signed 16-bit linear PCM sample to a µ-law byte.
 */
function encodeMuLaw(sample: number): number {
  const BIAS = 0x84
  const CLIP = 32767
  let sign = 0
  if (sample < 0) {
    sign = 0x80
    sample = -sample
  }
  if (sample > CLIP) sample = CLIP
  sample += BIAS
  let exponent = 7
  let expMask = 0x4000
  while ((sample & expMask) === 0 && exponent > 0) {
    exponent--
    expMask >>= 1
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f
  return ~(sign | (exponent << 4) | mantissa) & 0xff
}

/**
 * Gemini → Telnyx
 * Converts linear PCM 16-bit (24 kHz) to µ-law PCMU (8 kHz) by
 * taking every 3rd sample (3:1 naive downsample) then µ-law encoding.
 */
export function linear16ToPcmu(pcm24: Buffer): Buffer {
  const outputLen = Math.floor(pcm24.byteLength / 6)
  const out = Buffer.allocUnsafe(outputLen)
  for (let i = 0, j = 0; j < outputLen; i += 6, j++) {
    const sample = pcm24.readInt16LE(i)
    out[j] = encodeMuLaw(sample)
  }
  return out
}

// ── Tenant lookup ─────────────────────────────────────────────────────────────

/**
 * Parse TELNYX_TENANT_MAP env var.
 * Format: "+15127376388:tenant-uuid,+18005551234:other-uuid"
 */
export function parseTenantMap(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of raw.split(',')) {
    const [phone, tenantId] = entry.trim().split(':')
    if (phone && tenantId) map.set(phone.trim(), tenantId.trim())
  }
  return map
}

export function lookupTenant(toNumber: string, tenantMap: Map<string, string>): string | undefined {
  return tenantMap.get(toNumber)
}

// ── After-hours helpers ───────────────────────────────────────────────────────

interface AfterHoursDayConfig {
  open: string
  close: string
  enabled: boolean
}

interface LocationAfterHoursConfig {
  afterHoursEnabled: boolean
  businessHours: Record<string, AfterHoursDayConfig>
  afterHoursMessage: string
  timezone: string
}

interface LocationConfig {
  afterHoursConfig: LocationAfterHoursConfig | null
  businessProfile: BusinessProfile | null
  kbFiles: Array<{ file_name: string; extracted_text: string }> | null
  kbUrls: Array<{ url: string; extracted_text: string | null }> | null
  timezone: string
}

function isAfterHoursNow(
  businessHours: Record<string, AfterHoursDayConfig>,
  timezone: string
): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date())
    const weekdayRaw = parts.find((p) => p.type === 'weekday')?.value ?? ''
    const dayKey = weekdayRaw.slice(0, 3).toLowerCase() // 'sun','mon',...'sat'
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00'
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
    const currentTime = `${hour}:${minute}`

    const dayConfig = businessHours[dayKey]
    if (!dayConfig) return false
    if (!dayConfig.enabled) return true
    return currentTime < dayConfig.open || currentTime >= dayConfig.close
  } catch {
    return false
  }
}

async function getLocationConfig(tenantId: string): Promise<LocationConfig> {
  const FALLBACK: LocationConfig = {
    afterHoursConfig: null,
    businessProfile: null,
    kbFiles: null,
    kbUrls: null,
    timezone: 'America/Chicago',
  }
  const FALLBACK_MESSAGE =
    'We are currently closed. Please leave your name and number and we will call you back during business hours.'
  try {
    const url = process.env['SUPABASE_URL']
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
    if (!url || !key) return FALLBACK

    const supabase = createClient(url, key)
    let timedOut = false
    const timeout = new Promise<LocationConfig>((resolve) =>
      setTimeout(() => {
        timedOut = true
        resolve(FALLBACK)
      }, 400)
    )

    const query = (async (): Promise<LocationConfig> => {
      try {
        const [locResult, kbResult, kbUrlResult] = await Promise.all([
          supabase
            .from('locations')
            .select(
              'after_hours_enabled, business_hours, after_hours_message, timezone, business_profile'
            )
            .eq('tenant_id', tenantId)
            .eq('is_primary', true)
            .single(),
          supabase
            .from('maya_kb_files')
            .select('file_name, extracted_text')
            .eq('tenant_id', tenantId)
            .eq('status', 'ready'),
          supabase
            .from('maya_kb_urls')
            .select('url, extracted_text')
            .eq('tenant_id', tenantId)
            .eq('status', 'ready'),
        ])

        if (timedOut || locResult.error || !locResult.data) return FALLBACK

        const d = locResult.data as {
          after_hours_enabled?: boolean
          business_hours?: Record<string, AfterHoursDayConfig>
          after_hours_message?: string
          timezone?: string
          business_profile?: BusinessProfile | null
        }

        const afterHoursConfig: LocationAfterHoursConfig | null = d.after_hours_enabled
          ? {
              afterHoursEnabled: true,
              businessHours: d.business_hours ?? {},
              afterHoursMessage: d.after_hours_message ?? FALLBACK_MESSAGE,
              timezone: d.timezone ?? 'America/Chicago',
            }
          : null

        const businessProfile =
          d.business_profile && Object.keys(d.business_profile).length > 0
            ? d.business_profile
            : null

        const rawKb = (kbResult.data ?? []) as Array<{
          file_name: string
          extracted_text: string | null
        }>
        const kbFiles = rawKb.filter(
          (f): f is { file_name: string; extracted_text: string } =>
            typeof f.extracted_text === 'string' && f.extracted_text.length > 0
        )

        const rawKbUrls = (kbUrlResult.data ?? []) as Array<{
          url: string
          extracted_text: string | null
        }>

        return {
          afterHoursConfig,
          businessProfile,
          kbFiles: kbFiles.length > 0 ? kbFiles : null,
          kbUrls: rawKbUrls.length > 0 ? rawKbUrls : null,
          timezone: d.timezone ?? 'America/Chicago',
        }
      } catch {
        return FALLBACK
      }
    })()

    return Promise.race([query, timeout])
  } catch {
    return FALLBACK
  }
}

function buildAfterHoursSystemPrefix(msg: string): string {
  return (
    `IMPORTANT: This business is currently CLOSED.\n` +
    `Do NOT attempt to book appointments.\n` +
    `Instead, tell the caller: "${msg}"\n` +
    `Then ask for their name and phone number and tell them someone will call back during business hours.\n` +
    `End the call politely after collecting their information.`
  )
}

/**
 * Fetch tenant config from Supabase. Returns safe fallback on any error
 * so voice calls never crash due to a failed DB lookup. A hard 400ms
 * timeout guards against slow Supabase responses delaying call pickup —
 * the caller hears the fallback greeting rather than dead air.
 */
export async function getTenantConfig(
  tenantId: string
): Promise<{ businessName: string; vertical: string; product: 'maya_only' | 'suite' }> {
  const FALLBACK = {
    businessName: 'the business',
    vertical: 'sales_crm',
    product: 'suite' as const,
  }
  try {
    const url = process.env['SUPABASE_URL']
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
    if (!url || !key) return FALLBACK

    const supabase = createClient(url, key)
    type Result = { businessName: string; vertical: string; product: 'maya_only' | 'suite' }
    let timedOut = false
    const timeout = new Promise<Result>((resolve) =>
      setTimeout(() => {
        timedOut = true
        console.warn(
          `[telnyx-handler] getTenantConfig 400ms timeout — tenant=${tenantId} (using fallback)`
        )
        resolve(FALLBACK)
      }, 400)
    )

    const query: Promise<Result> = (async () => {
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('name, vertical, product')
          .eq('id', tenantId)
          .single()
        if (timedOut) return FALLBACK
        if (error || !data) return FALLBACK
        const d = data as { name?: string; vertical?: string; product?: string }
        return {
          businessName: d.name || FALLBACK.businessName,
          vertical: d.vertical || FALLBACK.vertical,
          product: (d.product === 'maya_only' ? 'maya_only' : 'suite') as 'maya_only' | 'suite',
        }
      } catch {
        return FALLBACK
      }
    })()

    return Promise.race([query, timeout])
  } catch {
    return FALLBACK
  }
}

// ── Telnyx message types ──────────────────────────────────────────────────────

interface TelnyxStartEvent {
  event: 'start'
  stream_id: string
  start: {
    call_sid: string
    from: string
    to: string
    custom_headers?: Array<{ name: string; value: string }>
  }
}

interface TelnyxMediaEvent {
  event: 'media'
  media: { track: string; payload: string }
}

interface TelnyxStopEvent {
  event: 'stop'
  stop: { call_sid: string }
}

type TelnyxEvent = TelnyxStartEvent | TelnyxMediaEvent | TelnyxStopEvent

// ── Pre-warm registry ────────────────────────────────────────────────────────

interface PrewarmedEntry {
  session: Awaited<ReturnType<typeof createGeminiLiveSession>>
  tenantId: string
  vertical: string
  businessName: string
  product: 'maya_only' | 'suite'
  callControlId: string
  cleanupTimer: ReturnType<typeof setTimeout>
  callerContext?: CallerContext
  contextSuffix?: string
}

export const prewarmedSessions = new Map<string, PrewarmedEntry>()
const streamWaiters = new Map<string, (entry: PrewarmedEntry) => void>()

// ── Outbound call registry ────────────────────────────────────────────────────

export interface OutboundCallMeta {
  tenantId: string
  contactId: string
  jobId: string
  contactName: string | null
  callContext: string
}

const outboundCallRegistry = new Map<string, OutboundCallMeta>()

export function registerOutboundCall(callControlId: string, meta: OutboundCallMeta): void {
  outboundCallRegistry.set(callControlId, meta)
  // Auto-cleanup after 10 minutes (call should have connected or failed by then)
  setTimeout(
    () => {
      outboundCallRegistry.delete(callControlId)
    },
    10 * 60 * 1000
  )
}

function buildOutboundPromptSuffix(meta: OutboundCallMeta, businessName: string): string {
  const name = meta.contactName ?? 'there'
  return `
--- OUTBOUND CALL MODE ---
You are making an OUTBOUND call. You called ${name} on behalf of ${businessName}.
Call purpose: ${meta.callContext}

OPENING: Start immediately with: "Hi, may I speak with ${name}?" [wait for response] "Hi ${name}, this is Maya calling from ${businessName}. ${meta.callContext}"

RULES:
- If they say it's a bad time, apologize and offer to call back later, then end the call politely using the end_call tool.
- If there is 20+ seconds of silence after connecting, assume voicemail. Leave a brief message: "Hi ${name}, this is Maya from ${businessName}. ${meta.callContext} Please call us back at your convenience. Have a great day!" Then use end_call.
- Never say you are "receiving" a call — you placed this call.
--- END OUTBOUND CALL MODE ---`
}

function buildDepartmentContextSuffix(department: string): string {
  switch (department) {
    case 'scheduling':
      return `\n\n--- DEPARTMENT ROUTING ---\nThis call came in on the SCHEDULING line. Prioritize booking and managing appointments.\n--- END DEPARTMENT ROUTING ---`
    case 'billing':
      return `\n\n--- DEPARTMENT ROUTING ---\nThis call came in on the BILLING line. Help with payment questions, invoices, and account balances.\n--- END DEPARTMENT ROUTING ---`
    case 'sales':
      return `\n\n--- DEPARTMENT ROUTING ---\nThis call came in on the SALES line. Focus on qualifying leads and converting prospects into customers.\n--- END DEPARTMENT ROUTING ---`
    case 'support':
      return `\n\n--- DEPARTMENT ROUTING ---\nThis call came in on the SUPPORT line. Help resolve issues patiently and thoroughly.\n--- END DEPARTMENT ROUTING ---`
    case 'general':
    case 'maya':
    default:
      return '' // No extra context — use default Maya behavior
  }
}

/**
 * Pre-warm a Gemini Live session before answering the call.
 * Resolves when setupComplete fires or after 3500ms (whichever first).
 * If fromNumber is provided, caller lookup runs in parallel with tenant config
 * so personalized context can be attached to the session.
 */
export async function prewarmGemini(
  callControlId: string,
  toNumber: string,
  fromNumber?: string
): Promise<void> {
  let tenantId: string | null = null
  let prewarmDepartment = 'general'

  const phoneResult = await getTenantByPhoneNumber(toNumber)
  if (phoneResult) {
    tenantId = phoneResult.tenantId
    prewarmDepartment = phoneResult.department
  } else {
    // Fallback to dev tenant for local testing
    tenantId = process.env['VOICE_DEV_TENANT_ID'] ?? 'unknown'
  }

  const lookupPromise: Promise<CallerContext> =
    fromNumber && tenantId !== 'unknown'
      ? lookupCaller(tenantId, fromNumber)
      : Promise.resolve({ matched: false })

  const { businessName, vertical, product } = await getTenantConfig(tenantId)
  const safeName = businessName || 'the business'
  const safeVertical = vertical || 'sales_crm'

  // Check after-hours mode in parallel with caller lookup
  const [callerContext, locationConfig] = await Promise.all([
    lookupPromise,
    getLocationConfig(tenantId),
  ])
  const contextSuffix = buildSystemPromptSuffix(callerContext, fromNumber)
  const deptSuffix = buildDepartmentContextSuffix(prewarmDepartment)
  const fullContextSuffix = contextSuffix + deptSuffix
  const { afterHoursConfig, businessProfile, kbUrls } = locationConfig

  let afterHoursPrefix: string | undefined
  if (
    afterHoursConfig &&
    isAfterHoursNow(afterHoursConfig.businessHours, afterHoursConfig.timezone)
  ) {
    afterHoursPrefix = buildAfterHoursSystemPrefix(afterHoursConfig.afterHoursMessage)
    console.info(
      `[telnyx-handler] after-hours mode active for tenant=${tenantId} — overriding system prompt`
    )
  }

  // Normalize caller phone to E.164 for memory lookup
  const callerPhoneE164 = fromNumber
    ? fromNumber.trim().startsWith('+')
      ? fromNumber.trim()
      : `+${fromNumber.trim()}`
    : undefined

  const session = await createGeminiLiveSession(
    tenantId,
    safeVertical,
    safeName,
    callControlId,
    product,
    fullContextSuffix,
    callerContext.contactId ?? null,
    afterHoursPrefix,
    businessProfile,
    locationConfig.kbFiles,
    kbUrls ?? null,
    callerPhoneE164,
    locationConfig.timezone
  )

  return new Promise<void>((resolve) => {
    let resolved = false
    function done(): void {
      if (resolved) return
      resolved = true
      resolve()
    }
    session.onSetupComplete(done)
    setTimeout(() => {
      if (!resolved) {
        console.warn('[prewarm] setupComplete timeout after 3500ms — answering anyway')
      }
      done()
    }, 3500)

    const cleanupTimer = setTimeout(() => {
      if (prewarmedSessions.get(callControlId)?.session === session) {
        console.warn(`[prewarm] unclaimed session for ${callControlId} — closing`)
        prewarmedSessions.delete(callControlId)
        session.close()
      }
    }, 30_000)

    prewarmedSessions.set(callControlId, {
      session,
      tenantId,
      vertical: safeVertical,
      businessName: safeName,
      product,
      callControlId,
      cleanupTimer,
      callerContext,
      contextSuffix: fullContextSuffix,
    })
  })
}

/**
 * Rekey a pre-warmed session from callControlId to streamId.
 * Called after streaming_start returns the stream_id.
 */
export function rekeyPrewarmedSession(callControlId: string, streamId: string): void {
  const entry = prewarmedSessions.get(callControlId)
  if (!entry) {
    console.warn(`[prewarm] rekey failed — no session for ${callControlId}`)
    return
  }
  prewarmedSessions.delete(callControlId)
  clearTimeout(entry.cleanupTimer)
  const newTimer = setTimeout(() => {
    if (prewarmedSessions.get(streamId)?.session === entry.session) {
      console.warn(`[prewarm] unclaimed session for stream ${streamId} — closing`)
      prewarmedSessions.delete(streamId)
      entry.session.close()
    }
  }, 30_000)
  const newEntry = { ...entry, cleanupTimer: newTimer }
  prewarmedSessions.set(streamId, newEntry)
  console.info(`[prewarm] rekeyed ${callControlId} → ${streamId}`)

  const waiter = streamWaiters.get(streamId)
  if (waiter) {
    streamWaiters.delete(streamId)
    waiter(newEntry)
  }
}

// ── WebSocket handler ─────────────────────────────────────────────────────────

export function registerVoiceWebSocket(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket) => {
    console.info('[telnyx-handler] WebSocket connection opened')

    let geminiSession: Awaited<ReturnType<typeof createGeminiLiveSession>> | null = null
    let tenantId: string | null = null
    let streamId: string | null = null
    let callStartTime: number | null = null
    let sessionReady = false
    let isCallActive = true
    const mediaQueue: Buffer[] = []
    let firstAudioReceivedAt: number | null = null
    let firstAudioSentAt: number | null = null
    let reconnectAttempts = 0
    const MAX_RECONNECTS = 2
    let mayaSpeakingUntil = 0
    let callControlId: string | null = null
    let callerId: string | null = null
    let sessionVertical: string | null = null
    let sessionBusinessName: string | null = null
    let sessionProduct: 'maya_only' | 'suite' = 'suite'
    let preCallContactId: string | null = null
    let preCallContextSuffix = ''
    let callDepartment = 'general'
    let startEventReceived = false

    // Warn if Telnyx never sends a start event — helps diagnose stream setup failures.
    const startEventTimeout = setTimeout(() => {
      if (!startEventReceived && isCallActive) {
        console.warn(
          '[telnyx-handler] no start event within 10s of connection open — stream may have failed'
        )
      }
    }, 10_000)

    // Azure Container Apps kills idle WebSocket connections after 4 minutes.
    // Ping every 30 seconds to keep the connection alive during call pauses.
    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.ping()
      }
    }, 30_000)

    ws.on('close', () => {
      clearTimeout(startEventTimeout)
      clearInterval(pingInterval)
      if (!startEventReceived) {
        console.warn('[telnyx-handler] WebSocket closed before start event was received')
      }
    })

    ws.on('message', async (data: Buffer) => {
      let event: TelnyxEvent
      try {
        event = JSON.parse(data.toString()) as TelnyxEvent
      } catch {
        console.warn(
          '[telnyx-handler] received non-JSON message, ignoring:',
          data.toString().slice(0, 120)
        )
        return
      }

      // Log every message type for diagnostics (media excluded — too frequent)
      if (event.event !== 'media') {
        console.info(`[telnyx-handler] message: event=${event.event}`)
      }

      if (event.event === 'start') {
        startEventReceived = true
        clearTimeout(startEventTimeout)
        // Log raw start payload to diagnose outbound tenant resolution and
        // confirm whether custom_headers are present in the WebSocket stream.
        console.info('[telnyx-handler] raw start event:', JSON.stringify(event.start))

        streamId = event.stream_id ?? null
        const toNumber = event.start.to

        callStartTime = Date.now()
        callControlId = event.start.call_sid ?? null
        callerId = event.start.from ?? null

        // Extract custom headers first — needed to determine call direction
        // before tenant lookup so we use the correct number.
        // NOTE: event.start.call_sid is the call_leg_id, not call_control_id, so the
        // outboundCallRegistry (keyed by call_control_id) cannot be used here for tenant lookup.
        const customHeaders: Array<{ name: string; value: string }> =
          event.start.custom_headers ?? []
        const headerCallType = customHeaders.find((h) => h.name === 'X-Call-Type')?.value
        const headerTenantId = customHeaders.find((h) => h.name === 'X-Tenant-Id')?.value

        // For inbound calls our Telnyx number is TO (the number the caller dialed).
        // For outbound calls our Telnyx number is FROM (we dialed the contact).
        // Always look up by our number so getTenantByPhoneNumber can match.
        const ourNumber = headerCallType === 'outbound' ? event.start.from : toNumber

        // Try DB lookup first, then env var fallback
        const phoneResult = await getTenantByPhoneNumber(ourNumber)
        if (phoneResult) {
          tenantId = phoneResult.tenantId
          callDepartment = phoneResult.department
        } else {
          console.warn(
            `[telnyx-handler] No tenant found for number ${ourNumber} — using dev fallback`
          )
          tenantId = process.env['VOICE_DEV_TENANT_ID'] ?? 'unknown'
        }

        // VOICE-01: the X-Tenant-Id custom header is client-controllable and must
        // never override server-side tenant resolution. Tenant is resolved above
        // from the phone-number lookup and (for outbound) the call registry below.
        if (headerTenantId) {
          console.warn(
            '[telnyx-handler] ignoring client-supplied X-Tenant-Id header — tenant resolved server-side'
          )
        }

        console.info(
          `[telnyx-handler] Call started — tenant: ${tenantId}, stream_id: ${streamId}, call_control_id: ${callControlId}`
        )

        // ── Pure call forwarding (maya_enabled=false + forwarding_number set) ────
        if (phoneResult && !phoneResult.mayaEnabled && phoneResult.forwardingNumber) {
          console.info(
            `[telnyx-handler] Forwarding call — number=${toNumber} → ${phoneResult.forwardingNumber} (maya disabled)`
          )
          const ccId = event.start.call_sid ?? null
          if (ccId) {
            const telnyxApiKey = process.env['TELNYX_API_KEY'] ?? ''
            try {
              await fetch(
                `https://api.telnyx.com/v2/calls/${encodeURIComponent(ccId)}/actions/transfer`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${telnyxApiKey}`,
                  },
                  body: JSON.stringify({ to: phoneResult.forwardingNumber }),
                }
              )
            } catch (err) {
              console.error('[telnyx-handler] Call forward failed:', err)
            }
          }
          // Don't set up Gemini session — forwarded call
          sessionReady = true // prevent media queue buildup
          return
        }

        // Detect outbound call
        const outboundMeta = callControlId ? outboundCallRegistry.get(callControlId) : undefined
        if (outboundMeta) {
          outboundCallRegistry.delete(callControlId!)
          // For outbound calls, toNumber is the contact's phone — getTenantByPhoneNumber
          // will not match it. Override tenantId from the registered call metadata.
          tenantId = outboundMeta.tenantId
          console.info(
            `[telnyx-handler] Outbound call detected — job=${outboundMeta.jobId} tenant=${outboundMeta.tenantId} (overriding tenantId from registry)`
          )
        }

        const resolvedTenantId = tenantId

        function wireSession(
          session: Awaited<ReturnType<typeof createGeminiLiveSession>>,
          vertical: string,
          businessName: string,
          product?: 'maya_only' | 'suite'
        ): void {
          geminiSession = session
          sessionVertical = vertical
          sessionBusinessName = businessName
          if (product) sessionProduct = product
          session.onAudio((audioChunk: Buffer) => {
            if (!isCallActive || ws.readyState !== ws.OPEN) return
            if (firstAudioSentAt === null && firstAudioReceivedAt !== null) {
              firstAudioSentAt = Date.now()
              const callId = streamId ?? 'unknown'
              console.info(
                `[latency] tenant=${tenantId} call=${callId} first_response_ms=${firstAudioSentAt - firstAudioReceivedAt}`
              )
            }
            const pcmu = linear16ToPcmu(audioChunk)
            console.info(`[telnyx-handler] outbound audio chunk: ${pcmu.length}b`)
            const FRAME_SIZE = 160 // 20ms of 8kHz PCMU (standard RTP frame)
            for (let offset = 0; offset < pcmu.length; offset += FRAME_SIZE) {
              if (ws.readyState !== ws.OPEN) break
              const frame = pcmu.subarray(offset, offset + FRAME_SIZE)
              ws.send(
                JSON.stringify({
                  event: 'media',
                  stream_id: streamId,
                  media: { payload: frame.toString('base64') },
                }),
                (err) => {
                  if (err) console.error('[telnyx-handler] send error', err)
                }
              )
            }
            // Echo suppression: mute inbound forwarding while Maya's audio is playing
            const chunkDurationMs = (pcmu.length / FRAME_SIZE) * 20
            mayaSpeakingUntil = Date.now() + chunkDurationMs + 200
          })
          session.onClose((code: number) => {
            if (
              code === 1011 &&
              isCallActive &&
              ws.readyState === ws.OPEN &&
              reconnectAttempts < MAX_RECONNECTS
            ) {
              reconnectAttempts++
              console.warn(
                `[telnyx-handler] Gemini 1011 — reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECTS})`
              )
              geminiSession = null
              createGeminiLiveSession(
                resolvedTenantId,
                vertical,
                businessName,
                callControlId ?? undefined,
                undefined,
                preCallContextSuffix,
                preCallContactId
              )
                .then((newSession) => {
                  if (!isCallActive) {
                    newSession.close()
                    return
                  }
                  wireSession(newSession, vertical, businessName)
                  for (const pcm16 of mediaQueue) {
                    newSession.send(pcm16)
                  }
                  mediaQueue.length = 0
                  sessionReady = true
                })
                .catch((err: unknown) => {
                  console.error('[telnyx-handler] Reconnect failed', err)
                })
            }
          })
          // Flush any media that arrived before session was ready
          for (const pcm16 of mediaQueue) {
            session.send(pcm16)
          }
          mediaQueue.length = 0
          sessionReady = true

          // Trigger Gemini to speak the greeting from the system prompt
          if (isCallActive) {
            session.sendGreeting('[call connected]')
          }
        }

        // Claim pre-warmed session by streamId (rekeyed after streaming_start)
        const prewarmed = streamId ? prewarmedSessions.get(streamId) : undefined
        if (prewarmed && streamId) {
          prewarmedSessions.delete(streamId)
          clearTimeout(prewarmed.cleanupTimer)
          console.info(`[telnyx-handler] using pre-warmed Gemini session (stream_id=${streamId})`)
          tenantId = prewarmed.tenantId
          callControlId = prewarmed.callControlId
          preCallContactId = prewarmed.callerContext?.contactId ?? null
          preCallContextSuffix = prewarmed.contextSuffix ?? ''
          console.info('[pre-call-ctx]', {
            tenantId,
            matched: prewarmed.callerContext?.matched ?? false,
            suffixChars: preCallContextSuffix.length,
          })
          wireSession(
            prewarmed.session,
            prewarmed.vertical,
            prewarmed.businessName,
            prewarmed.product
          )
        } else if (streamId) {
          // Wait up to 1000ms for rekey from streaming.started webhook
          console.info(`[telnyx-handler] waiting for pre-warm rekey (stream_id=${streamId})`)
          const waited = await new Promise<PrewarmedEntry | undefined>((resolve) => {
            const timer = setTimeout(() => {
              streamWaiters.delete(streamId!)
              resolve(undefined)
            }, 1000)
            streamWaiters.set(streamId!, (entry) => {
              clearTimeout(timer)
              resolve(entry)
            })
          })
          if (waited) {
            prewarmedSessions.delete(streamId)
            clearTimeout(waited.cleanupTimer)
            console.info(`[telnyx-handler] pre-warm claimed via waiter (stream_id=${streamId})`)
            tenantId = waited.tenantId
            callControlId = waited.callControlId
            preCallContactId = waited.callerContext?.contactId ?? null
            preCallContextSuffix = waited.contextSuffix ?? ''
            console.info('[pre-call-ctx]', {
              tenantId,
              matched: waited.callerContext?.matched ?? false,
              suffixChars: preCallContextSuffix.length,
            })
            wireSession(waited.session, waited.vertical, waited.businessName, waited.product)
          } else {
            console.info('[telnyx-handler] pre-warm wait timeout — creating fresh')
            if (!callControlId) {
              console.warn(
                '[telnyx-handler] fresh session created with null callControlId — hangup via API will not work'
              )
            }
            try {
              const fallbackLookup: Promise<CallerContext> = callerId
                ? lookupCaller(resolvedTenantId, callerId)
                : Promise.resolve({ matched: false })
              const { businessName, vertical } = await getTenantConfig(resolvedTenantId)
              const safeName = businessName || 'the business'
              const safeVertical = vertical || 'sales_crm'
              const fallbackCtx = await fallbackLookup
              preCallContactId = fallbackCtx.contactId ?? null
              preCallContextSuffix = buildSystemPromptSuffix(fallbackCtx, callerId ?? undefined)
              const deptSuffix = buildDepartmentContextSuffix(callDepartment)
              preCallContextSuffix += deptSuffix
              console.info('[pre-call-ctx]', {
                tenantId: resolvedTenantId,
                matched: fallbackCtx.matched,
                suffixChars: preCallContextSuffix.length,
              })
              const outboundSuffix = outboundMeta
                ? buildOutboundPromptSuffix(outboundMeta, safeName)
                : undefined
              const session = await createGeminiLiveSession(
                resolvedTenantId,
                safeVertical,
                safeName,
                callControlId ?? undefined,
                undefined,
                outboundSuffix ?? preCallContextSuffix,
                outboundMeta?.contactId ?? preCallContactId
              )
              if (!isCallActive) {
                session.close()
              } else {
                wireSession(session, safeVertical, safeName)
              }
            } catch (err: unknown) {
              console.error('[telnyx-handler] Failed to open Gemini session', err)
              void publishActivityEvent({
                tenant_id: tenantId ?? 'unknown',
                event_id: streamId ?? 'unknown',
                event_type: 'call.failed',
                payload_json: {
                  severity: 'high',
                  reason: err instanceof Error ? err.message : String(err),
                  call_id: streamId ?? 'unknown',
                },
              })
              sessionReady = true
              mediaQueue.length = 0
            }
          }
        } else {
          console.warn('[telnyx-handler] no stream_id in start event — creating fresh')
          if (!callControlId) {
            console.warn(
              '[telnyx-handler] fresh session created with null callControlId — hangup via API will not work'
            )
          }
          try {
            const fallbackLookup: Promise<CallerContext> = callerId
              ? lookupCaller(resolvedTenantId, callerId)
              : Promise.resolve({ matched: false })
            const { businessName, vertical } = await getTenantConfig(resolvedTenantId)
            const safeName = businessName || 'the business'
            const safeVertical = vertical || 'sales_crm'
            const fallbackCtx = await fallbackLookup
            preCallContactId = fallbackCtx.contactId ?? null
            preCallContextSuffix = buildSystemPromptSuffix(fallbackCtx)
            const deptSuffix2 = buildDepartmentContextSuffix(callDepartment)
            preCallContextSuffix += deptSuffix2
            console.info('[pre-call-ctx]', {
              tenantId: resolvedTenantId,
              matched: fallbackCtx.matched,
              suffixChars: preCallContextSuffix.length,
            })
            const outboundSuffix = outboundMeta
              ? buildOutboundPromptSuffix(outboundMeta, safeName)
              : undefined
            const session = await createGeminiLiveSession(
              resolvedTenantId,
              safeVertical,
              safeName,
              callControlId ?? undefined,
              undefined,
              outboundSuffix ?? preCallContextSuffix,
              outboundMeta?.contactId ?? preCallContactId
            )
            if (!isCallActive) {
              session.close()
            } else {
              wireSession(session, safeVertical, safeName)
            }
          } catch (err: unknown) {
            console.error('[telnyx-handler] Failed to open Gemini session', err)
            sessionReady = true
            mediaQueue.length = 0
          }
        }
      } else if (event.event === 'media') {
        if (!isCallActive || event.media.track !== 'inbound') return
        // Echo suppression: skip inbound audio while Maya's outbound is playing
        if (Date.now() < mayaSpeakingUntil) return
        if (firstAudioReceivedAt === null) {
          firstAudioReceivedAt = Date.now()
        }
        // Telnyx → Gemini: base64 PCMU 8kHz → PCM16 16kHz
        const pcmuBuffer = Buffer.from(event.media.payload, 'base64')
        const pcm16 = pcmuToLinear16(pcmuBuffer)
        if (!sessionReady) {
          mediaQueue.push(pcm16)
        } else if (geminiSession) {
          geminiSession.send(pcm16)
        }
      } else if (event.event === 'stop') {
        handleCallEnd()
      } else {
        console.warn(
          `[telnyx-handler] unhandled event type: ${(event as { event?: string }).event}`
        )
      }
    })

    ws.on('close', () => {
      handleCallEnd()
    })

    ws.on('error', (err: Error) => {
      console.error('[telnyx-handler] WebSocket error', err)
      Sentry.captureException(err)
      handleCallEnd()
    })

    function handleCallEnd(): void {
      if (!isCallActive) return
      isCallActive = false

      let latencyBreakdown: LatencyBreakdown | null = null
      if (geminiSession) {
        latencyBreakdown = geminiSession.getLatencyBreakdown()
        geminiSession.close()
        geminiSession = null
      }

      const duration = callStartTime ? Math.round((Date.now() - callStartTime) / 1000) : 0
      const latencyMs =
        firstAudioReceivedAt && firstAudioSentAt ? firstAudioSentAt - firstAudioReceivedAt : null
      logCall({
        tenant_id: tenantId ?? 'unknown',
        duration_seconds: duration,
        language: 'en',
        timestamp: new Date(),
      })
      console.info(
        `[telnyx-handler] Call ended — duration: ${duration}s` +
          (latencyMs !== null ? `, first_response_ms: ${latencyMs}` : '')
      )

      const ccId = callControlId ?? ''
      const booking = ccId ? callSessionState.get(ccId) : undefined
      const hangup = ccId ? hangupDataStore.get(ccId) : undefined

      // Fire-and-forget post-call automation
      if (tenantId && tenantId !== 'unknown') {
        handlePostCall({
          tenantId,
          callerId: callerId ?? '',
          streamId: streamId ?? '',
          callControlId: ccId,
          duration,
          vertical: sessionVertical ?? 'sales_crm',
          businessName: sessionBusinessName ?? 'the business',
          product: sessionProduct,
        }).catch((err) => console.error('[post-call] error:', err))

        persistVoiceSession({
          tenantId,
          streamId: streamId ?? '',
          callControlId: ccId,
          callerPhone: callerId ?? '',
          duration,
          firstResponseMs: latencyMs,
          bookedAppointment: booking?.bookedAppointment ?? false,
          appointmentId: booking?.appointmentId ?? null,
          contactId: booking?.contactId ?? preCallContactId,
          escalated: booking?.escalated ?? false,
          escalationReason: booking?.escalationReason ?? null,
          vertical: sessionVertical ?? 'sales_crm',
          toolCallsMade: booking?.toolCalls ?? [],
          hangupSource: hangup?.hangupSource ?? null,
          hangupCause: hangup?.hangupCause ?? null,
          callQualityMos: hangup?.callQualityMos ?? null,
          language: 'en',
          startedAt: callStartTime ? new Date(callStartTime) : new Date(),
          latencyBreakdown,
        }).catch((err) => console.error('[call-logger] error:', err))
      }

      // Always clean up Maps to prevent leaks when post-call path is skipped
      if (ccId) {
        hangupDataStore.delete(ccId)
        callSessionState.delete(ccId)
      }
    }
  })

  console.info('[telnyx-handler] WebSocket server registered at /voice/stream')
}

// ── Active connection tracking ───────────────────────────────────────────────

let wssRef: WebSocketServer | null = null

export function setWssRef(wss: WebSocketServer): void {
  wssRef = wss
}

export function getActiveConnectionCount(): number {
  return wssRef?.clients?.size ?? 0
}
