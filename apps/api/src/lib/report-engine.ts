import { createClient } from '@supabase/supabase-js'
import { Redis } from 'ioredis'
import crypto from 'crypto'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReportFilter {
  field: string
  operator: string
  value: unknown
}

export interface ReportConfig {
  object: 'contacts' | 'appointments' | 'deals' | 'quotes' | 'activity_log' | 'tasks'
  metric: 'count' | 'sum' | 'avg' | 'min' | 'max'
  metric_field?: string
  group_by: string
  filters?: ReportFilter[]
  date_range?: string
  date_from?: string
  date_to?: string
}

export interface ReportResult {
  labels: string[]
  datasets: Array<{ label: string; data: number[] }>
  total: number
  generated_at: string
}

// ── Supabase ─────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── Redis (optional) ─────────────────────────────────────────────────────────

let redisClient: Redis | null = null

function getRedis(): Redis | null {
  if (!process.env['REDIS_URL']) return null
  if (!redisClient) {
    redisClient = new Redis(process.env['REDIS_URL'], {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
      lazyConnect: true,
    })
    redisClient.on('error', (err: Error) => {
      console.error('[report-engine] Redis error:', err.message)
    })
  }
  return redisClient
}

function hashConfig(config: ReportConfig): string {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 16)
}

// ── Date range helpers ────────────────────────────────────────────────────────

function startOfDay(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString()
}

function endOfDay(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString()
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString()
}

function startOfMonth(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

function startOfQuarter(d: Date): string {
  const q = Math.floor(d.getMonth() / 3)
  return new Date(d.getFullYear(), q * 3, 1).toISOString()
}

function startOfYear(d: Date): string {
  return new Date(d.getFullYear(), 0, 1).toISOString()
}

function resolveDateRange(
  range: string,
  dateFrom?: string,
  dateTo?: string
): { from: string; to: string } | null {
  const now = new Date()
  switch (range) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now) }
    case 'last_7_days':
      return { from: daysAgo(7), to: now.toISOString() }
    case 'last_30_days':
      return { from: daysAgo(30), to: now.toISOString() }
    case 'last_90_days':
      return { from: daysAgo(90), to: now.toISOString() }
    case 'last_12_months':
      return { from: daysAgo(365), to: now.toISOString() }
    case 'this_month':
      return { from: startOfMonth(now), to: now.toISOString() }
    case 'this_quarter':
      return { from: startOfQuarter(now), to: now.toISOString() }
    case 'this_year':
      return { from: startOfYear(now), to: now.toISOString() }
    case 'all_time':
      return null
    case 'custom':
      return dateFrom && dateTo ? { from: dateFrom, to: dateTo } : null
    default:
      return null
  }
}

// ── Date column per object ────────────────────────────────────────────────────

function getDateColumn(object: ReportConfig['object']): string {
  switch (object) {
    case 'appointments':
      return 'start_time'
    default:
      return 'created_at'
  }
}

// ── Metric computation ────────────────────────────────────────────────────────

function computeMetric(rows: Record<string, unknown>[], metric: string, field?: string): number {
  if (metric === 'count') return rows.length
  if (!field) return 0
  const values = rows.map((r) => Number(r[field]) || 0).filter((v) => !isNaN(v))
  if (values.length === 0) return 0
  switch (metric) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
    default:
      return 0
  }
}

// ── Apply filters ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(query: any, filters: ReportFilter[]): any {
  for (const f of filters) {
    switch (f.operator) {
      case 'equals':
        query = query.eq(f.field, f.value)
        break
      case 'not_equals':
        query = query.neq(f.field, f.value)
        break
      case 'contains':
        query = query.ilike(f.field, `%${f.value}%`)
        break
      case 'greater_than':
        query = query.gt(f.field, f.value)
        break
      case 'less_than':
        query = query.lt(f.field, f.value)
        break
      case 'in':
        query = query.in(f.field, f.value as unknown[])
        break
      case 'is_null':
        query = query.is(f.field, null)
        break
      case 'is_not_null':
        query = query.not(f.field, 'is', null)
        break
      default:
        break
    }
  }
  return query
}

// ── Group-by resolution ───────────────────────────────────────────────────────

function getGroupKey(
  row: Record<string, unknown>,
  groupBy: string,
  lookupMap: Map<string, string>
): string {
  // Date-trunc month transforms
  if (groupBy === 'created_month') {
    const val = row['created_at']
    if (val && typeof val === 'string') return val.slice(0, 7)
    return 'Unknown'
  }
  if (groupBy === 'close_month') {
    const val = row['close_date'] ?? row['created_at']
    if (val && typeof val === 'string') return val.slice(0, 7)
    return 'Unknown'
  }

  // Join-based lookups
  if (groupBy === 'stage_name') {
    const stageId = row['pipeline_stage_id']
    if (stageId && typeof stageId === 'string') {
      return lookupMap.get(stageId) ?? 'Unknown'
    }
    return 'Unknown'
  }

  if (groupBy === 'assigned_to_user_id') {
    const userId = row['assigned_to_user_id']
    if (userId && typeof userId === 'string') {
      return lookupMap.get(userId) ?? 'Unknown'
    }
    return 'Unassigned'
  }

  // Tasks: completed vs open
  if (groupBy === 'completed') {
    return row['completed_at'] == null ? 'Open' : 'Completed'
  }

  // Default: use field value directly
  const val = row[groupBy]
  if (val == null) return 'Unknown'
  if (typeof val === 'string') return val || 'Unknown'
  return String(val)
}

