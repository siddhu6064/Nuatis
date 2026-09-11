import { describe, it, expect, beforeEach } from '@jest/globals'

const { broadcastToLocation, __registerPosWsClientForTest, __resetPosWsClientsForTest } =
  await import('./pos-ws.js')

interface FakeSocket {
  readyState: number
  sent: string[]
  send: (data: string) => void
}

function fakeSocket(): FakeSocket {
  return {
    readyState: 1, // WebSocket.OPEN
    sent: [],
    send(data: string) {
      this.sent.push(data)
    },
  }
}

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'
const LOC_1 = 'loc-1'
const LOC_2 = 'loc-2'

beforeEach(() => {
  __resetPosWsClientsForTest()
})

describe('broadcastToLocation', () => {
  it('delivers to a client at the same tenant and location', () => {
    const sock = fakeSocket()
    __registerPosWsClientForTest(TENANT_A, LOC_1, sock as never)

    broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })

    expect(sock.sent).toHaveLength(1)
    expect(JSON.parse(sock.sent[0] as string).type).toBe('ticket.fired')
  })

  it('does NOT deliver location 1 tickets to a location 2 screen', () => {
    const loc1 = fakeSocket()
    const loc2 = fakeSocket()
    __registerPosWsClientForTest(TENANT_A, LOC_1, loc1 as never)
    __registerPosWsClientForTest(TENANT_A, LOC_2, loc2 as never)

    broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })

    expect(loc1.sent).toHaveLength(1)
    expect(loc2.sent).toHaveLength(0)
  })

  it('does NOT deliver across tenants even for a colliding location id', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    __registerPosWsClientForTest(TENANT_A, LOC_1, a as never)
    __registerPosWsClientForTest(TENANT_B, LOC_1, b as never)

    broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })

    expect(a.sent).toHaveLength(1)
    expect(b.sent).toHaveLength(0)
  })

  it('does not let a crafted tenant id collide into another key', () => {
    // A naive `${tenantId}:${locationId}` key lets tenant "a:loc-1" + location
    // "x" address the same bucket as tenant "a" + location "loc-1:x".
    const victim = fakeSocket()
    const attacker = fakeSocket()
    __registerPosWsClientForTest(TENANT_A, LOC_1, victim as never)
    __registerPosWsClientForTest(`${TENANT_A}:${LOC_1}`, 'x', attacker as never)

    broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })

    expect(victim.sent).toHaveLength(1)
    expect(attacker.sent).toHaveLength(0)
  })

  it('delivers to every screen at the same location', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    __registerPosWsClientForTest(TENANT_A, LOC_1, a as never)
    __registerPosWsClientForTest(TENANT_A, LOC_1, b as never)

    broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })

    expect(a.sent).toHaveLength(1)
    expect(b.sent).toHaveLength(1)
  })

  it('skips sockets that are not OPEN', () => {
    const closing = fakeSocket()
    closing.readyState = 2 // CLOSING
    __registerPosWsClientForTest(TENANT_A, LOC_1, closing as never)

    broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })

    expect(closing.sent).toHaveLength(0)
  })

  it('is a no-op when nobody is listening', () => {
    expect(() =>
      broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })
    ).not.toThrow()
  })
})
