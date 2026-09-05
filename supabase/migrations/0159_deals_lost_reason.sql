-- Lost-reason tracking on deals — the "lost" state was a bare boolean with no
-- capture of why, so the pipeline could never answer "why do we lose deals."

ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason text;
