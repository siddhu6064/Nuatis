/**
 * Simple CSV parser that handles:
 * - Quoted fields with commas inside
 * - Windows line endings (\r\n)
 * - UTF-8 BOM
 */

export function parseCsv(raw: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip BOM
  let text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw

  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const lines = splitCsvLines(text)
  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = parseCsvLine(lines[0]!).map((h) => h.trim())
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    if (!line) continue
    const values = parseCsvLine(line)
    const row: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]!] = (values[j] ?? '').trim()
    }
    rows.push(row)
  }

  return { headers, rows }
}

function splitCsvLines(text: string): string[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) lines.push(current)

  return lines
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        fields.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  fields.push(current)

  return fields
}

const FIELD_ALIASES: Record<string, string> = {
  name: 'name',
  'full name': 'name',
  full_name: 'name',
  'contact name': 'name',
  'first name': 'name',
  phone: 'phone',
  'phone number': 'phone',
  mobile: 'phone',
  cell: 'phone',
  telephone: 'phone',
  email: 'email',
  'email address': 'email',
  'e-mail': 'email',
  tags: 'tags',
  tag: 'tags',
  labels: 'tags',
  notes: 'notes',
  note: 'notes',
  source: 'source',
}

export function suggestMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {}
  for (const header of headers) {
    const normalized = header.toLowerCase().trim()
    mapping[header] = FIELD_ALIASES[normalized] ?? null
  }
  return mapping
}
