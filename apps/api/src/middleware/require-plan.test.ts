import { describe, it, expect, jest, beforeAll, beforeEach } from '@jest/globals'

beforeAll(() => {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-test'
})

interface MockTenantRow {
  subscription_status: string | null
  subscription_plan: string | null
  modules: Record<string, boolean> | null
  product: string | null
}

/**
 * Minimal Supabase-client mock — only supports the single chain used by
 * require-plan: from(...).select(...).eq(...).maybeSingle().
 */
function mockSupabaseFor(row: MockTenantRow | null) {
  const maybeSingle = jest.fn<() => Promise<{ data: MockTenantRow | null; error: null }>>()
  maybeSingle.mockResolvedValue({ data: row, error: null })
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle,
        }),
      }),
    }),
  }
}

beforeEach(() => {
  jest.resetModules()
})

async function loadRequirePlan(row: MockTenantRow | null) {
  jest.unstable_mockModule('@supabase/supabase-js', () => ({
    createClient: () => mockSupabaseFor(row),
  }))
  const mod = await import('./require-plan.js')
  return mod.requirePlan
}

function makeReq(tenantId = 'tenant-1'): { tenantId: string } {
  return { tenantId }
}

function makeRes() {
  const status = jest.fn().mockReturnThis() as jest.Mock
  const json = jest.fn().mockReturnThis() as jest.Mock
  return { status, json } as unknown as {
    status: jest.Mock
    json: jest.Mock
  }
}

describe('requirePlan — subscription status gating', () => {
  it('allows trialing tenants through', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'trialing',
      subscription_plan: 'pro',
      modules: { maya: true },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('automation')(makeReq() as never, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('allows active tenants through', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'active',
      subscription_plan: 'pro',
      modules: { maya: true },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('campaigns')(makeReq() as never, res as never, next)

    expect(next).toHaveBeenCalled()
  })

  it('blocks past_due with 402 + status payload', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'past_due',
      subscription_plan: 'pro',
      modules: { campaigns: true },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('campaigns')(makeReq() as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(402)
    const payload = (res.json.mock.calls[0]?.[0] ?? {}) as { status?: string }
    expect(payload.status).toBe('past_due')
  })

  it('blocks canceled tenants', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'canceled',
      subscription_plan: null,
      modules: { campaigns: true },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('campaigns')(makeReq() as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(402)
  })

  it('blocks null subscription_status with 402 (no longer treated as trialing)', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: null,
      subscription_plan: 'pro',
      modules: { automation: true },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('automation')(makeReq() as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(402)
    const payload = (res.json.mock.calls[0]?.[0] ?? {}) as { error?: string }
    expect(payload.error).toBe('Subscription required')
  })

  it('returns 503 (fail closed) when Supabase env is not configured', async () => {
    const savedUrl = process.env['SUPABASE_URL']
    const savedKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
    delete process.env['SUPABASE_URL']
    delete process.env['SUPABASE_SERVICE_ROLE_KEY']
    try {
      const requirePlan = await loadRequirePlan(null)
      const next = jest.fn()
      const res = makeRes()
      await requirePlan('automation')(makeReq() as never, res as never, next)

      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(503)
    } finally {
      process.env['SUPABASE_URL'] = savedUrl
      process.env['SUPABASE_SERVICE_ROLE_KEY'] = savedKey
    }
  })
})

describe('requirePlan — module gating (entitlement-derived)', () => {
  it('blocks when module is explicitly set to false', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'active',
      subscription_plan: 'pro',
      modules: { campaigns: false },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('campaigns')(makeReq() as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(402)
    const payload = (res.json.mock.calls[0]?.[0] ?? {}) as { missing_modules?: string[] }
    expect(payload.missing_modules).toEqual(['campaigns'])
  })

  it('blocks an absent tier-gated module on core (campaigns)', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'active',
      subscription_plan: 'core',
      modules: { maya: true, crm: true },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('campaigns')(makeReq() as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(402)
    const payload = (res.json.mock.calls[0]?.[0] ?? {}) as { missing_modules?: string[] }
    expect(payload.missing_modules).toEqual(['campaigns'])
  })

  it('allows an absent tier-gated module on scale (cpq)', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'active',
      subscription_plan: 'scale',
      modules: { maya: true },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('cpq')(makeReq() as never, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('honors an explicit true comp on a lower tier (cpq:true on core)', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'active',
      subscription_plan: 'core',
      modules: { cpq: true },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('cpq')(makeReq() as never, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('allows an absent base module on a suite tenant (appointments)', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'active',
      subscription_plan: 'core',
      modules: { maya: true },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('appointments')(makeReq() as never, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('reports all unentitled modules at once', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'active',
      subscription_plan: 'core',
      modules: { maya: true },
      product: 'suite',
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('automation', 'insights')(makeReq() as never, res as never, next)

    expect(res.status).toHaveBeenCalledWith(402)
    const payload = (res.json.mock.calls[0]?.[0] ?? {}) as { missing_modules?: string[] }
    expect(payload.missing_modules?.sort()).toEqual(['automation', 'insights'])
  })
})
