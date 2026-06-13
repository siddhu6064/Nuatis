import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// Mock posthog-node so no real network client is constructed.
const mockCapture = jest.fn()
const mockFlush = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
const PostHogCtor = jest.fn().mockImplementation(() => ({
  capture: mockCapture,
  flush: mockFlush,
}))

jest.unstable_mockModule('posthog-node', () => ({
  PostHog: PostHogCtor,
}))

const { capture, shutdownPostHog, __resetPostHogClientForTests } = await import('./posthog.js')

beforeEach(() => {
  PostHogCtor.mockClear()
  mockCapture.mockClear()
  mockFlush.mockClear()
  __resetPostHogClientForTests()
  delete process.env['POSTHOG_KEY']
  delete process.env['POSTHOG_HOST']
})

afterEach(() => {
  delete process.env['POSTHOG_KEY']
  delete process.env['POSTHOG_HOST']
})

describe('capture()', () => {
  it('no-ops when POSTHOG_KEY is unset (zero client construction, zero capture)', () => {
    capture('user-1', 'some_event', { tenant_id: 't1' })
    expect(PostHogCtor).not.toHaveBeenCalled()
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('captures via the client when POSTHOG_KEY is set', () => {
    process.env['POSTHOG_KEY'] = 'phc_test'
    capture('user-1', 'some_event', { tenant_id: 't1' })
    expect(PostHogCtor).toHaveBeenCalledTimes(1)
    expect(mockCapture).toHaveBeenCalledWith({
      distinctId: 'user-1',
      event: 'some_event',
      properties: { tenant_id: 't1' },
    })
  })

  it('passes POSTHOG_HOST through to the client when set', () => {
    process.env['POSTHOG_KEY'] = 'phc_test'
    process.env['POSTHOG_HOST'] = 'https://eu.i.posthog.com'
    capture('user-1', 'evt')
    expect(PostHogCtor).toHaveBeenCalledWith('phc_test', { host: 'https://eu.i.posthog.com' })
  })

  it('swallows client errors and never throws', () => {
    process.env['POSTHOG_KEY'] = 'phc_test'
    mockCapture.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => capture('user-1', 'evt', { tenant_id: 't1' })).not.toThrow()
  })
})

describe('shutdownPostHog()', () => {
  it('no-ops when no client was created', async () => {
    await expect(shutdownPostHog()).resolves.toBeUndefined()
    expect(mockFlush).not.toHaveBeenCalled()
  })

  it('flushes queued events when a client exists', async () => {
    process.env['POSTHOG_KEY'] = 'phc_test'
    capture('user-1', 'evt')
    await shutdownPostHog()
    expect(mockFlush).toHaveBeenCalledTimes(1)
  })
})
