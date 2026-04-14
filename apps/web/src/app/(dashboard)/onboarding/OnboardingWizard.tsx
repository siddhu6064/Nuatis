'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const VERTICAL_LABELS: Record<string, string> = {
  sales_crm: 'Sales CRM',
  dental: 'Dental',
  salon: 'Salon',
  restaurant: 'Restaurant',
  contractor: 'Contractor',
  law_firm: 'Law Firm',
  real_estate: 'Real Estate',
}

const VERTICAL_ICONS: Record<string, string> = {
  sales_crm: '📊',
  dental: '🦷',
  salon: '✂️',
  restaurant: '🍽️',
  contractor: '🔧',
  law_firm: '⚖️',
  real_estate: '🏠',
}

const AREA_CODES = [
  { code: '512', label: 'Austin (512)' },
  { code: '214', label: 'Dallas (214)' },
  { code: '713', label: 'Houston (713)' },
  { code: '210', label: 'San Antonio (210)' },
  { code: '817', label: 'Fort Worth (817)' },
]

const STEPS = [
  { label: 'Business', num: 1 },
  { label: 'Phone', num: 2 },
  { label: 'Calendar', num: 3 },
  { label: 'Hours', num: 4 },
  { label: 'Test', num: 5 },
  { label: 'Done', num: 6 },
]

const DEFAULT_HOURS: Record<string, string> = {
  sales_crm: 'Mon–Fri 9am–6pm, Sat Closed, Sun Closed',
  dental: 'Mon–Fri 8am–5pm, Sat 9am–1pm, Sun Closed',
  salon: 'Mon–Fri 9am–7pm, Sat 9am–5pm, Sun Closed',
  restaurant: 'Mon–Fri 11am–10pm, Sat 11am–11pm, Sun 11am–9pm',
  contractor: 'Mon–Fri 7am–5pm, Sat 8am–12pm, Sun Closed',
  law_firm: 'Mon–Fri 9am–5pm, Sat Closed, Sun Closed',
  real_estate: 'Mon–Fri 9am–6pm, Sat 10am–4pm, Sun Closed',
}

interface Props {
  initialStep: number
  completed: boolean
  businessName: string
  vertical: string
  phoneNumber: string | null
  calendarConnected: boolean
}

function formatPhone(phone: string | null): string {
  if (!phone) return ''
  const d = phone.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) {
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  }
  return phone
}

