export interface DayAvailability {
  enabled: boolean
  start?: string
  end?: string
}

export type Availability = Partial<Record<DayKey, DayAvailability>>

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DayKey = (typeof DAY_KEYS)[number]

export const DAY_LABEL: Record<DayKey, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
}

export interface StaffMember {
  id: string
  tenant_id: string
  name: string
  role: string
  email: string | null
  phone: string | null
  color_hex: string
  is_active: boolean
  availability: Availability
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Shift {
  id: string
  tenant_id: string
  staff_id: string
  date: string
  start_time: string
  end_time: string
  notes: string | null
  created_at: string
  staff_name?: string | null
  staff_color?: string | null
}

export const COLOR_SWATCHES = [
  '#6366F1',
  '#0EA5E9',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#EC4899',
  '#8B5CF6',
  '#14B8A6',
  '#F97316',
  '#06B6D4',
  '#84CC16',
  '#64748B',
] as const
