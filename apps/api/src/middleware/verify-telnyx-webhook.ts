import type { Request, Response, NextFunction } from 'express'
import { createPublicKey, verify, type KeyObject } from 'node:crypto'

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: Buffer
  }
}

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const MAX_TIMESTAMP_SKEW_SECONDS = 300

let cachedKey: KeyObject | null = null
let cachedKeyMaterial: string | null = null

function getPublicKey(material: string): KeyObject {
  if (cachedKey && cachedKeyMaterial === material) return cachedKey
  const raw = Buffer.from(material, 'base64')
  if (raw.length !== 32) {
    throw new Error(
      `TELNYX_PUBLIC_KEY must decode to 32 bytes (got ${raw.length}) — expected base64-encoded Ed25519 public key`
    )
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw])
  cachedKey = createPublicKey({ key: der, format: 'der', type: 'spki' })
  cachedKeyMaterial = material
  return cachedKey
}

export function verifyTelnyxWebhook(req: Request, res: Response, next: NextFunction): void {
  if (process.env['NODE_ENV'] === 'test') {
    next()
    return
  }

  const publicKeyMaterial = process.env['TELNYX_PUBLIC_KEY']
  if (!publicKeyMaterial) {
    console.error('[telnyx-webhook] TELNYX_PUBLIC_KEY not set — rejecting request')
    res.status(500).json({ error: 'Webhook verification not configured' })
    return
  }

  const signature = req.headers['telnyx-signature-ed25519']
  const timestamp = req.headers['telnyx-timestamp']

  if (typeof signature !== 'string' || typeof timestamp !== 'string') {
    console.warn('[telnyx-webhook] missing telnyx-signature-ed25519 or telnyx-timestamp header')
    res.status(403).json({ error: 'Invalid webhook signature' })
    return
  }

  const tsSeconds = Number(timestamp)
  if (!Number.isFinite(tsSeconds)) {
    console.warn('[telnyx-webhook] invalid telnyx-timestamp value')
    res.status(403).json({ error: 'Invalid webhook signature' })
    return
  }
  const nowSeconds = Date.now() / 1000
  if (Math.abs(nowSeconds - tsSeconds) > MAX_TIMESTAMP_SKEW_SECONDS) {
    console.warn(
      `[telnyx-webhook] timestamp outside ${MAX_TIMESTAMP_SKEW_SECONDS}s replay window (ts=${timestamp})`
    )
    res.status(403).json({ error: 'Invalid webhook signature' })
    return
  }

  const rawBody = req.rawBody
  if (!rawBody) {
    console.error(
      '[telnyx-webhook] req.rawBody missing — express.json verify callback not configured for this route'
    )
    res.status(500).json({ error: 'Webhook verification not configured' })
    return
  }

  const message = Buffer.concat([Buffer.from(`${timestamp}|`), rawBody])
  const sigBuf = Buffer.from(signature, 'base64')

  try {
    const publicKey = getPublicKey(publicKeyMaterial)
    const ok = verify(null, message, publicKey, sigBuf)
    if (!ok) {
      console.warn('[telnyx-webhook] signature verification failed')
      res.status(403).json({ error: 'Invalid webhook signature' })
      return
    }
    next()
  } catch (err) {
    console.error('[telnyx-webhook] verification error:', err)
    res.status(403).json({ error: 'Invalid webhook signature' })
  }
}
