import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import type { Request, Response, NextFunction } from 'express'
import { requirePlatformOwner } from './platform-auth.js'

const PLATFORM = 'aaaaaaaa-0000-0000-0000-00000platform'

function run(tenantId: string | undefined, role: string | undefined) {
  const req = { tenantId, role } as unknown as Request
  const json = jest.fn()
  const status = jest.fn(() => ({ json }))
  const res = { status, json } as unknown as Response
  const next = jest.fn() as unknown as NextFunction
  requirePlatformOwner(req, res, next)
  return { next, status }
}

beforeEach(() => {
  process.env['PLATFORM_TENANT_ID'] = PLATFORM
})

describe('requirePlatformOwner', () => {
  it('allows the platform tenant owner through', () => {
    const { next } = run(PLATFORM, 'owner')
    expect(next).toHaveBeenCalled()
  })

  it('refuses another tenant owner', () => {
    const { next, status } = run('some-other-tenant', 'owner')
    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(403)
  })

  it('refuses a non-owner inside the platform tenant', () => {
    const { next, status } = run(PLATFORM, 'staff')
    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(403)
  })

  it('fails closed when PLATFORM_TENANT_ID is unset', () => {
    // An unconfigured environment must not turn the admin console into an open
    // door for whoever happens to have tenantId undefined.
    delete process.env['PLATFORM_TENANT_ID']
    const { next, status } = run(undefined, 'owner')
    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(403)
  })

  it('fails closed when PLATFORM_TENANT_ID is an empty string', () => {
    // An env var set to "" is a configuration mistake, not a wildcard.
    process.env['PLATFORM_TENANT_ID'] = ''
    const { next, status } = run('', 'owner')
    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(403)
  })
})
