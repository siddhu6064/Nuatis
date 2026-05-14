import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

function esc(s: string | null | undefined): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

serve(async (req) => {
  const payload = await req.json()
  const record = payload.record || {}

  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return new Response(JSON.stringify({ ok: false }), { status: 200 })

  const name = esc(record.full_name) || 'Not provided'
  const email = esc(record.email)
  const phone = esc(record.phone) || '—'
  const vertical = esc(record.vertical) || 'Not selected'
  const source = esc(record.source) || 'nuatis.com'
  const message = esc(record.pain_point)
  const when = esc(record.created_at)

  const messageBlock = message
    ? `
    <tr>
      <td style="padding:10px 0;color:#64748b;font-size:13px;vertical-align:top;width:110px;">Message</td>
      <td style="padding:10px 0;color:#0f172a;font-size:14px;line-height:1.55;white-space:pre-wrap;border-left:3px solid #0d9488;padding-left:12px;background:#f0fdfa;border-radius:4px;">${message}</td>
    </tr>`
    : ''

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="color:#0f172a;margin:0 0 6px;font-size:20px;">New waitlist signup</h2>
      <p style="color:#64748b;margin:0 0 20px;font-size:13px;">Someone just joined from nuatis.com</p>
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:10px 0;color:#64748b;font-size:13px;width:110px;">Name</td><td style="padding:10px 0;color:#0f172a;font-size:14px;">${name}</td></tr>
        <tr><td style="padding:10px 0;color:#64748b;font-size:13px;">Email</td><td style="padding:10px 0;color:#0f172a;font-size:14px;"><a href="mailto:${email}" style="color:#1d4ed8;text-decoration:none;">${email}</a></td></tr>
        <tr><td style="padding:10px 0;color:#64748b;font-size:13px;">Phone</td><td style="padding:10px 0;color:#0f172a;font-size:14px;">${phone}</td></tr>
        <tr><td style="padding:10px 0;color:#64748b;font-size:13px;">Vertical</td><td style="padding:10px 0;color:#0f172a;font-size:14px;text-transform:capitalize;">${vertical.replace(/_/g, ' ')}</td></tr>
        ${messageBlock}
        <tr><td style="padding:10px 0;color:#64748b;font-size:13px;">Source</td><td style="padding:10px 0;color:#0f172a;font-size:14px;">${source}</td></tr>
        <tr><td style="padding:10px 0;color:#64748b;font-size:13px;">Time</td><td style="padding:10px 0;color:#0f172a;font-size:14px;">${when}</td></tr>
      </table>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;">
        Reply directly to the lead — this email came via Supabase → Resend.
      </div>
    </div>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Nuatis Waitlist <notifications@nuatis.com>',
        to: ['sid@nuatis.com', 'nuatisllc@gmail.com'],
        reply_to: record.email || undefined,
        subject: `New signup — ${vertical.replace(/_/g, ' ')} · ${name}`,
        html,
      }),
    })
    if (!res.ok) console.error('Resend failed', await res.text())
  } catch (e) {
    console.error('Resend error', e)
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 })
})
