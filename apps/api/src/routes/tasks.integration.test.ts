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
const enqueueTaskReminder = jest.fn<() => Promise<string | null>>().mockResolvedValue('job-abc-123')
const cancelTaskReminder = jest.fn(async () => undefined)
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../workers/task-reminder-worker.js', () => ({
  enqueueTaskReminder,
  cancelTaskReminder,
}))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000tk00001'
const USER_ID = 'user-tk-001'
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

const [{ default: express }, { default: request }, { default: tasksRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./tasks.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/tasks', tasksRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tasks'] = []
  store.tables['contacts'] = []
  store.tables['users'] = []
  enqueueTaskReminder.mockClear()
  enqueueTaskReminder.mockResolvedValue('job-abc-123')
  cancelTaskReminder.mockClear()
  logActivity.mockClear()
})

describe('GET /api/tasks', () => {
  it('returns 200 with tasks array', async () => {
    const token = await makeToken()
    const res = await request(makeApp()).get('/api/tasks').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.tasks)).toBe(true)
  })
})

describe('POST /api/tasks', () => {
  it('creates task and returns 201 with id (no due_date)', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Call back patient' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.title).toBe('Call back patient')
    expect(enqueueTaskReminder).not.toHaveBeenCalled()
  })

  it('creates task with due_date, enqueues reminder, writes reminder_job_id', async () => {
    const token = await makeToken()
    const dueIso = new Date(Date.now() + 2 * 86400000).toISOString()
    const res = await request(makeApp())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Follow up', due_date: dueIso })

    expect(res.status).toBe(201)
    expect(enqueueTaskReminder).toHaveBeenCalledTimes(1)
    expect(res.body.reminder_job_id).toBe('job-abc-123')
  })

  it('returns 400 when title is missing', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 'high' })

    expect(res.status).toBe(400)
  })
})

describe('PUT /api/tasks/:id', () => {
  it('cancels reminder and logs activity on completion with contact_id', async () => {
    const taskId = randomUUID()
    const contactId = randomUUID()
    ;(store.tables['tasks'] as Row[]).push({
      id: taskId,
      tenant_id: TENANT_ID,
      contact_id: contactId,
      title: 'Follow up',
      priority: 'medium',
      reminder_job_id: 'job-xyz',
      completed_at: null,
    })
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Pat',
    })

    const token = await makeToken()
    const res = await request(makeApp())
      .put(`/api/tasks/${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ completed_at: new Date().toISOString() })

    expect(res.status).toBe(200)
    expect(cancelTaskReminder).toHaveBeenCalledTimes(1)
    expect(cancelTaskReminder.mock.calls[0]![0]).toBe('job-xyz')
    const taskActivity = logActivity.mock.calls.find(
      (c) => (c[0] as { type?: string }).type === 'task'
    )
    expect(taskActivity).toBeDefined()
  })
})
