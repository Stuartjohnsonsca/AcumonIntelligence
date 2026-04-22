-- RI Matters / audit-points upgrade.
--   - colour column: traffic-light tag the user picks (green/amber/red
--     or firm-specific). Nullable; 'new' status implies no colour yet.
--   - linked_from_type / linked_from_id: cross-link back to the source
--     record when a matter is "raised as" an Error / Management /
--     Representation point.
--
-- Idempotent. Safe to re-run.

ALTER TABLE audit_points ADD COLUMN IF NOT EXISTS colour TEXT;
ALTER TABLE audit_points ADD COLUMN IF NOT EXISTS linked_from_type TEXT;
ALTER TABLE audit_points ADD COLUMN IF NOT EXISTS linked_from_id TEXT;

CREATE INDEX IF NOT EXISTS audit_points_linked_from_id_idx
  ON audit_points (linked_from_id);

-- Same cross-link columns on the error schedule so "Raise as Error"
-- can stamp the originating RI matter's id. Read back by the UI to
-- render "from RI matter #N" on the error row.
ALTER TABLE audit_error_schedules ADD COLUMN IF NOT EXISTS linked_from_type TEXT;
ALTER TABLE audit_error_schedules ADD COLUMN IF NOT EXISTS linked_from_id TEXT;

CREATE INDEX IF NOT EXISTS audit_error_schedules_linked_from_id_idx
  ON audit_error_schedules (linked_from_id);
