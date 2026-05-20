import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { buildBrandVoicePromptBlock } from '../lib/brand-voice.js'
import type { BrandVoice } from '@nuatis/shared'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// ── GET /api/brand-voice ──────────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const { data, error } = await supabase
      .from('tenants')
      .select('brand_voice')
      .eq('id', authed.tenantId)
      .maybeSingle<{ brand_voice: BrandVoice | null }>()

    if (error) {
      console.error(`[brand-voice] GET error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch brand voice' })
      return
    }

    res.json({ brand_voice: data?.brand_voice ?? {} })
  } catch (err) {
    console.error('[brand-voice] GET error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── PUT /api/brand-voice ──────────────────────────────────────────────────────
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const body = req.body as Partial<BrandVoice>

  // Validate tone
  if (body.tone !== undefined) {
    const validTones = ['professional', 'friendly', 'casual', 'authoritative', 'warm'] as const
    if (!(validTones as readonly string[]).includes(body.tone)) {
      res.status(400).json({ error: 'Invalid tone value' })
      return
    }
  }

  // Validate formality
  if (body.formality !== undefined) {
    const validFormalities = ['formal', 'semi-formal', 'informal'] as const
    if (!(validFormalities as readonly string[]).includes(body.formality)) {
      res.status(400).json({ error: 'Invalid formality value' })
      return
    }
  }

  // Validate emoji_use
  if (body.emoji_use !== undefined) {
    const validEmojiUse = ['none', 'minimal', 'moderate'] as const
    if (!(validEmojiUse as readonly string[]).includes(body.emoji_use)) {
      res.status(400).json({ error: 'Invalid emoji_use value' })
      return
    }
  }

  // Validate industry_terms
  if (body.industry_terms !== undefined) {
    if (!Array.isArray(body.industry_terms)) {
      res.status(400).json({ error: 'industry_terms must be an array' })
      return
    }
    if (body.industry_terms.length > 10) {
      res.status(400).json({ error: 'industry_terms may contain at most 10 items' })
      return
    }
  }

  // Validate avoid_phrases
  if (body.avoid_phrases !== undefined) {
    if (!Array.isArray(body.avoid_phrases)) {
      res.status(400).json({ error: 'avoid_phrases must be an array' })
      return
    }
    if (body.avoid_phrases.length > 10) {
      res.status(400).json({ error: 'avoid_phrases may contain at most 10 items' })
      return
    }
  }

  // Validate signature
  if (body.signature !== undefined && body.signature.length > 100) {
    res.status(400).json({ error: 'signature must be at most 100 characters' })
    return
  }

  // Validate sample_message
  if (body.sample_message !== undefined && body.sample_message.length > 500) {
    res.status(400).json({ error: 'sample_message must be at most 500 characters' })
    return
  }

  try {
    // Fetch current brand_voice and merge
    const { data: current, error: fetchError } = await supabase
      .from('tenants')
      .select('brand_voice')
      .eq('id', authed.tenantId)
      .maybeSingle<{ brand_voice: BrandVoice | null }>()

    if (fetchError) {
      console.error(`[brand-voice] PUT fetch error: ${fetchError.message}`)
      res.status(500).json({ error: 'Failed to fetch current brand voice' })
      return
    }

    const merged: BrandVoice = {
      ...(current?.brand_voice ?? {}),
      ...body,
    }

    const { error: updateError } = await supabase
      .from('tenants')
      .update({ brand_voice: merged })
      .eq('id', authed.tenantId)

    if (updateError) {
      console.error(`[brand-voice] PUT update error: ${updateError.message}`)
      res.status(500).json({ error: 'Failed to update brand voice' })
      return
    }

    console.info(`[brand-voice] updated for tenant=${authed.tenantId}`)
    res.json({ brand_voice: merged })
  } catch (err) {
    console.error('[brand-voice] PUT error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /api/brand-voice/preview ─────────────────────────────────────────────
router.post('/preview', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const body = req.body as BrandVoice

  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    res.json({ preview: 'Preview unavailable — Gemini API key not configured.' })
    return
  }

  try {
    const promptBlock = buildBrandVoicePromptBlock(body)
    const prompt =
      promptBlock +
      '\n\nWrite a short appointment reminder SMS for a client named Alex whose appointment is tomorrow at 3pm.'

    const { GoogleGenAI } = await import('@google/genai')
    const genai = new GoogleGenAI({ apiKey })
    const result = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { maxOutputTokens: 100 },
    })
    const text = result?.text?.trim() ?? ''

    res.json({ preview: text })
  } catch (err) {
    console.error('[brand-voice] preview error:', err)
    res.json({ preview: 'Preview generation failed.' })
  }
})

export default router
