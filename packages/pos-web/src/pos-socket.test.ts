import { describe, it, expect, beforeEach } from '@jest/globals'
import {
  PosSocket,
  backoffMs,
  parseEvent,
  isAuthenticatedFrame,
  type SocketLike,
  type SocketStatus,
  type PosSocketEvent,
} from './pos-socket.js'

const TICKET = { token: 'socket.ticket.jwt', tenantId: 'tenant-1', locationId: 'loc-1' }

/** A WebSocket the test drives by hand. */
class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = []
  sent: string[] = []
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: ((error: unknown) => void) | null = null

  constructor() {
    FakeSocket.instances.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closed = true
    this.onclose?.()
  }
  open() {
    this.onopen?.()
  }
  receive(data: unknown) {
    this.onmessage?.({ data })
  }
  /** The server hanging up, as opposed to us closing. */
  drop() {
    this.onclose?.()
  }
}

/** Captures scheduled retries so a test can run them without real timers. */
function makeScheduler() {
  const pending: { fn: () => void; ms: number }[] = []
  return {
    schedule: (fn: () => void, ms: number) => {
      pending.push({ fn, ms })
      return pending.length - 1
    },
    cancel: () => undefined,
    pending,
    async runNext() {
      const next = pending.shift()
      next?.fn()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

interface Harness {
  events: PosSocketEvent[]
  statuses: SocketStatus[]
  socket: PosSocket
  scheduler: ReturnType<typeof makeScheduler>
  fetchCount: () => number
}

async function start(fetchTicket?: () => Promise<typeof TICKET>): Promise<Harness> {
  const events: PosSocketEvent[] = []
  const statuses: SocketStatus[] = []
  const scheduler = makeScheduler()
  let fetchCount = 0

  const socket = new PosSocket({
    url: 'ws://api.test/ws/pos',
    fetchTicket: async () => {
      fetchCount += 1
      return fetchTicket ? await fetchTicket() : TICKET
    },
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s),
    createSocket: () => new FakeSocket(),
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  })

  socket.start()
  // Let the awaited fetchTicket settle before the test touches the socket.
  await Promise.resolve()
  await Promise.resolve()

  return { events, statuses, socket, scheduler, fetchCount: () => fetchCount }
}

beforeEach(() => {
  FakeSocket.instances = []
})

describe('backoffMs', () => {
  it('grows exponentially and then stops growing', () => {
    expect(backoffMs(1)).toBe(500)
    expect(backoffMs(2)).toBe(1000)
    expect(backoffMs(3)).toBe(2000)
    expect(backoffMs(99)).toBe(15_000)
  })
})

describe('parseEvent', () => {
  it('accepts the three ticket events', () => {
    for (const type of ['ticket.fired', 'ticket.updated', 'ticket.bumped']) {
      expect(parseEvent(JSON.stringify({ type, ticket: { id: 't1' } }))?.type).toBe(type)
    }
  })

  it('ignores anything else rather than throwing', () => {
    expect(parseEvent(JSON.stringify({ type: 'authenticated' }))).toBeNull()
    expect(parseEvent(JSON.stringify({ type: 'ticket.teleported' }))).toBeNull()
    expect(parseEvent('not json')).toBeNull()
    expect(parseEvent(JSON.stringify(['ticket.fired']))).toBeNull()
    expect(parseEvent(null)).toBeNull()
  })

  it('recognises the handshake reply separately', () => {
    expect(isAuthenticatedFrame(JSON.stringify({ type: 'authenticated' }))).toBe(true)
    expect(isAuthenticatedFrame(JSON.stringify({ type: 'ticket.fired' }))).toBe(false)
    expect(isAuthenticatedFrame('garbage')).toBe(false)
  })
})

describe('PosSocket', () => {
  it('sends the auth frame on open, and never the session cookie', async () => {
    const h = await start()
    const ws = FakeSocket.instances[0]!
    ws.open()

    expect(ws.sent).toHaveLength(1)
    expect(JSON.parse(ws.sent[0]!)).toEqual({
      type: 'auth',
      token: 'socket.ticket.jwt',
      tenantId: 'tenant-1',
      locationId: 'loc-1',
    })
    h.socket.close()
  })

  it('reports live only once the server says authenticated', async () => {
    const h = await start()
    const ws = FakeSocket.instances[0]!
    ws.open()
    expect(h.statuses).not.toContain('live')

    ws.receive(JSON.stringify({ type: 'authenticated' }))
    expect(h.statuses).toContain('live')
    h.socket.close()
  })

  it('dispatches ticket events after the handshake', async () => {
    const h = await start()
    const ws = FakeSocket.instances[0]!
    ws.open()
    ws.receive(JSON.stringify({ type: 'authenticated' }))
    ws.receive(JSON.stringify({ type: 'ticket.fired', ticket: { id: 't1' } }))

    expect(h.events).toEqual([{ type: 'ticket.fired', ticket: { id: 't1' } }])
    h.socket.close()
  })

  it('fetches a fresh ticket on every reconnect — they expire in 60s', async () => {
    const h = await start()
    expect(h.fetchCount()).toBe(1)

    FakeSocket.instances[0]!.drop()
    await h.scheduler.runNext()

    expect(h.fetchCount()).toBe(2)
    expect(FakeSocket.instances).toHaveLength(2)
    h.socket.close()
  })

  it('backs off further on each successive failure', async () => {
    const h = await start()

    FakeSocket.instances[0]!.drop()
    expect(h.scheduler.pending[0]!.ms).toBe(500)
    await h.scheduler.runNext()

    FakeSocket.instances[1]!.drop()
    expect(h.scheduler.pending[0]!.ms).toBe(1000)
    h.socket.close()
  })

  it('resets the backoff only after a successful handshake', async () => {
    const h = await start()

    FakeSocket.instances[0]!.drop()
    await h.scheduler.runNext()
    FakeSocket.instances[1]!.drop()
    await h.scheduler.runNext()

    // Third attempt succeeds, so the next failure starts from the base delay
    // again rather than continuing to climb.
    const ws = FakeSocket.instances[2]!
    ws.open()
    ws.receive(JSON.stringify({ type: 'authenticated' }))
    ws.drop()

    expect(h.scheduler.pending[0]!.ms).toBe(500)
    h.socket.close()
  })

  it('retries without opening a socket when the ticket cannot be minted', async () => {
    let fail = true
    const h = await start(async () => {
      if (fail) throw new Error('401')
      return TICKET
    })

    expect(FakeSocket.instances).toHaveLength(0)
    expect(h.scheduler.pending).toHaveLength(1)

    fail = false
    await h.scheduler.runNext()
    expect(FakeSocket.instances).toHaveLength(1)
    h.socket.close()
  })

  it('close() stops everything, including a reconnect already scheduled', async () => {
    const h = await start()
    FakeSocket.instances[0]!.drop()
    expect(h.scheduler.pending).toHaveLength(1)

    h.socket.close()
    await h.scheduler.runNext()

    // The pending retry ran but must not have built another socket — a leaked
    // connection per effect re-run is the bug this guards.
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('does not reconnect when we are the one closing the socket', async () => {
    const h = await start()
    const ws = FakeSocket.instances[0]!
    ws.open()
    ws.receive(JSON.stringify({ type: 'authenticated' }))

    h.socket.close()

    expect(ws.closed).toBe(true)
    expect(h.scheduler.pending).toHaveLength(0)
    expect(FakeSocket.instances).toHaveLength(1)
  })

  it('emits no status after close', async () => {
    const h = await start()
    const before = h.statuses.length
    h.socket.close()
    FakeSocket.instances[0]!.drop()
    expect(h.statuses).toHaveLength(before)
  })
})
