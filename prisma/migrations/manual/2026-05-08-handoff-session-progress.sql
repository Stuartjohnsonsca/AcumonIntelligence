-- Granular progress tracking for ImportHandoffSession so the modal can
-- render a live progress bar of what the user's AI assistant is doing.
ALTER TABLE import_handoff_sessions
  ADD COLUMN IF NOT EXISTS progress_stage   text NOT NULL DEFAULT 'created',
  ADD COLUMN IF NOT EXISTS progress_message text,
  ADD COLUMN IF NOT EXISTS progress_at      timestamptz;
