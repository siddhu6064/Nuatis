import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000if00001'
const USER_ID = 'user-if-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  const secretBytes = new TextEncoder().encode(SECRET)
  return new SignJWT({ sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretBytes)
}

const [{ default: express }, { default: request }, { default: intakeFormsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./intake-forms.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/intake-forms', intakeFormsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['intake_forms'] = []
  store.tables['intake_submissions'] = []
  store.tables['contacts'] = []
})

describe('GET /api/intake-forms', () => {
  it('returns forms list with fieldCount and submissionCount', async () => {
    ;(store.tables['intake_forms'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'New Patient Intake',
      fields: [
        { id: 'f1', label: 'Name', type: 'text' },
        { id: 'f2', label: 'DOB', type: 'date' },
      ],
      linked_service_ids: [],
      is_active: true,
      created_at: new Date().toISOString(),
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/intake-forms')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data)).toBe(true)
    expect(res.body.data.length).toBe(1)
    expect(res.body.data[0].fieldCount).toBe(2)
    expect(res.body.data[0].submissionCount).toBe(0)
  })
})

describe('POST /api/intake-forms', () => {
  it('creates form and returns 201 with id', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/intake-forms')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Patient Intake',
        fields: [
          { id: 'f1', label: 'Full Name', type: 'text' },
          { id: 'f2', label: 'Date of Birth', type: 'date' },
        ],
      })

    expect(res.status).toBe(201)
    expect(res.body.data.id).toBeDefined()
    expect(res.body.data.name).toBe('New Patient Intake')
  })

  it('returns 400 when fields array is missing', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/intake-forms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bad Form' })

    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/intake-forms/:id', () => {
  it('returns 400 when submissions exist for the form', async () => {
    const formId = randomUUID()
    ;(store.tables['intake_forms'] as Row[]).push({
      id: formId,
      tenant_id: TENANT_ID,
      name: 'Has Submissions',
      fields: [],
      is_active: true,
    })
    ;(store.tables['intake_submissions'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      form_id: formId,
      data: { name: 'Test' },
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .delete(`/api/intake-forms/${formId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(400)
    expect(String(res.body.error)).toContain('submissions')
  })
})
