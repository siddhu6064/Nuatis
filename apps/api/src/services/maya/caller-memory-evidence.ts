/**
 * caller-memory-evidence.ts
 * Evidence ledger for Maya cross-call memory facts.
 *
 * Adapted from Comp AI's open-source CRM evidence model (MIT), re-priced for
 * the voice-call context. Core principle preserved verbatim:
 *
 *   THE MODEL NEVER SETS A CONFIDENCE. It reports what it observed (a kind
 *   plus a detail string); this module prices it. A model asked to grade its
 *   own certainty will be wrong in the direction that makes it look useful.
 *
 * Placement: same directory as memory-prompts.ts (imported by
 * maya-memory-extractor.ts in place of mergeFacts() for scalar fields).
 *
 * Conventions honoured: no console.log (banned); no new npm dependencies;
 * pure functions — no DB access, no imports from memory-prompts.ts (keeps
 * this lib's tests independent of the extractor/prompt wiring).
 */

// ---------------------------------------------------------------------------
// Evidence kinds — voice-call sources, strongest to weakest
// ---------------------------------------------------------------------------

export type EvidenceKind =
  | 'caller.confirmed' // Maya asked, caller explicitly confirmed ("yes, that's right")
  | 'booking.action' // derived from a completed tool call (book_appointment) — system fact
  | 'caller.stated-directly' // caller said it about themselves in their own words
  | 'caller.stated-earlier-call' // carried forward from a prior call where it was stated (extractor citing memory block)
  | 'caller.implied' // inferable from context but never stated ("we usually come in on Fridays")
  | 'third-party.mention' // someone else on the line said it, or caller said it about another person
  | 'model.inference' // Gemini inferred it; no utterance supports it directly
  | 'contradiction' // recorded when a new observation conflicts with existing evidence

type Weighting = {
  weight: number
  primary: boolean
  label: string
}

export const WEIGHTS: Record<EvidenceKind, Weighting> = {
  'caller.confirmed': {
    weight: 0.95,
    primary: true,
    label: 'the caller explicitly confirmed it',
  },
  'booking.action': {
    weight: 0.95,
    primary: true,
    label: 'it comes from a completed booking action',
  },
  'caller.stated-directly': {
    weight: 0.9,
    primary: true,
    label: 'the caller stated it about themselves',
  },
  'caller.stated-earlier-call': {
    weight: 0.75,
    primary: true,
    label: 'the caller stated it on an earlier call',
  },
  'caller.implied': {
    weight: 0.45,
    primary: false,
    label: 'implied by what the caller said, not stated',
  },
  'third-party.mention': {
    weight: 0.3,
    primary: false,
    label: 'mentioned by or about a third party',
  },
  'model.inference': {
    weight: 0.35,
    primary: false,
    label: 'inferred by the model, no supporting utterance',
  },
  contradiction: {
    weight: 0,
    primary: false,
    label: 'another observation disagrees',
  },
}

/** Facts on legacy rows (pre-0137, evidence = {}) are priced at this weight. */
export const LEGACY_WEIGHT = 0.5

/** Below this weight a new observation may fill a BLANK field but never overwrite. */
export const WRITE_THRESHOLD = 0.6

/** held[] is capped; oldest entries dropped first. */
export const HELD_CAP = 20

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FactEvidence = {
  kind: EvidenceKind
  weight: number // priced here, never model-supplied
  detail: string // shown to staff in CallerMemoryCard tooltip — write it for them
  observed_at: string // ISO timestamp
  call_session_id?: string
}

export type HeldFact = {
  field: string
  value: unknown
  kind: EvidenceKind
  weight: number
  detail: string
  reason: 'conflicts-with-stronger' | 'superseded'
  observed_at: string
}

/** What the extractor hands us per fact: kind + detail only. No weight. */
export type Observation = {
  kind: EvidenceKind
  detail: string
}

export type EvidenceLedger = Record<string, FactEvidence>

// Matches the existing facts JSONB shape (0111 + 0137's last_provider carry-forward). Unchanged shape otherwise.
export type CallerFacts = {
  name?: string | null
  preferred_name?: string | null
  last_appointment_type?: string | null
  last_appointment_date?: string | null
  last_provider?: string | null
  pending_needs?: string[] | null
  preferences?: string[] | null
  sentiment?: string | null
  language?: string | null
  topics?: string[] | null
}

/**
 * Per-call observations, not identity facts. These bypass the ledger entirely:
 * incoming always wins, exactly as mergeFacts() behaves today.
 */
const PER_CALL_FIELDS = new Set(['sentiment', 'language'])

/** Array fields: union-merge with case-insensitive dedupe, as today. No per-item evidence (scope control). */
const ARRAY_FIELDS = new Set(['pending_needs', 'preferences', 'topics'])

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export function priceObservation(
  obs: Observation,
  observedAt: string,
  callSessionId?: string
): FactEvidence {
  const priced = WEIGHTS[obs.kind] ?? WEIGHTS['model.inference']
  return {
    kind: WEIGHTS[obs.kind] ? obs.kind : 'model.inference',
    weight: priced.weight,
    detail: obs.detail.slice(0, 300),
    observed_at: observedAt,
    ...(callSessionId ? { call_session_id: callSessionId } : {}),
  }
}

/** Weight of the evidence currently backing a field. Legacy facts price at LEGACY_WEIGHT. */
export function existingWeight(ledger: EvidenceLedger, field: string, hasValue: boolean): number {
  if (!hasValue) return 0
  return ledger[field]?.weight ?? LEGACY_WEIGHT
}

