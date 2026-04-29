import { jest, describe, test, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Module-level mocks (must precede all dynamic imports) ─────────────────────

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const sendEmail = jest.fn(async () => true)
const sendViaGmail = jest.fn(async () => undefined)
const sendViaOutlook = jest.fn(async () => undefined)
const buildMimeMessage = jest.fn(() => 'raw-mime')
const injectTrackingPixel = jest.fn((html: string) => html)
const getValidToken = jest.fn(async () => ({ accessToken: 'tok', provider: 'gmail' as const }))
const sendSms = jest.fn(async () => ({ success: false }))

jest.unstable_mockModule('../lib/email-client.js', () => ({ sendEmail }))
jest.unstable_mockModule('../lib/email-send.js', () => ({
  sendViaGmail,
  sendViaOutlook,
  buildMimeMessage,
  injectTrackingPixel,
}))
jest.unstable_mockModule('../lib/email-oauth.js', () => ({
  getValidToken,
  encryptToken: jest.fn(() => 'enc-tok'),
  decryptToken: jest.fn(() => 'dec-tok'),
}))
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms }))
jest.unstable_mockModule('../lib/ops-copilot-client.js', () => ({
  publishActivityEvent: jest.fn(async () => undefined),
}))
jest.unstable_mockModule('../lib/webhook-dispatcher.js', () => ({
  dispatchWebhook: jest.fn(async () => undefined),
}))
jest.unstable_mockModule('../lib/push-client.js', () => ({
  sendPushNotification: jest.fn(async () => undefined),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['EMAIL_FROM'] = 'Maya <maya@nuatis.com>'

// ── Dynamic imports (after all unstable_mockModule calls) ─────────────────────

const { buildAppointmentConfirmationEmail } = await import('../lib/email-templates.js')
const { handlePostCall, callSessionState } = await import('../voice/post-call.js')

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000email001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-000email001'
const APPT_ID = randomUUID()
const CALL_CTRL = 'call-ctrl-email-001'

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedStore(
  opts: {
    contactEmail?: string | null
    emailAccount?: { provider: 'gmail' | 'outlook' } | null
  } = {}
) {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, timezone: 'America/Chicago' }]
  store.tables['contacts'] = [
    {
      id: CONTACT_ID,
      tenant_id: TENANT_ID,
      email: opts.contactEmail !== undefined ? opts.contactEmail : 'patient@example.com',
      full_name: 'Alice Smith',
      phone: '+15550001111',
      is_archived: false,
    },
  ]
  store.tables['appointments'] = [
    { id: APPT_ID, tenant_id: TENANT_ID, start_time: '2025-04-27T10:00:00Z' },
  ]
  store.tables['locations'] = []
  store.tables['user_email_accounts'] = opts.emailAccount
    ? [
        {
          id: 'email-acct-1',
          tenant_id: TENANT_ID,
          provider: opts.emailAccount.provider,
          email_address: 'biz@example.com',
          is_default: true,
        },
      ]
    : []
  store.tables['email_messages'] = []
  store.tables['services'] = []
  store.tables['quotes'] = []
  store.tables['quote_line_items'] = []
}

function seedSession(
  overrides: Partial<{
    bookedAppointment: boolean
    contactId: string | null
    appointmentId: string | null
  }> = {}
) {
  callSessionState.set(CALL_CTRL, {
    bookedAppointment: overrides.bookedAppointment ?? true,
    contactId: overrides.contactId !== undefined ? overrides.contactId : CONTACT_ID,
    appointmentId: overrides.appointmentId !== undefined ? overrides.appointmentId : APPT_ID,
  })
}

function baseParams(product: 'suite' | 'maya_only' = 'suite') {
  return {
    tenantId: TENANT_ID,
    callerId: '+15550001111',
    streamId: 'stream-001',
    callControlId: CALL_CTRL,
    duration: 60,
    vertical: 'dental',
    businessName: 'Smile Dental',
    product,
  } as const
}

beforeEach(() => {
  seedStore()
  callSessionState.clear()
  sendEmail.mockClear()
  sendEmail.mockImplementation(async () => true)
  sendViaGmail.mockClear()
  sendViaGmail.mockImplementation(async () => undefined)
  sendViaOutlook.mockClear()
  sendViaOutlook.mockImplementation(async () => undefined)
  buildMimeMessage.mockClear()
  buildMimeMessage.mockReturnValue('raw-mime')
  injectTrackingPixel.mockClear()
  injectTrackingPixel.mockImplementation((html: string) => html)
  getValidToken.mockClear()
  getValidToken.mockResolvedValue({ accessToken: 'tok', provider: 'gmail' as const })
  sendSms.mockClear()
  sendSms.mockImplementation(async () => ({ success: false }))
})

// ── Unit: buildAppointmentConfirmationEmail ───────────────────────────────────

describe('buildAppointmentConfirmationEmail — unit', () => {
  const DT = 'Monday, April 27 at 10:00 AM'

  test.each([
    ['dental', 'appointment', 'with'],
    ['medical', 'appointment', 'with'],
    ['vet', 'appointment', 'with'],
    ['salon', 'booking', 'at'],
    ['spa', 'booking', 'at'],
    ['gym', 'booking', 'at'],
    ['nail_bar', 'booking', 'at'],
    ['tattoo', 'booking', 'at'],
    ['pet_grooming', 'booking', 'at'],
    ['restaurant', 'reservation', 'at'],
    ['contractor', 'appointment', 'with'],
    ['law_firm', 'appointment', 'with'],
    ['real_estate', 'appointment', 'with'],
    ['sales_crm', 'appointment', 'with'],
  ] as const)('vertical=%s → subject contains noun=%s prep=%s', (vertical, noun, prep) => {
    const { subject } = buildAppointmentConfirmationEmail({ businessName: 'Acme', vertical })
    expect(subject).toContain(`${noun} ${prep} Acme`)
    expect(subject).toContain('confirmed')
  })

  test('HTML body contains %%TRACKING_PIXEL%% placeholder', () => {
    const { html } = buildAppointmentConfirmationEmail({ businessName: 'Acme', vertical: 'dental' })
    expect(html).toContain('%%TRACKING_PIXEL%%')
  })

  test('plain text body has no HTML tags', () => {
    const { text } = buildAppointmentConfirmationEmail({ businessName: 'Acme', vertical: 'salon' })
    expect(text).not.toMatch(/<[^>]+>/)
  })

  test('with contactName: greeting includes name in html and text', () => {
    const { html, text } = buildAppointmentConfirmationEmail({
      contactName: 'Alice',
      businessName: 'Clinic',
      vertical: 'dental',
    })
    expect(html).toContain('Alice')
    expect(text).toContain('Alice')
  })

  test('without contactName: no "undefined" in output, generic greeting present', () => {
    const { html, text } = buildAppointmentConfirmationEmail({
      businessName: 'Clinic',
      vertical: 'dental',
    })
    expect(html).not.toContain('undefined')
    expect(text).not.toContain('undefined')
    expect(text).toMatch(/^(Dear|Hi|Hello),$/m)
  })

  test('with appointmentDateTime: subject and body both include the date', () => {
    const { subject, html, text } = buildAppointmentConfirmationEmail({
      businessName: 'Clinic',
      appointmentDateTime: DT,
      vertical: 'dental',
    })
    expect(subject).toContain(DT)
    expect(html).toContain(DT)
    expect(text).toContain(DT)
  })

  test('without appointmentDateTime: subject has no date separator, body is generic', () => {
    const { subject, html, text } = buildAppointmentConfirmationEmail({
      businessName: 'Clinic',
      vertical: 'dental',
    })
    expect(subject).not.toContain(' — ')
    expect(html).not.toContain('DATE')
    expect(text).not.toContain('undefined')
  })

  test('with locationAddress: address appears in HTML and plain text', () => {
    const { html, text } = buildAppointmentConfirmationEmail({
      businessName: 'Clinic',
      locationAddress: '123 Main St, Chicago IL',
      vertical: 'dental',
    })
    expect(html).toContain('123 Main St')
    expect(text).toContain('123 Main St')
  })
})

// ── Integration: post-call Feature 3 ─────────────────────────────────────────

describe('post-call email confirmation — integration', () => {
  test('suite + contact has email → sendEmail called with correct to and subject', async () => {
    seedSession()
    await handlePostCall(baseParams())

    expect(sendEmail).toHaveBeenCalledTimes(1)
    const call = sendEmail.mock.calls[0]![0] as { to: string; subject: string; html: string }
    expect(call.to).toBe('patient@example.com')
    expect(call.subject).toContain('Smile Dental')
    expect(call.subject).toContain('confirmed')
  })

  test('suite + contact has no email → sendEmail NOT called', async () => {
    seedStore({ contactEmail: null })
    seedSession()
    await handlePostCall(baseParams())
    expect(sendEmail).not.toHaveBeenCalled()
  })

  test('maya_only → sendEmail NOT called (gate: product !== maya_only)', async () => {
    seedSession({ contactId: null, appointmentId: null })
    await handlePostCall(baseParams('maya_only'))
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendViaGmail).not.toHaveBeenCalled()
  })

  test('appointmentId null → sendEmail NOT called', async () => {
    seedSession({ appointmentId: null })
    await handlePostCall(baseParams())
    expect(sendEmail).not.toHaveBeenCalled()
  })

  test('email failure → post-call still completes, console.error called', async () => {
    sendEmail.mockImplementation(async () => {
      throw new Error('Resend down')
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    seedSession()
    await expect(handlePostCall(baseParams())).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(
      '[post-call] email confirmation error:',
      expect.any(Error)
    )
    errorSpy.mockRestore()
  })

  test('Gmail account → sendViaGmail called, Resend sendEmail NOT called', async () => {
    seedStore({ emailAccount: { provider: 'gmail' } })
    getValidToken.mockResolvedValue({ accessToken: 'gmail-tok', provider: 'gmail' as const })
    seedSession()
    await handlePostCall(baseParams())

    expect(sendViaGmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  test('Outlook account → sendViaOutlook called, Resend sendEmail NOT called', async () => {
    seedStore({ emailAccount: { provider: 'outlook' } })
    getValidToken.mockResolvedValue({ accessToken: 'outlook-tok', provider: 'outlook' as const })
    seedSession()
    await handlePostCall(baseParams())

    expect(sendViaOutlook).toHaveBeenCalledTimes(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
