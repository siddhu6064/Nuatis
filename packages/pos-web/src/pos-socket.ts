export type SocketStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'

export const SOCKET_EVENT_TYPES = ['ticket.fired', 'ticket.updated', 'ticket.bumped'] as const
export type SocketEventType = (typeof SOCKET_EVENT_TYPES)[number]

export interface PosSocketEvent {
  type: SocketEventType
  ticket: unknown
}

/** What /api/socket-ticket hands back. Never the 12h session token. */
export interface SocketTicket {
  token: string
  tenantId: string
  locationId: string
}

/** The slice of WebSocket this module uses, so a test can supply a fake. */
export interface SocketLike {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: ((error: unknown) => void) | null
}

export interface PosSocketOptions {
  url: string
  /** Fetches a fresh ticket. Called again on every reconnect — they expire. */
  fetchTicket: () => Promise<SocketTicket>
  onEvent: (event: PosSocketEvent) => void
  onStatus?: (status: SocketStatus) => void
  createSocket?: (url: string) => SocketLike
  /** Injected for tests; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => unknown
  cancel?: (handle: unknown) => void
}

const BASE_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 15_000

/**
 * Capped exponential backoff, deliberately without jitter.
 *
 * Jitter exists to stop a thundering herd; a kitchen has one to three screens,
 * so there is no herd, and a deterministic delay is one fewer thing that makes
 * a reconnect test flaky.
 */
export function backoffMs(attempt: number): number {
  if (attempt <= 0) return 0
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)
}

/**
 * Parse a socket frame, or null if it is not an event this board understands.
 *
 * Returns null rather than throwing for anything unrecognised — including the
 * `{"type":"authenticated"}` handshake reply, which is handled separately. A
 * future server-side event type must not crash a screen built before it
 * existed.
 */
export function parseEvent(data: unknown): PosSocketEvent | null {
  if (typeof data !== 'string') return null

  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>
  const type = o['type']
  if (typeof type !== 'string' || !(SOCKET_EVENT_TYPES as readonly string[]).includes(type)) {
    return null
  }
  return { type: type as SocketEventType, ticket: o['ticket'] }
}

export function isAuthenticatedFrame(data: unknown): boolean {
  if (typeof data !== 'string') return false
  try {
    const parsed = JSON.parse(data) as { type?: unknown }
    return parsed.type === 'authenticated'
  } catch {
    return false
  }
}

/**
 * A connection to the POS socket that reconnects itself.
 *
 * The credential is fetched per attempt rather than captured once: a socket
 * ticket lives sixty seconds, so a screen that reconnects after a ten-minute
 * network outage must mint a new one or it will be refused at the handshake.
 *
 * `close()` is idempotent and stops all further work, including a reconnect
 * already scheduled. A React effect cleanup that leaves a socket running is
 * how you end up with one live connection per re-render — the same leak the
 * API's own ping handling had to be fixed for.
 */
export class PosSocket {
  private readonly options: PosSocketOptions
  private readonly createSocket: (url: string) => SocketLike
  private readonly schedule: (fn: () => void, ms: number) => unknown
  private readonly cancel: (handle: unknown) => void

  private socket: SocketLike | null = null
  private retryHandle: unknown = null
  private attempt = 0
  private closed = false

  constructor(options: PosSocketOptions) {
    this.options = options
    this.createSocket =
      options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike)
    this.schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms))
    this.cancel =
      options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  start(): void {
    if (this.closed) return
    void this.connect()
  }

  close(): void {
    this.closed = true
    if (this.retryHandle !== null) {
      this.cancel(this.retryHandle)
      this.retryHandle = null
    }
    this.detach()
  }

  private status(status: SocketStatus): void {
    if (this.closed) return
    this.options.onStatus?.(status)
  }

  private detach(): void {
    const socket = this.socket
    if (!socket) return
    // Null the handlers before closing: `close()` fires onclose, which would
    // otherwise schedule a reconnect for a socket we are deliberately
    // discarding.
    socket.onopen = null
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null
    this.socket = null
    try {
      socket.close()
    } catch {
      // Already closed or never opened — nothing to unwind.
    }
  }

  private async connect(): Promise<void> {
    if (this.closed) return
    this.status(this.attempt === 0 ? 'connecting' : 'reconnecting')

    let ticket: SocketTicket
    try {
      ticket = await this.options.fetchTicket()
    } catch {
      // No ticket means no handshake. Back off and try again rather than
      // opening a socket that is certain to be refused.
      this.scheduleRetry()
      return
    }
    if (this.closed) return

    let socket: SocketLike
    try {
      socket = this.createSocket(this.options.url)
    } catch {
      this.scheduleRetry()
      return
    }
    this.socket = socket

    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'auth',
          token: ticket.token,
          tenantId: ticket.tenantId,
          locationId: ticket.locationId,
        })
      )
    }

    socket.onmessage = (event: { data: unknown }) => {
      if (isAuthenticatedFrame(event.data)) {
        // Reset only once the server has actually accepted us. Resetting on
        // `onopen` would turn a socket that opens and is immediately rejected
        // into a tight reconnect loop at the base delay.
        this.attempt = 0
        this.status('live')
        return
      }
      const parsed = parseEvent(event.data)
      if (parsed) this.options.onEvent(parsed)
    }

    socket.onclose = () => {
      if (this.closed) return
      this.socket = null
      this.scheduleRetry()
    }

    socket.onerror = () => {
      // onclose always follows, and that is where the retry lives — handling
      // both would schedule two reconnects for one failure.
    }
  }

  private scheduleRetry(): void {
    if (this.closed) return
    this.attempt += 1
    this.status(this.attempt > 1 ? 'offline' : 'reconnecting')
    this.retryHandle = this.schedule(() => {
      this.retryHandle = null
      void this.connect()
    }, backoffMs(this.attempt))
  }
}
