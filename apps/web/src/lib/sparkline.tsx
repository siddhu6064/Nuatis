// Shared 7-day trend helpers for stat tiles across the app (Dashboard,
// Invoices, Subscriptions, Referrals, ...) — bucket real timestamps into a
// small sparkline instead of a bare static number.

/**
 * Buckets amounts into 7 daily totals (oldest to newest) by calendar date —
 * uses the browser's local calendar day rather than the tenant's timezone
 * (client components here have no tenant-timezone plumbing), an acceptable
 * approximation for a trend line, not a source of truth.
 */
export function bucketAmountsByDay(entries: { date: string | null; amount: number }[]): number[] {
  const days = 7
  const now = new Date()
  const dayKeys = Array.from({ length: days }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (days - 1 - i))
    return d.toISOString().slice(0, 10)
  })
  const buckets = new Array(days).fill(0) as number[]
  for (const { date, amount } of entries) {
    if (!date) continue
    const idx = dayKeys.indexOf(date.slice(0, 10))
    if (idx >= 0) buckets[idx] = (buckets[idx] ?? 0) + amount
  }
  return buckets
}

export function sumTrend(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0)
}

export function MiniSparkline({ trend, color }: { trend: number[]; color: string }) {
  const w = 56
  const h = 18
  const max = Math.max(...trend, 1)
  const step = w / (trend.length - 1)
  const points = trend.map((v, i) => `${i * step},${h - (v / max) * (h - 3) - 1.5}`).join(' ')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
