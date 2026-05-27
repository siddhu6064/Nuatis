-- 0126_fix_outbound_calls_announcement_url.sql
-- Banner CTA for the Maya outbound-calls announcement linked to /outbound-calls,
-- which shows an empty state with no actionable path. Update to /contacts where
-- users can open a contact profile and initiate a call directly.

UPDATE announcements
SET    cta_url = '/contacts'
WHERE  cta_url = '/outbound-calls'
  AND  title   ILIKE '%outbound%';
