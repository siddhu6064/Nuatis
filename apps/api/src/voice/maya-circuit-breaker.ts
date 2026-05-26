/**
 * Per-tool circuit breaker for Maya's tool calls.
 *
 * Prevents a flaky downstream from hanging a live call.
 * After FAILURE_THRESHOLD consecutive failures the breaker trips OPEN
 * and returns a caller-facing fallback string immediately.
 *
 * States:
 *   CLOSED    → normal; calls pass through
 *   OPEN      → tripped; calls rejected for COOLDOWN_MS
 *   HALF_OPEN → one probe allowed; success resets to CLOSED, failure reopens
 */

export type BreakerState = 'closed' | 'open' | 'half_open'

interface PerToolState {
  state: BreakerState
  consecutiveFailures: number
  openedAt: number
}

export interface BreakerSnapshot {
  state: BreakerState
  consecutiveFailures: number
  cooldownRemainingMs: number
}

const FAILURE_THRESHOLD = 3
const COOLDOWN_MS = 60_000
export const TOOL_TIMEOUT_MS = 8_000

// Caller-facing messages — never mention "error" or "internal".
// Gemini will speak these verbatim when the circuit is OPEN.
const FALLBACK_MESSAGES: Record<string, string> = {
  check_availability:
    "I'm having a brief issue checking availability. Let me grab your details and have someone confirm the time slot with you directly.",
  book_appointment:
    "I wasn't able to complete that booking due to a technical issue. I've noted your request and someone will call you back to confirm.",
  get_services:
    "I'm having a moment of trouble loading our services list. The team can walk you through everything — would you like me to transfer you?",
  create_quote:
    "I wasn't able to generate that quote right now. Someone will follow up with the pricing details.",
  get_business_hours:
    "I'm having trouble pulling up our hours right now. You can check our website or call back and we'll get that for you.",
  send_sms: "I wasn't able to send that confirmation at the moment, but your information is noted.",
  transfer_call:
    "I'm having difficulty with the transfer right now. Please try the main number directly.",
  default:
    "I'm experiencing a brief technical issue with that request. The team will follow up with you shortly.",
}

function getFallback(toolName: string): string {
  return FALLBACK_MESSAGES[toolName] ?? FALLBACK_MESSAGES['default']!
}

export class MayaCircuitBreaker {
  private readonly threshold: number
  private readonly cooldownMs: number
  private readonly timeoutMs: number
  private readonly clock: () => number
  private readonly registry = new Map<string, PerToolState>()

  constructor(
    opts: {
      failureThreshold?: number
      cooldownMs?: number
      timeoutMs?: number // inject for deterministic tests
      clock?: () => number // inject for deterministic tests
    } = {}
  ) {
    this.threshold = opts.failureThreshold ?? FAILURE_THRESHOLD
    this.cooldownMs = opts.cooldownMs ?? COOLDOWN_MS
    this.timeoutMs = opts.timeoutMs ?? TOOL_TIMEOUT_MS
    this.clock = opts.clock ?? Date.now
  }

  private ensure(toolName: string): PerToolState {
    if (!this.registry.has(toolName)) {
      this.registry.set(toolName, { state: 'closed', consecutiveFailures: 0, openedAt: 0 })
    }
    return this.registry.get(toolName)!
  }

  private isAllowed(toolName: string): boolean {
    const s = this.ensure(toolName)
    if (s.state === 'closed') return true
    if (s.state === 'open') {
      if (this.clock() - s.openedAt >= this.cooldownMs) {
        s.state = 'half_open'
        console.info(`[maya-breaker] ${toolName}: OPEN → HALF_OPEN (probing)`)
        return true
      }
      return false
    }
    return true // half_open: allow probe
  }

  private recordSuccess(toolName: string): void {
    const s = this.ensure(toolName)
    if (s.state !== 'closed') {
      console.info(`[maya-breaker] ${toolName}: ${s.state.toUpperCase()} → CLOSED`)
    }
    s.state = 'closed'
    s.consecutiveFailures = 0
    s.openedAt = 0
  }

  private recordFailure(toolName: string): void {
    const s = this.ensure(toolName)
    s.consecutiveFailures += 1
    if (s.state === 'half_open' || s.consecutiveFailures >= this.threshold) {
      s.state = 'open'
      s.openedAt = this.clock()
      console.warn(
        `[maya-breaker] ${toolName}: OPEN after ${s.consecutiveFailures} failure(s). ` +
          `Cooldown ${this.cooldownMs / 1000}s.`
      )
    }
  }

  /**
   * Wrap a tool function with circuit-breaker + timeout.
   * Never throws — always returns a string Gemini can speak.
   */
  async wrap(toolName: string, fn: () => Promise<string>): Promise<string> {
    if (!this.isAllowed(toolName)) {
      const s = this.ensure(toolName)
      const remaining = Math.round((this.cooldownMs - (this.clock() - s.openedAt)) / 1000)
      console.warn(`[maya-breaker] ${toolName}: OPEN — skipping. ${remaining}s remaining.`)
      return getFallback(toolName)
    }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`Tool '${toolName}' timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs
      )
    })

    try {
      const result = await Promise.race([fn(), timeoutPromise])
      clearTimeout(timeoutHandle)
      this.recordSuccess(toolName)
      return result
    } catch (err) {
      clearTimeout(timeoutHandle)
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[maya-breaker] ${toolName} error: ${msg}`)
      this.recordFailure(toolName)
      return getFallback(toolName)
    }
  }

  getStatus(): Record<string, BreakerSnapshot> {
    const out: Record<string, BreakerSnapshot> = {}
    for (const [name, s] of this.registry.entries()) {
      out[name] = {
        state: s.state,
        consecutiveFailures: s.consecutiveFailures,
        cooldownRemainingMs:
          s.state === 'open' ? Math.max(0, this.cooldownMs - (this.clock() - s.openedAt)) : 0,
      }
    }
    return out
  }

  reset(): void {
    this.registry.clear()
  }
}

// Process-level singleton — shared across all concurrent calls in the process.
let _singleton: MayaCircuitBreaker | null = null

export function getMayaCircuitBreaker(): MayaCircuitBreaker {
  if (!_singleton) _singleton = new MayaCircuitBreaker()
  return _singleton
}

export function _setMayaCircuitBreaker(cb: MayaCircuitBreaker): void {
  _singleton = cb
}
