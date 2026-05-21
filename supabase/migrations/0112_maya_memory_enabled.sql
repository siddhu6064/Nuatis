-- 0112_maya_memory_enabled.sql
-- Add maya_memory_enabled flag to locations table (where all Maya settings live).
-- Allows per-location opt-out of caller memory extraction.

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS maya_memory_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN locations.maya_memory_enabled IS
  'When true, Maya extracts and stores caller memory after each call for personalised future interactions';
