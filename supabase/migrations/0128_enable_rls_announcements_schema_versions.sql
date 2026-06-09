-- 0128 — Enable RLS on announcements and schema_versions (Supabase advisor).
-- Neither table holds per-tenant PII, but anon-key direct REST access was open.
--
-- announcements: read via GET /api/announcements which uses the service-role
--   client (bypasses RLS — unaffected). SELECT policy for authenticated role
--   closes the anon-key REST door; service-role writes remain unrestricted.
--
-- schema_versions: pure migration-tracking table; written only by the Supabase
--   CLI. No policies added — service-role bypasses RLS; all other roles blocked.

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY announcements_select
  ON public.announcements
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.schema_versions ENABLE ROW LEVEL SECURITY;
-- No policies: service-role bypasses RLS and is the only accessor.
