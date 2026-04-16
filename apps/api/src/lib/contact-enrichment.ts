const AREA_CODES: Record<string, { city: string; state: string; timezone: string }> = {
  // Texas
  '512': { city: 'Austin', state: 'TX', timezone: 'America/Chicago' },
  '210': { city: 'San Antonio', state: 'TX', timezone: 'America/Chicago' },
  '214': { city: 'Dallas', state: 'TX', timezone: 'America/Chicago' },
  '469': { city: 'Dallas', state: 'TX', timezone: 'America/Chicago' },
  '972': { city: 'Dallas', state: 'TX', timezone: 'America/Chicago' },
  '713': { city: 'Houston', state: 'TX', timezone: 'America/Chicago' },
  '832': { city: 'Houston', state: 'TX', timezone: 'America/Chicago' },
  '817': { city: 'Fort Worth', state: 'TX', timezone: 'America/Chicago' },
  '254': { city: 'Waco', state: 'TX', timezone: 'America/Chicago' },
  '325': { city: 'Abilene', state: 'TX', timezone: 'America/Chicago' },
  '903': { city: 'Tyler', state: 'TX', timezone: 'America/Chicago' },
  '915': { city: 'El Paso', state: 'TX', timezone: 'America/Denver' },
  // California
  '213': { city: 'Los Angeles', state: 'CA', timezone: 'America/Los_Angeles' },
  '323': { city: 'Los Angeles', state: 'CA', timezone: 'America/Los_Angeles' },
  '310': { city: 'Los Angeles', state: 'CA', timezone: 'America/Los_Angeles' },
  '415': { city: 'San Francisco', state: 'CA', timezone: 'America/Los_Angeles' },
  '408': { city: 'San Jose', state: 'CA', timezone: 'America/Los_Angeles' },
  '669': { city: 'San Jose', state: 'CA', timezone: 'America/Los_Angeles' },
  '619': { city: 'San Diego', state: 'CA', timezone: 'America/Los_Angeles' },
  '858': { city: 'San Diego', state: 'CA', timezone: 'America/Los_Angeles' },
  '916': { city: 'Sacramento', state: 'CA', timezone: 'America/Los_Angeles' },
  '949': { city: 'Irvine', state: 'CA', timezone: 'America/Los_Angeles' },
  // New York
  '212': { city: 'New York', state: 'NY', timezone: 'America/New_York' },
  '646': { city: 'New York', state: 'NY', timezone: 'America/New_York' },
  '917': { city: 'New York', state: 'NY', timezone: 'America/New_York' },
  '718': { city: 'Brooklyn', state: 'NY', timezone: 'America/New_York' },
  '516': { city: 'Long Island', state: 'NY', timezone: 'America/New_York' },
  '914': { city: 'Westchester', state: 'NY', timezone: 'America/New_York' },
  // Florida
  '305': { city: 'Miami', state: 'FL', timezone: 'America/New_York' },
  '786': { city: 'Miami', state: 'FL', timezone: 'America/New_York' },
  '407': { city: 'Orlando', state: 'FL', timezone: 'America/New_York' },
  '813': { city: 'Tampa', state: 'FL', timezone: 'America/New_York' },
  '904': { city: 'Jacksonville', state: 'FL', timezone: 'America/New_York' },
  '954': { city: 'Fort Lauderdale', state: 'FL', timezone: 'America/New_York' },
  // Illinois
  '312': { city: 'Chicago', state: 'IL', timezone: 'America/Chicago' },
  '773': { city: 'Chicago', state: 'IL', timezone: 'America/Chicago' },
  '847': { city: 'Chicago Suburbs', state: 'IL', timezone: 'America/Chicago' },
  // Pennsylvania
  '215': { city: 'Philadelphia', state: 'PA', timezone: 'America/New_York' },
  '412': { city: 'Pittsburgh', state: 'PA', timezone: 'America/New_York' },
  // Georgia
  '404': { city: 'Atlanta', state: 'GA', timezone: 'America/New_York' },
  '678': { city: 'Atlanta', state: 'GA', timezone: 'America/New_York' },
  // Massachusetts
  '617': { city: 'Boston', state: 'MA', timezone: 'America/New_York' },
  '857': { city: 'Boston', state: 'MA', timezone: 'America/New_York' },
  // Arizona
  '602': { city: 'Phoenix', state: 'AZ', timezone: 'America/Phoenix' },
  '480': { city: 'Scottsdale', state: 'AZ', timezone: 'America/Phoenix' },
  // Washington
  '206': { city: 'Seattle', state: 'WA', timezone: 'America/Los_Angeles' },
  '253': { city: 'Tacoma', state: 'WA', timezone: 'America/Los_Angeles' },
  // Colorado
  '303': { city: 'Denver', state: 'CO', timezone: 'America/Denver' },
  '720': { city: 'Denver', state: 'CO', timezone: 'America/Denver' },
  // Michigan
  '313': { city: 'Detroit', state: 'MI', timezone: 'America/Detroit' },
  // Minnesota
  '612': { city: 'Minneapolis', state: 'MN', timezone: 'America/Chicago' },
  // Oregon
  '503': { city: 'Portland', state: 'OR', timezone: 'America/Los_Angeles' },
  // Nevada
  '702': { city: 'Las Vegas', state: 'NV', timezone: 'America/Los_Angeles' },
  // North Carolina
  '704': { city: 'Charlotte', state: 'NC', timezone: 'America/New_York' },
  '919': { city: 'Raleigh', state: 'NC', timezone: 'America/New_York' },
  // Ohio
  '614': { city: 'Columbus', state: 'OH', timezone: 'America/New_York' },
  '216': { city: 'Cleveland', state: 'OH', timezone: 'America/New_York' },
  // Tennessee
  '615': { city: 'Nashville', state: 'TN', timezone: 'America/Chicago' },
  '901': { city: 'Memphis', state: 'TN', timezone: 'America/Chicago' },
  // Missouri
  '314': { city: 'St. Louis', state: 'MO', timezone: 'America/Chicago' },
  '816': { city: 'Kansas City', state: 'MO', timezone: 'America/Chicago' },
  // DC
  '202': { city: 'Washington', state: 'DC', timezone: 'America/New_York' },
}