// ── Lookup map builders ───────────────────────────────────────────────────────

async function buildStageLookup(tenantId: string): Promise<Map<string, string>> {
  const supabase = getSupabase()
  const { data } = await supabase
    .from('pipeline_stages')
    .select('id, name')
    .eq('tenant_id', tenantId)
  const map = new Map<string, string>()
  for (const row of data ?? []) {
    map.set(row.id, row.name)
  }
  return map
}

async function buildUserLookup(tenantId: string): Promise<Map<string, string>> {
  const supabase = getSupabase()
  const { data } = await supabase.from('users').select('id, full_name').eq('tenant_id', tenantId)
  const map = new Map<string, string>()
  for (const row of data ?? []) {
    map.set(row.id, row.full_name ?? row.id)
  }
  return map
}

// ── Core execute ──────────────────────────────────────────────────────────────

async function executeReportInternal(
  tenantId: string,
  report: ReportConfig
): Promise<ReportResult> {
  const supabase = getSupabase()

  // 1. Base query scoped to tenant
  let query = supabase.from(report.object).select('*').eq('tenant_id', tenantId)

  // 2. Date range filter
  if (report.date_range) {
    const range = resolveDateRange(report.date_range, report.date_from, report.date_to)
    if (range) {
      const dateCol = getDateColumn(report.object)
      query = query.gte(dateCol, range.from).lte(dateCol, range.to)
    }
  }

  // 3. Custom filters
  if (report.filters && report.filters.length > 0) {
    query = applyFilters(query, report.filters)
  }

  // 4. Fetch all matching rows
  const { data, error } = await query
  if (error) {
    throw new Error(`[report-engine] Supabase query failed: ${error.message}`)
  }

  const rows = (data ?? []) as Record<string, unknown>[]

  // 5. Build lookup maps for join-based group_by fields
  let lookupMap = new Map<string, string>()
  if (report.group_by === 'stage_name') {
    lookupMap = await buildStageLookup(tenantId)
  } else if (report.group_by === 'assigned_to_user_id') {
    lookupMap = await buildUserLookup(tenantId)
  }

  // 6. Group rows by the group_by field
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const key = getGroupKey(row, report.group_by, lookupMap)
    const bucket = groups.get(key) ?? []
    bucket.push(row)
    groups.set(key, bucket)
  }

  // 7. Sort group keys (chronologically for month keys, alphabetically otherwise)
  const labels = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b))

  // 8. Compute metric per group
  const data_values = labels.map((label) => {
    const bucket = groups.get(label) ?? []
    return computeMetric(bucket, report.metric, report.metric_field)
  })

  // 9. Compute total
  const total = computeMetric(rows, report.metric, report.metric_field)

  return {
    labels,
    datasets: [{ label: report.metric, data: data_values }],
    total,
    generated_at: new Date().toISOString(),
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute a report with optional Redis caching.
 * @param tenantId  - The tenant to scope queries to
 * @param report    - ReportConfig describing what to compute
 * @param reportId  - Optional stable report ID for cache key; defaults to a hash of config
 */
export async function executeReport(
  tenantId: string,
  report: ReportConfig,
  reportId?: string
): Promise<ReportResult> {
  const redis = getRedis()
  const id = reportId ?? 'adhoc'
  const cacheKey = `report:${tenantId}:${id}:${hashConfig(report)}`

  // Cache hit
  if (redis) {
    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        return JSON.parse(cached) as ReportResult
      }
    } catch (err) {
      console.warn('[report-engine] Redis get failed, skipping cache:', err)
    }
  }

  // Cache miss — execute
  const result = await executeReportInternal(tenantId, report)

  // Store in cache
  if (redis) {
    try {
      await redis.setex(cacheKey, 3600, JSON.stringify(result))
    } catch (err) {
      console.warn('[report-engine] Redis set failed, skipping cache:', err)
    }
  }

  return result
}

/**
 * Invalidate all cached results for a given tenant + reportId combination.
 */
export async function clearReportCache(tenantId: string, reportId: string): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  try {
    const pattern = `report:${tenantId}:${reportId}:*`
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  } catch (err) {
    console.warn('[report-engine] clearReportCache failed:', err)
  }
}
