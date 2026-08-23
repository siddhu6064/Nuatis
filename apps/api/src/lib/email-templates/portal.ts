// ── Portal access emails ──────────────────────────────────────────────────────

export interface PortalMagicLinkEmailParams {
  businessName: string
  portalUrl: string
  accessToken: string
}

export interface PortalEmail {
  subject: string
  html: string
}

/** Sent when a contact requests a fresh magic link to an existing portal login. */
export function buildPortalMagicLinkEmail({
  businessName,
  portalUrl,
  accessToken,
}: PortalMagicLinkEmailParams): PortalEmail {
  return {
    subject: `Access your ${businessName} portal`,
    html: `<p>Here is your link to access the ${businessName} client portal:</p>
<p><a href="${portalUrl}?token=${accessToken}">${portalUrl}?token=${accessToken}</a></p>
<p>This link is personal to you — please don't share it.</p>`,
  }
}

export interface PortalInviteEmailParams {
  contactName?: string | null
  businessName?: string | null
  portalUrl: string
  accessToken: string
}

/** Sent when a business owner first invites a contact to the portal. */
export function buildPortalInviteEmail({
  contactName,
  businessName,
  portalUrl,
  accessToken,
}: PortalInviteEmailParams): PortalEmail {
  return {
    subject: `Access your ${businessName ?? 'business'} portal`,
    html: `<p>Hi ${contactName ?? 'there'},</p>
<p>${businessName ?? 'Your service provider'} has set up a client portal for you.</p>
<p>View your appointments, documents, and invoices here:<br>
<a href="${portalUrl}?token=${accessToken}">${portalUrl}?token=${accessToken}</a></p>
<p>This link is personal to you — please don't share it.</p>`,
  }
}