export default function OnboardingWizard({
  initialStep,
  completed,
  businessName,
  vertical,
  phoneNumber: initialPhone,
  calendarConnected: initialCalendar,
}: Props) {
  const router = useRouter()
  const [step, setStep] = useState(completed ? 6 : Math.min(initialStep, 6))
  const [phone, setPhone] = useState(initialPhone)
  const [calendarConnected] = useState(initialCalendar)
  const [areaCode, setAreaCode] = useState('512')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function completeStep(stepNum: number) {
    try {
      await fetch('/api/provisioning/complete-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: stepNum }),
      })
    } catch {
      // best-effort
    }
  }

  async function goNext() {
    await completeStep(step)
    setStep((s) => Math.min(s + 1, 6))
    setError('')
  }

  async function provisionPhone() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/provisioning/provision-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ area_code: areaCode }),
      })
      const data = await res.json()
      if (res.ok && data.phone_number) {
        setPhone(data.phone_number)
        await goNext()
      } else {
        setError(data.error || 'Failed to provision number')
      }
    } catch {
      setError('Could not connect to server')
    } finally {
      setLoading(false)
    }
  }

  function connectCalendar() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
    window.location.href = `${apiUrl}/api/auth/google?return_to=/onboarding`
  }

  return (
    <div className="w-full max-w-lg">
      {/* Progress bar */}
      <div className="flex items-center justify-between mb-8">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                  step > s.num
                    ? 'bg-teal-100 text-teal-700'
                    : step === s.num
                      ? 'bg-teal-600 text-white'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                {step > s.num ? '✓' : s.num}
              </div>
              <span className="text-[10px] text-gray-400 mt-1">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`h-px w-6 mx-1 mt-[-12px] ${step > s.num ? 'bg-teal-400' : 'bg-gray-200'}`}
              />
            )}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-8 shadow-sm">
        {/* Step 1: Business Info */}
        {step === 1 && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Welcome to Nuatis!</h1>
            <p className="text-sm text-gray-500 mb-6">Let&apos;s confirm your business details.</p>
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg">
                <span className="text-2xl">{VERTICAL_ICONS[vertical] ?? '🏢'}</span>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{businessName}</p>
                  <p className="text-xs text-gray-500">{VERTICAL_LABELS[vertical] ?? vertical}</p>
                </div>
              </div>
              <button
                onClick={goNext}
                className="w-full py-2.5 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Phone Number */}
        {step === 2 && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Get your phone number</h1>
            <p className="text-sm text-gray-500 mb-6">
              Maya needs a phone number to answer calls for {businessName}.
            </p>
            {phone ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-100">
                  <span className="text-green-600 text-lg">✓</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{formatPhone(phone)}</p>
                    <p className="text-xs text-green-600">Number provisioned</p>
                  </div>
                </div>
                <button
                  onClick={goNext}
                  className="w-full py-2.5 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
                >
                  Continue
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">
                    Area code
                  </label>
                  <select
                    value={areaCode}
                    onChange={(e) => setAreaCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    {AREA_CODES.map((ac) => (
                      <option key={ac.code} value={ac.code}>
                        {ac.label}
                      </option>
                    ))}
                  </select>
                </div>
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
                )}
                <button
                  onClick={provisionPhone}
                  disabled={loading}
                  className="w-full py-2.5 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  {loading ? 'Provisioning...' : 'Get My Number'}
                </button>
                <button
                  onClick={goNext}
                  className="w-full text-sm text-gray-400 hover:text-gray-600"
                >
                  Skip for now
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Calendar */}
        {step === 3 && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Connect Google Calendar</h1>
            <p className="text-sm text-gray-500 mb-6">
              Let Maya check availability and book appointments in real-time.
            </p>
            {calendarConnected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-100">
                  <span className="text-green-600 text-lg">✓</span>
                  <p className="text-sm font-semibold text-gray-900">Google Calendar connected</p>
                </div>
                <button
                  onClick={goNext}
                  className="w-full py-2.5 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
                >
                  Continue
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <button
                  onClick={connectCalendar}
                  className="w-full py-2.5 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.372 0 0 5.372 0 12s5.372 12 12 12 12-5.372 12-12S18.628 0 12 0zm6.28 7.18L12 13.46 5.72 7.18A.5.5 0 0 1 6 6.5h12a.5.5 0 0 1 .28.68z" />
                  </svg>
                  Connect Google Calendar
                </button>
                <button
                  onClick={goNext}
                  className="w-full text-sm text-gray-400 hover:text-gray-600"
                >
                  Skip for now
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Business Hours */}
        {step === 4 && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Business hours</h1>
            <p className="text-sm text-gray-500 mb-6">
              Maya uses these hours to schedule appointments and inform callers.
            </p>
            <div className="p-4 bg-gray-50 rounded-lg mb-6">
              <p className="text-sm text-gray-700">
                {DEFAULT_HOURS[vertical] ?? 'Mon–Fri 9am–5pm'}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Default hours for {VERTICAL_LABELS[vertical]}. Contact support to customize.
              </p>
            </div>
            <button
              onClick={goNext}
              className="w-full py-2.5 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
            >
              These look right
            </button>
          </div>
        )}

        {/* Step 5: Test Maya */}
        {step === 5 && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Test Maya</h1>
            <p className="text-sm text-gray-500 mb-6">Call your number to hear Maya in action!</p>
            {phone ? (
              <div className="space-y-4">
                <div className="p-6 bg-teal-50 rounded-lg text-center border border-teal-100">
                  <p className="text-xs text-teal-600 mb-1">Call this number</p>
                  <p className="text-2xl font-bold text-teal-800">{formatPhone(phone)}</p>
                </div>
                <div className="p-3 bg-gray-50 rounded-lg">
                  <p className="text-xs text-gray-500">
                    Try asking: &quot;What are your business hours?&quot; or &quot;I&apos;d like to
                    book an appointment for Thursday&quot;
                  </p>
                </div>
                <button
                  onClick={goNext}
                  className="w-full py-2.5 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
                >
                  I&apos;ve tested Maya
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-400">
                  You&apos;ll need a phone number to test Maya. You can set one up from Settings
                  later.
                </p>
                <button
                  onClick={goNext}
                  className="w-full py-2.5 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
                >
                  Skip
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 6: All Set */}
        {step >= 6 && (
          <div className="text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">You&apos;re all set!</h1>
            <p className="text-sm text-gray-500 mb-6">
              {businessName} is ready to go. Maya is standing by to handle your calls.
            </p>
            <div className="space-y-2 mb-6 text-left">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-green-600">✓</span>
                <span className="text-gray-700">
                  {businessName} ({VERTICAL_LABELS[vertical]})
                </span>
              </div>
              {phone && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-green-600">✓</span>
                  <span className="text-gray-700">Phone: {formatPhone(phone)}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <span className={calendarConnected ? 'text-green-600' : 'text-gray-300'}>
                  {calendarConnected ? '✓' : '○'}
                </span>
                <span className="text-gray-700">
                  Google Calendar {calendarConnected ? 'connected' : 'not connected'}
                </span>
              </div>
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="w-full py-2.5 px-4 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
            >
              Go to Dashboard
            </button>
            <p className="text-xs text-gray-400 mt-3">
              You&apos;re on the Starter plan. Upgrade anytime from Settings.
            </p>
          </div>
        )}

        {/* Back button (steps 2-5) */}
        {step > 1 && step < 6 && (
          <button
            onClick={() => setStep((s) => Math.max(s - 1, 1))}
            className="mt-4 text-sm text-gray-400 hover:text-gray-600"
          >
            &larr; Back
          </button>
        )}
      </div>
    </div>
  )
}
