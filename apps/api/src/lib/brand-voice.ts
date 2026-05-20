import type { BrandVoice } from '@nuatis/shared'

export function buildBrandVoicePromptBlock(brandVoice: BrandVoice | null): string {
  if (!brandVoice) {
    return ''
  }

  const lines: string[] = []

  // Tone line: only include if tone or formality is set
  const hasTone = !!brandVoice.tone
  const hasFormality = !!brandVoice.formality

  if (hasTone || hasFormality) {
    let toneLine = 'Tone:'
    const parts: string[] = []
    if (hasTone) parts.push(brandVoice.tone)
    if (hasFormality) parts.push(brandVoice.formality)
    toneLine += ' ' + parts.join(' and ')
    lines.push(toneLine)
  }

  // Emoji line: only include if emoji_use is set
  if (brandVoice.emoji_use) {
    let emojiLine = 'Emoji:'
    if (brandVoice.emoji_use === 'none') {
      emojiLine += ' Do not use emojis'
    } else if (brandVoice.emoji_use === 'minimal') {
      emojiLine += ' Use emojis sparingly (1-2 max)'
    } else {
      emojiLine += ' Emojis are welcome'
    }
    lines.push(emojiLine)
  }

  // Industry terms line: only include if non-empty array
  if (Array.isArray(brandVoice.industry_terms) && brandVoice.industry_terms.length > 0) {
    const terms = brandVoice.industry_terms.filter((t) => t && typeof t === 'string').join(', ')
    if (terms) {
      lines.push(`Industry terms to use naturally: ${terms}`)
    }
  }

  // Phrases to avoid line: only include if non-empty array
  if (Array.isArray(brandVoice.avoid_phrases) && brandVoice.avoid_phrases.length > 0) {
    const phrases = brandVoice.avoid_phrases.filter((p) => p && typeof p === 'string').join(', ')
    if (phrases) {
      lines.push(`Phrases to avoid: ${phrases}`)
    }
  }

  // Sign off messages line: only include if signature is non-empty
  if (
    brandVoice.signature &&
    typeof brandVoice.signature === 'string' &&
    brandVoice.signature.trim()
  ) {
    lines.push(`Sign off messages as: ${brandVoice.signature}`)
  }

  // Example of our voice line: only include if sample_message is non-empty
  if (
    brandVoice.sample_message &&
    typeof brandVoice.sample_message === 'string' &&
    brandVoice.sample_message.trim()
  ) {
    lines.push(`Example of our voice: "${brandVoice.sample_message}"`)
  }

  // If no lines remain, return empty string
  if (lines.length === 0) {
    return ''
  }

  // Build the full block
  return `--- BRAND VOICE ---\n${lines.join('\n')}\n--- END BRAND VOICE ---`
}
