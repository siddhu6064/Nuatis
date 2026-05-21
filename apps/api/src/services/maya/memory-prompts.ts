/**
 * Prompts and merge logic for Maya caller memory extraction.
 * Used by the maya-memory-extractor BullMQ worker after each voice session.
 */

// ── Fact extraction prompt ──────────────────────────────────────────────────

/**
 * System prompt for a non-streaming Gemini call in JSON mode.
 * Instructs the model to extract structured caller facts from a voice transcript.
 */
export const EXTRACT_FACTS_PROMPT = `You are a caller memory assistant for a business AI receptionist.

Your task: read the provided voice call transcript and extract structured facts about the caller.

Return ONLY a valid JSON object with exactly this shape — no commentary, no markdown, no backticks:
{
  "name": "caller's full or first name, or null",
  "preferred_name": "nickname or preferred name if mentioned, or null",
  "last_appointment_type": "type of appointment or service discussed, or null",
  "last_appointment_date": "date mentioned in YYYY-MM-DD format, or null",
  "pending_needs": ["things the caller wanted but did not complete, e.g. 'reschedule crown'"],
  "preferences": ["time or staff preferences, e.g. 'morning slots', 'Dr. Martinez'"],
  "sentiment": "one of: positive | neutral | negative | frustrated",
  "language": "BCP-47 language code of the caller, e.g. en, es, hi, te",
  "topics": ["subjects discussed in the call, e.g. 'appointment booking', 'insurance'"]
}

Rules:
- Return ONLY valid JSON — no markdown fences, no explanation text, no trailing comments
- Only include facts explicitly stated or clearly implied by the transcript
- Scalar fields (name, preferred_name, last_appointment_type, last_appointment_date): use null if unknown
- Array fields (pending_needs, preferences, topics): use [] if none found
- Keep every array item concise — 5 words maximum per item, no duplicates
- sentiment must be exactly one of: positive, neutral, negative, frustrated
- language must be a valid BCP-47 code; default to "en" if language cannot be determined
`

// ── Summary prompt ──────────────────────────────────────────────────────────

/**
 * System prompt that converts extracted facts JSON into a 1-2 sentence briefing
 * suitable for injection into a Maya receptionist system prompt.
 */
export const SUMMARISE_PROMPT = `You are a caller memory assistant for a business AI receptionist.

Given a JSON object of extracted facts about a returning caller, write a warm, concise 1–2 sentence
summary suitable for briefing a receptionist before they answer the phone.

The summary should feel natural and helpful — mention the caller's name if known, their most recent
topic or appointment type, and any pending needs or preferences worth knowing.

Example outputs:
- "Returning caller John, last called about a crown consultation in April. Prefers morning slots with Dr. Martinez and wants to reschedule."
- "Returning caller Maria spoke about HVAC repair last time and prefers afternoon appointments."
- "A returning caller previously inquired about pricing for lawn care; no name on record."

Return ONLY the summary text — no JSON, no labels, no markdown, no surrounding quotes.
`

// ── Types ───────────────────────────────────────────────────────────────────

export interface CallerFacts {
  name?: string | null
  preferred_name?: string | null
  last_appointment_type?: string | null
  last_appointment_date?: string | null
  pending_needs?: string[]
  preferences?: string[]
  sentiment?: 'positive' | 'neutral' | 'negative' | 'frustrated'
  language?: string
  topics?: string[]
  [key: string]: unknown
}

// ── Merge logic ─────────────────────────────────────────────────────────────

const ARRAY_FIELDS = new Set(['pending_needs', 'preferences', 'topics'])
const SCALAR_FIELDS = new Set([
  'name',
  'preferred_name',
  'last_appointment_type',
  'last_appointment_date',
  'language',
])

/**
 * Merge two facts objects. Rules:
 *
 * - Arrays (pending_needs, preferences, topics):
 *     Union merge with case-insensitive deduplication.
 * - Scalar strings (name, preferred_name, last_appointment_type,
 *     last_appointment_date, language):
 *     Incoming value wins only if it is not null/undefined.
 *     Never overwrites an existing real value with null.
 * - sentiment:
 *     Incoming always wins (latest call sentiment is most relevant).
 * - Unknown extra keys:
 *     Follow the same scalar rule — incoming non-null wins.
 * - If existing is null, return incoming as-is.
 */
export function mergeFacts(
  existing: Record<string, unknown> | null,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  if (!existing) return { ...incoming }

  const merged: Record<string, unknown> = { ...existing }

  for (const key of Object.keys(incoming)) {
    const inVal = incoming[key]

    // sentiment — incoming always wins
    if (key === 'sentiment') {
      merged[key] = inVal
      continue
    }

    if (inVal === undefined || inVal === null) continue

    if (ARRAY_FIELDS.has(key)) {
      const inArr = Array.isArray(inVal) ? (inVal as string[]) : []
      const exArr = Array.isArray(merged[key]) ? (merged[key] as string[]) : []

      // Case-insensitive deduplication: normalise to lowercase for comparison,
      // but preserve the original casing of the first occurrence.
      const seen = new Map<string, string>()
      for (const item of [...exArr, ...inArr]) {
        const lower = item.toLowerCase()
        if (!seen.has(lower)) seen.set(lower, item)
      }
      merged[key] = [...seen.values()]
      continue
    }

    if (SCALAR_FIELDS.has(key)) {
      // Only overwrite if incoming is a non-empty, non-null string
      if (typeof inVal === 'string' && inVal.trim().length > 0) {
        merged[key] = inVal
      }
      continue
    }

    // Unknown extra key — incoming non-null wins
    merged[key] = inVal
  }

  return merged
}
