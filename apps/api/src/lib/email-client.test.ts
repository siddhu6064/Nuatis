import { jest, describe, it, expect, beforeEach } from '@jest/globals'

type SendArgs = { to: string; subject: string; html: string; replyTo?: string; from?: string }
type SendResult = { error: null | { message: string } }

const resendSend = jest.fn<(params: SendArgs) => Promise<SendResult>>().mockResolvedValue({
  error: null,
})

class FakeResend {
  emails = { send: resendSend }
}

jest.unstable_mockModule('resend', () => ({ Resend: FakeResend }))

process.env['RESEND_API_KEY'] = 'test-resend-key'

const { sendEmail, sendTemplatedEmail } = await import('./email-client.js')

beforeEach(() => {
  resendSend.mockClear()
  resendSend.mockResolvedValue({ error: null })
})

describe('sendEmail', () => {
  it('calls Resend emails.send with correct to/subject/html and returns true on success', async () => {
    const ok = await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
    })

    expect(ok).toBe(true)
    expect(resendSend).toHaveBeenCalledTimes(1)
    const callArgs = resendSend.mock.calls[0]![0]
    expect(callArgs.to).toBe('test@example.com')
    expect(callArgs.subject).toBe('Test')
    expect(callArgs.html).toBe('<p>Hi</p>')
  })

  it('returns false when Resend returns an error', async () => {
    resendSend.mockResolvedValueOnce({ error: { message: 'fail' } })

    const ok = await sendEmail({
      to: 'test@example.com',
      subject: 'Test',
      html: '<p>Hi</p>',
    })

    expect(ok).toBe(false)
  })
})

describe('sendTemplatedEmail', () => {
  it('resolves appointment_reminder template and sends', async () => {
    const ok = await sendTemplatedEmail({
      to: 'patient@example.com',
      subject: 'Your appointment',
      templateName: 'appointment_reminder',
      variables: {
        contactName: 'Jane',
        appointmentTitle: 'Cleaning',
        appointmentTime: 'Mon 10am',
        businessName: 'Nuatis Dental',
      },
    })

    expect(ok).toBe(true)
    expect(resendSend).toHaveBeenCalledTimes(1)
    const callArgs = resendSend.mock.calls[0]![0]
    expect(callArgs.to).toBe('patient@example.com')
    expect(callArgs.html).toContain('Jane')
    expect(callArgs.html).toContain('Cleaning')
  })
})
