/**
 * Seed 3 vertical-appropriate sample staff members + Mon–Fri shifts
 * for the current week. Called from tenant provisioner on new-tenant creation.
 * Safe to re-run — staff insert filters out existing (name match per tenant)
 * and shifts upsert on (tenant_id, staff_id, date, start_time).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

interface StaffSeed {
  name: string
  role: string
}

const STAFF_PRESETS: Record<string, StaffSeed[]> = {
  dental: [
    { name: 'Dr. Sarah Chen', role: 'Dentist' },
    { name: 'Emily Torres', role: 'Dental Hygienist' },
    { name: 'Marcus Webb', role: 'Front Desk' },
  ],
  medical: [
    { name: 'Dr. James Patel', role: 'Physician' },
    { name: 'Lisa Nguyen', role: 'Medical Assistant' },
    { name: 'Tom Rivera', role: 'Front Desk' },
  ],
  veterinary: [
    { name: 'Dr. Rachel Kim', role: 'Veterinarian' },
    { name: 'Danny Park', role: 'Vet Technician' },
    { name: 'Sofia Reyes', role: 'Receptionist' },
  ],
  salon: [
    { name: 'Ava Mitchell', role: 'Lead Stylist' },
    { name: 'Jordan Lee', role: 'Stylist' },
    { name: 'Priya Sharma', role: 'Colorist' },
  ],
  restaurant: [
    { name: 'Carlos Mendez', role: 'Head Chef' },
    { name: 'Nina Costa', role: 'Sous Chef' },
    { name: 'Alex Brown', role: 'Front of House' },
  ],
  contractor: [
    { name: "Mike O'Brien", role: 'Lead Technician' },
    { name: 'Ryan Smith', role: 'Electrician' },
    { name: 'Dave Jackson', role: 'Plumber' },
  ],
  law_firm: [
    { name: 'Sarah Williams', role: 'Attorney' },
    { name: 'Kevin Zhang', role: 'Associate' },
    { name: 'Patricia Moore', role: 'Paralegal' },
  ],
  real_estate: [
    { name: 'Jennifer Davis', role: 'Lead Agent' },
    { name: 'Robert Taylor', role: 'Agent' },
    { name: 'Amanda White', role: 'Office Manager' },
  ],
  sales_crm: [
    { name: 'Chris Johnson', role: 'Account Executive' },
    { name: 'Megan Harris', role: 'SDR' },
    { name: 'Brian Clark', role: 'Sales Manager' },
  ],
}

const COLORS = ['#6366F1', '#0EA5E9', '#10B981']

const AVAILABILITY = {
  mon: { enabled: true, start: '09:00', end: '17:00' },
  tue: { enabled: true, start: '09:00', end: '17:00' },
  wed: { enabled: true, start: '09:00', end: '17:00' },
  thu: { enabled: true, start: '09:00', end: '17:00' },
  fri: { enabled: true, start: '09:00', end: '17:00' },
  sat: { enabled: false },
  sun: { enabled: false },
}

function getAdminClient(): SupabaseClient {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key)
}

function mondayOfCurrentWeek(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay() // 0=Sun .. 6=Sat
  const offset = (dow + 6) % 7
  d.setDate(d.getDate() - offset)
  return d
}

function toIso(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function seedStaff(tenantId: string, vertical: string): Promise<void> {
  const presets = STAFF_PRESETS[vertical] ?? STAFF_PRESETS['sales_crm']!
  if (presets.length === 0) return

  const supabase = getAdminClient()

  // Filter out staff members this tenant already has by name
  const names = presets.map((p) => p.name)
  const { data: existing } = await supabase
    .from('staff_members')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .in('name', names)

  const existingByName = new Map<string, string>()
  for (const row of existing ?? []) {
    existingByName.set(row.name as string, row.id as string)
  }

  const toInsert = presets
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !existingByName.has(p.name))
    .map(({ p, i }) => ({
      tenant_id: tenantId,
      vertical,
      name: p.name,
      role: p.role,
      color_hex: COLORS[i] ?? '#6366F1',
      is_active: true,
      availability: AVAILABILITY,
    }))

  let insertedRows: Array<{ id: string; name: string }> = []
  if (toInsert.length > 0) {
    const { data: inserted, error } = await supabase
      .from('staff_members')
      .insert(toInsert)
      .select('id, name')
    if (error) {
      console.error(`[seed:staff] tenant=${tenantId} staff insert error: ${error.message}`)
      return
    }
    insertedRows = (inserted ?? []) as Array<{ id: string; name: string }>
  }

  const idByName = new Map<string, string>()
  for (const row of insertedRows) idByName.set(row.name, row.id)
  for (const [name, id] of existingByName) idByName.set(name, id)

  // Shifts: Mon–Fri 09:00–17:00 for each staff member this week
  const monday = mondayOfCurrentWeek()
  const shifts: Array<Record<string, unknown>> = []
  for (const p of presets) {
    const staffId = idByName.get(p.name)
    if (!staffId) continue
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      shifts.push({
        tenant_id: tenantId,
        staff_id: staffId,
        date: toIso(d),
        start_time: '09:00',
        end_time: '17:00',
      })
    }
  }

  if (shifts.length === 0) return

  const { error: shiftErr } = await supabase
    .from('shifts')
    .upsert(shifts, { onConflict: 'tenant_id,staff_id,date,start_time', ignoreDuplicates: true })

  if (shiftErr) {
    console.error(`[seed:staff] tenant=${tenantId} shift upsert error: ${shiftErr.message}`)
  }
}
