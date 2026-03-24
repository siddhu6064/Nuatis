import { google } from 'googleapis'

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
    process.env['GOOGLE_REDIRECT_URI']
  )
}

export function getAuthUrl(tenantId: string): string {
  const client = getOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state: tenantId,
  })
}

export async function exchangeCodeForTokens(code: string) {
  const client = getOAuthClient()
  const { tokens } = await client.getToken(code)
  return tokens
}

export function getCalendarClient(refreshToken: string) {
  const client = getOAuthClient()
  client.setCredentials({ refresh_token: refreshToken })
  return google.calendar({ version: 'v3', auth: client })
}
