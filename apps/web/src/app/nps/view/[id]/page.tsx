'use client'

import { useState, useEffect } from 'react'

interface SurveyData {
  business_name: string
  contact_name: string | null
  status: 'pending' | 'sent' | 'responded'
}

const SCORES = Array.from({ length: 11 }, (_, i) => i)

export default function PublicNpsSurveyView({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null)
  const [survey, setSurvey] = useState<SurveyData | null>(null)
  const [loading, setLoading] = useState(true)
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [justSubmitted, setJustSubmitted] = useState(false)

  useEffect(() => {
    params.then((p) => setId(p.id))
  }, [params])

  useEffect(() => {
    if (!id) return
    fetch(`/api/nps-surveys/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSurvey(data as SurveyData)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [id])

  async function submit() {
    if (!id || score === null) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/nps-surveys/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment: comment.trim() || undefined }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Unable to submit')
      }
      setJustSubmitted(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to submit')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <p className="text-sm text-ink4">Loading survey...</p>
      </div>
    )
  }

  if (!survey) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <p className="text-sm text-ink3">Survey not found.</p>
      </div>
    )
  }

  const alreadyResponded = survey.status === 'responded' && !justSubmitted

  return (
    <div className="min-h-screen bg-bg px-4 py-8">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <div className="w-10 h-10 rounded-lg bg-teal-600 flex items-center justify-center mx-auto mb-3">
            <span className="text-white text-sm font-bold">N</span>
          </div>
          <h1 className="text-lg font-bold text-ink">{survey.business_name}</h1>
        </div>

        <div className="bg-white rounded-xl border border-border-brand shadow-sm p-6">
          {justSubmitted ? (
            <div className="text-center py-4">
              <p className="text-lg font-semibold text-green-800 mb-1">Thank you!</p>
              <p className="text-sm text-ink3">We appreciate your feedback.</p>
            </div>
          ) : alreadyResponded ? (
            <div className="text-center py-4">
              <p className="text-sm text-ink3">
                You've already responded to this survey. Thanks again!
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-ink2 mb-1">
                {survey.contact_name ? `Hi ${survey.contact_name}, ` : ''}on a scale of 0–10, how
                likely are you to recommend {survey.business_name} to a friend or colleague?
              </p>

              <div className="grid grid-cols-11 gap-1 my-5">
                {SCORES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScore(s)}
                    className={`aspect-square rounded-lg text-sm font-semibold transition-colors ${
                      score === s
                        ? 'bg-teal-600 text-white'
                        : 'bg-gray-50 text-ink3 hover:bg-gray-100'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-ink4 mb-5 px-0.5">
                <span>Not likely</span>
                <span>Very likely</span>
              </div>

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Anything you'd like to add? (optional)"
                rows={3}
                className="w-full text-sm rounded-lg border border-border-brand px-3 py-2 mb-4 resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
              />

              {submitError && <p className="text-xs text-rose-600 mb-3">{submitError}</p>}

              <button
                onClick={() => void submit()}
                disabled={score === null || submitting}
                className="w-full py-3 bg-teal-600 text-white text-sm font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </>
          )}
        </div>

        <p className="text-center text-[10px] text-gray-300 mt-6">Powered by Nuatis</p>
      </div>
    </div>
  )
}
