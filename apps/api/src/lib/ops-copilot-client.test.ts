import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const enqueueRetry = jest.fn(async () => undefined)

jest.unstable_mockModule('../workers/webhook-retry-worker.js', () => ({ enqueueRetry }))

process.env['OPS_COPILOT_URL'] = 'http://localhost:8001'

const fetchMock = jest.fn<typeof fetch>(async () => {
  return { ok: true, status: 201, text: async () => '' } as unknown as Response
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).fetch = fetchMock

const { publishActivityEvent } = await import('./ops-copilot-client.js')

beforeEach(() => {
  fetchMock.mockClear()
  fetchMock.mockResolvedValue({
    ok: true,
    status: 201,
    text: async () => '',
  } as unknown as Response)
  enqueueRetry.mockClear()
})

describe('publishActivityEvent', () => {
  it('POSTs to ops-copilot URL with correct body shape', async () => {
    await publishActivityEvent({
      tenant_id: 'ten-1',
      event_id: 'evt-1',
      event_type: 'call.completed',
      payload_json: { duration: 30 },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(String(url)).toContain('/internal/events/activity')
    const body = JSON.parse(String(opts.body)) as Record<string, unknown>
    expect(body['event_source']).toBe('nuatis_crm')
    expect(body['event_type']).toBe('call.completed')
    expect(body['tenant_id']).toBe('ten-1')
  })

  it('does not throw on non-201 response (triggers retry best-effort)', async () => {
    delete process.env['REDIS_URL']
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => '',
    } as unknown as Response)

    await expect(
      publishActivityEvent({
        tenant_id: 'ten-1',
        event_id: 'evt-2',
        event_type: 'lead.stalled',
        payload_json: {},
      })
    ).resolves.not.toThrow()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never throws even when fetch rejects', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network failure'))

    await expect(
      publishActivityEvent({
        tenant_id: 'ten-1',
        event_id: 'evt-3',
        event_type: 'call.completed',
        payload_json: {},
      })
    ).resolves.not.toThrow()
  })
})
