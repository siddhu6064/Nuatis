-- 0127 — Repoint user-id FKs from auth.users to public.users.
-- The app uses NextAuth identities stored in public.users; these columns were
-- mistakenly FK'd to auth.users (Supabase Auth), so any write of a public.users
-- id violated the FK and returned 500 (resolve/assign/campaign-create/etc.).
-- All target columns are nullable and have zero orphan rows, so ON DELETE SET NULL is safe.
-- Does NOT touch auth.* internal tables.

ALTER TABLE public.conversation_status
  DROP CONSTRAINT IF EXISTS conversation_status_resolved_by_fkey,
  DROP CONSTRAINT IF EXISTS conversation_status_assigned_to_fkey;
ALTER TABLE public.conversation_status
  ADD CONSTRAINT conversation_status_resolved_by_fkey
    FOREIGN KEY (resolved_by) REFERENCES public.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT conversation_status_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_created_by_fkey;
ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.resource_bookings
  DROP CONSTRAINT IF EXISTS resource_bookings_booked_by_fkey;
ALTER TABLE public.resource_bookings
  ADD CONSTRAINT resource_bookings_booked_by_fkey
    FOREIGN KEY (booked_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.snippets
  DROP CONSTRAINT IF EXISTS snippets_created_by_fkey;
ALTER TABLE public.snippets
  ADD CONSTRAINT snippets_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
