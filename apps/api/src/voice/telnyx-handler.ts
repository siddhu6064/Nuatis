import alawmulaw from 'alawmulaw'
const { mulaw } = alawmulaw
import type { WebSocketServer, WebSocket } from 'ws'
import { createClient } from '@supabase/supabase-js'
import { createGeminiLiveSession } from './gemini-live.js'
import { logCall } from './call-logger.js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'
import { handlePostCall, callSessionState } from './post-call.js'
import { persistVoiceSession } from './call-session-logger.js'
import { lookupCaller, buildSystemPromptSuffix, type CallerContext } from './pre-call-lookup.js'
import { Sentry } from '../lib/sentry.js'

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
  start: { call_sid: string; from: string; to: string }
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
  const tenantMapRaw = process.env['TELNYX_TENANT_MAP'] ?? ''
  const tenantMap = parseTenantMap(tenantMapRaw)
  let tenantId = lookupTenant(toNumber, tenantMap) ?? null
  if (!tenantId) {
    tenantId = process.env['VOICE_DEV_TENANT_ID'] ?? 'unknown'
  }

  const lookupPromise: Promise<CallerContext> =
    fromNumber && tenantId !== 'unknown'
      ? lookupCaller(tenantId, fromNumber)
      : Promise.resolve({ matched: false })

  const { businessName, vertical, product } = await getTenantConfig(tenantId)
  const safeName = businessName || 'the business'
  const safeVertical = vertical || 'sales_crm'

  // Resolve caller lookup before opening Gemini so the suffix lands in systemInstruction
  const callerContext = await lookupPromise
  const contextSuffix = buildSystemPromptSuffix(callerContext)

  const session = await createGeminiLiveSession(
    tenantId,
    safeVertical,
    safeName,
    callControlId,
    product,
    contextSuffix
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
      contextSuffix,
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
  const tenantMapRaw = process.env['TELNYX_TENANT_MAP'] ?? ''
  const tenantMap = parseTenantMap(tenantMapRaw)

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

    ws.on('message', async (data: Buffer) => {
      let event: TelnyxEvent
      try {
        event = JSON.parse(data.toString()) as TelnyxEvent
      } catch {
        return
      }

      if (event.event === 'start') {
        streamId = event.stream_id ?? null
        const toNumber = event.start.to
        tenantId = lookupTenant(toNumber, tenantMap) ?? null

        if (!tenantId) {
          console.warn(
            `[telnyx-handler] No tenant found for number ${toNumber} — using dev fallback`
          )
          tenantId = process.env['VOICE_DEV_TENANT_ID'] ?? 'unknown'
        }

        callStartTime = Date.now()
        callControlId = event.start.call_sid ?? null
        callerId = event.start.from ?? null
        console.info(
          `[telnyx-handler] Call started — tenant: ${tenantId}, to: ${toNumber}, from: ${callerId}, stream_id: ${streamId}, call_control_id: ${callControlId}`
        )

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
                  media: { payload: frame.toString('base64'), track: 'outbound' },
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
                preCallContextSuffix
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
              preCallContextSuffix = buildSystemPromptSuffix(fallbackCtx)
              console.info('[pre-call-ctx]', {
                tenantId: resolvedTenantId,
                matched: fallbackCtx.matched,
                suffixChars: preCallContextSuffix.length,
              })
              const session = await createGeminiLiveSession(
                resolvedTenantId,
                safeVertical,
                safeName,
                callControlId ?? undefined,
                undefined,
                preCallContextSuffix
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
            console.info('[pre-call-ctx]', {
              tenantId: resolvedTenantId,
              matched: fallbackCtx.matched,
              suffixChars: preCallContextSuffix.length,
            })
            const session = await createGeminiLiveSession(
              resolvedTenantId,
              safeVertical,
              safeName,
              callControlId ?? undefined,
              undefined,
              preCallContextSuffix
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
        console.info(
          `[telnyx-handler] inbound audio chunk: ${pcmuBuffer.length}b, first4=${pcmuBuffer.subarray(0, 4).toString('hex')}`
        )
        const pcm16 = pcmuToLinear16(pcmuBuffer)
        if (!sessionReady) {
          mediaQueue.push(pcm16)
        } else if (geminiSession) {
          geminiSession.send(pcm16)
        }
      } else if (event.event === 'stop') {
        handleCallEnd()
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

      if (geminiSession) {
        geminiSession.close()
        geminiSession = null
      }

      const duration = callStartTime ? Math.round((Date.now() - callStartTime) / 1000) : 0
      // TODO: persist latency_ms to voice_sessions table once latency_ms column is added
      const latencyMs =
        firstAudioReceivedAt && firstAudioSentAt ? firstAudioSentAt - firstAudioReceivedAt : null
      logCall({
        tenant_id: tenantId ?? 'unknown',
        duration_seconds: duration,
        language: 'unknown', // language detection added in future task
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
          startedAt: callStartTime ? new Date(callStartTime) : new Date(),
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
