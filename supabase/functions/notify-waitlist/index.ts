import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

interface WaitlistRecord {
  id: string
  full_name: string
  email: string
  phone: string | null
  vertical: string | null
  pain_point: string | null
  source: string | null
  created_at: string
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: WaitlistRecord
  schema: string
}

function formatVertical(slug: string | null | undefined): string | null {
  if (!slug) return null
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/New_York',
  })
}

function row(label: string, value: string | null | undefined, fallback = '—'): string {
  const display = value?.trim() || fallback
  return `
    <tr>
      <td style="padding:10px 16px;font-size:14px;color:#6b7280;font-weight:600;white-space:nowrap;width:120px">${label}</td>
      <td style="padding:10px 16px;font-size:14px;color:${display === fallback ? '#9ca3af' : '#111827'}">${display}</td>
    </tr>`
}

function buildHtml(r: WaitlistRecord): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f9f8f5;font-family:'DM Sans',system-ui,sans-serif">
  <div style="max-width:560px;margin:40px auto;padding:0 16px">

    <div style="text-align:center;margin-bottom:24px">
      <span style="display:inline-block;background:#0d9488;color:#fff;font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:6px 14px;border-radius:999px">New Waitlist Signup</span>
    </div>

    <div style="background:#fff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
      <div style="background:#0d9488;padding:24px 28px">
        <h1 style="margin:0;font-size:20px;font-weight:600;color:#fff">
          ${r.full_name} just joined the waitlist
        </h1>
      </div>

      <table style="width:100%;border-collapse:collapse">
        <tbody>
          ${row('Name', r.full_name, 'Not provided')}
          ${row('Email', r.email, 'Not provided')}
          ${row('Phone', r.phone)}
          ${row('Vertical', formatVertical(r.vertical))}
          ${row('Message', r.pain_point)}
          ${row('Source', r.source)}
          ${row('Time', formatTime(r.created_at))}
        </tbody>
      </table>

      <div style="border-top:1px solid #e5e7eb;padding:20px 28px">
        <a href="mailto:${r.email}"
           style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 22px;border-radius:8px">
          Reply to ${r.full_name.split(' ')[0]}
        </a>
      </div>
    </div>

    <p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:20px">
      Nuatis &mdash; notifications@nuatis.com
    </p>
  </div>
</body>
</html>`
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let payload: WebhookPayload
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  console.info('payload:', JSON.stringify(payload))

  if (payload.type !== 'INSERT' || payload.table !== 'waitlist_leads') {
    return new Response('Ignored', { status: 200 })
  }

  const record = payload.record
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) {
    console.error('[notify-waitlist] RESEND_API_KEY not set')
    return new Response('Missing API key', { status: 500 })
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Nuatis Notifications <notifications@nuatis.com>',
      to: ['sid@nuatis.com'],
      subject: `🔔 New waitlist signup — ${record.full_name}`,
      html: buildHtml(record),
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    console.error(`[notify-waitlist] Resend error ${res.status}: ${body}`)
    return new Response('Email send failed', { status: 500 })
  }

  console.info(`[notify-waitlist] Notified for ${record.email}`)
  return new Response('OK', { status: 200 })
})
