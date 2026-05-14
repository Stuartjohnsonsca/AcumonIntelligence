-- Portal WeCom Pro External Contact bind support.
-- Idempotent; safe to re-run.
--
-- Adds the three columns we need to mint per-user Contact Way QRs,
-- match the WeCom change_external_contact webhook back to the right
-- portal user, and remember the WeCom-issued config_id for later
-- admin actions (delete/update Contact Way).

ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS wecom_bind_code              TEXT NULL,
  ADD COLUMN IF NOT EXISTS wecom_bind_code_expires_at   TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS wecom_config_id              TEXT NULL;

-- Plain unique index on wecom_bind_code. Postgres treats NULLs as
-- distinct in a unique index, so multiple users with NULL bind_code
-- don't collide; two pending binds with the same non-null code still
-- collide as intended. Matches Prisma's `@unique` annotation; a
-- previous partial-unique variant collided with Prisma on every
-- deploy.
CREATE UNIQUE INDEX IF NOT EXISTS client_portal_users_wecom_bind_code_key
  ON client_portal_users (wecom_bind_code);
