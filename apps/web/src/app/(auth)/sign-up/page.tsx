'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { VerticalSelector } from '@/components/crm'

type Step = 1 | 2 | 3

interface FormData {
  business_name: string
  vertical_slug: string
  owner_name: string
  owner_email: string
  owner_password: string
  timezone: string
  product: 'maya_only' | 'suite'
}

const INITIAL: FormData = {
  business_name: '',
  vertical_slug: '',
  owner_name: '',
  owner_email: '',
  owner_password: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  product: 'suite',
}

export default function SignUpPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [step, setStep] = useState<Step>(1)
  const [form, setForm] = useState<FormData>(INITIAL)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const p = searchParams.get('product')
    if (p === 'maya_only' || p === 'suite') {
      setForm((prev) => ({ ...prev, product: p }))
    }
  }, [searchParams])

  function set(key: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setError('')
  }

  function nextStep() {
    if (step === 1 && !form.business_name.trim()) {
      setError('Business name is required')
      return
    }
    if (step === 2 && !form.vertical_slug) {
      setError('Please select your business type')
      return
    }
    setStep((s) => (s + 1) as Step)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.owner_name || !form.owner_email || !form.owner_password) {
      setError('All fields are required')
      return
    }
    if (form.owner_password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/tenants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const data = (await res.json()) as { error?: string; message?: string }

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong')
        return
      }

      // Success — sign in automatically and redirect to onboarding
      const { signIn } = await import('next-auth/react')
      const signInRes = await signIn('credentials', {
        email: form.owner_email,
        password: form.owner_password,
        redirect: false,
      })
      if (signInRes?.ok) {
        router.push(form.product === 'maya_only' ? '/onboarding/maya' : '/onboarding')
      } else {
        router.push('/sign-in?registered=1')
      }
    } catch {
      setError('Could not connect to server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputClass = `
    w-full px-3 py-2 border border-gray-300 rounded-lg text-sm
    focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent
  `.trim()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg bg-white rounded-xl border border-gray-200 p-8 shadow-sm">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center">
            <span className="text-white text-sm font-bold">N</span>
          </div>
          <span className="text-lg font-semibold text-gray-900">Nuatis</span>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-6">
          {([1, 2, 3] as Step[]).map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`
                w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold
                ${
                  step === s
                    ? 'bg-teal-600 text-white'
                    : step > s
                      ? 'bg-teal-100 text-teal-700'
                      : 'bg-gray-100 text-gray-400'
                }
              `}
              >
                {step > s ? '✓' : s}
              </div>
              {s < 3 && <div className={`h-px w-8 ${step > s ? 'bg-teal-400' : 'bg-gray-200'}`} />}
            </div>
          ))}
          <span className="ml-2 text-xs text-gray-400">
            {step === 1 && 'Business info'}
            {step === 2 && 'Business type'}
            {step === 3 && 'Your account'}
          </span>
        </div>

        {/* ── Step 1: Business name + product ── */}
        {step === 1 && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Get started with Nuatis</h1>
            <p className="text-sm text-gray-500 mb-4">
              Choose your plan and enter your business name.
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, product: 'maya_only' }))}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${form.product === 'maya_only' ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <p className="text-sm font-semibold text-gray-900">Maya AI</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Voice receptionist + calendar booking
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setForm((p) => ({ ...p, product: 'suite' }))}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${form.product === 'suite' ? 'border-teal-500 bg-teal-50' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <p className="text-sm font-semibold text-gray-900">Nuatis Suite</p>
                  <p className="text-xs text-gray-500 mt-0.5">Full CRM + voice AI + automation</p>
                </button>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Business name
                </label>
                <input
                  type="text"
                  value={form.business_name}
                  onChange={(e) => set('business_name', e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && nextStep()}
                  placeholder="e.g. Sunrise Dental, Oak & Vine"
                  className={inputClass}
                  autoFocus
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}
              <button
                type="button"
                onClick={nextStep}
                className="w-full py-2 px-4 bg-teal-600 text-white text-sm font-medium
                           rounded-lg hover:bg-teal-700 transition-colors"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Vertical selector ── */}
        {step === 2 && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">
              What type of business is {form.business_name}?
            </h1>
            <p className="text-sm text-gray-500 mb-6">
              This sets up your CRM fields and AI receptionist for your industry.
            </p>
            <VerticalSelector
              value={form.vertical_slug}
              onChange={(slug) => set('vertical_slug', slug)}
            />
            {error && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mt-4">{error}</p>
            )}
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 text-sm
                           font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={nextStep}
                className="flex-1 py-2 px-4 bg-teal-600 text-white text-sm font-medium
                           rounded-lg hover:bg-teal-700 transition-colors"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Account details ── */}
        {step === 3 && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Create your account</h1>
            <p className="text-sm text-gray-500 mb-6">
              You will be the owner of {form.business_name}.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Your full name
                </label>
                <input
                  type="text"
                  value={form.owner_name}
                  onChange={(e) => set('owner_name', e.target.value)}
                  placeholder="Jane Smith"
                  className={inputClass}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email address
                </label>
                <input
                  type="email"
                  value={form.owner_email}
                  onChange={(e) => set('owner_email', e.target.value)}
                  placeholder="jane@yourbusiness.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={form.owner_password}
                  onChange={(e) => set('owner_password', e.target.value)}
                  placeholder="Min. 8 characters"
                  className={inputClass}
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="flex-1 py-2 px-4 border border-gray-300 text-gray-700 text-sm
                             font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  ← Back
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-2 px-4 bg-teal-600 text-white text-sm font-medium
                             rounded-lg hover:bg-teal-700 disabled:opacity-50
                             disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Creating account…' : 'Create account'}
                </button>
              </div>
            </form>
            <p className="mt-4 text-xs text-center text-gray-400">
              Already have an account?{' '}
              <a href="/sign-in" className="text-teal-600 hover:underline">
                Sign in
              </a>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
