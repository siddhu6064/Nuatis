/**
 * Email send helpers — pure utility functions, no DB dependencies.
 */

/**
 * Builds a base64url-encoded RFC 2822 MIME message (multipart/alternative).
 */
export function buildMimeMessage(
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  textBody: string
): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`

  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    textBody,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=UTF-8`,
    `Content-Transfer-Encoding: quoted-printable`,
    ``,
    htmlBody,
    ``,
    `--${boundary}--`,
  ].join('\r\n')

  // base64url encoding (RFC 4648 §5) — replace + with -, / with _, strip =
  return Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Inserts a 1×1 tracking pixel before </body>. Falls back to appending.
 */
export function injectTrackingPixel(html: string, trackingToken: string, apiUrl: string): string {
  const pixel = `<img src="${apiUrl}/api/email-tracking/${trackingToken}" width="1" height="1" style="display:none" alt="" />`

  const bodyCloseIdx = html.toLowerCase().lastIndexOf('</body>')
  if (bodyCloseIdx !== -1) {
    return html.slice(0, bodyCloseIdx) + pixel + html.slice(bodyCloseIdx)
  }

  return html + pixel
}

/**
 * Sends a pre-built raw MIME message via the Gmail API.
 */
export async function sendViaGmail(accessToken: string, rawBase64Message: string): Promise<void> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawBase64Message }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail send failed (${res.status}): ${text}`)
  }
}

/**
 * Sends an email via the Microsoft Graph API (Outlook / M365).
 * textBody is accepted to match the interface but Graph renders the HTML body;
 * it is intentionally unused here.
 */
export async function sendViaOutlook(
  accessToken: string,
  to: string,
  subject: string,
  htmlBody: string,

  _textBody: string
): Promise<void> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: {
          contentType: 'HTML',
          content: htmlBody,
        },
        toRecipients: [
          {
            emailAddress: {
              address: to,
            },
          },
        ],
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outlook send failed (${res.status}): ${text}`)
  }
}
