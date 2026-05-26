import { describe, it, expect, beforeEach } from '@jest/globals'
import { MayaCircuitBreaker } from '../maya-circuit-breaker.js'

// ── helpers ────────────────────────────────────────────────────────────────────

/** Returns a function that always rejects (simulates a flaky downstream). */
function alwaysFail(msg = 'downstream error'): () => Promise<string> {
  return async () => {
    throw new Error(msg)
  }
}

/** Returns a function that always resolves with the given payload. */
function alwaysSucceed(payload = 'ok'): () => Promise<string> {
  return async () => payload
}

// ── Circuit breaker unit tests ─────────────────────────────────────────────────

describe('MayaCircuitBreaker', () => {
  let cb: MayaCircuitBreaker

  beforeEach(() => {
    cb = new MayaCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000 })
  })

  // 1. CLOSED: calls pass through and return the fn result
  it('CLOSED: allows calls through and returns fn result', async () => {
    const result = await cb.wrap('test_tool', alwaysSucceed('payload_123'))
    expect(result).toBe('payload_123')
    expect(cb.getStatus()['test_tool']?.state).toBe('closed')
  })

  // 2. Trips OPEN after failureThreshold consecutive failures
  it('trips OPEN after threshold consecutive failures', async () => {
    await cb.wrap('test_tool', alwaysFail())
    await cb.wrap('test_tool', alwaysFail())
    await cb.wrap('test_tool', alwaysFail()) // 3rd — trips OPEN

    expect(cb.getStatus()['test_tool']?.state).toBe('open')
    expect(cb.getStatus()['test_tool']?.consecutiveFailures).toBe(3)
  })

  // 3. OPEN: returns fallback immediately without invoking fn
  it('OPEN: returns fallback without calling fn', async () => {
    // Trip the breaker
    await cb.wrap('test_tool', alwaysFail())
    await cb.wrap('test_tool', alwaysFail())
    await cb.wrap('test_tool', alwaysFail())

    let fnCalled = false
    const probe = async (): Promise<string> => {
      fnCalled = true
      return 'should_not_be_called'
    }

    const result = await cb.wrap('test_tool', probe)

    expect(fnCalled).toBe(false)

    // Fallback must be valid JSON with _breaker_open flag
    const parsed = JSON.parse(result) as Record<string, unknown>
    expect(parsed['_breaker_open']).toBe(true)
    expect(typeof parsed['message']).toBe('string')
    expect((parsed['message'] as string).length).toBeGreaterThan(0)
  })

  // 4. OPEN → HALF_OPEN after cooldown; successful probe resets to CLOSED
  it('OPEN → HALF_OPEN after cooldown; success resets to CLOSED', async () => {
    let now = 0
    const clock = (): number => now

    const timedCb = new MayaCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000, clock })

    // Trip breaker at t=0
    await timedCb.wrap('tool', alwaysFail())
    await timedCb.wrap('tool', alwaysFail())
    await timedCb.wrap('tool', alwaysFail())
    expect(timedCb.getStatus()['tool']?.state).toBe('open')

    // Advance past cooldown
    now = 61_000
    const result = await timedCb.wrap('tool', alwaysSucceed('recovered'))

    expect(result).toBe('recovered')
    expect(timedCb.getStatus()['tool']?.state).toBe('closed')
    expect(timedCb.getStatus()['tool']?.consecutiveFailures).toBe(0)
  })

  // 5. HALF_OPEN: failure on probe re-opens breaker
  it('HALF_OPEN: failure on probe re-opens breaker', async () => {
    let now = 0
    const clock = (): number => now

    const timedCb = new MayaCircuitBreaker({ failureThreshold: 3, cooldownMs: 60_000, clock })

    // Trip breaker at t=0
    await timedCb.wrap('tool', alwaysFail())
    await timedCb.wrap('tool', alwaysFail())
    await timedCb.wrap('tool', alwaysFail())

    // Advance into HALF_OPEN window
    now = 61_000
    // Probe fails — should snap back to OPEN
    const result = await timedCb.wrap('tool', alwaysFail())

    const parsed = JSON.parse(result) as Record<string, unknown>
    expect(parsed['_breaker_open']).toBe(true)
    expect(timedCb.getStatus()['tool']?.state).toBe('open')
    // openedAt updated to `now`
    expect(timedCb.getStatus()['tool']?.cooldownRemainingMs).toBeGreaterThan(0)
  })
})

// ── Integration smoke test ─────────────────────────────────────────────────────

describe('MayaCircuitBreaker — integration smoke', () => {
  // Simulates the pattern used in tool-handlers.ts:
  //   getMayaCircuitBreaker().wrap(toolName, async () => { /* supabase call */ })
  // When Supabase throws, wrap() must return valid non-empty fallback JSON
  // with no top-level "error" key (matches the tool-handler caller contract).
  it('downstream throws → wrap returns non-empty fallback JSON with no error key', async () => {
    const cb = new MayaCircuitBreaker({ failureThreshold: 3 })

    // Simulate Supabase (or any downstream) throwing inside the handler callback
    const simulateSupabaseThrow = async (): Promise<string> => {
      throw new Error('Connection refused: Supabase unreachable')
    }

    const result = await cb.wrap('lookup_contact', simulateSupabaseThrow)

    // Must be parseable JSON
    let parsed: Record<string, unknown>
    expect(() => {
      parsed = JSON.parse(result) as Record<string, unknown>
    }).not.toThrow()

    // Non-empty
    expect(Object.keys(parsed!).length).toBeGreaterThan(0)

    // No "error" key — callers must not receive a raw error object
    expect(parsed!).not.toHaveProperty('error')

    // Circuit-breaker contract: includes the open flag and a human message
    expect(parsed!['_breaker_open']).toBe(true)
    expect(typeof parsed!['message']).toBe('string')
    expect((parsed!['message'] as string).length).toBeGreaterThan(0)
  })
})
