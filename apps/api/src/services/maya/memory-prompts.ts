/**
 * Prompts and merge logic for Maya caller memory extraction.
 * Used by the maya-memory-extractor BullMQ worker after each voice session.
 */

// ── Fact extraction prompt ──────────────────────────────────────────────────

/**
 * System prompt for a non-streaming Gemini call in JSON mode.
 * Instructs the model to extract structured caller facts, plus a per-scalar
 * evidence observation (kind + detail — never a confidence/weight, which is
 * priced server-side by caller-memory-evidence.ts's priceObservation()).
 */
export const EXTRACT_FACTS_PROMPT = `You extract durable facts about a caller from a phone call transcript, for use
on future calls. You never guess, and you NEVER rate your own confidence.
For each fact you report WHAT YOU OBSERVED using exactly one evidence kind.

Evidence kinds — pick the one that matches what actually happened in the transcript:

- "caller.confirmed"       — the assistant asked and the caller explicitly
                             confirmed ("yes, that's right", "correct").
- "caller.stated-directly" — the caller said it about themselves in their own
                             words ("my name is Priya", "I was in last month
                             for a cleaning").
- "caller.implied"         — inferable from what they said but never stated
                             ("we usually come in on Fridays" implies a
                             preference, not a stated fact).
- "third-party.mention"    — someone else on the line said it, or the caller
                             said it about a different person. A caller booking
                             for their mother is telling you about the mother,
                             not themselves.
- "model.inference"        — you are inferring it and no utterance supports it
                             directly. Use this whenever you are unsure which
                             kind applies. Choosing a stronger kind than the
                             transcript supports files a wrong fact on a
                             customer record.

Rules:
- One observation per fact, matched to the single strongest supporting moment
  in the transcript.
- "detail" is read by front-desk staff in a tooltip. Quote or closely
  paraphrase the utterance: good — caller said "it's Priya, P-R-I-Y-A";
  bad — "name mentioned in call".
- A fact you cannot tie to an utterance is omitted, not downgraded.
- sentiment and language need no observation — report them directly.
- If the transcript contains no extractable facts, return {"facts": {}, "observations": {}}.

Return ONLY this JSON, no markdown fences, no commentary:

{
  "facts": {
    "name": string | null,
    "preferred_name": string | null,
    "last_appointment_type": string | null,
    "last_appointment_date": "YYYY-MM-DD" | null,
    "last_provider": string | null,
    "pending_needs": string[],
    "preferences": string[],
    "sentiment": "positive" | "neutral" | "negative" | "frustrated",
    "language": string,
    "topics": string[]
  },
  "observations": {
    "<scalar fact field>": { "kind": "<evidence kind>", "detail": "<what you saw>" }
  }
}

"observations" carries an entry for every non-null SCALAR fact (name,
preferred_name, last_appointment_type, last_appointment_date, last_provider).
Arrays, sentiment and language take no observations.
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
If last_provider is set, mention who they saw last (e.g. "They last saw Dr. Lee.").

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
  last_provider?: string | null
  pending_needs?: string[]
  preferences?: string[]
  sentiment?: 'positive' | 'neutral' | 'negative' | 'frustrated'
  language?: string
  topics?: string[]
  [key: string]: unknown
}

// ── Sanitization (PROMPT-01) ────────────────────────────────────────────────

// Strip instruction-injection phrasing and structural characters from caller
// memory before it is stored and later injected into Maya's system prompt.
const INJECTION_PATTERN =
  /(ignore|disregard|forget|override|pretend|you are|your (real |true |actual )?instructions|system prompt|[<>{}\\])/gi

/** Sanitize a free-text memory string: strip injection phrasing, collapse
 *  whitespace, and truncate to `maxLen` characters. */
export function sanitizeMemoryText(text: string, maxLen: number): string {
  return text
    .replace(INJECTION_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxLen)
}

/** Sanitize every string (and string-array) value in a facts object. Scalars
 *  are capped at 200 chars; structure and non-string values are preserved. */
export function sanitizeFacts(facts: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(facts)) {
    if (typeof value === 'string') {
      out[key] = sanitizeMemoryText(value, 200)
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        typeof item === 'string' ? sanitizeMemoryText(item, 200) : item
      )
    } else {
      out[key] = value
    }
  }
  return out
}

// ── Merge logic ─────────────────────────────────────────────────────────────

const ARRAY_FIELDS = new Set(['pending_needs', 'preferences', 'topics'])
const SCALAR_FIELDS = new Set([
  'name',
  'preferred_name',
  'last_appointment_type',
  'last_appointment_date',
  'last_provider',
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
