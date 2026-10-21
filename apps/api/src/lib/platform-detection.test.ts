import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
const notifyPlatformTeam = jest.fn<() => Promise<void>>()
jest.unstable_mockModule('./notify-platform-team.js', () => ({ notifyPlatformTeam }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { autoDetectionEnabled, maybeDeclareFromErrorRate, AUTO_DETECT_ERROR_THRESHOLD } =
  await import('./platform-detection.js')

beforeEach(() => {
  store = createStore()
  store.tables['platform_incidents'] = []
  store.tables['platform_incident_events'] = []
  notifyPlatformTeam.mockClear()
  notifyPlatformTeam.mockResolvedValue(undefined)
  delete process.env['PLATFORM_AUTO_DETECT']
})

describe('autoDetectionEnabled', () => {
  it('is off when the flag is unset — the shipping default', () => {
    expect(autoDetectionEnabled()).toBe(false)
  })

  it('is off for any value other than an explicit true', () => {
    // A flag this consequential should be switched on by someone who read the
    // docs, not by someone who guessed at the spelling.
    process.env['PLATFORM_AUTO_DETECT'] = '1'
    expect(autoDetectionEnabled()).toBe(false)
    process.env['PLATFORM_AUTO_DETECT'] = 'yes'
    expect(autoDetectionEnabled()).toBe(false)
    process.env['PLATFORM_AUTO_DETECT'] = 'TRUE'
    expect(autoDetectionEnabled()).toBe(false)
  })

  it('is on only for "true"', () => {
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    expect(autoDetectionEnabled()).toBe(true)
  })
})

describe('maybeDeclareFromErrorRate', () => {
  it('declares nothing while the flag is off, however bad the spike', async () => {
    const id = await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 10_000 })
    expect(id).toBeNull()
    expect(store.tables['platform_incidents']).toHaveLength(0)
  })

  it('declares a SEV3 above the threshold when enabled', async () => {
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    const id = await maybeDeclareFromErrorRate({
      windowMinutes: 5,
      errorCount: AUTO_DETECT_ERROR_THRESHOLD + 1,
    })
    expect(id).toBeTruthy()
    expect((store.tables['platform_incidents'] as Row[])[0]!['severity']).toBe('sev3')
  })

  it('never auto-declares above SEV3', async () => {
    // A machine may say "something is wrong". Only a human decides that
    // merchants cannot take money.
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 1_000_000 })
    expect((store.tables['platform_incidents'] as Row[])[0]!['severity']).toBe('sev3')
  })

  it('stays quiet below the threshold', async () => {
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    const id = await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 3 })
    expect(id).toBeNull()
  })

  it('stays quiet exactly at the threshold', async () => {
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    const id = await maybeDeclareFromErrorRate({
      windowMinutes: 5,
      errorCount: AUTO_DETECT_ERROR_THRESHOLD,
    })
    expect(id).toBeNull()
  })

  it('does not open a second incident while one is already open', async () => {
    // A spike lasting twenty minutes is one incident, not four.
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 500 })
    await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 500 })
    await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 500 })
    expect(store.tables['platform_incidents']).toHaveLength(1)
  })

  it('opens a new one once the previous auto-declared incident is closed', async () => {
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 500 })
    ;(store.tables['platform_incidents'] as Row[])[0]!['status'] = 'closed'
    await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 500 })
    expect(store.tables['platform_incidents']).toHaveLength(2)
  })

  it('marks the incident as machine-declared on its timeline', async () => {
    // A reader should be able to tell a threshold fired from a person deciding.
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 500 })
    const events = (store.tables['platform_incident_events'] ?? []) as Row[]
    expect(events[0]!['actor_kind']).toBe('system')
  })

  it('never throws', async () => {
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    notifyPlatformTeam.mockRejectedValue(new Error('push is down'))
    await expect(
      maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 500 })
    ).resolves.toBeDefined()
  })
})
