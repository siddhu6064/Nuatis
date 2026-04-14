'use client'

import { useState, useEffect } from 'react'

export function NPSSurvey() {
  const [show, setShow] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const [feedback, setFeedback] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (localStorage.getItem('nps-snoozed')) {
      const snoozed = Number(localStorage.getItem('nps-snoozed'))
      if (Date.now() - snoozed < 7 * 86400000) return
    }

    fetch('/api/nps/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { show?: boolean } | null) => {
        if (data?.show) setShow(true)
      })
      .catch(() => {})
  }, [])

  async function submit() {
    if (score == null) return
    setSubmitting(true)
    try {
      await fetch('/api/nps/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, feedback: feedback || null }),
      })
      setSubmitted(true)
    } catch {
      // ignore
    } finally {
      setSubmitting(false)
    }
  }

  function snooze() {
    localStorage.setItem('nps-snoozed', String(Date.now()))
    setShow(false)
  }

  async function dismiss() {
    try {
      await fetch('/api/nps/dismiss', { method: 'POST' })
    } catch {
      // ignore
    }
    setShow(false)
  }

  if (!show) return null

  if (submitted) {
    return (
      <div className="fixed bottom-4 right-4 z-50 w-80 bg-white rounded-xl border border-gray-200 shadow-lg p-5 text-center">
        <p className="text-sm font-semibold text-gray-900 mb-1">Thank you for your feedback!</p>
        <p className="text-xs text-gray-400">Your input helps us improve Nuatis.</p>
        <button onClick={() => setShow(false)} className="mt-3 text-xs text-teal-600 font-medium">
          Close
        </button>
      </div>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 bg-white rounded-xl border border-gray-200 shadow-lg p-5">
      <div className="flex items-start justify-between mb-3">
        <p className="text-sm font-semibold text-gray-900">
          How likely are you to recommend Nuatis?
        </p>
        <button onClick={snooze} className="text-gray-300 hover:text-gray-500 text-lg leading-none">
          &times;
        </button>
      </div>

      {/* Score buttons */}
      <div className="flex gap-1 mb-3">
        {Array.from({ length: 11 }, (_, i) => (
          <button
            key={i}
            onClick={() => setScore(i)}
            className={`w-6 h-6 rounded text-[10px] font-medium transition-colors ${
              score === i ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {i}
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[9px] text-gray-400 mb-3">
        <span>Not likely</span>
        <span>Extremely likely</span>
      </div>

      {/* Feedback for detractors */}
      {score != null && score < 7 && (
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What could we improve?"
          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-lg mb-3 resize-none focus:outline-none focus:ring-1 focus:ring-teal-500"
          rows={2}
        />
      )}

      {score != null && (
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full py-2 bg-teal-600 text-white text-xs font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      )}

      <div className="flex justify-center gap-3 mt-2">
        <button onClick={snooze} className="text-[10px] text-gray-400 hover:text-gray-600">
          Not now
        </button>
        <button onClick={dismiss} className="text-[10px] text-gray-400 hover:text-gray-600">
          Don&apos;t ask again
        </button>
      </div>
    </div>
  )
}
