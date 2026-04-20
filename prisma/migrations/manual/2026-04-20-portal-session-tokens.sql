-- Adds server-side session tokens to the client portal users table.
-- Runs are idempotent — safe to re-run. Each portal user now has a
-- unique session token written on 2FA verify; all portal API endpoints
-- must resolve the caller from this token (see lib/portal-session.ts)
-- instead of the earlier "findFirst where isActive = true" pattern,
-- which let one portal user see another's data.

ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS session_token TEXT;
ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMP(3);

-- Unique index on session_token so we can look up the user in O(1)
-- without risking a collision with another user's (expired) token.
CREATE UNIQUE INDEX IF NOT EXISTS client_portal_users_session_token_key
  ON client_portal_users (session_token);

-- Lookup index for the resolvePortalUserFromToken helper.
CREATE INDEX IF NOT EXISTS client_portal_users_session_token_idx
  ON client_portal_users (session_token);
