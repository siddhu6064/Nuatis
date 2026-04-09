import alawmulaw from 'alawmulaw'
const { mulaw } = alawmulaw
import type { WebSocketServer, WebSocket } from 'ws'
import { createClient } from '@supabase/supabase-js'
import { createGeminiLiveSession } from './gemini-live.js'
import { logCall } from './call-logger.js'
import { publishActivityEvent } from '../lib/ops-copilot-client.js'

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
 * so voice calls never crash due to a failed DB lookup.
 */
async function getTenantConfig(
  tenantId: string
): Promise<{ businessName: string; vertical: string }> {
  const FALLBACK = { businessName: 'the business', vertical: 'sales_crm' }
  try {
    const url = process.env['SUPABASE_URL']
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
    if (!url || !key) return FALLBACK

    const supabase = createClient(url, key)
    const { data, error } = await supabase
      .from('tenants')
      .select('name, vertical')
      .eq('id', tenantId)
      .single()

    if (error || !data) return FALLBACK
    return {
      businessName: (data as { name?: string; vertical?: string }).name || FALLBACK.businessName,
      vertical: (data as { name?: string; vertical?: string }).vertical || FALLBACK.vertical,
    }
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
    const mediaQueue: Buffer[] = []
    let firstAudioReceivedAt: number | null = null
    let firstAudioSentAt: number | null = null
    let reconnectAttempts = 0
    const MAX_RECONNECTS = 2

    ws.on('message', (data: Buffer) => {
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
        const callControlId = event.start.call_sid ?? null
        console.info(
          `[telnyx-handler] Call started — tenant: ${tenantId}, to: ${toNumber}, stream_id: ${streamId}, call_control_id: ${callControlId}`
        )

        const resolvedTenantId = tenantId
        let safeName = ''
        let safeVertical = ''

        function connectGemini(): void {
          createGeminiLiveSession(
            resolvedTenantId,
            safeVertical,
            safeName,
            callControlId ?? undefined
          )
            .then((session) => {
              geminiSession = session
              session.onAudio((audioChunk: Buffer) => {
                if (ws.readyState !== ws.OPEN) return
                if (firstAudioSentAt === null && firstAudioReceivedAt !== null) {
                  firstAudioSentAt = Date.now()
                  const callId = streamId ?? 'unknown'
                  console.info(
                    `[latency] tenant=${tenantId} call=${callId} first_response_ms=${firstAudioSentAt - firstAudioReceivedAt}`
                  )
                }
                const pcmu = linear16ToPcmu(audioChunk)
                ws.send(
                  JSON.stringify({
                    event: 'media',
                    stream_id: streamId,
                    media: { payload: pcmu.toString('base64'), track: 'outbound' },
                  }),
                  (err) => {
                    if (err) console.error('[telnyx-handler] Failed to send audio to Telnyx', err)
                  }
                )
              })
              session.onClose((code: number) => {
                if (
                  code === 1011 &&
                  ws.readyState === ws.OPEN &&
                  reconnectAttempts < MAX_RECONNECTS
                ) {
                  reconnectAttempts++
                  console.warn(
                    `[telnyx-handler] Gemini 1011 — reconnecting (attempt ${reconnectAttempts}/${MAX_RECONNECTS})`
                  )
                  geminiSession = null
                  connectGemini()
                }
              })
              // Flush any media that arrived before session was ready
              for (const pcm16 of mediaQueue) {
                session.send(pcm16)
              }
              mediaQueue.length = 0
              sessionReady = true
            })
            .catch((err: unknown) => {
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
            })
        }

        getTenantConfig(resolvedTenantId).then(({ businessName, vertical }) => {
          safeName = businessName || 'the business'
          safeVertical = vertical || 'sales_crm'
          connectGemini()
        })
      } else if (event.event === 'media') {
        if (event.media.track !== 'inbound') return
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
      handleCallEnd()
    })

    function handleCallEnd(): void {
      if (!geminiSession) return
      geminiSession.close()
      geminiSession = null

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
    }
  })

  console.info('[telnyx-handler] WebSocket server registered at /voice/stream')
}
