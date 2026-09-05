// Thin wrapper around the Yelp Fusion API. App-level bearer key
// (YELP_API_KEY), not OAuth — a tenant just links their Yelp business id,
// there's no per-tenant credential to collect.
//
// Known, permanent API limitations (not bugs in this code): Yelp's Reviews
// endpoint returns at most 3 review excerpts per business regardless of how
// many reviews actually exist, and there is no reply-to-review endpoint for
// any third party — a business owner has to reply from Yelp's own dashboard.

const YELP_API_BASE = 'https://api.yelp.com/v3'

function requireYelpKey(): string {
  const key = process.env['YELP_API_KEY']
  if (!key) throw new Error('YELP_API_KEY is not set')
  return key
}

async function yelpFetch<T>(path: string): Promise<T> {
  const key = requireYelpKey()
  const res = await fetch(`${YELP_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Yelp API ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

export interface YelpBusinessSummary {
  id: string
  name: string
  location: string | null
  rating: number | null
  review_count: number | null
  image_url: string | null
}

export async function searchYelpBusinesses(
  term: string,
  location: string
): Promise<YelpBusinessSummary[]> {
  const params = new URLSearchParams({ term, location, limit: '5' })
  const data = await yelpFetch<{
    businesses: Array<{
      id: string
      name: string
      location?: { display_address?: string[] }
      rating?: number
      review_count?: number
      image_url?: string
    }>
  }>(`/businesses/search?${params.toString()}`)

  return (data.businesses ?? []).map((b) => ({
    id: b.id,
    name: b.name,
    location: b.location?.display_address?.join(', ') ?? null,
    rating: b.rating ?? null,
    review_count: b.review_count ?? null,
    image_url: b.image_url ?? null,
  }))
}

export interface YelpReview {
  id: string
  rating: number
  text: string
  time_created: string
  user: { name?: string }
}

export async function getYelpReviews(yelpBusinessId: string): Promise<YelpReview[]> {
  const data = await yelpFetch<{ reviews: YelpReview[] }>(
    `/businesses/${encodeURIComponent(yelpBusinessId)}/reviews`
  )
  return data.reviews ?? []
}
