-- Set David Cartwright's roleLabel to "Manager" on the johnsons firm's
-- current audit engagement (c3869e2e-e803-4f09-9136-f5b6ce99541b) so
-- the Audit Planning Letter renders his role as "Manager" instead of
-- the system default "Reviewer".
--
-- Scoped narrowly via engagement_id + email lookup so we can't
-- accidentally hit the wrong row. Idempotent — re-running just sets
-- the same value again.

-- 1. Pre-flight — confirm exactly one matching team member.
SELECT atm.id, u.name, u.email, atm.role, atm.role_label
FROM audit_team_members atm
JOIN users u ON u.id = atm.user_id
WHERE atm.engagement_id = 'c3869e2e-e803-4f09-9136-f5b6ce99541b'
  AND lower(u.email) = 'davidc@acumon.com';

-- 2. Apply the override.
UPDATE audit_team_members atm
SET role_label = 'Manager'
FROM users u
WHERE atm.user_id = u.id
  AND lower(u.email) = 'davidc@acumon.com'
  AND atm.engagement_id = 'c3869e2e-e803-4f09-9136-f5b6ce99541b';

-- 3. Post-flight verification — should show role_label = 'Manager'.
SELECT atm.id, u.name, u.email, atm.role, atm.role_label
FROM audit_team_members atm
JOIN users u ON u.id = atm.user_id
WHERE atm.engagement_id = 'c3869e2e-e803-4f09-9136-f5b6ce99541b'
  AND lower(u.email) = 'davidc@acumon.com';
