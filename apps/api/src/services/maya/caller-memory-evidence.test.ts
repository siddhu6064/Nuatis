/**
 * Tests for mergeFactsWithEvidence — mirrors the mergeFacts test style
 * (unit, no DB). Framework: Jest.
 */
import { describe, it, expect } from '@jest/globals'
import {
  HELD_CAP,
  LEGACY_WEIGHT,
  WEIGHTS,
  mergeFactsWithEvidence,
  priceObservation,
  type EvidenceLedger,
  type HeldFact,
  type MergeInput,
} from './caller-memory-evidence.js'

const NOW = '2026-08-03T12:00:00.000Z'

function merge(overrides: Partial<MergeInput>) {
  return mergeFactsWithEvidence({
    existingFacts: {},
    existingEvidence: {},
    existingHeld: [],
    incomingFacts: {},
    incomingObservations: {},
    observedAt: NOW,
    callSessionId: 'cs_test',
    ...overrides,
  })
}

describe('priceObservation', () => {
  it('prices weight server-side from the kind', () => {
    const priced = priceObservation(
      { kind: 'caller.stated-directly', detail: "said 'my name is Priya'" },
      NOW
    )
    expect(priced.weight).toBe(WEIGHTS['caller.stated-directly'].weight)
  })

  it('coerces unknown kinds to model.inference', () => {
    const priced = priceObservation({ kind: 'made.up-kind' as never, detail: 'x' }, NOW)
    expect(priced.kind).toBe('model.inference')
    expect(priced.weight).toBe(WEIGHTS['model.inference'].weight)
  })

  it('truncates detail at 300 chars', () => {
    const priced = priceObservation({ kind: 'caller.implied', detail: 'x'.repeat(500) }, NOW)
    expect(priced.detail.length).toBe(300)
  })
})

describe('mergeFactsWithEvidence — unchanged legacy behaviours', () => {
  it('null incoming never overwrites a real value', () => {
    const result = merge({
      existingFacts: { name: 'Priya' },
      incomingFacts: { name: null },
    })
    expect(result.facts.name).toBe('Priya')
  })

  it('sentiment: incoming always wins, no ledger entry', () => {
    const result = merge({
      existingFacts: { sentiment: 'positive' },
      incomingFacts: { sentiment: 'frustrated' },
    })
    expect(result.facts.sentiment).toBe('frustrated')
    expect(result.evidence.sentiment).toBeUndefined()
  })

  it('arrays union-merge with case-insensitive dedupe', () => {
    const result = merge({
      existingFacts: { preferences: ['Morning slots'] },
      incomingFacts: { preferences: ['morning slots', 'Dr. Chen'] },
    })
    expect(result.facts.preferences).toEqual(['Morning slots', 'Dr. Chen'])
  })
})

describe('mergeFactsWithEvidence — blanks', () => {
  it('strong evidence fills a blank and records the ledger entry', () => {
    const result = merge({
      incomingFacts: { name: 'Priya' },
      incomingObservations: {
        name: { kind: 'caller.stated-directly', detail: "said 'it's Priya'" },
      },
    })
    expect(result.facts.name).toBe('Priya')
    expect(result.evidence.name?.kind).toBe('caller.stated-directly')
    expect(result.evidence.name?.call_session_id).toBe('cs_test')
  })

  it('weak evidence still fills a blank, priced at its true weight', () => {
    const result = merge({
      incomingFacts: { name: 'Priya' },
      incomingObservations: {
        name: { kind: 'model.inference', detail: 'greeting sounded like Priya' },
      },
    })
    expect(result.facts.name).toBe('Priya')
    expect(result.evidence.name?.weight).toBe(WEIGHTS['model.inference'].weight)
  })

  it('scalar with no observation defaults to model.inference', () => {
    const result = merge({
      incomingFacts: { preferred_name: 'Pri' },
    })
    expect(result.evidence.preferred_name?.kind).toBe('model.inference')
  })

  it('last_provider is a plain scalar — no special handling, same blank-fill path as any other field', () => {
    const result = merge({
      incomingFacts: { last_provider: 'Dr. Chen' },
      incomingObservations: {
        last_provider: { kind: 'caller.stated-directly', detail: "said 'I saw Dr. Chen'" },
      },
    })
    expect(result.facts.last_provider).toBe('Dr. Chen')
    expect(result.evidence.last_provider?.kind).toBe('caller.stated-directly')
  })
})

