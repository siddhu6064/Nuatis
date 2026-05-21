import type { BusinessProfile } from '@nuatis/shared'

const DAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

const DAY_LABEL: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

function formatTime(time: string): string {
  const [hStr, mStr] = time.split(':')
  const h = parseInt(hStr ?? '0', 10)
  const m = parseInt(mStr ?? '0', 10)
  const period = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 || 12
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`
}

export function buildBusinessKnowledgeBlock(profile: BusinessProfile): string {
  const lines: string[] = []

  // Hours
  if (profile.hours && Object.keys(profile.hours).length > 0) {
    const hourParts: string[] = []
    for (const day of DAY_ORDER) {
      const h = profile.hours[day]
      if (!h) continue
      if (h.closed) {
        hourParts.push(`${DAY_LABEL[day]}: Closed`)
      } else {
        hourParts.push(`${DAY_LABEL[day]}: ${formatTime(h.open)}–${formatTime(h.close)}`)
      }
    }
    if (hourParts.length > 0) {
      lines.push(`HOURS: ${hourParts.join(', ')}`)
    }
  }

  // Services
  if (profile.services && profile.services.length > 0) {
    const serviceParts = profile.services.map((s) => {
      const parts = [s.name]
      if (s.duration_min) parts.push(`${s.duration_min} min`)
      if (s.price != null) parts.push(`$${s.price}`)
      return parts.join(' | ')
    })
    lines.push(`SERVICES: ${serviceParts.join('; ')}`)
  }

  // Staff
  if (profile.staff && profile.staff.length > 0) {
    const staffParts = profile.staff.map((s) => `${s.name} (${s.role})`)
    lines.push(`STAFF: ${staffParts.join(', ')}`)
  }

  // FAQs
  const faqLines: string[] = []
  if (profile.faqs && profile.faqs.length > 0) {
    for (const faq of profile.faqs) {
      if (faq.question && faq.answer) {
        faqLines.push(`Q: ${faq.question}\nA: ${faq.answer}`)
      }
    }
  }

  const hasContent = lines.length > 0 || faqLines.length > 0 || Boolean(profile.notes)
  if (!hasContent) return ''

  let block = '\n\n--- BUSINESS KNOWLEDGE ---\n'
  if (lines.length > 0) block += lines.join('\n') + '\n'
  if (faqLines.length > 0) block += 'FAQs:\n' + faqLines.join('\n') + '\n'
  if (profile.notes) block += `NOTES: ${profile.notes}\n`
  block += '--- END BUSINESS KNOWLEDGE ---'

  return block
}

export function buildKbFilesBlock(
  files: Array<{ file_name: string; extracted_text: string | null }>
): string {
  const ready = files.filter((f) => f.extracted_text && f.extracted_text.trim())
  if (ready.length === 0) return ''

  let block = '\n\n--- UPLOADED DOCUMENTS ---\n'
  for (const f of ready) {
    block += `[${f.file_name}]:\n${f.extracted_text!}\n---\n`
  }
  return block
}

export function buildKbUrlsBlock(
  urls: Array<{ url: string; extracted_text: string | null }>
): string {
  const ready = urls.filter((u) => u.extracted_text && u.extracted_text.trim())
  if (ready.length === 0) return ''

  let block = '\n\n--- WEBSITE KNOWLEDGE ---\n'
  for (const u of ready) {
    block += `Source: ${u.url}\n${u.extracted_text!}\n---\n`
  }
  return block
}
