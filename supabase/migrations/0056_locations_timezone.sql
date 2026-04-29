-- Migration 0056: Add timezone column to locations
-- Applied manually via Supabase SQL editor on 2026-04-29
-- Column already exists in DB. This file is for tracking only.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Chicago';
