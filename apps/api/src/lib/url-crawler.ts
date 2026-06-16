import dns from 'node:dns'
import net from 'node:net'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { load } from 'cheerio'
import type { Element } from 'domhandler'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── SSRF guard (SSRF-01) ────────────────────────────────────────────────────
const MAX_REDIRECTS = 3
const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2MB

// Private / loopback / link-local / reserved ranges that must never be reached.
const PRIVATE_BLOCKLIST = (() => {
  const bl = new net.BlockList()
  // IPv4
  bl.addSubnet('0.0.0.0', 8, 'ipv4')
  bl.addSubnet('10.0.0.0', 8, 'ipv4')
  bl.addSubnet('100.64.0.0', 10, 'ipv4') // CGNAT
  bl.addSubnet('127.0.0.0', 8, 'ipv4')
  bl.addSubnet('169.254.0.0', 16, 'ipv4') // link-local / cloud metadata
  bl.addSubnet('172.16.0.0', 12, 'ipv4')
  bl.addSubnet('192.168.0.0', 16, 'ipv4')
  bl.addSubnet('198.18.0.0', 15, 'ipv4') // benchmarking
  bl.addSubnet('198.51.100.0', 24, 'ipv4') // TEST-NET-2
  bl.addSubnet('203.0.113.0', 24, 'ipv4') // TEST-NET-3
  bl.addSubnet('240.0.0.0', 4, 'ipv4') // reserved (covers 255.255.255.255)
  // IPv6
  bl.addAddress('::1', 'ipv6')
  bl.addSubnet('fc00::', 7, 'ipv6') // ULA
  bl.addSubnet('fe80::', 10, 'ipv6') // link-local
  bl.addSubnet('::ffff:0:0', 96, 'ipv6') // IPv4-mapped
  return bl
})()

/**
 * Reject any URL that is not a publicly-routable http/https endpoint. Blocks
 * raw IP literals (decimal/octal/hex/IPv6), resolves the hostname via DNS, and
 * rejects if ANY resolved A/AAAA record falls in a private/loopback/link-local
 * range. Must be called on the initial URL, robots.txt, and every redirect hop.
 */
async function assertPublicUrl(urlStr: string): Promise<void> {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new Error('Invalid URL')
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must use http or https protocol')
  }
  const hostname = parsed.hostname
  if (hostname === 'localhost') {
    throw new Error('Crawling local addresses is not allowed')
  }
  // Reject bare IP literals (the original URL string) — incl. IPv6 in brackets.
  const ipKind = net.isIP(hostname)
  if (ipKind !== 0) {
    throw new Error('Crawling raw IP addresses is not allowed')
  }
  // Reject decimal/octal/hex-encoded IPs that net.isIP does not recognize but
  // the resolver/fetch would still interpret (e.g. http://2130706433/).
  if (/^(0x[0-9a-f]+|\d+|0\d+(\.\d+)*|\d+\.\d+\.\d+\.\d+)$/i.test(hostname)) {
    throw new Error('Crawling numeric/encoded IP addresses is not allowed')
  }

  let records: Array<{ address: string; family: number }>
  try {
    records = await dns.promises.lookup(hostname, { all: true })
  } catch {
    throw new Error('DNS resolution failed')
  }
  if (records.length === 0) {
    throw new Error('No DNS records for host')
  }
  for (const rec of records) {
    const family = rec.family === 6 ? 'ipv6' : 'ipv4'
    if (PRIVATE_BLOCKLIST.check(rec.address, family)) {
      throw new Error('Host resolves to a private/loopback/link-local address')
    }
  }
}

