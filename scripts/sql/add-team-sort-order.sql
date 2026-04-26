-- One-off migration: add sort_order column to audit_team_members so
-- engagements can reorder their team list (drives the Opening tab
-- and `{{#each team}}` document-template iterations).
--
-- Idempotent. Existing rows get sort_order = ROW_NUMBER over their
-- engagement keyed by joined_at, so the visible order doesn't change
-- on existing engagements — they just gain the ability to reorder
-- going forward.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_team_members' AND column_name = 'sort_order'
  ) THEN
    ALTER TABLE audit_team_members ADD COLUMN sort_order INT NOT NULL DEFAULT 0;

    -- Seed sort_order from existing joined_at order so today's view
    -- on every engagement keeps its current ordering.
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY engagement_id ORDER BY joined_at, id) - 1 AS rn
      FROM audit_team_members
    )
    UPDATE audit_team_members
    SET sort_order = ranked.rn
    FROM ranked
    WHERE audit_team_members.id = ranked.id;
  END IF;
END
$$;
