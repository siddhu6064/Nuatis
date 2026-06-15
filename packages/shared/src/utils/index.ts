export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  const h = parseInt(hStr ?? '0', 10)
  const m = parseInt(mStr ?? '0', 10)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Extracts the first name from a full_name string.
 * Trims input, then splits on the first space; returns the whole (trimmed)
 * string when no space is present. Returns the fallback when fullName is
 * null, undefined, empty, or whitespace-only.
 *
 * @param fullName - The full name string (from contacts.full_name column)
 * @param fallback - Returned when fullName is falsy/blank. Defaults to 'there'.
 */
export function getFirstName(fullName: string | null | undefined, fallback = 'there'): string {
  if (!fullName?.trim()) return fallback
  return fullName.trim().split(' ')[0] ?? fallback
}
