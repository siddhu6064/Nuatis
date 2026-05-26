/**
 * Per-session turn latency tracker for Maya.
 *
 * Measures agent_response_ms per turn:
 *   last user audio chunk forwarded to Gemini
 *   → first Gemini audio chunk received
 *
 * This approximates the user-perceived response latency. In Gemini Live,
 * STT/LLM/TTS are all internal to the model — we can't decompose them.
 * agent_response_ms is the composite we can actually measure.
 *
 * Usage in gemini-live.ts:
 *   const tracker = new MayaLatencyTracker();
 *   // every time we forward audio to Gemini:
 *   tracker.onInputAudioSent();
 *   // when we receive the first audio chunk of a new model turn:
 *   tracker.onFirstOutputAudio();
 *   // when serverContent.interrupted = true:
 *   tracker.onInterrupted();
 *   // when serverContent.turnComplete = true:
 *   tracker.onTurnComplete();
 *   // at session end:
 *   const stats = tracker.getStats(); // null if no complete turns
 */

export interface TurnLatency {
  turn: number
  agent_response_ms: number
  interrupted: boolean
}

export interface LatencyBreakdown {
  turn_count: number
  avg_agent_response_ms: number
  p50_agent_response_ms: number
  p95_agent_response_ms: number
  turns: TurnLatency[]
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((pct / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)] ?? 0
}

export class MayaLatencyTracker {
  private completedTurns: TurnLatency[] = []
  private turnCount = 0

  private lastInputAt: number | null = null
  private firstOutputAt: number | null = null
  private currentTurnInterrupted = false
  private outputRecorded = false // guard — only take the FIRST output chunk per turn

  /** Call every time we forward an audio chunk from Telnyx to Gemini. */
  onInputAudioSent(): void {
    this.lastInputAt = Date.now()
  }

  /**
   * Call when we receive the first audio chunk of a new Gemini model turn.
   * Subsequent chunks in the same turn are ignored.
   */
  onFirstOutputAudio(): void {
    if (this.outputRecorded) return // already have the first chunk for this turn
    if (this.lastInputAt === null) return // no input baseline yet
    this.firstOutputAt = Date.now()
    this.outputRecorded = true
  }

  /** Call when serverContent.interrupted = true. */
  onInterrupted(): void {
    this.currentTurnInterrupted = true
  }

  /**
   * Call when serverContent.turnComplete = true (Gemini finished its turn).
   * Commits the turn's latency sample and resets state for the next turn.
   */
  onTurnComplete(): void {
    if (this.lastInputAt !== null && this.firstOutputAt !== null) {
      const delta = this.firstOutputAt - this.lastInputAt
      // Sanity bounds: ignore negative values and anything over 30 s
      // (could happen if lastInputAt is stale from a very long silence).
      if (delta > 0 && delta < 30_000) {
        this.turnCount += 1
        this.completedTurns.push({
          turn: this.turnCount,
          agent_response_ms: delta,
          interrupted: this.currentTurnInterrupted,
        })
      }
    }

    // Reset per-turn state (keep lastInputAt — updated on next user speech)
    this.firstOutputAt = null
    this.outputRecorded = false
    this.currentTurnInterrupted = false
  }

  /**
   * Compute summary stats. Call at session end.
   * Returns null if no turns were completed (e.g. call dropped immediately).
   */
  getStats(): LatencyBreakdown | null {
    if (this.completedTurns.length === 0) return null

    const samples = this.completedTurns.map((t) => t.agent_response_ms)
    const sorted = [...samples].sort((a, b) => a - b)
    const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length)

    return {
      turn_count: this.completedTurns.length,
      avg_agent_response_ms: avg,
      p50_agent_response_ms: percentile(sorted, 50),
      p95_agent_response_ms: percentile(sorted, 95),
      turns: [...this.completedTurns],
    }
  }
}
