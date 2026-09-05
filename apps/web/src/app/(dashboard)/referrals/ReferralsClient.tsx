'use client'

import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { formatCurrency } from '@nuatis/shared'
import Button from '@mui/material/Button'
import { bucketAmountsByDay, sumTrend, MiniSparkline } from '@/lib/sparkline'

const API_URL = ''

interface Signup {
  referred_email: string
  status: 'signed_up' | 'active' | 'churned' | 'paid'
  signed_up_at: string
  commission_amount: number | null
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  return `${local.slice(0, 2)}***@${domain}`
}

const STATUS_CLASSES: Record<string, string> = {
  signed_up: 'bg-gray-100 text-gray-600',
  active: 'bg-green-50 text-green-700',
  churned: 'bg-red-50 text-red-700',
  paid: 'bg-blue-50 text-blue-700',
}

const STATUS_LABELS: Record<string, string> = {
  signed_up: 'Signed up',
  active: 'Active',
  churned: 'Churned',
  paid: 'Paid',
}

export default function ReferralsClient() {
  const [clicks, setClicks] = useState<number>(0)
  const [commissionRate, setCommissionRate] = useState<number>(20)
  const [signups, setSignups] = useState<number>(0)
  const [referralUrl, setReferralUrl] = useState<string>('')
  const [estimatedMrr, setEstimatedMrr] = useState<number>(0)
  const [signupsList, setSignupsList] = useState<Signup[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      try {
        const [codeRes, signupsRes] = await Promise.all([
          fetch(`${API_URL}/api/referrals/my-code`, { credentials: 'include' }),
          fetch(`${API_URL}/api/referrals/signups`, { credentials: 'include' }),
        ])

        if (codeRes.ok) {
          const codeData = await codeRes.json()
          setClicks(codeData.clicks ?? 0)
          setReferralUrl(codeData.referral_url ?? '')
          setCommissionRate(
            codeData.commission_rate != null ? Number(codeData.commission_rate) : 20
          )
        }

        if (signupsRes.ok) {
          const signupsData = await signupsRes.json()
          const list: Signup[] = signupsData.signups ?? signupsData ?? []
          setSignupsList(list)
          setSignups(list.length)
          setEstimatedMrr(signupsData.estimated_mrr ?? 0)
        }
      } catch {
        // Silently fail — UI shows zeros
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  useEffect(() => {
    if (!referralUrl) return
    QRCode.toDataURL(referralUrl, { width: 150 })
      .then((url: string) => setQrDataUrl(url))
      .catch(() => {})
  }, [referralUrl])

  async function handleCopy() {
    if (!referralUrl) return
    try {
      await navigator.clipboard.writeText(referralUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for older browsers
    }
  }

  const ratePct = Math.round(commissionRate)

  // 7-day trends from the already-fetched signups list — real timestamps,
  // no fabricated data. Link clicks has no per-event history available
  // client-side (just a running counter), so it's left without a trend.
  const signupsTrend = bucketAmountsByDay(
    signupsList.map((s) => ({ date: s.signed_up_at, amount: 1 }))
  )
  const mrrAddedTrend = bucketAmountsByDay(
    signupsList.map((s) => ({ date: s.signed_up_at, amount: Number(s.commission_amount ?? 0) }))
  )
  const signupsThisWeek = sumTrend(signupsTrend)
  const mrrAddedThisWeek = sumTrend(mrrAddedTrend)

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Hero banner */}
      <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-xl p-6 mb-6">
        <h1 className="text-2xl font-bold text-amber-900 mb-2">
          Earn {ratePct}% recurring commission
        </h1>
        <p className="text-amber-800">
          Refer a business to Nuatis and earn {ratePct}% of their monthly subscription — every month
          they stay active.
        </p>
      </div>

      {/* Referral URL + QR code */}
      <div className="bg-white border border-border-brand rounded-xl p-6 mb-6">
        <p className="text-sm font-medium text-ink4 mb-3">Your referral link</p>
        <div className="flex flex-col sm:flex-row gap-6 items-start">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 bg-gray-50 border border-border-brand rounded-lg px-4 py-2 mb-3">
              <span className="font-mono text-sm text-ink truncate flex-1">
                {loading ? 'Loading…' : referralUrl || '—'}
              </span>
            </div>
            <Button onClick={handleCopy} disabled={!referralUrl || loading} variant="contained">
              {copied ? 'Copied!' : 'Copy link'}
            </Button>
          </div>

          {/* QR code */}
          {qrDataUrl && (
            <div className="flex-shrink-0">
              <img
                src={qrDataUrl}
                alt="QR code for referral link"
                width={150}
                height={150}
                className="rounded-lg border border-border-brand"
              />
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-border-brand rounded-xl p-6 transition-shadow hover:shadow-md">
          <p className="text-3xl font-bold text-ink">{loading ? '—' : clicks}</p>
          <p className="text-sm text-ink3 mt-1">Link clicks</p>
        </div>
        <div className="bg-white border border-border-brand rounded-xl p-6 transition-shadow hover:shadow-md">
          <div className="flex items-end justify-between gap-2">
            <p className="text-3xl font-bold text-ink">{loading ? '—' : signups}</p>
            {!loading && <MiniSparkline trend={signupsTrend} color="#1b1d1f" />}
          </div>
          <p className="text-sm text-ink3 mt-1">
            Signups
            {!loading &&
              (signupsThisWeek > 0 ? ` · +${signupsThisWeek} this week` : ' · none this week')}
          </p>
        </div>
        <div className="bg-white border border-border-brand rounded-xl p-6 transition-shadow hover:shadow-md">
          <div className="flex items-end justify-between gap-2">
            <p className="text-3xl font-bold text-ink">
              {loading ? '—' : formatCurrency(estimatedMrr)}
            </p>
            {!loading && <MiniSparkline trend={mrrAddedTrend} color="#16a34a" />}
          </div>
          <p className="text-sm text-ink3 mt-1">
            Est. monthly earnings
            {!loading &&
              (mrrAddedThisWeek > 0
                ? ` · +${formatCurrency(mrrAddedThisWeek)} this week`
                : ' · none added this week')}
          </p>
        </div>
      </div>

      {/* Signups table */}
      <div className="bg-white border border-border-brand rounded-xl p-6 mb-6">
        <h2 className="text-base font-semibold text-ink mb-4">Your referrals</h2>

        {loading ? (
          <p className="text-sm text-ink3">Loading…</p>
        ) : signupsList.length === 0 ? (
          <p className="text-sm text-ink3 py-6 text-center">
            No signups yet. Share your link to start earning!
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-brand">
                  <th className="text-left py-2 px-3 text-ink4 font-medium">Email</th>
                  <th className="text-left py-2 px-3 text-ink4 font-medium">Status</th>
                  <th className="text-left py-2 px-3 text-ink4 font-medium">Commission</th>
                  <th className="text-left py-2 px-3 text-ink4 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {signupsList.map((s, i) => (
                  <tr
                    key={i}
                    className="border-b border-border-brand last:border-0 hover:bg-gray-50 transition-colors"
                  >
                    <td className="py-3 px-3 font-mono text-ink">{maskEmail(s.referred_email)}</td>
                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_CLASSES[s.status] ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {STATUS_LABELS[s.status] ?? s.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-ink3">
                      {s.commission_amount != null ? formatCurrency(s.commission_amount) : '—'}
                    </td>
                    <td className="py-3 px-3 text-ink3">
                      {new Date(s.signed_up_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* How it works */}
      <div className="bg-white border border-border-brand rounded-xl p-6">
        <h2 className="text-base font-semibold text-ink mb-4">How it works</h2>
        <div className="space-y-4">
          {[
            'Share your unique referral link with fellow business owners',
            'They sign up for Nuatis using your link',
            `Earn ${ratePct}% of their monthly subscription — for life`,
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-100 text-amber-700 font-bold text-sm flex items-center justify-center">
                {i + 1}
              </div>
              <p className="text-sm text-ink pt-1.5">{step}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
