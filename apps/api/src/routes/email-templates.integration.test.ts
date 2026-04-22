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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000em00001'
const USER_ID = 'user-em-001'
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

const [{ default: express }, { default: request }, { default: templatesRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./email-templates.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/email-templates', templatesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['email_templates'] = []
})

describe('GET /api/email-templates', () => {
  it('returns templates array for tenant', async () => {
    ;(store.tables['email_templates'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      name: 'Welcome',
      subject: 'Hi {{first_name}}',
      body: 'Hello {{first_name}}',
      vertical: 'dental',
      is_default: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/email-templates')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBe(1)
  })
})

describe('POST /api/email-templates', () => {
  it('creates template and returns 201 with id', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/email-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Follow-up',
        subject: 'Checking in',
        body: '<p>Hello {{first_name}}</p>',
      })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Follow-up')
  })

  it('returns 400 when required field is missing', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/email-templates')
      .set('Authorization', `Bearer ${token}`)
      .send({ subject: 'Only subject', body: 'Only body' })

    expect(res.status).toBe(400)
  })
})
