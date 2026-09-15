import { createSocketTicketRoute } from '@nuatis/pos-web'

// A 60-second token for the WebSocket handshake and nothing else — see
// createSocketTicketRoute for why the 12h session token is never returned here.
// The register uses it to watch for orders the kitchen has marked ready.
export const { GET } = createSocketTicketRoute()

// Minting depends on the request's cookie, so this must never be prerendered.
export const dynamic = 'force-dynamic'