export async function crawlUrl(params: {
  tenantId: string
  urlRecordId: string
  rootUrl: string
}): Promise<void> {
  const { tenantId, urlRecordId, rootUrl } = params
  const supabase = getSupabase()

  try {
    // Step 1: UPDATE status='crawling'
    await supabase
      .from('maya_kb_urls')
      .update({ status: 'crawling', updated_at: new Date().toISOString() })
      .eq('id', urlRecordId)
      .eq('tenant_id', tenantId)

    // Step 2: Normalize URL
    let normalizedUrl = rootUrl.trim()
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl
    }
    normalizedUrl = normalizedUrl.replace(/\/$/, '')

    // Step 3: Validate URL (SSRF-01 — DNS-resolving private-range guard)
    await assertPublicUrl(normalizedUrl)
    const parsed = new URL(normalizedUrl)

    // Step 3b: Check robots.txt
    try {
      const robotsUrl = `${parsed.protocol}//${parsed.hostname}/robots.txt`
      const robotsRes = await safeFetch(robotsUrl, 5000)
      if (robotsRes.ok) {
        const robotsTxt = await robotsRes.text()
        if (isDisallowAll(robotsTxt)) {
          throw new Error('Crawling disallowed by robots.txt')
        }
      }
    } catch (robotsErr) {
      if (robotsErr instanceof Error && robotsErr.message === 'Crawling disallowed by robots.txt') {
        throw robotsErr
      }
      // If robots.txt fetch fails, proceed (many sites don't have one)
    }

    // Step 4: Fetch root page
    const rootHtml = await fetchPage(normalizedUrl)
    if (!rootHtml) throw new Error('Failed to fetch root page')

    // Step 5: Parse root page
    const rootText = extractText(rootHtml)
    const subUrls = findInternalLinks(rootHtml, normalizedUrl)

    // Step 6: Crawl up to 5 subpages
    const allTexts: string[] = [rootText]
    let pagesCrawled = 1

    for (const subUrl of subUrls.slice(0, 5)) {
      try {
        await sleep(2000) // 2s delay between requests
        const html = await fetchPage(subUrl)
        if (html) {
          allTexts.push(extractText(html))
          pagesCrawled++
        }
      } catch {
        // Skip failed subpages
      }
    }

    // Step 7: Combine + deduplicate
    let combinedText = allTexts.filter((t) => t.trim().length > 0).join('\n\n---\n\n')

    // Deduplicate repeated blocks (remove duplicate lines longer than 20 chars)
    const lines = combinedText.split('\n')
    const seen = new Set<string>()
    const deduped = lines.filter((line) => {
      const trimmed = line.trim()
      if (trimmed.length < 20) return true // keep short lines (headings etc.)
      if (seen.has(trimmed)) return false
      seen.add(trimmed)
      return true
    })
    combinedText = deduped.join('\n')

    // Step 8: Summarize with Gemini if > 8000 chars
    let finalText = combinedText
    if (combinedText.length > 8000) {
      const apiKey = process.env['GEMINI_API_KEY']
      if (apiKey) {
        try {
          const genai = new GoogleGenAI({ apiKey })
          const response = await genai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: [
              {
                parts: [
                  {
                    text: `Summarize this business website content into key facts Maya (an AI receptionist) needs to know: services offered, pricing, hours, location, team, policies. Max 2000 words. Plain text only.\n\n${combinedText.slice(0, 20000)}`,
                  },
                ],
              },
            ],
          })
          if (response.text) {
            finalText = response.text
          }
        } catch {
          // If Gemini fails, use truncated raw text
          finalText = combinedText.slice(0, 8000)
        }
      } else {
        finalText = combinedText.slice(0, 8000)
      }
    }

    // Step 9: UPDATE status='ready'
    await supabase
      .from('maya_kb_urls')
      .update({
        status: 'ready',
        extracted_text: finalText,
        pages_crawled: pagesCrawled,
        last_crawled_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: null,
      })
      .eq('id', urlRecordId)
      .eq('tenant_id', tenantId)

    console.info(`[url-crawler] done url=${normalizedUrl} pages=${pagesCrawled}`)
  } catch (err) {
    // Step 10: UPDATE status='error'
    const errMsg = err instanceof Error ? err.message : String(err)
    await supabase
      .from('maya_kb_urls')
      .update({
        status: 'error',
        error_message: errMsg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', urlRecordId)
      .eq('tenant_id', tenantId)
    console.error(`[url-crawler] error for ${rootUrl}:`, errMsg)
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NuatisBot/1.0 (AI Assistant Knowledge Base Builder)',
      },
      // SSRF-01: never auto-follow — each hop is re-validated by assertPublicUrl.
      redirect: 'manual',
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch with per-hop SSRF validation. Validates the URL (and every redirect
 * Location) against assertPublicUrl, following at most MAX_REDIRECTS hops.
 */
async function safeFetch(url: string, timeoutMs: number): Promise<Response> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current)
    const res = await fetchWithTimeout(current, timeoutMs)
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) return res
      if (hop === MAX_REDIRECTS) throw new Error('Too many redirects')
      current = new URL(location, current).toString()
      continue
    }
    return res
  }
  throw new Error('Too many redirects')
}

/** Read a response body, aborting if it exceeds MAX_BODY_BYTES. */
async function readCappedText(res: Response): Promise<string | null> {
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  if (!res.body) return res.text()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  }
  return Buffer.concat(chunks).toString('utf-8')
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, 10000)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) return null
    return await readCappedText(res)
  } catch {
    return null
  }
}

function extractText(html: string): string {
  const $ = load(html)

  // Remove unwanted elements
  $('script, style, nav, header, footer, aside, .cookie-banner, [aria-hidden="true"]').remove()

  // Try to get main content area first
  const mainSelectors = ['main', 'article', '.content', '[role="main"]', '#main', '#content']
  let text = ''
  for (const sel of mainSelectors) {
    if ($(sel).length > 0) {
      text = $(sel).text()
      break
    }
  }
  if (!text.trim()) {
    text = $('body').text()
  }

  // Clean whitespace and HTML entities
  return text
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function findInternalLinks(html: string, baseUrl: string): string[] {
  const $ = load(html)
  const baseHostname = new URL(baseUrl).hostname
  const links = new Set<string>()

  $('a[href]').each((_: number, el: Element) => {
    const href = $(el).attr('href') ?? ''
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return
    }
    try {
      const resolved = new URL(href, baseUrl)
      if (
        resolved.hostname === baseHostname &&
        ['http:', 'https:'].includes(resolved.protocol) &&
        !resolved.search // no query string — prefer clean page paths
      ) {
        const clean = resolved.origin + resolved.pathname.replace(/\/$/, '')
        if (clean !== baseUrl) {
          links.add(clean)
        }
      }
    } catch {
      // invalid URL, skip
    }
  })

  // Fisher-Yates shuffle for variety
  const arr = Array.from(links)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
  }
  return arr
}

function isDisallowAll(robotsTxt: string): boolean {
  const lines = robotsTxt.split('\n').map((l) => l.trim().toLowerCase())
  let inAllAgents = false
  for (const line of lines) {
    if (line === 'user-agent: *') inAllAgents = true
    else if (line.startsWith('user-agent:')) inAllAgents = false
    else if (inAllAgents && (line === 'disallow: /' || line === 'disallow:/')) {
      return true
    }
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
