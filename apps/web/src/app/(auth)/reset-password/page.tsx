'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [supabase, setSupabase] = useState<SupabaseClient | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [tokenError, setTokenError] = useState('')

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    setSupabase(client)

    const hash = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash
    const params = new URLSearchParams(hash)
    const access_token = params.get('access_token')
    const refresh_token = params.get('refresh_token')

    if (!access_token || !refresh_token) {
      setTokenError('Invalid or expired reset link. Request a new one.')
      return
    }

    client.auth
      .setSession({ access_token, refresh_token })
      .then(({ error }) => {
        if (error) {
          setTokenError('Invalid or expired reset link. Request a new one.')
          return
        }
        setSessionReady(true)
        history.replaceState(null, '', window.location.pathname)
      })
      .catch(() => {
        setTokenError('Invalid or expired reset link. Request a new one.')
      })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (!supabase) return

    setLoading(true)
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (updateErr) {
      setError(updateErr.message)
      return
    }

    await supabase.auth.signOut()
    router.push('/sign-in?passwordUpdated=1')
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
          <h1 className="text-lg font-semibold text-ink mb-1">Reset password</h1>
          <p className="text-sm text-ink4 mb-6">Choose a new password for your account.</p>

          {tokenError ? (
            <div className="space-y-4">
              <p className="text-xs text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
                {tokenError}
              </p>
              <a
                href="/forgot-password"
                className="block w-full text-center bg-teal-600 hover:bg-teal-700 text-white
                           text-sm font-medium py-2.5 rounded-lg transition-colors"
              >
                Request new link
              </a>
            </div>
          ) : !sessionReady ? (
            <p className="text-sm text-ink4">Verifying reset link…</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-ink3 mb-1.5">New password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  placeholder="At least 8 characters"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-border-brand text-sm
                             text-ink placeholder-gray-300 outline-none
                             focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10
                             transition-colors"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink3 mb-1.5">
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-border-brand text-sm
                             text-ink placeholder-gray-300 outline-none
                             focus:border-teal-500 focus:ring-2 focus:ring-teal-500/10
                             transition-colors"
                />
              </div>

              {error && (
                <p
                  className="text-xs text-red-500 bg-red-50 border border-red-100
                              px-3 py-2 rounded-lg"
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60
                           text-white text-sm font-medium py-2.5 rounded-lg
                           transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-300 mt-6">Nuatis LLC · Front Office AI</p>
      </div>
    </div>
  )
}