const COMMON_EMAIL_PROVIDERS = new Set([
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'aol.com',
  'icloud.com',
  'protonmail.com',
  'live.com',
  'msn.com',
  'me.com',
  'ymail.com',
  'mail.com',
])

/**
 * Extract area code from a US phone number and return location/timezone data.
 * Supports formats: +1XXXXXXXXXX, 1XXXXXXXXXX, XXXXXXXXXX, (XXX) XXX-XXXX
 */
export function enrichByPhone(
  phone: string
): { city?: string; state?: string; timezone?: string } | null {
  // Strip all non-digit characters to normalize
  const digits = phone.replace(/\D/g, '')

  let areaCode: string | null = null

  if (digits.length === 11 && digits.startsWith('1')) {
    // +1XXXXXXXXXX or 1XXXXXXXXXX
    areaCode = digits.slice(1, 4)
  } else if (digits.length === 10) {
    // XXXXXXXXXX
    areaCode = digits.slice(0, 3)
  } else {
    return null
  }

  const match = AREA_CODES[areaCode]
  if (!match) return null

  return { city: match.city, state: match.state, timezone: match.timezone }
}

/**
 * Extract domain from email and suggest company name for business domains.
 * Returns null for common personal email providers.
 */
export function enrichByEmail(email: string): { suggestedCompany?: string } | null {
  const atIndex = email.lastIndexOf('@')
  if (atIndex === -1) return null

  const domain = email
    .slice(atIndex + 1)
    .toLowerCase()
    .trim()
  if (!domain) return null

  if (COMMON_EMAIL_PROVIDERS.has(domain)) return null

  // Strip TLD(s) — take everything before the last dot segment
  const parts = domain.split('.')
  if (parts.length < 2) return null

  const namePart = parts.slice(0, parts.length - 1).join('.')

  // Capitalize first letter only
  const suggestedCompany = namePart.charAt(0).toUpperCase() + namePart.slice(1)

  return { suggestedCompany }
}

/**
 * Auto-enrich a contact using phone and/or email.
 * - Phone enrichment runs only when city/state/timezone are not already set.
 * - Email enrichment always runs when an email is provided.
 * Returns DB field updates and an optional suggestedCompany for custom_fields.
 */
export function autoEnrichContact(contact: {
  phone?: string
  email?: string
  city?: string
  state?: string
  timezone?: string
}): { updates: Record<string, string>; suggestedCompany?: string } {
  const updates: Record<string, string> = {}
  let suggestedCompany: string | undefined

  // Phone enrichment — only when location fields are empty
  if (contact.phone && !contact.city && !contact.state && !contact.timezone) {
    const phoneData = enrichByPhone(contact.phone)
    if (phoneData) {
      if (phoneData.city) updates['city'] = phoneData.city
      if (phoneData.state) updates['state'] = phoneData.state
      if (phoneData.timezone) updates['timezone'] = phoneData.timezone
    }
  }

  // Email enrichment
  if (contact.email) {
    const emailData = enrichByEmail(contact.email)
    if (emailData?.suggestedCompany) {
      suggestedCompany = emailData.suggestedCompany
    }
  }

  return { updates, ...(suggestedCompany !== undefined ? { suggestedCompany } : {}) }
}
