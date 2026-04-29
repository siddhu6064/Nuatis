import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const { email } = (await request.json()) as { email?: string }
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ ok: true })
    }

    const supabase = createAdminClient()
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/reset-password`,
    })
  } catch {
    // swallow — never leak account existence or internal errors
  }

  return NextResponse.json({ ok: true })
}
