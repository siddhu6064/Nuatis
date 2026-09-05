import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

const mockUpdateSmsRiskScore = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
const mockBroadcastToTenant = jest.fn()
const mockEnqueueScoreCompute = jest.fn()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/sms-risk.js', () => ({
  updateSmsRiskScore: mockUpdateSmsRiskScore,
}))
jest.unstable_mockModule('../lib/conversations-ws.js', () => ({
  broadcastToTenant: mockBroadcastToTenant,
}))
jest.unstable_mockModule('../lib/lead-score-queue.js', () => ({
  enqueueScoreCompute: mockEnqueueScoreCompute,
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: smsWebhooksRouter } = await import('./sms-webhooks.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/webhooks/sms', smsWebhooksRouter)
  return app
}

const TENANT_ID = 'tenant-sw-1'
const CONTACT_ID = 'contact-sw-1'

beforeEach(() => {
  store = createStore()
  store.tables['locations'] = [{ id: 'loc-1', tenant_id: TENANT_ID, telnyx_number: '+15125550100' }]
  store.tables['contacts'] = [
    { id: CONTACT_ID, tenant_id: TENANT_ID, full_name: 'Jane', phone: '+15125550001' },
  ]
  store.tables['sms_messages'] = []
  mockUpdateSmsRiskScore.mockClear()
})

describe('STOP keyword — sms-risk wiring', () => {
  it('flags the contact opted_out in the risk scorer', async () => {
    const res = await request(makeApp())
      .post('/api/webhooks/sms')
      .send({
        data: {
          event_type: 'message.received',
          payload: {
            id: 'msg-1',
            from: { phone_number: '+15125550001' },
            to: [{ phone_number: '+15125550100' }],
            text: 'STOP',
          },
        },
      })

    expect(res.status).toBe(200)
    expect(mockUpdateSmsRiskScore).toHaveBeenCalledWith(CONTACT_ID, TENANT_ID, 'opted_out')
  })
})

describe('message.finalized — sms-risk wiring', () => {
  it('records a delivered event against the risk scorer', async () => {
    store.tables['sms_messages'] = [
      {
        id: 'sm-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        message_sid: 'msg-fin-1',
        status: 'sent',
      },
    ]

    const res = await request(makeApp())
      .post('/api/webhooks/sms')
      .send({
        data: {
          event_type: 'message.finalized',
          payload: { id: 'msg-fin-1', to: [{ status: 'delivered' }] },
        },
      })

    expect(res.status).toBe(200)
    expect(mockUpdateSmsRiskScore).toHaveBeenCalledWith(CONTACT_ID, TENANT_ID, 'delivered')
  })

  it('records a failed event against the risk scorer', async () => {
    store.tables['sms_messages'] = [
      {
        id: 'sm-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        message_sid: 'msg-fin-2',
        status: 'sent',
      },
    ]

    const res = await request(makeApp())
      .post('/api/webhooks/sms')
      .send({
        data: {
          event_type: 'message.finalized',
          payload: { id: 'msg-fin-2', to: [{ status: 'delivery_failed' }] },
        },
      })

    expect(res.status).toBe(200)
    expect(mockUpdateSmsRiskScore).toHaveBeenCalledWith(CONTACT_ID, TENANT_ID, 'failed')
  })
})
