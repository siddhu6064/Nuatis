// ── Stripe billing lifecycle emails ───────────────────────────────────────────
// Shared skeleton: <p>Hi,</p>...(varying middle content)...<p>— Nuatis</p>

export interface BillingEmail {
  subject: string
  html: string
}

function wrapBillingEmail(bodyHtml: string): string {
  return `<p>Hi,</p>${bodyHtml}<p>— Nuatis</p>`
}

function webUrl(): string {
  return process.env['WEB_URL'] ?? 'https://app.nuatis.com'
}

/** Sent when a tenant's subscription is canceled (customer.subscription.deleted). */
export function buildSubscriptionCanceledEmail(): BillingEmail {
  return {
    subject: 'Your Nuatis subscription has been canceled',
    html: wrapBillingEmail(
      `<p>Your Nuatis subscription has been canceled. Maya call handling will remain active for 7 days so any in-flight calls don't get cut off.</p><p>If this was a mistake, you can re-subscribe at any time: <a href="${webUrl()}/pricing">View plans</a></p>`
    ),
  }
}

/**
 * Sent when a subscription invoice payment fails (invoice.payment_failed).
 * Escalates by attempt number instead of sending the identical email every
 * time Stripe retries: 1st = standard notice, 2nd = warning, 3rd+ = final
 * notice ahead of Stripe's own eventual subscription cancellation.
 */
export function buildPaymentFailedEmail(attemptNumber = 1): BillingEmail {
  if (attemptNumber <= 1) {
    return {
      subject: 'Action required — Nuatis payment failed',
      html: wrapBillingEmail(
        `<p>We weren't able to charge your card for the latest Nuatis invoice. Your account is now in a past-due state. Service will continue for 7 days while you update your payment details.</p><p><a href="${webUrl()}/settings/billing">Update payment details</a></p>`
      ),
    }
  }
  if (attemptNumber === 2) {
    return {
      subject: 'Second attempt failed — please update your Nuatis payment method',
      html: wrapBillingEmail(
        `<p>We tried again and still couldn't charge your card for your Nuatis subscription. This is the second failed attempt — please update your payment details soon to avoid a service interruption.</p><p><a href="${webUrl()}/settings/billing">Update payment details</a></p>`
      ),
    }
  }
  return {
    subject: 'Final notice — your Nuatis subscription is at risk of cancellation',
    html: wrapBillingEmail(
      `<p>We've now tried ${attemptNumber} times and still can't charge your card for your Nuatis subscription. Please update your payment details right away — your subscription may be canceled if this isn't resolved.</p><p><a href="${webUrl()}/settings/billing">Update payment details</a></p>`
    ),
  }
}

/** Sent 3 days before a trial ends (customer.subscription.trial_will_end). */
export function buildTrialEndingEmail(): BillingEmail {
  return {
    subject: 'Your Nuatis trial ends in 3 days',
    html: wrapBillingEmail(
      `<p>Just a heads-up — your 7-day free trial of Nuatis ends in 3 days. To keep Maya answering your calls without interruption, no action is needed and your card will be charged automatically.</p><p>Want to change plans first? <a href="${webUrl()}/pricing">View plans</a></p>`
    ),
  }
}
