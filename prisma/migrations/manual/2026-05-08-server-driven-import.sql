-- Pivot from user-driven MCP to server-driven orchestrator.
-- Drops OAuth tables (no longer needed — orchestrator authenticates to
-- Acumon's internal API with a shared secret, not OAuth), extends
-- ImportHandoffSession with prompt-state for in-flight credential / MFA /
-- confirmation prompts, and adds VendorRecipe for crowd-sourced
-- vendor navigation memory.

-- 1) Drop OAuth tables.
DROP TABLE IF EXISTS oauth_access_tokens;
DROP TABLE IF EXISTS oauth_auth_codes;
DROP TABLE IF EXISTS oauth_clients;

-- 2) Extend ImportHandoffSession.
ALTER TABLE import_handoff_sessions
  ADD COLUMN IF NOT EXISTS pending_prompt_type        text,
  ADD COLUMN IF NOT EXISTS pending_prompt_message     text,
  ADD COLUMN IF NOT EXISTS pending_prompt_options     jsonb,
  ADD COLUMN IF NOT EXISTS pending_prompt_id          text,
  ADD COLUMN IF NOT EXISTS pending_prompt_at          timestamptz,
  ADD COLUMN IF NOT EXISTS pending_prompt_answer      jsonb,
  ADD COLUMN IF NOT EXISTS pending_prompt_answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_message            text;

CREATE INDEX IF NOT EXISTS import_handoff_sessions_pending_prompt_type_idx
  ON import_handoff_sessions(pending_prompt_type);

-- 3) VendorRecipe table.
CREATE TABLE IF NOT EXISTS vendor_recipes (
  id                text PRIMARY KEY,
  firm_id           text NOT NULL,
  vendor_key        text NOT NULL,
  client_reference  text NOT NULL,
  recipe            jsonb NOT NULL,
  version           integer NOT NULL DEFAULT 1,
  success_count     integer NOT NULL DEFAULT 0,
  last_used_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_recipes_firm_vendor_client_uniq
  ON vendor_recipes(firm_id, vendor_key, client_reference);
CREATE INDEX IF NOT EXISTS vendor_recipes_firm_vendor_idx
  ON vendor_recipes(firm_id, vendor_key);
