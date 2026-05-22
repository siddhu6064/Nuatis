-- Fix announcement cta_url: page is at /settings/brand-profile, not /settings/brand-voice.
-- The original seed in 0110_labs.sql pointed to a path that does not exist, causing 404s
-- when users clicked "Set up Brand Voice" on the dashboard banner.

UPDATE announcements
SET cta_url = '/settings/brand-profile'
WHERE cta_url = '/settings/brand-voice';
