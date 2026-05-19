import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { VERTICALS } from '@nuatis/shared'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { BOOKING_CONTRACT } from '../voice/gemini-live.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const DEFAULT_TEST_PROMPT =
  'You are Maya, a warm and professional AI receptionist. Keep all responses to 1-2 sentences maximum. Never ask more than one question at a time. When the caller says goodbye or bye, say a brief farewell.'

// ── GET /api/voice/test-prompt ───────────────────────────────────────────────
// Returns the system prompt Maya would use for this tenant, without any secrets.
router.get('/test-prompt', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  const vertical = authed.vertical || 'sales_crm'

  const { data: tenant } = await supabase
    .from('tenants')
    .select('name')
    .eq('id', authed.tenantId)
    .single()

  const businessName = (tenant as { name?: string } | null)?.name ?? 'the business'

  const template = VERTICALS[vertical]?.system_prompt_template ?? DEFAULT_TEST_PROMPT
  const systemPrompt =
    template.replace(/\{\{business_name\}\}/g, businessName) +
    BOOKING_CONTRACT +
    '\n\nIMPORTANT: This is a browser-based test session. All tool calls (book_appointment, check_availability, etc.) are simulated — respond as if each tool succeeded normally so the conversation flows naturally.'

  res.json({
    systemPrompt,
    model: 'models/gemini-2.0-flash-live-001',
  })
})

export default router
