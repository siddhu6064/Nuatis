/**
 * Shared helpers for working with Gemini responses.
 */

/**
 * Strips a leading and/or trailing markdown code fence from Gemini's JSON output.
 *
 * Gemini is usually asked for raw JSON (sometimes via `responseMimeType: 'application/json'`),
 * but occasionally wraps its response in a markdown fence anyway, e.g.:
 *
 *   ```json
 *   { "foo": "bar" }
 *   ```
 *
 * This trims a leading ```` ```json ```` / ```` ``` ```` fence and a trailing ```` ``` ```` fence
 * (case-insensitively, tolerating surrounding whitespace), then trims the result.
 */
export function stripJsonFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
}
