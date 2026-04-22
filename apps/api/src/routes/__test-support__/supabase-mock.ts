/**
 * Minimal in-memory Supabase client for route integration tests.
 *
 * Supports only the subset of the query builder surface that the CPQ +
 * inventory + staff routes (+ their dependencies: modules.ts, activity.ts,
 * push-client.ts, etc.) actually use. Intentionally narrow — extend
 * case-by-case when new assertions require it.
 *
 * NOT a test file — lives under __test-support__ so Jest's testMatch
 * ('**\/*.test.ts') does not pick it up.
 */

import { randomUUID } from 'node:crypto'
import { jest } from '@jest/globals'

export type Row = Record<string, unknown>

type UploadResult = { data: { path: string } | null; error: null | { message: string } }
type SignedUrlResult = {
  data: { signedUrl: string } | null
  error: null | { message: string }
}

export interface StorageMock {
  upload: jest.Mock<(path: string, body: unknown, opts?: unknown) => Promise<UploadResult>>
  createSignedUrl: jest.Mock<(path: string, seconds: number) => Promise<SignedUrlResult>>
}

export interface MockStore {
  tables: Record<string, Row[]>
  storage: StorageMock
}

export function createStore(): MockStore {
  const upload = jest
    .fn<(path: string, body: unknown, opts?: unknown) => Promise<UploadResult>>()
    .mockResolvedValue({ data: { path: 'exports/test/file.csv.gz' }, error: null })
  const createSignedUrl = jest
    .fn<(path: string, seconds: number) => Promise<SignedUrlResult>>()
    .mockResolvedValue({ data: { signedUrl: 'https://signed.url/test' }, error: null })
  return { tables: {}, storage: { upload, createSignedUrl } }
}

type Op = 'select' | 'insert' | 'update' | 'delete'

interface State {
  table: string
  op: Op
  payload?: unknown
  filters: Array<(r: Row) => boolean>
  returnSelect: boolean
  selectCols?: string
  selectOpts?: { count?: string; head?: boolean }
  orderBy?: { col: string; asc: boolean }
  rangeFrom?: number
  rangeTo?: number
  limitN?: number
}

function matchRow(state: State, row: Row): boolean {
  return state.filters.every((f) => f(row))
}

function applySortPaging(state: State, rows: Row[]): Row[] {
  let out = [...rows]
  if (state.orderBy) {
    const { col, asc } = state.orderBy
    out.sort((a, b) => {
      const av = a[col] as string | number | null | undefined
      const bv = b[col] as string | number | null | undefined
      if (av === bv) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = av < bv ? -1 : 1
      return asc ? cmp : -cmp
    })
  }
  if (state.rangeFrom !== undefined && state.rangeTo !== undefined) {
    out = out.slice(state.rangeFrom, state.rangeTo + 1)
  }
  if (state.limitN !== undefined) out = out.slice(0, state.limitN)
  return out
}

