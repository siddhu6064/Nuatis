/**
 * Simple in-memory TTL cache for active staff members, keyed by tenant.
 * Used by the Maya check_availability tool handler to avoid hitting Supabase
 * on every call. Cleared whenever a staff mutation occurs via
 * invalidateStaffCache().
 */

export interface CachedStaffMember {
  id: string
  name: string
  role: string
  color_hex: string
  availability: Record<string, { enabled?: boolean; start?: string; end?: string }>
}

interface CacheEntry {
  staff: CachedStaffMember[]
  fetchedAt: number
}

const TTL_MS = 5 * 60 * 1000

const cache = new Map<string, CacheEntry>()

export function getCachedStaff(tenantId: string): CachedStaffMember[] | null {
  const entry = cache.get(tenantId)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > TTL_MS) {
    cache.delete(tenantId)
    return null
  }
  return entry.staff
}

export function setCachedStaff(tenantId: string, staff: CachedStaffMember[]): void {
  cache.set(tenantId, { staff, fetchedAt: Date.now() })
}

export function invalidateStaffCache(tenantId: string): void {
  cache.delete(tenantId)
}
