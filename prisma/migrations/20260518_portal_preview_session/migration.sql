-- Portal preview sessions — let firm auditors view the client portal as a
-- specific client user, in read-only mode, without disturbing that user's
-- real session token. Each row is a short-lived (default 1h) impersonation
-- handle minted by the firm and consumed by the portal pages just like a
-- normal session token (?token=…).
--
-- Strict invariants enforced server-side:
--   - is_read_only is always TRUE for now (no read-write firm sessions)
--   - expires_at <= created_at + 4h
--   - portal_user_id must belong to the engagement's client
-- Idempotent so this SQL can be re-run safely against Supabase.

CREATE TABLE IF NOT EXISTS client_portal_preview_sessions (
  id                  text PRIMARY KEY,
  token               text NOT NULL UNIQUE,
  portal_user_id      text NOT NULL REFERENCES client_portal_users(id) ON DELETE CASCADE,
  engagement_id       text NOT NULL REFERENCES audit_engagements(id)   ON DELETE CASCADE,
  firm_user_id        text NOT NULL REFERENCES users(id)               ON DELETE CASCADE,
  is_read_only        boolean NOT NULL DEFAULT TRUE,
  expires_at          timestamp(3) NOT NULL,
  created_at          timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at          timestamp(3)
);

CREATE INDEX IF NOT EXISTS client_portal_preview_sessions_token_idx
  ON client_portal_preview_sessions (token);

CREATE INDEX IF NOT EXISTS client_portal_preview_sessions_firm_user_idx
  ON client_portal_preview_sessions (firm_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_portal_preview_sessions_engagement_idx
  ON client_portal_preview_sessions (engagement_id);
