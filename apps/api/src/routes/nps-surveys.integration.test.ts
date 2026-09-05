import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: npsSurveysRouter } = await import('./nps-surveys.js')

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ns00001'
const CONTACT_ID = 'bbbbbbbb-0000-0000-0000-00000ns00002'

function makeApp() {
  const app = express()
  app.use('/api/nps-surveys', express.json(), npsSurveysRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, name: 'Test Biz' }]
  store.tables['contacts'] = [{ id: CONTACT_ID, tenant_id: TENANT_ID, full_name: 'Jane Doe' }]
  store.tables['nps_responses'] = []
})

describe('GET /api/nps-surveys/:id', () => {
  it('returns the survey shell for a pending survey', async () => {
    const id = randomUUID()
    ;(store.tables['nps_responses'] as Row[]).push({
      id,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      status: 'sent',
    })

    const res = await request(makeApp()).get(`/api/nps-surveys/${id}`)

    expect(res.status).toBe(200)
    expect(res.body.business_name).toBe('Test Biz')
    expect(res.body.contact_name).toBe('Jane')
    expect(res.body.status).toBe('sent')
  })

  it('404s for an unknown survey id', async () => {
    const res = await request(makeApp()).get(`/api/nps-surveys/${randomUUID()}`)
    expect(res.status).toBe(404)
  })
})

describe('POST /api/nps-surveys/:id/respond', () => {
  it('records a score and comment, marking the survey responded', async () => {
    const id = randomUUID()
    ;(store.tables['nps_responses'] as Row[]).push({
      id,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      status: 'sent',
    })

    const res = await request(makeApp())
      .post(`/api/nps-surveys/${id}/respond`)
      .send({ score: 9, comment: 'Great service!' })

    expect(res.status).toBe(200)
    const row = (store.tables['nps_responses'] as Row[]).find((r) => r['id'] === id)
    expect(row?.['status']).toBe('responded')
    expect(row?.['score']).toBe(9)
    expect(row?.['comment']).toBe('Great service!')
    expect(row?.['responded_at']).toBeTruthy()
  })

  it('rejects a score outside 0-10', async () => {
    const id = randomUUID()
    ;(store.tables['nps_responses'] as Row[]).push({
      id,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      status: 'sent',
    })

    const res = await request(makeApp()).post(`/api/nps-surveys/${id}/respond`).send({ score: 11 })

    expect(res.status).toBe(400)
  })

  it('rejects a double-submit on an already-responded survey', async () => {
    const id = randomUUID()
    ;(store.tables['nps_responses'] as Row[]).push({
      id,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      status: 'responded',
      score: 8,
    })

    const res = await request(makeApp()).post(`/api/nps-surveys/${id}/respond`).send({ score: 3 })

    expect(res.status).toBe(400)
    const row = (store.tables['nps_responses'] as Row[]).find((r) => r['id'] === id)
    expect(row?.['score']).toBe(8)
  })

  it('404s when responding to an unknown survey id', async () => {
    const res = await request(makeApp())
      .post(`/api/nps-surveys/${randomUUID()}/respond`)
      .send({ score: 5 })

    expect(res.status).toBe(404)
  })
})
