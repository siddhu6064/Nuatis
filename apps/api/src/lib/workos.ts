import { WorkOS } from '@workos-inc/node'

// Enterprise SSO scaffold — built structurally complete, but genuinely
// untestable without a real WorkOS account + at least one test SAML/OIDC
// connection (an external setup step, outside what a coding session can
// obtain on its own — same class of limitation as the Facebook OAuth
// scaffold). Every function here degrades cleanly when WORKOS_API_KEY /
// WORKOS_CLIENT_ID are unset rather than crashing.

export function isWorkosConfigured(): boolean {
  return Boolean(process.env['WORKOS_API_KEY'] && process.env['WORKOS_CLIENT_ID'])
}

let client: WorkOS | null = null

function getWorkosClient(): WorkOS {
  const apiKey = process.env['WORKOS_API_KEY']
  if (!apiKey) throw new Error('WorkOS is not configured')
  if (!client) client = new WorkOS(apiKey)
  return client
}

function redirectUri(): string {
  return `${process.env['API_BASE_URL'] ?? 'http://localhost:3001'}/api/auth/sso/callback`
}

export async function createWorkosOrganization(name: string): Promise<string> {
  const workos = getWorkosClient()
  const org = await workos.organizations.createOrganization({ name })
  return org.id
}

export async function getWorkosPortalLink(organizationId: string): Promise<string> {
  const workos = getWorkosClient()
  const link = await workos.adminPortal.generateLink({
    organization: organizationId,
    intent: 'sso',
  })
  return link.link
}

export function getSsoAuthorizationUrl(organizationId: string, state: string): string {
  const clientId = process.env['WORKOS_CLIENT_ID']
  if (!clientId) throw new Error('WORKOS_CLIENT_ID is not set')
  const workos = getWorkosClient()
  return workos.userManagement.getAuthorizationUrl({
    clientId,
    organizationId,
    redirectUri: redirectUri(),
    provider: 'authkit',
    state,
  })
}

export interface WorkosProfile {
  workosUserId: string
  organizationId: string | null
  email: string
  firstName: string | null
  lastName: string | null
}

export async function authenticateWithCode(code: string): Promise<WorkosProfile> {
  const clientId = process.env['WORKOS_CLIENT_ID']
  if (!clientId) throw new Error('WORKOS_CLIENT_ID is not set')
  const workos = getWorkosClient()
  const result = await workos.userManagement.authenticateWithCode({ clientId, code })
  return {
    workosUserId: result.user.id,
    organizationId: result.organizationId ?? null,
    email: result.user.email,
    firstName: result.user.firstName ?? null,
    lastName: result.user.lastName ?? null,
  }
}
