'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'

interface ReferralLanding {
  business_name: string
  referrer_first_name: string | null
  booking_page_enabled: boolean
  booking_page_slug: string | null
}

export default function ReferralLandingPage() {
  const params = useParams<{ code: string }>()
  const code = params.code

  const [data, setData] = useState<ReferralLanding | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    fetch(`/api/customer-referrals/${code}`)
      .then((r) => (r.ok ? (r.json() as Promise<ReferralLanding>) : Promise.reject()))
      .then((d) => setData(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [code])

  async function handleLeadSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!fullName.trim() || (!phone.trim() && !email.trim())) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/customer-referrals/${code}/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
        }),
      })
      if (!res.ok) throw new Error('Unable to submit')
      setSubmitted(true)
    } catch {
      setSubmitError('Unable to submit — please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <p className="text-gray-500 text-sm">This referral link is no longer active.</p>
      </div>
    )
  }

  const referrerLabel = data.referrer_first_name ? `${data.referrer_first_name} sent you` : "You've"

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{data.business_name}</h1>
          <p className="text-gray-500 text-sm mt-1">
            {referrerLabel} been invited to try {data.business_name}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {data.booking_page_enabled && data.booking_page_slug ? (
            <>
              <h2 className="text-base font-semibold text-gray-900 mb-1">Book your first visit</h2>
              <p className="text-sm text-gray-500 mb-6">
                Grab a spot and we'll take care of the rest.
              </p>
              <a
                href={`/book/${data.booking_page_slug}?ref=${code}`}
                className="block w-full text-center py-2.5 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 transition-colors"
              >
                Book Now
              </a>
              <p className="text-xs text-gray-400 text-center mt-4">
                Prefer we reach out instead? Leave your info below.
              </p>
            </>
          ) : null}

          {submitted ? (
            <div className="text-center mt-4">
              <p className="text-sm text-gray-500">Thanks! We'll be in touch shortly.</p>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                void handleLeadSubmit(e)
              }}
              className="mt-4 space-y-3"
            >
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
              {submitError && <p className="text-xs text-rose-600">{submitError}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Sending…' : 'Leave my info'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">Powered by Nuatis</p>
      </div>
    </div>
  )
}
