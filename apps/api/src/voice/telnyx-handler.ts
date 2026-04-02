import alawmulaw from 'alawmulaw'
const { mulaw } = alawmulaw
import type { WebSocketServer } from 'ws'

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

// ── WebSocket handler (registered in index.ts) ────────────────────────────────

export function registerVoiceWebSocket(_wss: WebSocketServer): void {
  // Implemented in Task 6
}
