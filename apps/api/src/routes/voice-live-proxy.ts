/**
 * Server-side WebSocket proxy for Gemini Live.
 *
 * Keeps GEMINI_API_KEY out of the browser bundle by injecting it server-side
 * via the proxyReqWs handler.  The proxy is transparent — messages flow
 * unchanged between the browser and Gemini; only the target URL is rewritten.
 *
 * HTTP path:    /api/voice/live  (Express middleware — auth enforced)
 * WS upgrade:  /api/voice/live  (server.on('upgrade') in index.ts — proxy only)
 */
import { Router } from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { jwtVerify } from 'jose'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { ProxyServerOptions } from 'httpxy'
import { requireAuth } from '../lib/auth.js'

const GEMINI_TARGET = 'wss://generativelanguage.googleapis.com'

/**
 * VOICE-02: authenticate a `/api/voice/live` WebSocket upgrade. Express
 * middleware (incl. requireAuth) never runs for upgrades, so the upgrade handler
 * in index.ts calls this directly before proxying to Gemini. Accepts the API JWT
 * from a `token` query param, an `Authorization: Bearer` header, or a
 * `Sec-WebSocket-Protocol: token.<jwt>` subprotocol (browsers can't set headers
 * on WS upgrades). Same iss/aud binding as requireAuth — only this API's tokens.
 */
export async function verifyVoiceLiveUpgrade(req: IncomingMessage): Promise<boolean> {
  const secret = process.env['AUTH_SECRET']
  if (!secret) {
    console.warn('[voice/live] AUTH_SECRET not set — rejecting upgrade')
    return false
  }

  let token: string | undefined
  const fromQuery = new URL(req.url ?? '', 'http://x').searchParams.get('token')
  const authHeader = req.headers['authorization']
  if (fromQuery) {
    token = fromQuery
  } else if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length)
  } else {
    const proto = req.headers['sec-websocket-protocol']
    const protoStr = Array.isArray(proto) ? proto.join(',') : proto
    token = protoStr
      ?.split(',')
      .map((p) => p.trim())
      .find((p) => p.startsWith('token.'))
      ?.slice('token.'.length)
  }

  if (!token) return false

  try {
    await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      issuer: ['nuatis-web', 'nuatis-mobile'],
      audience: 'nuatis-api',
    })
    return true
  } catch {
    return false
  }
}
const GEMINI_WS_PATH =
  '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

/**
 * Named export — used in `server.on('upgrade', ...)` in index.ts so that
 * WebSocket upgrades bypass Express but still reach the proxy.
 */
export const voiceLiveProxy = createProxyMiddleware({
  target: GEMINI_TARGET,
  changeOrigin: true,
  // ws:true intentionally omitted — it causes http-proxy-middleware v4 to
  // auto-subscribe to the server's upgrade event for ALL paths (default
  // pathFilter '/'), destroying /voice/stream sockets on arrival.
  // WebSocket upgrades are routed manually in server.on('upgrade') below.
  pathFilter: '/api/voice/live',
  // Always rewrite to the Gemini BidiGenerateContent WS path regardless of
  // how Express strips (or doesn't strip) the mount prefix.
  pathRewrite: (_path: string) => GEMINI_WS_PATH,
  on: {
    proxyReqWs: (
      proxyReq: ClientRequest,
      _req: IncomingMessage,
      socket: Socket,
      _options: ProxyServerOptions,
      _head: unknown
    ) => {
      const key = process.env['GEMINI_API_KEY']
      if (!key) {
        console.warn('GEMINI_API_KEY not set — voice live proxy unavailable')
        socket.destroy()
        return
      }
      // path has already been rewritten to GEMINI_WS_PATH by pathRewrite above.
      const sep = proxyReq.path.includes('?') ? '&' : '?'
      proxyReq.path = `${proxyReq.path}${sep}key=${encodeURIComponent(key)}`
    },
  },
})

const router = Router()
// requireAuth enforces Bearer-token auth for any HTTP request hitting this
// path.  WebSocket upgrades are handled via voiceLiveProxy.upgrade in
// index.ts (outside Express middleware stack).
router.use('/', requireAuth, voiceLiveProxy)

export default router
