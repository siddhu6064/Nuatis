import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const notifyPlatformTeam = jest.fn<() => Promise<void>>()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/notify-platform-team.js', () => ({ notifyPlatformTeam }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { scan } = await import('./platform-ack-scanner.js')

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString()
}

function incident(overrides: Record<string, unknown> = {}) {
  return {
    id: `i-${Math.random().toString(36).slice(2, 8)}`,
    reference: 'SEV-2026-001',
    severity: 'sev1',
    title: 'Register cannot take payment',
    status: 'detected',
    detected_at: minutesAgo(20),
    ack_due_at: minutesAgo(5),
    ack_breached_at: null,
    acknowledged_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  store.tables['platform_incidents'] = []
  notifyPlatformTeam.mockClear()
  notifyPlatformTeam.mockResolvedValue(undefined)
})

describe('platform-ack-scanner', () => {
  it('escalates a SEV1 that nobody acknowledged inside its deadline', async () => {
    store.tables['platform_incidents'] = [incident()]
    await scan()
    expect(notifyPlatformTeam).toHaveBeenCalledTimes(1)
  })

  it('leaves an acknowledged incident alone', async () => {
    store.tables['platform_incidents'] = [incident({ acknowledged_at: minutesAgo(10) })]
    await scan()
    expect(notifyPlatformTeam).not.toHaveBeenCalled()
  })

  it('escalates once, not on every tick', async () => {
    store.tables['platform_incidents'] = [incident()]
    await scan()
    await scan()
    await scan()
    expect(notifyPlatformTeam).toHaveBeenCalledTimes(1)
  })

  it('stamps the breach before notifying', async () => {
    // A crash between the two costs one missed escalation; the other order
    // costs a duplicate every five minutes forever, which is how a team learns
    // to mute the alert.
    store.tables['platform_incidents'] = [incident()]
    await scan()
    expect((store.tables['platform_incidents'] as Row[])[0]!['ack_breached_at']).toEqual(
      expect.any(String)
    )
  })

  it('ignores SEV4, which has no deadline', async () => {
    store.tables['platform_incidents'] = [
      incident({ severity: 'sev4', ack_due_at: null, detected_at: minutesAgo(600) }),
    ]
    await scan()
    expect(notifyPlatformTeam).not.toHaveBeenCalled()
  })

  it('ignores an incident whose deadline has not passed', async () => {
    store.tables['platform_incidents'] = [
      incident({ ack_due_at: new Date(Date.now() + 60_000).toISOString() }),
    ]
    await scan()
    expect(notifyPlatformTeam).not.toHaveBeenCalled()
  })

  it('ignores an incident already past acknowledgement', async () => {
    store.tables['platform_incidents'] = [incident({ status: 'resolved' })]
    await scan()
    expect(notifyPlatformTeam).not.toHaveBeenCalled()
  })

  it('alerts per incident, because a SEV1 deserves its own alert', async () => {
    store.tables['platform_incidents'] = [incident(), incident(), incident()]
    await scan()
    expect(notifyPlatformTeam).toHaveBeenCalledTimes(3)
  })

  it('does nothing when there is nothing to escalate', async () => {
    await scan()
    expect(notifyPlatformTeam).not.toHaveBeenCalled()
  })

  it('does not throw when the query fails', async () => {
    // A scanner that throws takes the worker down with it.
    store.tables['platform_incidents'] = [incident()]
    notifyPlatformTeam.mockRejectedValue(new Error('push is down'))
    await expect(scan()).resolves.toBeUndefined()
  })
})
