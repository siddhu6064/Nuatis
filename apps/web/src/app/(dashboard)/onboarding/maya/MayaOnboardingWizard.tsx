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

function formatPhone(phone: string | null): string {
  if (!phone) return ''
  const d = phone.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1'))
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return phone
}

interface Props {
  businessName: string
  vertical: string
  phoneNumber: string | null
  calendarConnected: boolean
}

export default function MayaOnboardingWizard({
  businessName,
  vertical,
  phoneNumber: initialPhone,
  calendarConnected: initialCalendar,
}: Props) {
  const router = useRouter()
  const [step, setStep] = useState(1)
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
    setStep((s) => Math.min(s + 1, 4))
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
    window.location.href = `/api/auth/google?return_to=/onboarding/maya`
  }

  async function finish() {
    await completeStep(4)
    // Mark onboarding complete
    try {
      await fetch('/api/provisioning/complete-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 6 }),
      })
    } catch {
      // best-effort
    }
    router.push('/calls')
  }

  const STEPS = [
    { num: 1, label: 'Info' },
    { num: 2, label: 'Phone' },
    { num: 3, label: 'Calendar' },
    { num: 4, label: 'Done' },
  ]

  return (
    <div className="w-full max-w-lg">
      {/* Progress */}
      <div className="flex items-center justify-between mb-8">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
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
                className={`h-px w-8 mx-1 mt-[-12px] ${step > s.num ? 'bg-teal-400' : 'bg-gray-200'}`}
              />
            )}
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-8 shadow-sm">
        {/* Step 1: Business Info */}
        {step === 1 && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Welcome to Maya AI!</h1>
            <p className="text-sm text-gray-500 mb-6">Your AI receptionist is almost ready.</p>
            <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg mb-4">
              <span className="text-2xl">{VERTICAL_ICONS[vertical] ?? '🏢'}</span>
              <div>
                <p className="text-sm font-semibold text-gray-900">{businessName}</p>
                <p className="text-xs text-gray-500">{VERTICAL_LABELS[vertical] ?? vertical}</p>
              </div>
            </div>
            <button
              onClick={goNext}
              className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700"
            >
              Continue
            </button>
          </div>
        )}

        {/* Step 2: Phone */}
        {step === 2 && (
          <div>
            <h1 className="text-xl font-semibold text-gray-900 mb-1">Get your phone number</h1>
            <p className="text-sm text-gray-500 mb-6">
              Maya needs a number to answer calls for {businessName}.
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
                  className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700"
                >
                  Continue
                </button>
              </div>
            ) : (
              <div className="space-y-4">
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
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
                )}
                <button
                  onClick={provisionPhone}
                  disabled={loading}
                  className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
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
              Maya will check availability and book appointments in real-time.
            </p>
            {calendarConnected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg border border-green-100">
                  <span className="text-green-600 text-lg">✓</span>
                  <p className="text-sm font-semibold text-gray-900">Google Calendar connected</p>
                </div>
                <button
                  onClick={goNext}
                  className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700"
                >
                  Continue
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <button
                  onClick={connectCalendar}
                  className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700"
                >
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

        {/* Step 4: Done */}
        {step >= 4 && (
          <div className="text-center">
            <div className="text-5xl mb-4">🎉</div>
            <h1 className="text-xl font-semibold text-gray-900 mb-2">Maya is ready!</h1>
            <p className="text-sm text-gray-500 mb-6">
              {phone
                ? `Call ${formatPhone(phone)} to test Maya.`
                : 'Set up a phone number from Settings to start receiving calls.'}
            </p>
            {phone && (
              <div className="p-4 bg-teal-50 rounded-lg border border-teal-100 mb-4">
                <p className="text-xs text-teal-600 mb-1">Your Maya number</p>
                <p className="text-xl font-bold text-teal-800">{formatPhone(phone)}</p>
              </div>
            )}
            <button
              onClick={finish}
              className="w-full py-2.5 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 mb-4"
            >
              Go to Call Log
            </button>
            <div className="p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500">
                Want a full CRM with pipeline, automation, and quotes?
              </p>
              <button
                onClick={() => router.push('/upgrade')}
                className="text-xs text-teal-600 font-medium mt-1 hover:text-teal-700"
              >
                Upgrade to Nuatis Suite &rarr;
              </button>
            </div>
          </div>
        )}

        {step > 1 && step < 4 && (
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
