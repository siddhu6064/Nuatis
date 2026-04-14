'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { trackEvent } from '@/lib/analytics'

const FEATURES = [
  { name: 'Voice AI receptionist', maya: true, suite: true },
  { name: 'Google Calendar booking', maya: true, suite: true },
  { name: 'Call logs', maya: true, suite: true },
  { name: 'Maya settings & knowledge base', maya: true, suite: true },
  { name: 'Contact CRM', maya: false, suite: true },
  { name: 'Pipeline / Kanban', maya: false, suite: true },
  { name: 'Automation (follow-ups, reminders)', maya: false, suite: true },
  { name: 'Insights & analytics', maya: false, suite: true },
  { name: 'Quotes & proposals (CPQ)', maya: false, suite: true },
  { name: 'Webhook integrations', maya: false, suite: true },
  { name: 'Audit log', maya: false, suite: true },
]

export default function UpgradePage() {
  const router = useRouter()
  const [upgrading, setUpgrading] = useState(false)

  useEffect(() => {
    void trackEvent('upgrade_page_viewed')
  }, [])

  async function handleUpgrade() {
    setUpgrading(true)
    void trackEvent('upgrade_cta_clicked')
    try {
      const res = await fetch('/api/provisioning/upgrade-to-suite', { method: 'POST' })
      if (res.ok) {
        void trackEvent('upgrade_completed')
        router.push('/onboarding')
      }
    } catch {
      // ignore
    } finally {
      setUpgrading(false)
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Unlock the Full Nuatis Suite</h1>
        <p className="text-sm text-gray-500 mt-2">
          Everything in Maya AI, plus a complete CRM with pipeline, automation, quotes, and
          analytics.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-8">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Feature</th>
              <th className="text-center text-xs font-medium text-gray-400 px-4 py-3">Maya AI</th>
              <th className="text-center text-xs font-medium text-teal-600 px-4 py-3 bg-teal-50">
                Suite
              </th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f.name} className="border-b border-gray-50 last:border-0">
                <td className="px-6 py-3 text-sm text-gray-700">{f.name}</td>
                <td className="px-4 py-3 text-center">
                  {f.maya ? (
                    <span className="text-green-600">&#10003;</span>
                  ) : (
                    <span className="text-gray-300">&mdash;</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center bg-teal-50/50">
                  <span className="text-green-600">&#10003;</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-center">
        <p className="text-sm text-gray-500 mb-4">Suite starts at $99/mo</p>
        <button
          onClick={handleUpgrade}
          disabled={upgrading}
          className="px-8 py-3 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          {upgrading ? 'Upgrading...' : 'Upgrade to Suite'}
        </button>
        <p className="text-xs text-gray-400 mt-3">
          Pricing is placeholder. Stripe billing will be configured during Phase 6.
        </p>
      </div>
    </div>
  )
}
