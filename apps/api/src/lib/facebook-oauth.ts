import { encryptToken, decryptToken } from './email-oauth.js'
import { getServiceClient } from './supabase.js'

// Facebook OAuth scaffold — built structurally complete, but genuinely
// untestable without real META_APP_ID/META_APP_SECRET credentials (Meta App
// Review + business verification are an external approval process, outside
// what a coding session can obtain). Every function here degrades cleanly
// when those env vars are unset rather than crashing, so the rest of the app
// is unaffected until a tenant actually provides real credentials.

const GRAPH_VERSION = 'v19.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`

export function isFacebookConfigured(): boolean {
  return Boolean(process.env['META_APP_ID'] && process.env['META_APP_SECRET'])
}

function redirectUri(): string {
  return `${process.env['API_BASE_URL'] ?? 'http://localhost:3001'}/api/reputation/facebook/callback`
}

export function getFacebookAuthUrl(state: string): string {
  const appId = process.env['META_APP_ID']
  if (!appId) throw new Error('META_APP_ID is not set')

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(),
    state,
    // pages_show_list: list the pages this user manages.
    // pages_read_engagement: read ratings/reviews on a page.
    // Both require Meta App Review before they work for anyone but the
    // app's own test users.
    scope: 'pages_show_list,pages_read_engagement',
  })
  return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`
}

interface FacebookTokenResponse {
  access_token: string
  expires_in?: number
}

export async function exchangeFacebookCode(code: string): Promise<FacebookTokenResponse> {
  const appId = process.env['META_APP_ID']
  const appSecret = process.env['META_APP_SECRET']
  if (!appId || !appSecret) throw new Error('Facebook is not configured')

  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri(),
    code,
  })
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Facebook token exchange failed: ${res.status} ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<FacebookTokenResponse>
}

export interface FacebookPage {
  id: string
  name: string
  access_token: string
}

// The user access token from exchangeFacebookCode() can list pages, but
// reading a Page's ratings needs that PAGE's own access token (returned
// alongside each page here), not the user token.
export async function getFacebookPages(userAccessToken: string): Promise<FacebookPage[]> {
  const res = await fetch(`${GRAPH_BASE}/me/accounts?access_token=${userAccessToken}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Facebook pages fetch failed: ${res.status} ${body.slice(0, 200)}`)
  }
  const body = (await res.json()) as { data?: FacebookPage[] }
  return body.data ?? []
}

export async function saveFacebookConnection(
  tenantId: string,
  page: FacebookPage,
  expiresInSeconds: number | undefined
): Promise<void> {
  const supabase = getServiceClient()
  await supabase.from('facebook_connections').upsert(
    {
      tenant_id: tenantId,
      facebook_page_id: page.id,
      page_name: page.name,
      access_token: encryptToken(page.access_token),
      token_expires_at: expiresInSeconds
        ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
        : null,
    },
    { onConflict: 'tenant_id' }
  )
}

export async function getFacebookConnection(
  tenantId: string
): Promise<{ facebookPageId: string; pageName: string | null; pageAccessToken: string } | null> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('facebook_connections')
    .select('facebook_page_id, page_name, access_token')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!data) return null
  return {
    facebookPageId: data.facebook_page_id as string,
    pageName: data.page_name as string | null,
    pageAccessToken: decryptToken(data.access_token as string),
  }
}
