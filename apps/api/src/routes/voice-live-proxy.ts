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
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { ProxyServerOptions } from 'httpxy'
import { requireAuth } from '../lib/auth.js'

const GEMINI_TARGET = 'wss://generativelanguage.googleapis.com'
const GEMINI_WS_PATH =
  '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

/**
 * Named export — used in `server.on('upgrade', ...)` in index.ts so that
 * WebSocket upgrades bypass Express but still reach the proxy.
 */
export const voiceLiveProxy = createProxyMiddleware({
  target: GEMINI_TARGET,
  changeOrigin: true,
  ws: true,
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
