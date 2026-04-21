import { describe, it, expect } from '@jest/globals'
import { VERTICALS, VERTICAL_SLUGS, getVertical } from '@nuatis/shared'

const EXPECTED_SLUGS = [
  'sales_crm',
  'dental',
  'medical',
  'veterinary',
  'salon',
  'restaurant',
  'contractor',
  'law_firm',
  'real_estate',
]

const UNIVERSAL_CONTACT_KEYS = new Set([
  'name',
  'full_name',
  'first_name',
  'last_name',
  'phone',
  'email',
  'address',
  'notes',
  'tags',
])

const REMOVED_LEGACY_KEYS = new Set(['insurance_id', 'insurance_provider', 'insurance_plan_id'])

describe('VERTICALS registry', () => {
  it('exports all 9 expected verticals', () => {
    for (const slug of EXPECTED_SLUGS) {
      expect(VERTICALS[slug]).toBeDefined()
      expect(VERTICALS[slug]?.slug).toBe(slug)
    }
    expect(VERTICAL_SLUGS.length).toBeGreaterThanOrEqual(EXPECTED_SLUGS.length)
  })

  it('getVertical() returns config for known slug and throws for unknown', () => {
    expect(getVertical('dental').slug).toBe('dental')
    expect(() => getVertical('doesnotexist')).toThrow()
  })
})

describe.each(EXPECTED_SLUGS)('vertical: %s', (slug) => {
  const config = VERTICALS[slug]!

  it('has at least 8 customFields', () => {
    expect(config.fields.length).toBeGreaterThanOrEqual(8)
  })

  it('has at least 5 pipeline stages', () => {
    expect(config.pipeline_stages.length).toBeGreaterThanOrEqual(5)
  })

  it('has exactly one is_won pipeline stage', () => {
    const wonStages = config.pipeline_stages.filter((s) => s.is_won === true)
    expect(wonStages).toHaveLength(1)
  })

  it('has at least one is_lost pipeline stage', () => {
    const lostStages = config.pipeline_stages.filter((s) => s.is_lost === true)
    expect(lostStages.length).toBeGreaterThanOrEqual(1)
  })

  it('has unique pipeline-stage positions', () => {
    const positions = config.pipeline_stages.map((s) => s.position)
    expect(new Set(positions).size).toBe(positions.length)
  })

  it('has exactly one is_default stage', () => {
    const defaults = config.pipeline_stages.filter((s) => s.is_default === true)
    expect(defaults).toHaveLength(1)
  })

  it('pipeline-stage colors are valid 6-digit hex', () => {
    for (const stage of config.pipeline_stages) {
      expect(stage.color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('customField keys are snake_case, unique, and not universal contact fields', () => {
    const keys = config.fields.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(UNIVERSAL_CONTACT_KEYS.has(key)).toBe(false)
    }
  })

  it('does not re-introduce removed legacy insurance fields', () => {
    for (const field of config.fields) {
      expect(REMOVED_LEGACY_KEYS.has(field.key)).toBe(false)
    }
  })

  it('select fields declare an options array', () => {
    for (const field of config.fields) {
      if (field.type === 'select') {
        expect(Array.isArray(field.options)).toBe(true)
        expect((field.options ?? []).length).toBeGreaterThan(0)
      }
    }
  })

  it('has maya_intents (3-8 items)', () => {
    expect(Array.isArray(config.maya_intents)).toBe(true)
    const intents = config.maya_intents ?? []
    expect(intents.length).toBeGreaterThanOrEqual(3)
    expect(intents.length).toBeLessThanOrEqual(8)
  })

  it('system_prompt_template references {{business_name}}', () => {
    expect(config.system_prompt_template).toContain('{{business_name}}')
  })
})
