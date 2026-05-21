import { Queue, Worker } from 'bullmq'
import { createClient } from '@supabase/supabase-js'
import { GoogleGenAI } from '@google/genai'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import {
  EXTRACT_FACTS_PROMPT,
  SUMMARISE_PROMPT,
  mergeFacts,
  type CallerFacts,
} from '../services/maya/memory-prompts.js'

const QUEUE_NAME = 'voice-session-complete'

export interface MayaMemoryJobData {
  tenantId: string
  sessionId: string
  phone: string
}

interface VoiceSessionRow {
  transcript: string | null
  outcome: string | null
  tool_calls_made: unknown
}

interface CallerMemoryRow {
  facts: CallerFacts | null
  call_count: number
  contact_id: string | null
}

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function processMemory(data: MayaMemoryJobData): Promise<void> {
  const { tenantId, sessionId, phone } = data
  console.log(
    `[maya-memory-extractor] job start: session=${sessionId} tenant=${tenantId} phone=${phone}`
  )

  // ── Step 1: Fetch voice session transcript ─────────────────────────────────

  const supabase = getSupabase()
  const { data: session, error: sessionError } = await supabase
    .from('voice_sessions')
    .select('transcript, outcome, tool_calls_made')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    console.warn(
      `[maya-memory-extractor] session not found or error: session=${sessionId} err=${sessionError?.message ?? 'no row'}`
    )
    return
  }

  const row = session as VoiceSessionRow
  const transcript = row.transcript

  if (!transcript || transcript.trim().length === 0) {
    console.warn(`[maya-memory-extractor] empty transcript — skipping: session=${sessionId}`)
    return
  }

  const apiKey = process.env['GEMINI_API_KEY']
  if (!apiKey) {
    console.error('[maya-memory-extractor] GEMINI_API_KEY not set — skipping memory extraction')
    return
  }

  const genai = new GoogleGenAI({ apiKey })

  // ── Step 2: Extract structured facts via Gemini ────────────────────────────

  let extractedFacts: CallerFacts = {}
  try {
    const factsResult = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: transcript }] }],
      config: { systemInstruction: EXTRACT_FACTS_PROMPT },
    })

    const rawFacts = factsResult.text ?? ''
    const stripped = rawFacts
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim()

    extractedFacts = JSON.parse(stripped) as CallerFacts
    console.log(`[maya-memory-extractor] facts extracted successfully: session=${sessionId}`)
  } catch (err) {
    console.error(
      `[maya-memory-extractor] fact extraction failed: session=${sessionId}`,
      err instanceof Error ? err.message : err
    )
    return
  }

  // ── Step 3: Generate a plain-text summary via Gemini ──────────────────────

  let summary = ''
  try {
    const summaryResult = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(extractedFacts) }] }],
      config: { systemInstruction: SUMMARISE_PROMPT },
    })
    summary = summaryResult.text?.trim() ?? ''
  } catch (err) {
    // Non-fatal — proceed without summary
    console.error(
      `[maya-memory-extractor] summary generation failed (non-fatal): session=${sessionId}`,
      err instanceof Error ? err.message : err
    )
  }

  // ── Step 4: Load existing memory for this phone number ────────────────────

  const { data: existing } = await supabase
    .from('caller_memory')
    .select('facts, call_count, contact_id')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle()

  const existingRow = existing as CallerMemoryRow | null

  // ── Step 5: Merge facts ───────────────────────────────────────────────────

  const mergedFacts = mergeFacts(existingRow?.facts ?? null, extractedFacts)

  // ── Step 6: Best-effort contact_id lookup ─────────────────────────────────

  let contactId: string | null = existingRow?.contact_id ?? null
  if (!contactId) {
    try {
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('phone', phone)
        .eq('is_archived', false)
        .maybeSingle()
      if (contact) {
        contactId = (contact as { id: string }).id
      }
    } catch {
      // best-effort, ignore
    }
  }

  // ── Step 7: Upsert caller_memory ─────────────────────────────────────────

  const now = new Date().toISOString()

  const upsertPayload: Record<string, unknown> = {
    tenant_id: tenantId,
    phone,
    facts: mergedFacts,
    summary: summary || null,
    call_count: (existingRow?.call_count ?? 0) + 1,
    last_call_at: now,
    updated_at: now,
  }

  if (contactId) {
    upsertPayload['contact_id'] = contactId
  }

  const { error: upsertError } = await supabase
    .from('caller_memory')
    .upsert(upsertPayload, { onConflict: 'tenant_id,phone' })

  if (upsertError) {
    console.error(
      `[maya-memory-extractor] upsert failed: session=${sessionId} phone=${phone}`,
      upsertError.message
    )
    return
  }

  console.log(
    `[maya-memory-extractor] upsert complete: session=${sessionId} phone=${phone} calls=${(existingRow?.call_count ?? 0) + 1}`
  )
}

export function createMayaMemoryExtractor(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection })

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const data = job.data as MayaMemoryJobData
      try {
        await processMemory(data)
      } catch (err) {
        // Swallow all errors — memory extraction must never crash other workers
        console.error(
          `[maya-memory-extractor] unhandled error for job ${job.id ?? 'unknown'}:`,
          err instanceof Error ? err.message : err
        )
      }
    },
    { connection }
  )

  worker.on('failed', (job, err) => {
    console.error(`[maya-memory-extractor] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
