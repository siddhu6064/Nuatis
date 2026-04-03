/**
 * telnyx-setup.ts
 *
 * Ensures a Telnyx Call Control Application named "Nuatis Voice AI" exists
 * and is assigned to the provisioned phone number.
 *
 * Run with: npx tsx src/voice/telnyx-setup.ts
 */
import 'dotenv/config'

const TELNYX_API_BASE = 'https://api.telnyx.com/v2'
const PHONE_NUMBER = process.env['TELNYX_PHONE_NUMBER'] ?? '+15127376388'
const APP_NAME = 'Nuatis Voice AI'

function authHeaders(): Record<string, string> {
  const apiKey = process.env['TELNYX_API_KEY']
  if (!apiKey) throw new Error('TELNYX_API_KEY not set')
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

async function telnyxGet(path: string): Promise<unknown> {
  const res = await fetch(`${TELNYX_API_BASE}${path}`, {
    headers: authHeaders(),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telnyx GET ${path} → ${res.status}: ${body}`)
  }
  return res.json() as Promise<unknown>
}

async function telnyxPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${TELNYX_API_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Telnyx POST ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<unknown>
}

async function telnyxPatch(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${TELNYX_API_BASE}${path}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Telnyx PATCH ${path} → ${res.status}: ${text}`)
  }
  return res.json() as Promise<unknown>
}

interface TelnyxApp {
  id: string
  application_name: string
  webhook_event_url: string
  webhook_event_failover_url: string
}

async function main(): Promise<void> {
  console.info('=== Telnyx Setup ===')
  console.info(`Phone number: ${PHONE_NUMBER}`)

  const webhookUrl = process.env['VOICE_WEBHOOK_URL']
  if (!webhookUrl) {
    throw new Error('VOICE_WEBHOOK_URL not set')
  }
  console.info(`VOICE_WEBHOOK_URL: ${webhookUrl}`)
  console.info('')

  // ── Step 1: Find or create the call control application ──────────────────────
  console.info('Fetching call control applications...')
  const appsResponse = await telnyxGet('/call_control_applications')
  const apps = (appsResponse as { data: TelnyxApp[] }).data ?? []

  let app = apps.find((a) => a.application_name === APP_NAME)

  if (app) {
    console.info(`Found existing app: "${app.application_name}" (id: ${app.id})`)
    // Update webhook URL in case it changed
    console.info('Updating webhook URL...')
    const updated = await telnyxPatch(`/call_control_applications/${app.id}`, {
      webhook_event_url: webhookUrl,
      webhook_api_version: '2',
    })
    app = (updated as { data: TelnyxApp }).data
    console.info('Webhook URL updated.')
  } else {
    console.info(`No "${APP_NAME}" app found — creating...`)
    const created = await telnyxPost('/call_control_applications', {
      application_name: APP_NAME,
      webhook_event_url: webhookUrl,
      webhook_api_version: '2',
    })
    app = (created as { data: TelnyxApp }).data
    console.info(`Created app: "${app.application_name}" (id: ${app.id})`)
  }

  console.info('')
  console.info(`✅ connection_id: ${app.id}`)
  console.info('')
  console.info('Add to apps/api/.env:')
  console.info(`  TELNYX_CONNECTION_ID=${app.id}`)
  console.info('')

  // ── Step 2: Assign the app to the phone number ────────────────────────────────
  console.info(`Assigning connection_id to ${PHONE_NUMBER}...`)
  const encodedNumber = encodeURIComponent(PHONE_NUMBER)
  await telnyxPatch(`/phone_numbers/${encodedNumber}`, {
    connection_id: app.id,
  })
  console.info('Phone number updated.')
  console.info('')

  // ── Step 3: Verify final phone number config ──────────────────────────────────
  console.info('Verifying phone number configuration...')
  const numResponse = await telnyxGet(`/phone_numbers/${encodedNumber}`)
  const num = (numResponse as { data: Record<string, unknown> }).data
  console.info('Phone number config:')
  console.info(JSON.stringify(num, null, 2))
  console.info('')
  console.info('=== Done ===')
}

main().catch((err: unknown) => {
  console.error('Error:', err)
  process.exit(1)
})
