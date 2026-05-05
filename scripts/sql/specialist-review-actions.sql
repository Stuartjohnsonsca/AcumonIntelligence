-- Specialist Reviews: response attachments + auditor "actioned" tracking.
-- Adds the columns the engagement-level Specialist Requests panel uses
-- to (a) display files the specialist sent back with their decision,
-- and (b) split the count dots into green (actioned by an auditor) vs
-- red (still outstanding). Idempotent.

ALTER TABLE schedule_specialist_reviews
  ADD COLUMN IF NOT EXISTS attachments JSONB NULL;

ALTER TABLE schedule_specialist_reviews
  ADD COLUMN IF NOT EXISTS actioned BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE schedule_specialist_reviews
  ADD COLUMN IF NOT EXISTS actioned_at TIMESTAMPTZ NULL;

ALTER TABLE schedule_specialist_reviews
  ADD COLUMN IF NOT EXISTS actioned_by_id TEXT NULL;

ALTER TABLE schedule_specialist_reviews
  ADD COLUMN IF NOT EXISTS actioned_by_name TEXT NULL;
