import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000media1'
const USER_ID = 'user-media-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' },
    { secret: SECRET }
  )
}

const [{ default: express }, { default: request }, { default: mediaLibraryRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./media-library.js')])

function makeApp() {
  const app = express()
  // NOTE: do NOT add express.json() here — the upload route reads raw binary
  app.use('/api/media', mediaLibraryRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['media_files'] = []
})

// ── GET /api/media ───────────────────────────────────────────────────────────

describe('GET /api/media', () => {
  it('returns empty list when no files exist', async () => {
    const token = await makeToken()
    const res = await request(makeApp()).get('/api/media').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.files).toEqual([])
    expect(res.body.total).toBe(0)
    expect(res.body.page).toBe(1)
  })

  it('returns files belonging to the tenant', async () => {
    store.tables['media_files'] = [
      {
        id: 'file-001',
        tenant_id: TENANT_ID,
        file_name: 'logo.png',
        file_size: 5120,
        mime_type: 'image/png',
        storage_path: `${TENANT_ID}/abc.png`,
        public_url: 'https://cdn.example.com/logo.png',
        tags: [],
        created_at: new Date().toISOString(),
      },
      {
        id: 'file-002',
        tenant_id: 'other-tenant',
        file_name: 'other.png',
        file_size: 1024,
        mime_type: 'image/png',
        storage_path: 'other-tenant/xyz.png',
        public_url: null,
        tags: [],
        created_at: new Date().toISOString(),
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp()).get('/api/media').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.files).toHaveLength(1)
    expect(res.body.files[0].id).toBe('file-001')
  })

  it('returns 401 without auth token', async () => {
    const res = await request(makeApp()).get('/api/media')
    expect(res.status).toBe(401)
  })
})

// ── POST /api/media/upload ───────────────────────────────────────────────────

describe('POST /api/media/upload', () => {
  it('returns 400 for non-image content type', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('pdf-content'))

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/image/)
  })

  it('uploads an image and returns 201 with file row', async () => {
    const token = await makeToken()
    const fakeImage = Buffer.from('fake-png-bytes')

    const res = await request(makeApp())
      .post('/api/media/upload')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'image/png')
      .set('X-File-Name', 'test-logo.png')
      .send(fakeImage)

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.file_name).toBe('test-logo.png')
    expect(res.body.mime_type).toBe('image/png')
    expect(res.body.tenant_id).toBe(TENANT_ID)
  })
})

// ── DELETE /api/media/:id ────────────────────────────────────────────────────

describe('DELETE /api/media/:id', () => {
  it('deletes a file and returns ok:true', async () => {
    store.tables['media_files'] = [
      {
        id: 'file-del-01',
        tenant_id: TENANT_ID,
        file_name: 'to-delete.jpg',
        file_size: 2048,
        mime_type: 'image/jpeg',
        storage_path: `${TENANT_ID}/del.jpg`,
        public_url: null,
        tags: [],
        created_at: new Date().toISOString(),
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/media/file-del-01')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(store.tables['media_files']).toHaveLength(0)
    expect(store.storage.remove).toHaveBeenCalledWith([`${TENANT_ID}/del.jpg`])
  })

  it('returns 404 when file does not belong to tenant', async () => {
    store.tables['media_files'] = [
      {
        id: 'file-other',
        tenant_id: 'different-tenant',
        file_name: 'secret.jpg',
        file_size: 1000,
        mime_type: 'image/jpeg',
        storage_path: 'different-tenant/secret.jpg',
        public_url: null,
        tags: [],
        created_at: new Date().toISOString(),
      },
    ]

    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/media/file-other')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})
