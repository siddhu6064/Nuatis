import * as SQLite from 'expo-sqlite'

let _db: SQLite.SQLiteDatabase | null = null

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_db) {
    _db = await SQLite.openDatabaseAsync('nuatis_cache.db')
    await _db.execAsync(`
      CREATE TABLE IF NOT EXISTS cache_contacts (
        id TEXT PRIMARY KEY,
        full_name TEXT,
        email TEXT,
        phone TEXT,
        lifecycle_stage TEXT,
        lead_score INTEGER,
        lead_grade TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS cache_appointments (
        id TEXT PRIMARY KEY,
        contact_id TEXT,
        contact_name TEXT,
        title TEXT,
        start_time TEXT,
        end_time TEXT,
        status TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)
  }
  return _db
}

export async function cacheContacts(
  contacts: Array<{
    id: string
    full_name: string
    email?: string
    phone?: string
    lifecycle_stage?: string
    lead_score?: number
    lead_grade?: string
  }>
): Promise<void> {
  const db = await getDb()
  const now = new Date().toISOString()
  await db.execAsync('DELETE FROM cache_contacts')
  for (const c of contacts) {
    await db.runAsync(
      'INSERT OR REPLACE INTO cache_contacts (id, full_name, email, phone, lifecycle_stage, lead_score, lead_grade, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        c.id,
        c.full_name || '',
        c.email || null,
        c.phone || null,
        c.lifecycle_stage || null,
        c.lead_score || null,
        c.lead_grade || null,
        now,
      ]
    )
  }
}

export async function getCachedContacts(): Promise<
  Array<{
    id: string
    full_name: string
    email: string | null
    phone: string | null
    lifecycle_stage: string | null
    lead_score: number | null
    lead_grade: string | null
  }>
> {
  const db = await getDb()
  return db.getAllAsync<{
    id: string
    full_name: string
    email: string | null
    phone: string | null
    lifecycle_stage: string | null
    lead_score: number | null
    lead_grade: string | null
  }>('SELECT * FROM cache_contacts ORDER BY full_name')
}

export async function cacheAppointments(
  appts: Array<{
    id: string
    contact_id: string | null
    start_time: string
    end_time: string
    status: string
    title?: string
    contacts?: { full_name?: string }
  }>
): Promise<void> {
  const db = await getDb()
  const now = new Date().toISOString()
  await db.execAsync('DELETE FROM cache_appointments')
  for (const a of appts) {
    await db.runAsync(
      'INSERT OR REPLACE INTO cache_appointments (id, contact_id, contact_name, title, start_time, end_time, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        a.id,
        a.contact_id || null,
        a.contacts?.full_name || '',
        a.title || '',
        a.start_time,
        a.end_time,
        a.status || 'scheduled',
        now,
      ]
    )
  }
}

export async function getCachedAppointments(): Promise<
  Array<{
    id: string
    contact_id: string | null
    contact_name: string | null
    title: string
    start_time: string
    end_time: string
    status: string
  }>
> {
  const db = await getDb()
  return db.getAllAsync<{
    id: string
    contact_id: string | null
    contact_name: string | null
    title: string
    start_time: string
    end_time: string
    status: string
  }>('SELECT * FROM cache_appointments ORDER BY start_time')
}
