export function buildTriggerUrl(slug: string, contactId?: string): string {
  const base =
    process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001'
  const url = `${base}/t/${slug}`
  return contactId ? `${url}?cid=${contactId}` : url
}
