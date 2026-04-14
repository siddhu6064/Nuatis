'use client'

import { useState } from 'react'

const FAQS = [
  {
    q: 'How does Maya answer calls?',
    a: 'Maya uses Google Gemini 2.0 Flash Live for real-time voice AI. When a call comes in, she answers instantly, understands the caller, and responds naturally — all in under 1.5 seconds.',
  },
  {
    q: 'Can Maya handle multiple languages?',
    a: 'Yes! Maya automatically detects what language the caller is speaking and responds in that language. Currently supported: English, Spanish, Hindi, and Telugu.',
  },
  {
    q: "What happens if Maya can't help a caller?",
    a: 'Maya will transfer the call to you or your staff. She sends you an SMS heads-up before connecting, so you know what the caller needs.',
  },
  {
    q: 'How much does each call cost?',
    a: 'About $0.008 per call for the AI processing. Your $49/mo subscription includes unlimited calls — no per-minute charges.',
  },
  {
    q: 'Can I customize what Maya says?',
    a: 'Yes. You can set a custom greeting, choose her personality (professional, friendly, or casual), and upload a knowledge base with your business FAQs.',
  },
  {
    q: 'Do I need any special equipment?',
    a: 'No. Maya works with any phone system. We provision a local phone number for you — just forward your business line to it, or give customers the number directly.',
  },
]

export default function MayaFAQ() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <div className="space-y-2">
      {FAQS.map((faq, i) => (
        <div key={i} className="border border-gray-100 rounded-lg">
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-sm font-medium text-gray-900">{faq.q}</span>
            <span className="text-gray-400 text-lg ml-2">{open === i ? '−' : '+'}</span>
          </button>
          {open === i && (
            <div className="px-4 pb-3">
              <p className="text-sm text-gray-500 leading-relaxed">{faq.a}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
