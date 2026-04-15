import { createClient } from '@supabase/supabase-js'
import { logActivity } from './activity.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface ImportError {
  row: number
  field: string
  message: string
}

export interface ImportResult {
  imported: number
  skipped: number
  errors: ImportError[]
}

interface ImportOptions {
  skip_duplicates: boolean
  update_existing: boolean
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw.trim()
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export async function processImportRows(
  tenantId: string,
  rows: Record<string, string>[],
  mapping: Record<string, string>,
  options: ImportOptions,
  onProgress?: (imported: number, skipped: number, errorCount: number) => Promise<void>
): Promise<ImportResult> {
  const supabase = getSupabase()
  let imported = 0
  let skipped = 0
  const errors: ImportError[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    try {
      // Map CSV values to contact fields
      const contact: Record<string, unknown> = { tenant_id: tenantId, source: 'import' }
      let phone: string | null = null
      let email: string | null = null

      for (const [csvHeader, contactField] of Object.entries(mapping)) {
        if (contactField === 'skip' || !contactField) continue
        const rawValue = row[csvHeader] ?? ''
        if (!rawValue.trim()) continue

        switch (contactField) {
          case 'name':
            contact['full_name'] = rawValue.trim()
            break
          case 'phone':
            phone = normalizePhone(rawValue)
            contact['phone'] = phone
            break
          case 'email':
            email = normalizeEmail(rawValue)
            contact['email'] = email
            break
          case 'tags': {
            const tags = rawValue
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
            contact['tags'] = tags
            break
          }
          case 'notes':
            contact['notes'] = rawValue.trim()
            break
          case 'source':
            contact['source'] = rawValue.trim()
            break
        }
      }

      // Must have at least name, phone, or email
      if (!contact['full_name'] && !phone && !email) {
        errors.push({ row: i + 1, field: '', message: 'Row has no name, phone, or email' })
        continue
      }

      // Default name if missing
      if (!contact['full_name']) {
        contact['full_name'] = email ?? phone ?? 'Unknown'
      }

      // Duplicate check
      let duplicateId: string | null = null
      if (phone || email) {
        const conditions: string[] = []
        if (phone) {
          const phoneDigits = phone.replace(/\D/g, '')
          conditions.push(`phone.ilike.%${phoneDigits.slice(-10)}%`)
        }
        if (email) conditions.push(`email.ilike.${email}`)

        const { data: dupes } = await supabase
          .from('contacts')
          .select('id')
          .eq('tenant_id', tenantId)
          .or(conditions.join(','))
          .limit(1)

        if (dupes && dupes.length > 0) {
          duplicateId = dupes[0]!.id
        }
      }

      if (duplicateId) {
        if (options.update_existing) {
          const updateFields: Record<string, unknown> = {}
          if (phone) updateFields['phone'] = phone
          if (email) updateFields['email'] = email
          if (contact['tags']) updateFields['tags'] = contact['tags']
          if (contact['notes']) updateFields['notes'] = contact['notes']

          await supabase.from('contacts').update(updateFields).eq('id', duplicateId)
          imported++
        } else if (options.skip_duplicates) {
          skipped++
        } else {
          skipped++
        }
        continue
      }

      // INSERT new contact
      const { data: newContact, error: insertErr } = await supabase
        .from('contacts')
        .insert(contact)
        .select('id')
        .single()

      if (insertErr) {
        errors.push({ row: i + 1, field: '', message: insertErr.message })
        continue
      }

      imported++

      if (newContact) {
        void logActivity({
          tenantId,
          contactId: newContact.id,
          type: 'system',
          body: 'Contact imported via CSV',
          actorType: 'system',
        })
      }
    } catch (err) {
      errors.push({
        row: i + 1,
        field: '',
        message: err instanceof Error ? err.message : 'Unknown error',
      })
    }

    // Progress callback every 50 rows
    if (onProgress && (i + 1) % 50 === 0) {
      await onProgress(imported, skipped, errors.length)
    }
  }

  return { imported, skipped, errors }
}
