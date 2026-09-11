import { WebSocketServer, WebSocket } from 'ws'
import { jwtVerify } from 'jose'

/**
 * POS live updates, keyed by tenant AND location.
 *
 * Deliberately a sibling of conversations-ws.ts rather than an extension of
 * it: that socket keys clients by tenant only, which for a multi-location
 * restaurant would deliver location A's kitchen tickets to location B's
 * screen. That is a cross-location data leak, so the filtering happens here on
 * the server — never on the client.
 */

export interface PosWsEvent {
  type: 'ticket.fired' | 'ticket.updated' | 'ticket.bumped'
  ticket: unknown
}

// tenantId → locationId → connected clients.
//
// Nested rather than a `${tenantId}:${locationId}` string key: a flat key is
// ambiguous, so tenant "a:loc-1" + location "x" would address the same bucket
// as tenant "a" + location "loc-1:x".
const tenantLocationClients = new Map<string, Map<string, Set<WebSocket>>>()

function addClient(tenantId: string, locationId: string, ws: WebSocket): void {
  let byLocation = tenantLocationClients.get(tenantId)
  if (!byLocation) {
    byLocation = new Map()
    tenantLocationClients.set(tenantId, byLocation)
  }
  let clients = byLocation.get(locationId)
  if (!clients) {
    clients = new Set()
    byLocation.set(locationId, clients)
  }
  clients.add(ws)
}

function removeClient(tenantId: string, locationId: string, ws: WebSocket): void {
  const byLocation = tenantLocationClients.get(tenantId)
  if (!byLocation) return
  const clients = byLocation.get(locationId)
  if (!clients) return
  clients.delete(ws)
  if (clients.size === 0) byLocation.delete(locationId)
  if (byLocation.size === 0) tenantLocationClients.delete(tenantId)
}

export function broadcastToLocation(tenantId: string, locationId: string, event: PosWsEvent): void {
  try {
    const clients = tenantLocationClients.get(tenantId)?.get(locationId)
    if (!clients || clients.size === 0) return

    const payload = JSON.stringify(event)
    const dead: WebSocket[] = []

    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload)
        } catch (err) {
          console.error('[pos-ws] send error:', err)
          dead.push(client)
        }
      } else {
        dead.push(client)
      }
    }

    for (const d of dead) clients.delete(d)
  } catch (err) {
    console.error('[pos-ws] broadcastToLocation error:', err)
  }
}

export function initPosWs(): WebSocketServer {
  // noServer:true — upgrade routing is handled centrally in index.ts so the ws
  // library does not subscribe to the HTTP server's upgrade event.
  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (ws) => {
    let authenticated = false
    let clientTenantId: string | null = null
    let clientLocationId: string | null = null

    const authTimeout = setTimeout(() => {
      if (!authenticated) ws.close(4001, 'Auth timeout')
    }, 10000)

    ws.on('message', async (data) => {
      if (authenticated) return // only process the auth message

      try {
        const msg = JSON.parse(data.toString()) as {
          type?: string
          token?: string
          tenantId?: string
          locationId?: string
        }
        if (msg.type !== 'auth' || !msg.token || !msg.tenantId || !msg.locationId) {
          ws.close(4001, 'Invalid auth message')
          return
        }

        const secret = process.env['AUTH_SECRET']
        if (!secret) {
          ws.close(4001, 'Server misconfigured')
          return
        }
        const secretBytes = new TextEncoder().encode(secret)
        // Same iss/aud binding as requireAuth (lib/auth.ts) — only tokens
        // minted for this API are accepted.
        const { payload } = await jwtVerify(msg.token, secretBytes, {
          algorithms: ['HS256'],
          issuer: ['nuatis-web', 'nuatis-mobile'],
          audience: 'nuatis-api',
        })

        const tokenTenantId = (payload['tenantId'] ?? payload['org_id']) as string | undefined
        if (!tokenTenantId || tokenTenantId !== msg.tenantId) {
          ws.close(4001, 'Tenant mismatch')
          return
        }

        // A register token is scoped to one location. If the token carries a
        // locationId it must match the requested one, so a terminal cannot
        // subscribe to a sibling location's kitchen feed.
        const tokenLocationId = payload['locationId'] as string | undefined
        if (tokenLocationId && tokenLocationId !== msg.locationId) {
          ws.close(4001, 'Location mismatch')
          return
        }

        clearTimeout(authTimeout)
        authenticated = true
        clientTenantId = tokenTenantId
        clientLocationId = msg.locationId
        addClient(clientTenantId, clientLocationId, ws)

        ws.send(JSON.stringify({ type: 'authenticated' }))
      } catch {
        ws.close(4001, 'Auth failed')
      }
    })

    ws.on('close', () => {
      clearTimeout(authTimeout)
      if (clientTenantId && clientLocationId) {
        removeClient(clientTenantId, clientLocationId, ws)
      }
    })

    ws.on('error', (err) => {
      console.error('[pos-ws] client error:', err)
    })
  })

  console.info('POS WebSocket listening at /ws/pos')
  return wss
}

/** Test seam — register a socket without performing the auth handshake. */
export function __registerPosWsClientForTest(
  tenantId: string,
  locationId: string,
  ws: WebSocket
): void {
  addClient(tenantId, locationId, ws)
}

/** Test seam — clear all registered clients between tests. */
export function __resetPosWsClientsForTest(): void {
  tenantLocationClients.clear()
}
