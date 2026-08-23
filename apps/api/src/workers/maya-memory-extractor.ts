import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { GoogleGenAI } from '@google/genai'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { stripJsonFences } from '../lib/gemini.js'
import { maskPhone } from '../voice/pre-call-lookup.js'
import {
  EXTRACT_FACTS_PROMPT,
  SUMMARISE_PROMPT,
  sanitizeFacts,
  sanitizeMemoryText,
} from '../services/maya/memory-prompts.js'
import {
  mergeFactsWithEvidence,
  type CallerFacts,
  type EvidenceLedger,
  type HeldFact,
  type Observation,
} from '../services/maya/caller-memory-evidence.js'

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
  evidence: EvidenceLedger | null
  held: HeldFact[] | null
}

interface ExtractionResult {
  facts: CallerFacts
  observations: Record<string, Observation>
}

/**
 * True when a Supabase/Postgrest error indicates a referenced column doesn't
 * exist — i.e. migration 0137 hasn't been applied yet. Postgres SQLSTATE
 * 42703 (undefined_column) is the authoritative signal; the message check is
 * a fallback for any Postgrest wrapping that drops the code.
 */
function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  if (error.code === '42703') return true
  const msg = error.message ?? ''
  return msg.includes('column') && msg.includes('does not exist')
}

async function processMemory(data: MayaMemoryJobData): Promise<void> {
  const { tenantId, sessionId, phone } = data
  console.info(
    `[maya-memory-extractor] job start: session=${sessionId} tenant=${tenantId} phone=${maskPhone(phone)}`
  )

  // ── Step 1: Fetch voice session transcript ─────────────────────────────────

  const supabase = getServiceClient()
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

  // ── Step 2: Extract structured facts + evidence observations via Gemini ───

  let extractedFacts: CallerFacts = {}
  let observations: Record<string, Observation> = {}
  try {
    const factsResult = await genai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: transcript }] }],
      config: { systemInstruction: EXTRACT_FACTS_PROMPT },
    })

    const rawFacts = factsResult.text ?? ''
    const stripped = stripJsonFences(rawFacts)

    const parsed = JSON.parse(stripped) as Partial<ExtractionResult>
    extractedFacts = parsed.facts ?? {}
    // Missing/malformed observations must not fail the job — every scalar
    // field defaults to model.inference inside mergeFactsWithEvidence when
    // no matching entry is present here.
    observations = parsed.observations ?? {}
    console.info(`[maya-memory-extractor] facts extracted successfully: session=${sessionId}`)
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

  // Guarded SELECT: try the full evidence-ledger column set first; if
  // migration 0137 hasn't been applied yet, evidence/held won't exist and
  // Postgrest returns 42703 — fall back to the pre-0137 column set rather
  // than let a missing-column error masquerade as "no existing row" (which
  // would otherwise silently reset a real caller's facts on merge).
  let existingRow: CallerMemoryRow | null = null
  const { data: existingFull, error: selectErr } = await supabase
    .from('caller_memory')
    .select('facts, call_count, contact_id, evidence, held')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle()

  if (selectErr && isMissingColumnError(selectErr)) {
    console.warn(
      `[maya-memory-extractor] evidence/held columns not present yet (migration 0137 unapplied) — falling back to base columns: session=${sessionId}`
    )
    const { data: existingBase } = await supabase
      .from('caller_memory')
      .select('facts, call_count, contact_id')
      .eq('tenant_id', tenantId)
      .eq('phone', phone)
      .maybeSingle()
    existingRow = existingBase
      ? {
          ...(existingBase as {
            facts: CallerFacts | null
            call_count: number
            contact_id: string | null
          }),
          evidence: null,
          held: null,
        }
      : null
  } else {
    existingRow = existingFull as CallerMemoryRow | null
  }

  // ── Step 5: Merge facts through the evidence ledger ────────────────────────

  const now = new Date().toISOString()

  const merged = mergeFactsWithEvidence({
    existingFacts: existingRow?.facts ?? {},
    existingEvidence: existingRow?.evidence ?? {},
    existingHeld: existingRow?.held ?? [],
    incomingFacts: extractedFacts,
    incomingObservations: observations,
    observedAt: now,
    callSessionId: sessionId,
  })

  // PROMPT-01: sanitize every model-derived free-text string before it is
  // stored and later injected into Maya's system prompt (facts/summary) or
  // shown to staff (evidence detail, held detail/value) — same discipline
  // the pre-ledger code already applied to facts + summary.
  const mergedFacts = sanitizeFacts(merged.facts as Record<string, unknown>)
  const sanitizedSummary = summary ? sanitizeMemoryText(summary, 500) : ''

  const sanitizedEvidence: EvidenceLedger = {}
  for (const [field, ev] of Object.entries(merged.evidence)) {
    sanitizedEvidence[field] = { ...ev, detail: sanitizeMemoryText(ev.detail, 300) }
  }
  const sanitizedHeld: HeldFact[] = merged.held.map((h) => ({
    ...h,
    detail: sanitizeMemoryText(h.detail, 300),
    value: typeof h.value === 'string' ? sanitizeMemoryText(h.value, 200) : h.value,
  }))

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

  const basePayload: Record<string, unknown> = {
    tenant_id: tenantId,
    phone,
    facts: mergedFacts,
    summary: sanitizedSummary || null,
    call_count: (existingRow?.call_count ?? 0) + 1,
    last_call_at: now,
    updated_at: now,
  }

  if (contactId) {
    basePayload['contact_id'] = contactId
  }

  // Guarded UPSERT, mirroring the SELECT above: attempt the full payload
  // first, and if the evidence/held columns don't exist yet, retry with the
  // base payload only — facts must keep writing even before 0137 lands.
  let { error: upsertError } = await supabase
    .from('caller_memory')
    .upsert(
      { ...basePayload, evidence: sanitizedEvidence, held: sanitizedHeld },
      { onConflict: 'tenant_id,phone' }
    )

  if (upsertError && isMissingColumnError(upsertError)) {
    console.warn(
      `[maya-memory-extractor] evidence/held columns not present yet (migration 0137 unapplied) — writing facts only: session=${sessionId}`
    )
    ;({ error: upsertError } = await supabase
      .from('caller_memory')
      .upsert(basePayload, { onConflict: 'tenant_id,phone' }))
  }

  if (upsertError) {
    console.error(
      `[maya-memory-extractor] upsert failed: session=${sessionId} phone=${maskPhone(phone)}`,
      upsertError.message
    )
    return
  }

  console.info(
    `[maya-memory-extractor] upsert complete: session=${sessionId} phone=${maskPhone(phone)} calls=${(existingRow?.call_count ?? 0) + 1}`
  )
}

export function createMayaMemoryExtractor(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })

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
    { connection, skipVersionCheck: true }
  )

  worker.on('failed', (job, err) => {
    console.error(`[maya-memory-extractor] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
