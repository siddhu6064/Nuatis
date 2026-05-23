import { describe, it, expect, jest, beforeAll, beforeEach } from '@jest/globals'

beforeAll(() => {
  process.env['SUPABASE_URL'] = 'https://example.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service-role-test'
})

interface MockTenantRow {
  subscription_status: string | null
  modules: Record<string, boolean> | null
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
      modules: { maya: true, automation: true },
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
      modules: { campaigns: true },
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('campaigns')(makeReq() as never, res as never, next)

    expect(next).toHaveBeenCalled()
  })

  it('blocks past_due with 402 + status payload', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'past_due',
      modules: { campaigns: true },
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
      modules: { campaigns: true },
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('campaigns')(makeReq() as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(402)
  })

  it('treats null status as trialing for legacy tenants', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: null,
      modules: { automation: true },
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('automation')(makeReq() as never, res as never, next)

    expect(next).toHaveBeenCalled()
  })
})

describe('requirePlan — module gating', () => {
  it('blocks when module is explicitly set to false', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'active',
      modules: { campaigns: false },
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('campaigns')(makeReq() as never, res as never, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(402)
    const payload = (res.json.mock.calls[0]?.[0] ?? {}) as { missing_modules?: string[] }
    expect(payload.missing_modules).toEqual(['campaigns'])
  })

  it('allows when module key is missing — legacy/pre-billing tenants', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'active',
      modules: { maya: true, crm: true },
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('automation')(makeReq() as never, res as never, next)

    expect(next).toHaveBeenCalled()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('reports all explicitly-false modules at once', async () => {
    const requirePlan = await loadRequirePlan({
      subscription_status: 'active',
      modules: { automation: false, insights: false },
    })

    const next = jest.fn()
    const res = makeRes()
    await requirePlan('automation', 'insights')(makeReq() as never, res as never, next)

    expect(res.status).toHaveBeenCalledWith(402)
    const payload = (res.json.mock.calls[0]?.[0] ?? {}) as { missing_modules?: string[] }
    expect(payload.missing_modules?.sort()).toEqual(['automation', 'insights'])
  })
})
