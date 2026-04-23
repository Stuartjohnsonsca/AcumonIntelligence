-- Raise-as-... cross-link columns on audit_error_schedules + audit_points.
--
-- The "Raise as Error / Management point / Representation" flows on
-- RI Matters stamp the new record with linked_from_type / linked_from_id
-- so the UI can show "originated from RI matter #N" on the target and
-- "raised as Error #M" on the source. The Prisma schema already declares
-- these columns; production Supabase is missing them — running the
-- Planning Letter download (which loads error_schedules) currently 500s
-- with "column audit_error_schedules.linked_from_type does not exist".
--
-- Idempotent. Safe to run in Supabase SQL Editor.

ALTER TABLE audit_error_schedules
  ADD COLUMN IF NOT EXISTS linked_from_type TEXT NULL;

ALTER TABLE audit_error_schedules
  ADD COLUMN IF NOT EXISTS linked_from_id TEXT NULL;

CREATE INDEX IF NOT EXISTS audit_error_schedules_linked_from_id_idx
  ON audit_error_schedules (linked_from_id);

ALTER TABLE audit_points
  ADD COLUMN IF NOT EXISTS linked_from_type TEXT NULL;

ALTER TABLE audit_points
  ADD COLUMN IF NOT EXISTS linked_from_id TEXT NULL;

CREATE INDEX IF NOT EXISTS audit_points_linked_from_id_idx
  ON audit_points (linked_from_id);
