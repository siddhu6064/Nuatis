'use client'

import { useState, useEffect, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'

interface VerifyResult {
  valid: boolean
  contact_name?: string | null
  business_name?: string | null
  portal_slug?: string | null
}

interface BusinessInfo {
  business_name: string
  portal_enabled: boolean
}

function PortalLandingContent() {
  const params = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const slug = params.slug
  const token = searchParams.get('token')

  const [businessInfo, setBusinessInfo] = useState<BusinessInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [requestSent, setRequestSent] = useState(false)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    // Fetch business info
    fetch(`/api/portal/by-slug/${slug}`)
      .then((r) => (r.ok ? (r.json() as Promise<BusinessInfo>) : Promise.reject('Not found')))
      .then((data) => setBusinessInfo(data))
      .catch(() => setError('Portal not found or unavailable.'))
      .finally(() => setLoading(false))
  }, [slug])

  useEffect(() => {
    if (!token) return
    // Verify token
    fetch(`/api/portal/verify?token=${encodeURIComponent(token)}`)
      .then((r) => r.json() as Promise<VerifyResult>)
      .then((data) => {
        if (data.valid) {
          router.replace(`/portal/${slug}/dashboard?token=${encodeURIComponent(token)}`)
        } else {
          setError('Your access link has expired or is invalid. Request a new one below.')
        }
      })
      .catch(() => setError('Unable to verify access link.'))
  }, [token, slug, router])

  async function handleRequestAccess(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setRequesting(true)
    try {
      await fetch('/api/portal/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, email: email.trim() }),
      })
      setRequestSent(true)
    } catch {
      setError('Unable to send access link. Please try again.')
    } finally {
      setRequesting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error && !businessInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center">
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  const businessName = businessInfo?.business_name ?? 'Client Portal'

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-900">{businessName}</h1>
          <p className="text-gray-500 text-sm mt-1">Client Portal</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          {requestSent ? (
            <div className="text-center">
              <div className="w-12 h-12 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-6 h-6 text-teal-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-base font-semibold text-gray-900 mb-2">Check your email</h2>
              <p className="text-sm text-gray-500">
                If you have portal access, we sent a link to <strong>{email}</strong>.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-base font-semibold text-gray-900 mb-1">Access your portal</h2>
              <p className="text-sm text-gray-500 mb-6">
                Enter your email to receive an access link.
              </p>

              {error && (
                <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-lg">
                  {error}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  void handleRequestAccess(e)
                }}
              >
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  required
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent mb-4"
                />
                <button
                  type="submit"
                  disabled={requesting}
                  className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  {requesting ? 'Sending…' : 'Send access link'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">Powered by Nuatis</p>
      </div>
    </div>
  )
}

export default function PortalLandingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <PortalLandingContent />
    </Suspense>
  )
}
