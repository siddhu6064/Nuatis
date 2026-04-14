'use client'

import { useState } from 'react'

interface FollowUpStep {
  days_after: number
  channel: 'sms' | 'email'
  subject?: string
  template: string
}

interface Props {
  cadence: FollowUpStep[]
  verticalLabel: string
  businessName: string
  telnyxNumber: string
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
}

const VARIABLES = [
  { key: 'name', label: '{name}', desc: 'Contact name' },
  { key: 'business', label: '{business}', desc: 'Business name' },
  { key: 'phone', label: '{phone}', desc: 'Business phone' },
]

export default function FollowUpEditor({
  cadence,
  verticalLabel,
  businessName,
  telnyxNumber,
}: Props) {
  const [selectedStep, setSelectedStep] = useState(0)

  const sampleVars: Record<string, string> = {
    name: 'John Smith',
    business: businessName,
    phone: telnyxNumber,
  }

  const current = cadence[selectedStep]

  return (
    <div className="max-w-2xl space-y-6">
      {/* Variables reference */}
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <p className="text-xs font-medium text-gray-500 mb-2">Available variables</p>
        <div className="flex flex-wrap gap-2">
          {VARIABLES.map((v) => (
            <span
              key={v.key}
              className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-mono bg-teal-50 text-teal-700 border border-teal-100"
              title={v.desc}
            >
              {v.label}
            </span>
          ))}
        </div>
      </div>

      {/* Cadence timeline */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-4">
          Follow-up Cadence &mdash; {verticalLabel}
        </h2>

        {cadence.length === 0 ? (
          <p className="text-sm text-gray-400">
            No follow-up cadence configured for this vertical.
          </p>
        ) : (
          <div className="space-y-0">
            {cadence.map((step, i) => (
              <button key={i} onClick={() => setSelectedStep(i)} className="w-full text-left">
                <div className="flex items-start gap-3 relative">
                  {/* Vertical line */}
                  {i < cadence.length - 1 && (
                    <div className="absolute left-[7px] top-4 w-px h-full bg-gray-100" />
                  )}
                  {/* Dot */}
                  <div
                    className={`w-[15px] h-[15px] rounded-full border-2 shrink-0 mt-0.5 relative z-10 ${
                      selectedStep === i ? 'border-teal-500 bg-teal-50' : 'border-gray-300 bg-white'
                    }`}
                  />
                  <div
                    className={`flex-1 pb-5 px-3 py-2 rounded-lg transition-colors ${
                      selectedStep === i ? 'bg-gray-50' : 'hover:bg-gray-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-gray-900">Day {step.days_after}</p>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                          step.channel === 'sms'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-teal-50 text-teal-700'
                        }`}
                      >
                        {step.channel.toUpperCase()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 line-clamp-2">{step.template}</p>
                    {step.channel === 'sms' && step.template.length > 160 && (
                      <p className="text-[10px] text-amber-600 mt-1">
                        {step.template.length}/160 chars (may split into multiple SMS)
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selected step detail + preview */}
      {current && (
        <div className="bg-white rounded-xl border border-gray-100 p-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-semibold text-gray-900">Step {selectedStep + 1} Preview</h2>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                current.channel === 'sms' ? 'bg-blue-50 text-blue-700' : 'bg-teal-50 text-teal-700'
              }`}
            >
              {current.channel.toUpperCase()}
            </span>
          </div>

          {/* Template (read-only) */}
          {current.subject && (
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
              <div className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700">
                {current.subject}
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 mb-1">Template</label>
            <div className="w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg text-gray-700 whitespace-pre-wrap">
              {current.template}
            </div>
            {current.channel === 'sms' && (
              <p className="text-[10px] text-gray-400 mt-1">{current.template.length} characters</p>
            )}
          </div>

          {/* Rendered preview */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Preview (with sample data)
            </label>
            <div
              className={`px-4 py-3 rounded-lg text-sm ${
                current.channel === 'sms'
                  ? 'bg-blue-50 text-blue-900 border border-blue-100'
                  : 'bg-teal-50 text-teal-900 border border-teal-100'
              }`}
            >
              {current.subject && (
                <p className="font-medium mb-1">{interpolate(current.subject, sampleVars)}</p>
              )}
              <p>{interpolate(current.template, sampleVars)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Read-only notice */}
      {/* TODO: Per-tenant template customization — store overrides in tenant_follow_up_overrides table */}
      <div className="bg-amber-50 rounded-xl border border-amber-100 p-4 flex items-start gap-3">
        <span className="text-amber-500 text-lg leading-none mt-0.5">!</span>
        <div>
          <p className="text-sm font-medium text-amber-800">Templates are read-only</p>
          <p className="text-xs text-amber-600 mt-0.5">
            Templates are configured per vertical. Custom templates are coming soon.
          </p>
          <a
            href="mailto:sid@nuatis.com?subject=Custom follow-up templates"
            className="inline-block mt-2 text-xs text-teal-600 font-medium hover:text-teal-700"
          >
            Request Custom Templates &rarr;
          </a>
        </div>
      </div>
    </div>
  )
}
