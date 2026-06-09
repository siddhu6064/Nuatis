import { WebSocketServer, WebSocket } from 'ws'
import { jwtVerify } from 'jose'
import type { ConversationsWsEvent } from '@nuatis/shared'

// tenantId → connected clients
const tenantClients = new Map<string, Set<WebSocket>>()

export function initConversationsWs(): WebSocketServer {
  // noServer:true — upgrade routing is handled centrally in index.ts so
  // the ws library does not subscribe to the HTTP server's upgrade event.
  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (ws) => {
    let authenticated = false
    let clientTenantId: string | null = null

    const authTimeout = setTimeout(() => {
      if (!authenticated) ws.close(4001, 'Auth timeout')
    }, 10000)

    ws.on('message', async (data) => {
      if (authenticated) return // only process auth message

      try {
        const msg = JSON.parse(data.toString()) as {
          type?: string
          token?: string
          tenantId?: string
        }
        if (msg.type !== 'auth' || !msg.token || !msg.tenantId) {
          ws.close(4001, 'Invalid auth message')
          return
        }

        // Validate token
        const secret = process.env['AUTH_SECRET']
        if (!secret) {
          ws.close(4001, 'Server misconfigured')
          return
        }
        const secretBytes = new TextEncoder().encode(secret)
        const { payload } = await jwtVerify(msg.token, secretBytes, { algorithms: ['HS256'] })

        const tokenTenantId = (payload['tenantId'] ?? payload['org_id']) as string | undefined
        if (!tokenTenantId || tokenTenantId !== msg.tenantId) {
          ws.close(4001, 'Tenant mismatch')
          return
        }

        clearTimeout(authTimeout)
        authenticated = true
        clientTenantId = tokenTenantId

        if (!tenantClients.has(clientTenantId)) {
          tenantClients.set(clientTenantId, new Set())
        }
        tenantClients.get(clientTenantId)!.add(ws)

        ws.send(JSON.stringify({ type: 'authenticated' }))
      } catch {
        ws.close(4001, 'Auth failed')
      }
    })

    ws.on('close', () => {
      clearTimeout(authTimeout)
      if (clientTenantId) {
        tenantClients.get(clientTenantId)?.delete(ws)
      }
    })

    ws.on('error', (err) => {
      console.error('[conversations-ws] client error:', err)
    })
  })

  console.info('Conversations WebSocket listening at /ws/conversations')
  return wss
}

export function broadcastToTenant(tenantId: string, event: ConversationsWsEvent): void {
  try {
    const clients = tenantClients.get(tenantId)
    if (!clients || clients.size === 0) return

    const payload = JSON.stringify(event)
    const dead: WebSocket[] = []

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload)
        } catch (err) {
          console.error('[conversations-ws] send error:', err)
          dead.push(client)
        }
      } else {
        dead.push(client)
      }
    }

    for (const d of dead) clients.delete(d)
  } catch (err) {
    console.error('[conversations-ws] broadcastToTenant error:', err)
  }
}