// ---------------------------------------------------------------------------
// Evidence-aware merge — replaces mergeFacts() for scalar fields
// ---------------------------------------------------------------------------

export type MergeInput = {
  existingFacts: CallerFacts
  existingEvidence: EvidenceLedger
  existingHeld: HeldFact[]
  incomingFacts: CallerFacts
  /** kind + detail per incoming scalar field, from the extractor. Missing entry → model.inference. */
  incomingObservations: Record<string, Observation>
  observedAt: string // ISO now
  callSessionId?: string
}

export type MergeResult = {
  facts: CallerFacts
  evidence: EvidenceLedger
  held: HeldFact[]
}

/**
 * Rules (voice adaptation of the Comp AI ledger):
 *  - null/undefined incoming NEVER overwrites a real value (unchanged).
 *  - sentiment/language: incoming always wins, no ledger (per-call state, unchanged).
 *  - arrays: union-merge, case-insensitive dedupe via Map keyed on .toLowerCase() (unchanged).
 *  - scalar, existing blank: write if weight >= WRITE_THRESHOLD; weak evidence
 *    (below threshold) still fills a blank — a low-confidence value beats an
 *    empty field — but is recorded at its true weight so anything stronger
 *    later replaces it.
 *  - scalar, same value (case-insensitive string compare): keep value, upgrade
 *    the ledger entry if the new observation is stronger.
 *  - scalar conflict:
 *      incoming weight >= existing weight  → incoming wins (the caller is the
 *        authority on themselves, and recency matters on the phone); the old
 *        value is pushed to held[] as "superseded" so nothing is silently lost.
 *      incoming weight <  existing weight  → existing kept; incoming pushed to
 *        held[] as "conflicts-with-stronger". Weak never overwrites strong.
 *  - held[] capped at HELD_CAP, oldest dropped.
 *  - last_provider is a normal scalar — no special-cased handling, it flows
 *    through this same path automatically.
 */
export function mergeFactsWithEvidence(input: MergeInput): MergeResult {
  const {
    existingFacts,
    existingEvidence,
    existingHeld,
    incomingFacts,
    incomingObservations,
    observedAt,
    callSessionId,
  } = input

  const facts: CallerFacts = { ...existingFacts }
  const evidence: EvidenceLedger = { ...existingEvidence }
  const held: HeldFact[] = [...existingHeld]

  for (const [field, rawIncoming] of Object.entries(incomingFacts)) {
    if (rawIncoming === null || rawIncoming === undefined) continue

    // Per-call state: incoming always wins, no ledger.
    if (PER_CALL_FIELDS.has(field)) {
      ;(facts as Record<string, unknown>)[field] = rawIncoming
      continue
    }

    // Arrays: union-merge, case-insensitive dedupe.
    if (ARRAY_FIELDS.has(field)) {
      const current = (facts as Record<string, unknown>)[field]
      const currentArr = Array.isArray(current) ? current : []
      const incomingArr = Array.isArray(rawIncoming) ? rawIncoming : []
      const map = new Map<string, string>()
      for (const item of [...currentArr, ...incomingArr]) {
        if (typeof item === 'string' && item.trim()) {
          const key = item.trim().toLowerCase()
          if (!map.has(key)) map.set(key, item.trim()) // first-seen casing wins
        }
      }
      ;(facts as Record<string, unknown>)[field] = [...map.values()]
      continue
    }

    // Scalars.
    const incoming = typeof rawIncoming === 'string' ? rawIncoming.trim() : rawIncoming
    if (incoming === '') continue

    const obs: Observation = incomingObservations[field] ?? {
      kind: 'model.inference',
      detail: 'no observation supplied by extractor',
    }
    const priced = priceObservation(obs, observedAt, callSessionId)

    const existingValue = (facts as Record<string, unknown>)[field]
    const hasExisting =
      existingValue !== null && existingValue !== undefined && existingValue !== ''

    if (!hasExisting) {
      // Blank field: any evidence fills it, recorded at true weight.
      ;(facts as Record<string, unknown>)[field] = incoming
      evidence[field] = priced
      continue
    }

    const same =
      typeof existingValue === 'string' && typeof incoming === 'string'
        ? existingValue.trim().toLowerCase() === incoming.toLowerCase()
        : existingValue === incoming

    const currentWeight = existingWeight(evidence, field, true)

    if (same) {
      // Reinforcement: keep value, keep the strongest evidence.
      if (priced.weight > currentWeight) evidence[field] = priced
      continue
    }

    // Conflict.
    if (priced.weight >= currentWeight) {
      // Incoming wins; retire the old value into held[] so it is auditable.
      pushHeld(held, {
        field,
        value: existingValue,
        kind: evidence[field]?.kind ?? 'model.inference',
        weight: currentWeight,
        detail: evidence[field]?.detail ?? 'legacy fact (pre-ledger)',
        reason: 'superseded',
        observed_at: evidence[field]?.observed_at ?? observedAt,
      })
      ;(facts as Record<string, unknown>)[field] = incoming
      evidence[field] = priced
    } else {
      // Weak never overwrites strong; the observation is held, not lost.
      pushHeld(held, {
        field,
        value: incoming,
        kind: priced.kind,
        weight: priced.weight,
        detail: priced.detail,
        reason: 'conflicts-with-stronger',
        observed_at: observedAt,
      })
    }
  }

  return { facts, evidence, held }
}

function pushHeld(held: HeldFact[], entry: HeldFact): void {
  held.push(entry)
  while (held.length > HELD_CAP) held.shift()
}
