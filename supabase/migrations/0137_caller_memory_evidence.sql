-- 0137_caller_memory_evidence.sql
-- Evidence ledger for Maya cross-call memory facts.
-- Adapted from Comp AI's evidence-graded fact model (MIT) for the voice-call context.
--
-- evidence: JSONB keyed by fact field name. Each entry:
--   { "kind": "caller.stated-directly", "weight": 0.9, "detail": "said 'my name is Priya' at 00:42",
--     "observed_at": "2026-08-03T14:12:00Z", "call_session_id": "..." }
--   Weight is priced server-side from the WEIGHTS table in caller-memory-evidence.ts —
--   the model NEVER supplies a weight or confidence. It reports what it observed (kind + detail).
--
-- held: JSONB array of facts that were NOT written because they conflicted with
--   stronger existing evidence, or were superseded. Shape:
--   { "field": "name", "value": "Pria", "kind": "model.inference", "weight": 0.35,
--     "detail": "...", "reason": "conflicts-with-stronger" | "superseded",
--     "observed_at": "..." }
--   Surfaced later in CallerMemoryCard as review items. Capped at 20 entries (oldest dropped).
--
-- Legacy rows: evidence = '{}' means every existing fact is treated as
-- LEGACY_WEIGHT (0.5) by mergeFactsWithEvidence(). No backfill needed.
--
-- RLS: caller_memory already has tenant_isolation policy (0111). New columns inherit it.
-- Apply manually via Supabase SQL editor. Do NOT apply programmatically.

ALTER TABLE caller_memory
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS held jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN caller_memory.evidence IS
  'Per-field evidence ledger: { field: { kind, weight, detail, observed_at, call_session_id } }. Weight priced server-side, never by the model.';
COMMENT ON COLUMN caller_memory.held IS
  'Facts held back (conflict with stronger evidence) or superseded. Array, newest last, capped at 20.';