describe('mergeFactsWithEvidence — reinforcement', () => {
  it('same value (case-insensitive) upgrades the evidence, keeps the value', () => {
    const existingEvidence: EvidenceLedger = {
      name: priceObservation(
        { kind: 'model.inference', detail: 'guessed' },
        '2026-07-01T00:00:00.000Z'
      ),
    }
    const result = merge({
      existingFacts: { name: 'priya' },
      existingEvidence,
      incomingFacts: { name: 'Priya' },
      incomingObservations: {
        name: { kind: 'caller.confirmed', detail: 'confirmed spelling' },
      },
    })
    expect(result.facts.name).toBe('priya') // value kept, not churned
    expect(result.evidence.name?.kind).toBe('caller.confirmed')
    expect(result.held).toHaveLength(0)
  })

  it('same value with weaker evidence does not downgrade the ledger', () => {
    const existingEvidence: EvidenceLedger = {
      name: priceObservation(
        { kind: 'caller.confirmed', detail: 'confirmed' },
        '2026-07-01T00:00:00.000Z'
      ),
    }
    const result = merge({
      existingFacts: { name: 'Priya' },
      existingEvidence,
      incomingFacts: { name: 'Priya' },
      incomingObservations: {
        name: { kind: 'model.inference', detail: 'mentioned' },
      },
    })
    expect(result.evidence.name?.kind).toBe('caller.confirmed')
  })
})

describe('mergeFactsWithEvidence — conflicts', () => {
  it('stronger incoming supersedes; old value auditable in held[]', () => {
    const existingEvidence: EvidenceLedger = {
      name: priceObservation(
        { kind: 'model.inference', detail: 'guessed from greeting' },
        '2026-07-01T00:00:00.000Z'
      ),
    }
    const result = merge({
      existingFacts: { name: 'Pria' },
      existingEvidence,
      incomingFacts: { name: 'Priya' },
      incomingObservations: {
        name: { kind: 'caller.stated-directly', detail: 'spelled P-R-I-Y-A' },
      },
    })
    expect(result.facts.name).toBe('Priya')
    expect(result.held).toHaveLength(1)
    expect(result.held[0]).toMatchObject({
      field: 'name',
      value: 'Pria',
      reason: 'superseded',
    })
  })

  it('weaker incoming never overwrites; observation held, not lost', () => {
    const existingEvidence: EvidenceLedger = {
      name: priceObservation(
        { kind: 'caller.confirmed', detail: 'confirmed spelling' },
        '2026-07-01T00:00:00.000Z'
      ),
    }
    const result = merge({
      existingFacts: { name: 'Priya' },
      existingEvidence,
      incomingFacts: { name: 'Maya' },
      incomingObservations: {
        name: { kind: 'third-party.mention', detail: 'husband called her Maya?' },
      },
    })
    expect(result.facts.name).toBe('Priya')
    expect(result.held[0]).toMatchObject({
      field: 'name',
      value: 'Maya',
      reason: 'conflicts-with-stronger',
    })
  })

  it('legacy facts (no ledger) price at LEGACY_WEIGHT — primary evidence beats them', () => {
    const result = merge({
      existingFacts: { name: 'Pria' }, // pre-0137 row: evidence = {}
      incomingFacts: { name: 'Priya' },
      incomingObservations: {
        name: { kind: 'caller.stated-directly', detail: 'stated their name' },
      },
    })
    expect(result.facts.name).toBe('Priya')
    expect(result.held[0]?.weight).toBe(LEGACY_WEIGHT)
  })

  it('legacy facts survive a weak observation', () => {
    const result = merge({
      existingFacts: { name: 'Priya' },
      incomingFacts: { name: 'Maya' },
      incomingObservations: {
        name: { kind: 'model.inference', detail: 'unsure' },
      },
    })
    expect(result.facts.name).toBe('Priya')
  })
})

describe('mergeFactsWithEvidence — held cap', () => {
  it('held[] caps at HELD_CAP, oldest dropped', () => {
    const existingHeld: HeldFact[] = Array.from({ length: HELD_CAP }, (_, i) => ({
      field: 'name',
      value: `old-${i}`,
      kind: 'model.inference',
      weight: 0.35,
      detail: 'old',
      reason: 'conflicts-with-stronger',
      observed_at: NOW,
    }))
    const result = merge({
      existingFacts: { name: 'Priya' },
      existingEvidence: {
        name: priceObservation({ kind: 'caller.confirmed', detail: 'c' }, NOW),
      },
      existingHeld,
      incomingFacts: { name: 'Maya' },
      incomingObservations: {
        name: { kind: 'model.inference', detail: 'unsure' },
      },
    })
    expect(result.held).toHaveLength(HELD_CAP)
    expect(result.held[0]?.value).toBe('old-1') // oldest dropped
    expect(result.held[HELD_CAP - 1]?.value).toBe('Maya')
  })
})
