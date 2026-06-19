'use client'

import { Suspense, useState, useRef } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'

const DEMO_EMAIL = process.env.NEXT_PUBLIC_DEMO_EMAIL ?? ''
const DEMO_PASSWORD = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? ''

// Lucide-style SVG icons — no extra dependency
function IconCopy() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy to clipboard"
      className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md
                 bg-transparent hover:bg-[#f2f0eb] text-[#0d9488] transition-colors"
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  )
}

function DemoCard({ onLoginAsDemo }: { onLoginAsDemo: () => void }) {
  return (
    <div className="w-full mb-4 bg-white rounded-xl p-5" style={{ border: '1px solid #dedad2' }}>
      <span
        className="text-[10px] font-medium tracking-widest text-teal-600 uppercase"
        style={{ fontFamily: 'DM Mono, monospace' }}
      >
        Live Demo
      </span>
      <h2 className="mt-1 text-base font-semibold text-ink">Try Nuatis free</h2>
      <p className="mt-0.5 text-xs text-ink4 leading-relaxed">
        Explore the full product with our demo account — no signup needed. Demo environment —
        synthetic data only.
      </p>

      <div className="mt-3 space-y-2">
        {/* Email row */}
        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
          <span
            className="text-[10px] uppercase tracking-wider text-ink3 w-16 flex-shrink-0"
            style={{ fontFamily: 'DM Mono, monospace' }}
          >
            Email
          </span>
          <span className="flex-1 text-[13px] text-ink truncate">{DEMO_EMAIL}</span>
          <CopyButton value={DEMO_EMAIL} />
        </div>
        {/* Password row */}
        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
          <span
            className="text-[10px] uppercase tracking-wider text-ink3 w-16 flex-shrink-0"
            style={{ fontFamily: 'DM Mono, monospace' }}
          >
            Password
          </span>
          <span className="flex-1 text-[13px] text-ink tracking-widest">••••••••••••</span>
          <CopyButton value={DEMO_PASSWORD} />
        </div>
      </div>

      <button
        type="button"
        onClick={onLoginAsDemo}
        className="mt-3 w-full bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium
                   py-2.5 rounded-lg transition-colors cursor-pointer"
      >
        Log in as Demo
      </button>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  )
}

// REDIRECT-01: allow only same-origin relative paths (reject `//host`, `/\host`,
// and absolute URLs like `https://evil.com`).
function isSafeRedirect(url: string): boolean {
  return url === '/' || /^\/[^/\\]/.test(url)
}

function SignInForm() {
  const router = useRouter()
  const params = useSearchParams()
  // REDIRECT-01: only allow same-origin relative paths to prevent open redirect.
  const rawCallbackUrl = params.get('callbackUrl') ?? '/dashboard'
  const callbackUrl = isSafeRedirect(rawCallbackUrl) ? rawCallbackUrl : '/dashboard'
  const reset = params.get('reset') === '1'
  const passwordUpdated = params.get('passwordUpdated') === '1'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await signIn('credentials', {
      email,
      password,
      redirect: false,
    })

    if (res?.error) {
      setError('Invalid email or password')
      setLoading(false)
      return
    }

    router.push(callbackUrl)
  }

  async function handleLoginAsDemo() {
    setEmail(DEMO_EMAIL)
    setPassword(DEMO_PASSWORD)
    setLoading(true)
    setError('')

    const res = await signIn('credentials', {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      redirect: false,
    })

    if (res?.error) {
      setError('Invalid email or password')
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center px-4 justify-center sm:justify-start sm:pt-20">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="flex items-center justify-center mb-8">
          <Image src="/nuatis-lockup-teal.png" width={160} height={50} alt="Nuatis" priority />
        </div>

        {/* Demo Card */}
        <DemoCard onLoginAsDemo={handleLoginAsDemo} />

        {/* Login Card */}
        <div className="bg-white rounded-2xl border border-border-brand shadow-sm p-8">
          <h1 className="text-lg font-semibold text-ink mb-1">Sign in</h1>
          <p className="text-sm text-ink4 mb-6">Access your Nuatis dashboard</p>

          {(reset || passwordUpdated) && (
            <p
              className="text-xs text-teal-700 bg-teal-50 border border-teal-100
                          px-3 py-2 rounded-lg mb-4"
            >
              {passwordUpdated
                ? 'Password updated — please sign in.'
                : 'Check your email for a reset link.'}
            </p>
          )}

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink3 mb-1.5">Email</label>
              <input
                id="email"
                name="email"
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

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-ink3">Password</label>
                <a href="/forgot-password" className="text-xs text-teal-600 hover:underline">
                  Forgot password?
                </a>
              </div>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* New-account CTA — divider + link to the existing sign-up flow */}
          <div className="mt-6 pt-5 border-t border-border-brand text-center">
            <p className="text-xs text-ink3 mb-3">New to Nuatis?</p>
            <Link
              href="/sign-up"
              className="block w-full bg-white hover:bg-gray-50 border border-teal-600
                         text-teal-700 text-sm font-medium py-2.5 rounded-lg
                         transition-colors"
            >
              Start your 7-day free trial
            </Link>
          </div>
        </div>

        <p className="text-center text-xs text-gray-300 mt-6">Nuatis LLC · Front Office AI</p>
      </div>
    </div>
  )
}
