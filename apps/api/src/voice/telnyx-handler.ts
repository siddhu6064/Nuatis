import alawmulaw from 'alawmulaw'
const { mulaw } = alawmulaw
import type { WebSocketServer, WebSocket } from 'ws'
import { createGeminiLiveSession } from './gemini-live.js'
import { logCall } from './call-logger.js'

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
 * Gemini → Telnyx
 * Converts linear PCM 16-bit (16 kHz) to µ-law PCMU (8 kHz) by
 * taking every other sample (naive downsample) then µ-law encoding.
 */
export function linear16ToPcmu(pcm16Buffer: Buffer): Buffer {
  const samples16k = new Int16Array(
    pcm16Buffer.buffer,
    pcm16Buffer.byteOffset,
    Math.floor(pcm16Buffer.byteLength / 2)
  )
  const samples8k = new Int16Array(Math.floor(samples16k.length / 2))
  for (let i = 0; i < samples8k.length; i++) {
    samples8k[i] = samples16k[i * 2]!
  }
  return Buffer.from(mulaw.encode(samples8k))
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
        console.info(
          `[telnyx-handler] Call started — tenant: ${tenantId}, to: ${toNumber}, stream_id: ${streamId}`
        )

        createGeminiLiveSession(tenantId, 'sales_crm')
          .then((session) => {
            geminiSession = session
            session.onAudio((audioChunk: Buffer) => {
              if (ws.readyState !== ws.OPEN) return
              console.info(`[telnyx-handler] Gemini audio chunk: ${audioChunk.length}b`)
              // Gemini → Telnyx: PCM16 16kHz → PCMU 8kHz → base64
              const pcmu = linear16ToPcmu(audioChunk)
              ws.send(
                JSON.stringify({
                  event: 'media',
                  stream_id: streamId,
                  media: { payload: pcmu.toString('base64') },
                }),
                (err) => {
                  if (err) console.error('[telnyx-handler] Failed to send audio to Telnyx', err)
                }
              )
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
            sessionReady = true
            mediaQueue.length = 0
          })
      } else if (event.event === 'media') {
        if (event.media.track !== 'inbound') return
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
      logCall({
        tenant_id: tenantId ?? 'unknown',
        duration_seconds: duration,
        language: 'unknown', // language detection added in future task
        timestamp: new Date(),
      })
      console.info(`[telnyx-handler] Call ended — duration: ${duration}s`)
    }
  })

  console.info('[telnyx-handler] WebSocket server registered at /voice/stream')
}
