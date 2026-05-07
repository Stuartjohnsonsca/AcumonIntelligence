-- OAuth 2.1 server tables (for the Acumon MCP custom integration).
-- Idempotent so it's safe to re-run.

CREATE TABLE IF NOT EXISTS oauth_clients (
  id                          text PRIMARY KEY,
  client_id                   text UNIQUE NOT NULL,
  client_secret_hash          text,
  client_name                 text NOT NULL,
  redirect_uris               jsonb NOT NULL,
  token_endpoint_auth_method  text NOT NULL DEFAULT 'none',
  grant_types                 jsonb NOT NULL DEFAULT '["authorization_code","refresh_token"]'::jsonb,
  firm_id                     text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_clients_firm_idx ON oauth_clients(firm_id);

CREATE TABLE IF NOT EXISTS oauth_auth_codes (
  code                    text PRIMARY KEY,
  client_id               text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id                 text NOT NULL,
  firm_id                 text NOT NULL,
  redirect_uri            text NOT NULL,
  code_challenge          text NOT NULL,
  code_challenge_method   text NOT NULL,
  scope                   text,
  resource                text,
  expires_at              timestamptz NOT NULL,
  used                    boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_auth_codes_client_idx ON oauth_auth_codes(client_id);
CREATE INDEX IF NOT EXISTS oauth_auth_codes_expires_idx ON oauth_auth_codes(expires_at);

CREATE TABLE IF NOT EXISTS oauth_access_tokens (
  id                          text PRIMARY KEY,
  token_hash                  text UNIQUE NOT NULL,
  refresh_token_hash          text UNIQUE,
  client_id                   text NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id                     text NOT NULL,
  firm_id                     text NOT NULL,
  scope                       text,
  resource                    text,
  expires_at                  timestamptz NOT NULL,
  refresh_token_expires_at    timestamptz,
  revoked_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_client_idx ON oauth_access_tokens(client_id);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_user_idx ON oauth_access_tokens(user_id);
CREATE INDEX IF NOT EXISTS oauth_access_tokens_expires_idx ON oauth_access_tokens(expires_at);