// ── Nested-select resolution ───────────────────────────────────────────────
// Supports two join shapes:
//   one-to-one: parent[singular_of_table + '_id'] → lookup by child.id
//   one-to-many: child[singular_of_parentTable + '_id'] === parent.id
//
// Projection: 'table(*)' → whole row; 'table(c1, c2)' → only those cols.
function singularize(name: string): string {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`
  if (name.endsWith('s')) return name.slice(0, -1)
  return name
}

function projectCols(row: Row, colsList: string): Row {
  const list = colsList.trim()
  if (!list || list === '*') return { ...row }
  const cols = list.split(',').map((c) => c.trim())
  const out: Row = {}
  for (const c of cols) out[c] = row[c] ?? null
  return out
}

function resolveNestedSelect(
  store: MockStore,
  parentTable: string,
  parentRow: Row,
  selectStr: string
): void {
  const re = /(\w+)\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(selectStr)) !== null) {
    const tableName = m[1]
    const colsList = m[2] ?? '*'
    if (!tableName || !(tableName in store.tables)) continue

    const childRows = store.tables[tableName] ?? []
    const singularChild = singularize(tableName)
    const parentFk = `${singularChild}_id`

    if (parentFk in parentRow) {
      // One-to-one: parent row references single child by FK
      const childId = parentRow[parentFk]
      const child = childRows.find((r) => r['id'] === childId) ?? null
      parentRow[tableName] = child ? projectCols(child, colsList) : null
    } else {
      // One-to-many: child rows reference parent by parent_singular_id
      const singularParent = singularize(parentTable)
      const childFk = `${singularParent}_id`
      const matching = childRows.filter((r) => r[childFk] === parentRow['id'])
      parentRow[tableName] = matching.map((r) => projectCols(r, colsList))
    }
  }
}

function hasNestedSelect(selectStr?: string): boolean {
  return Boolean(selectStr && /\w+\([^)]*\)/.test(selectStr))
}

function execute(
  store: MockStore,
  state: State
): { data: Row | Row[] | null; error: null | { message: string }; count?: number } {
  const rows = (store.tables[state.table] ??= [])

  if (state.op === 'insert') {
    const toInsert = Array.isArray(state.payload)
      ? (state.payload as Row[])
      : [state.payload as Row]
    const inserted = toInsert.map((r) => ({
      id: (r['id'] as string) ?? randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...r,
    }))
    rows.push(...inserted)
    if (state.returnSelect) {
      // Clone so callers can't mutate the stored row by accident.
      const copies = inserted.map((r) => ({ ...r }))
      if (hasNestedSelect(state.selectCols)) {
        for (const r of copies) resolveNestedSelect(store, state.table, r, state.selectCols!)
      }
      const data: Row | Row[] = copies.length === 1 ? (copies[0] as Row) : copies
      return { data, error: null }
    }
    return { data: null, error: null }
  }

  const matching = rows.filter((r) => matchRow(state, r))

  if (state.op === 'update') {
    const patch = state.payload as Row
    for (const r of matching) Object.assign(r, patch, { updated_at: new Date().toISOString() })
    if (state.returnSelect) {
      const copies = matching.map((r) => ({ ...r }))
      if (hasNestedSelect(state.selectCols)) {
        for (const r of copies) resolveNestedSelect(store, state.table, r, state.selectCols!)
      }
      return { data: copies, error: null }
    }
    return { data: null, error: null }
  }

  if (state.op === 'delete') {
    store.tables[state.table] = rows.filter((r) => !matching.includes(r))
    return { data: state.returnSelect ? matching.map((r) => ({ ...r })) : null, error: null }
  }

  // select — clone so callers can't mutate the stored rows
  const sorted = applySortPaging(state, matching).map((r) => ({ ...r }))
  if (hasNestedSelect(state.selectCols)) {
    for (const r of sorted) resolveNestedSelect(store, state.table, r, state.selectCols!)
  }
  return { data: sorted, error: null, count: matching.length }
}

// ── Filter helpers for or() parsing ────────────────────────────────────────
// or('col.ilike.%v%,col2.eq.v2') — split on commas, combine with OR.
function parseOrExpression(expr: string): Array<(r: Row) => boolean> {
  const parts = expr
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  const preds: Array<(r: Row) => boolean> = []
  for (const p of parts) {
    const segs = p.split('.')
    if (segs.length < 3) continue
    const col = segs[0]!
    const op = segs[1]!
    const val = segs.slice(2).join('.')
    if (op === 'ilike') {
      const needle = val.replace(/%/g, '').toLowerCase()
      preds.push((r) => {
        const v = r[col]
        return typeof v === 'string' && v.toLowerCase().includes(needle)
      })
    } else if (op === 'like') {
      const needle = val.replace(/%/g, '')
      preds.push((r) => {
        const v = r[col]
        return typeof v === 'string' && v.includes(needle)
      })
    } else if (op === 'eq') {
      preds.push((r) => String(r[col] ?? '') === val)
    } else if (op === 'neq') {
      preds.push((r) => String(r[col] ?? '') !== val)
    } else if (op === 'is') {
      if (val === 'null') preds.push((r) => r[col] == null)
      else preds.push((r) => String(r[col]) === val)
    }
  }
  return preds
}

function buildQuery(store: MockStore, table: string): unknown {
  const state: State = { table, op: 'select', filters: [], returnSelect: false }
  const addFilter = (f: (r: Row) => boolean): void => {
    state.filters.push(f)
  }

  type QueryAPI = {
    select: (cols?: string, opts?: { count?: string; head?: boolean }) => QueryAPI
    insert: (payload: Row | Row[]) => QueryAPI
    update: (patch: Row) => QueryAPI
    delete: () => QueryAPI
    upsert: (payload: Row | Row[], opts?: unknown) => QueryAPI
    eq: (col: string, val: unknown) => QueryAPI
    neq: (col: string, val: unknown) => QueryAPI
    in: (col: string, vals: unknown[]) => QueryAPI
    lt: (col: string, val: unknown) => QueryAPI
    gt: (col: string, val: unknown) => QueryAPI
    gte: (col: string, val: unknown) => QueryAPI
    lte: (col: string, val: unknown) => QueryAPI
    is: (col: string, val: unknown) => QueryAPI
    or: (expr: string) => QueryAPI
    ilike: (col: string, pat: string) => QueryAPI
    like: (col: string, pat: string) => QueryAPI
    filter: (col: string, op: string, val: unknown) => QueryAPI
    not: (col: string, op: 'is', val: unknown) => QueryAPI
    order: (col: string, opts?: { ascending?: boolean }) => QueryAPI
    range: (from: number, to: number) => QueryAPI
    limit: (n: number) => QueryAPI
    single: () => Promise<{ data: Row | null; error: null | { message: string } }>
    maybeSingle: () => Promise<{ data: Row | null; error: null | { message: string } }>
    returns: () => QueryAPI
    then: (
      resolve: (value: { data: unknown; error: unknown; count?: number }) => void,
      reject?: (err: unknown) => void
    ) => void
  }

  const q: QueryAPI = {
    select(cols, opts) {
      if (state.op === 'insert' || state.op === 'update' || state.op === 'delete') {
        state.returnSelect = true
      } else {
        state.op = 'select'
      }
      if (cols !== undefined) state.selectCols = cols
      if (opts) state.selectOpts = opts
      return q
    },
    insert(payload) {
      state.op = 'insert'
      state.payload = payload
      return q
    },
    update(patch) {
      state.op = 'update'
      state.payload = patch
      return q
    },
    delete() {
      state.op = 'delete'
      return q
    },
    upsert(payload) {
      state.op = 'insert'
      state.payload = payload
      return q
    },
    eq(col, val) {
      addFilter((r) => r[col] === val)
      return q
    },
    neq(col, val) {
      addFilter((r) => r[col] !== val)
      return q
    },
    in(col, vals) {
      addFilter((r) => vals.includes(r[col]))
      return q
    },
    lt(col, val) {
      addFilter((r) => {
        const v = r[col]
        return v != null && (v as string | number) < (val as string | number)
      })
      return q
    },
    gt(col, val) {
      addFilter((r) => {
        const v = r[col]
        return v != null && (v as string | number) > (val as string | number)
      })
      return q
    },
    gte(col, val) {
      addFilter((r) => {
        const v = r[col]
        return v != null && (v as string | number) >= (val as string | number)
      })
      return q
    },
    lte(col, val) {
      addFilter((r) => {
        const v = r[col]
        return v != null && (v as string | number) <= (val as string | number)
      })
      return q
    },
    is(col, val) {
      if (val === null) {
        addFilter((r) => r[col] == null)
        return q
      }
      addFilter((r) => r[col] === val)
      return q
    },
    or(expr) {
      const preds = parseOrExpression(expr)
      if (preds.length > 0) {
        addFilter((r) => preds.some((p) => p(r)))
      }
      return q
    },
    ilike(col, pat) {
      const needle = String(pat).replace(/%/g, '').toLowerCase()
      addFilter((r) => {
        const v = r[col]
        return typeof v === 'string' && v.toLowerCase().includes(needle)
      })
      return q
    },
    like(col, pat) {
      const needle = String(pat).replace(/%/g, '')
      addFilter((r) => {
        const v = r[col]
        return typeof v === 'string' && v.includes(needle)
      })
      return q
    },
    filter() {
      return q
    },
    not(col, op, val) {
      if (op === 'is') addFilter((r) => r[col] !== val)
      return q
    },
    order(col, opts) {
      state.orderBy = { col, asc: opts?.ascending ?? true }
      return q
    },
    range(from, to) {
      state.rangeFrom = from
      state.rangeTo = to
      return q
    },
    limit(n) {
      state.limitN = n
      return q
    },
    returns() {
      return q
    },
    async single() {
      state.returnSelect = true
      const res = execute(store, state)
      const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
      if (rows.length === 0) {
        return { data: null, error: { message: 'Row not found' } }
      }
      return { data: rows[0] as Row, error: null }
    },
    async maybeSingle() {
      state.returnSelect = true
      const res = execute(store, state)
      const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : []
      if (rows.length === 0) return { data: null, error: null }
      return { data: rows[0] as Row, error: null }
    },
    then(resolve) {
      try {
        const res = execute(store, state)
        if (state.selectOpts?.count === 'exact') {
          resolve({ data: res.data, error: res.error, count: res.count })
        } else {
          resolve({ data: res.data, error: res.error })
        }
      } catch (err) {
        resolve({ data: null, error: { message: String(err) } })
      }
    },
  }
  return q
}

export function createMockSupabase(store: MockStore): unknown {
  return {
    from(table: string) {
      return buildQuery(store, table)
    },
    rpc() {
      return Promise.resolve({ data: null, error: null })
    },
    auth: {
      admin: {
        createUser: () => Promise.resolve({ data: { user: null }, error: null }),
        deleteUser: () => Promise.resolve({ error: null }),
      },
    },
    storage: {
      from(_bucket: string) {
        return {
          upload: store.storage.upload,
          createSignedUrl: store.storage.createSignedUrl,
        }
      },
    },
  }
}
