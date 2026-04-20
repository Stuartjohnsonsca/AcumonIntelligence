-- Idempotent SQL to apply the 2026-04-20 schema changes to production.
-- Run once in the Supabase SQL editor. Safe to re-run: every statement
-- uses IF NOT EXISTS. Nothing below drops data.

-- AuditRMMRow — add 'source' column so PAR-sourced rows can be grouped
-- at the bottom of the RMM tab with light shading.
ALTER TABLE audit_rmm_rows
  ADD COLUMN IF NOT EXISTS source TEXT;

-- MethodologyFsLine — add firm-configurable FS Level / FS Statement
-- names. Every row in methodology_fs_lines is now treated as an FS
-- Note Level; these two columns denormalise the parent FS Level and
-- parent FS Statement strings so TB classification can cascade
-- deterministically.
ALTER TABLE methodology_fs_lines
  ADD COLUMN IF NOT EXISTS fs_level_name TEXT;
ALTER TABLE methodology_fs_lines
  ADD COLUMN IF NOT EXISTS fs_statement_name TEXT;

-- Best-effort backfill: seed fs_statement_name from the legacy
-- fs_category field so existing FS Lines immediately show the right
-- statement in the new dropdowns. Uses the same mapping the server
-- uses elsewhere. Only touches rows where fs_statement_name is null,
-- so it's safe to re-run.
UPDATE methodology_fs_lines
   SET fs_statement_name = CASE fs_category
     WHEN 'pnl' THEN 'Profit & Loss'
     WHEN 'balance_sheet' THEN 'Balance Sheet'
     WHEN 'cashflow' THEN 'Cashflow'
     WHEN 'notes' THEN 'Notes'
     ELSE fs_statement_name
   END
 WHERE fs_statement_name IS NULL AND fs_category IS NOT NULL;

-- Best-effort backfill: seed fs_level_name from the legacy parent
-- relationship. note_item rows point at an fs_line_item parent whose
-- name is the FS Level; fs_line_item rows are levels themselves.
UPDATE methodology_fs_lines AS child
   SET fs_level_name = parent.name
  FROM methodology_fs_lines AS parent
 WHERE child.parent_fs_line_id = parent.id
   AND child.fs_level_name IS NULL;

UPDATE methodology_fs_lines
   SET fs_level_name = name
 WHERE line_type = 'fs_line_item'
   AND fs_level_name IS NULL;
