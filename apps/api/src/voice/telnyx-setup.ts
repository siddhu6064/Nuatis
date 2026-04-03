/**
 * telnyx-setup.ts
 *
 * Reads the current Telnyx webhook configuration for the provisioned phone number.
 * Run with: npx tsx src/voice/telnyx-setup.ts
 *
 * When VOICE_WEBHOOK_URL is set, this script can be extended to register
 * the webhook via the Telnyx API. For now it logs the current config.
 */
import 'dotenv/config'

const TELNYX_API_BASE = 'https://api.telnyx.com/v2'
const PHONE_NUMBER = process.env['TELNYX_PHONE_NUMBER'] ?? '+15127376388'

async function telnyxGet(path: string): Promise<unknown> {
  const apiKey = process.env['TELNYX_API_KEY']
  if (!apiKey) throw new Error('TELNYX_API_KEY not set')

  const res = await fetch(`${TELNYX_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telnyx API ${path} → ${res.status}: ${body}`)
  }

  return res.json() as Promise<unknown>
}

async function main(): Promise<void> {
  console.info('=== Telnyx Webhook Setup ===')
  console.info(`Phone number: ${PHONE_NUMBER}`)
  console.info(
    `VOICE_WEBHOOK_URL: ${process.env['VOICE_WEBHOOK_URL'] ?? '(not set — set this to register webhook)'}`
  )
  console.info('')

  // Fetch call control applications
  console.info('Fetching call control applications...')
  const appsResponse = await telnyxGet('/call_control_applications')
  const apps = (
    appsResponse as {
      data: Array<{
        id: string
        application_name: string
        webhook_event_url: string
        webhook_event_failover_url: string
      }>
    }
  ).data

  if (!apps || apps.length === 0) {
    console.info('No call control applications found.')
  } else {
    console.info(`Found ${apps.length} call control application(s):\n`)
    for (const app of apps) {
      console.info(`  ID:               ${app.id}`)
      console.info(`  Name:             ${app.application_name}`)
      console.info(`  Webhook URL:      ${app.webhook_event_url || '(none)'}`)
      console.info(`  Failover URL:     ${app.webhook_event_failover_url || '(none)'}`)
      console.info('')
    }
  }

  // Fetch phone number configuration
  console.info('Fetching phone number configuration...')
  const encodedNumber = encodeURIComponent(PHONE_NUMBER)
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
