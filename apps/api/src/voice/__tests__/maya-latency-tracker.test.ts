import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals'
import { MayaLatencyTracker } from '../maya-latency-tracker.js'

// ── Latency tracker unit tests ─────────────────────────────────────────────────

describe('MayaLatencyTracker', () => {
  let tracker: MayaLatencyTracker

  beforeEach(() => {
    tracker = new MayaLatencyTracker()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // 1. getStats() returns null when no turns have completed
  it('getStats() returns null with no completed turns', () => {
    expect(tracker.getStats()).toBeNull()

    // Even with partial activity (input sent but no complete turn) — still null
    tracker.onInputAudioSent()
    expect(tracker.getStats()).toBeNull()
  })

  // 2. Single turn: agent_response_ms equals the measured delta between
  //    onInputAudioSent and onFirstOutputAudio
  it('single turn: agent_response_ms equals the measured delta', () => {
    jest.useFakeTimers()

    jest.setSystemTime(1_000)
    tracker.onInputAudioSent()

    jest.setSystemTime(2_200) // 1200 ms later
    tracker.onFirstOutputAudio()
    tracker.onTurnComplete()

    const stats = tracker.getStats()
    expect(stats).not.toBeNull()
    expect(stats!.turn_count).toBe(1)
    expect(stats!.avg_agent_response_ms).toBe(1200)
    expect(stats!.p50_agent_response_ms).toBe(1200)
    expect(stats!.p95_agent_response_ms).toBe(1200)
    expect(stats!.turns).toHaveLength(1)
    expect(stats!.turns[0]!.agent_response_ms).toBe(1200)
    expect(stats!.turns[0]!.interrupted).toBe(false)
  })

  // 3. Multiple turns: avg and p95 computed correctly across the sample set
  it('multiple turns: avg and p95 computed correctly', () => {
    jest.useFakeTimers()

    // Turn 1 → 1000 ms
    jest.setSystemTime(0)
    tracker.onInputAudioSent()
    jest.setSystemTime(1_000)
    tracker.onFirstOutputAudio()
    tracker.onTurnComplete()

    // Turn 2 → 2000 ms
    jest.setSystemTime(2_000)
    tracker.onInputAudioSent()
    jest.setSystemTime(4_000)
    tracker.onFirstOutputAudio()
    tracker.onTurnComplete()

    // Turn 3 → 1500 ms
    jest.setSystemTime(5_000)
    tracker.onInputAudioSent()
    jest.setSystemTime(6_500)
    tracker.onFirstOutputAudio()
    tracker.onTurnComplete()

    const stats = tracker.getStats()
    expect(stats).not.toBeNull()
    expect(stats!.turn_count).toBe(3)

    // avg = round((1000 + 2000 + 1500) / 3) = 1500
    expect(stats!.avg_agent_response_ms).toBe(1500)

    // sorted = [1000, 1500, 2000]
    // p50: ceil(0.50 * 3) - 1 = ceil(1.5) - 1 = 2 - 1 = 1 → 1500
    expect(stats!.p50_agent_response_ms).toBe(1500)

    // p95: ceil(0.95 * 3) - 1 = ceil(2.85) - 1 = 3 - 1 = 2 → 2000
    expect(stats!.p95_agent_response_ms).toBe(2000)
  })

  // 4. interrupted flag set by onInterrupted() propagates to the turn record
  it('interrupted: true propagates to the committed turn record', () => {
    jest.useFakeTimers()

    jest.setSystemTime(0)
    tracker.onInputAudioSent()

    jest.setSystemTime(800)
    tracker.onFirstOutputAudio()

    tracker.onInterrupted() // user barged in before Gemini finished
    tracker.onTurnComplete()

    const stats = tracker.getStats()
    expect(stats).not.toBeNull()
    expect(stats!.turns).toHaveLength(1)
    expect(stats!.turns[0]!.interrupted).toBe(true)
    expect(stats!.turns[0]!.agent_response_ms).toBe(800)
  })
})
