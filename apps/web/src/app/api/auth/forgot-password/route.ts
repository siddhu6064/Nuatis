import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveResetRedirectUrl } from '@/lib/auth/reset-redirect'

export async function POST(request: Request) {
  // Resolve OUTSIDE the swallow-all block: a misconfigured base URL must
  // surface as an error, not silently email a broken localhost reset link.
  let redirectTo: string
  try {
    redirectTo = resolveResetRedirectUrl()
  } catch (err) {
    console.error('[forgot-password] reset redirect misconfigured:', err)
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  try {
    const { email } = (await request.json()) as { email?: string }
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ ok: true })
    }

    const supabase = createAdminClient()

    await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  } catch {
    // swallow — never leak account existence or internal errors
  }

  return NextResponse.json({ ok: true })
}
