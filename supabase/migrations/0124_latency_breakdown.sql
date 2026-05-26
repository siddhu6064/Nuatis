-- 0124_latency_breakdown.sql
-- Add latency_breakdown JSONB to voice_sessions.
-- Populated at session end by call-session-logger.ts.
-- Shape: { turn_count, avg_agent_response_ms, p50_agent_response_ms,
--          p95_agent_response_ms, turns: [{turn, agent_response_ms, interrupted}] }

ALTER TABLE voice_sessions
  ADD COLUMN IF NOT EXISTS latency_breakdown jsonb DEFAULT NULL;

COMMENT ON COLUMN voice_sessions.latency_breakdown IS
  'Per-turn agent response latency stats. Null for calls with no completed turns. '
  'Shape: {turn_count, avg_agent_response_ms, p50_agent_response_ms, p95_agent_response_ms, turns[]}';
