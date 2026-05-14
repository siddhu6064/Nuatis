'use client'

import { useState } from 'react'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch {
      // swallow — don't leak account existence
    } finally {
      setSubmitted(true)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-teal-600 flex items-center justify-center">
            <span className="text-white font-bold text-base">N</span>
          </div>
          <span className="font-display font-bold text-[22px] tracking-tight text-ink">
            Nu<span className="text-teal-brand">atis</span>
          </span>
        </div>

        <div className="bg-white rounded-2xl border border-border-brand shadow-sm p-8">
          <h1 className="text-lg font-semibold text-ink mb-1">Forgot password</h1>
          <p className="text-sm text-ink4 mb-6">
            Enter your email and we&apos;ll send you a reset link.
          </p>

          {submitted ? (
            <div className="space-y-4">
              <p className="text-sm text-ink2 bg-teal-50 border border-teal-100 px-3 py-3 rounded-lg">
                If that email is registered, you&apos;ll receive a reset link shortly.
              </p>
              <a
                href="/sign-in"
                className="block w-full text-center bg-teal-600 hover:bg-teal-700 text-white
                           text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Back to sign in
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink3 mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-border-brand text-sm
                             text-ink placeholder-gray-300 outline-none
                             focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10
                             transition-colors"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60
                           text-white text-sm font-medium py-2.5 rounded-lg
                           transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>

              <p className="text-center text-xs text-ink4">
                <a href="/sign-in" className="text-teal-600 hover:underline">
                  Back to sign in
                </a>
              </p>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-300 mt-6">Nuatis LLC · Front Office AI</p>
      </div>
    </div>
  )
}
