-- Journal risk: AI augmentation columns + conclusion text + error-schedule link.
--   ai_insight        — Together AI commentary on the journal description /
--                       linguistic patterns. Does NOT influence the
--                       deterministic risk score; it is surfaced alongside.
--   ai_flag           — boolean set when AI judges the description genuinely
--                       concerning (vague, evasive, or out-of-distribution).
--   ai_processed_at   — null when AI augmentation has not run for this entry.
--   error_schedule_id — link to the AuditErrorSchedule row created when the
--                       auditor raised this journal as an error.
-- And on journal_risk_runs:
--   conclusion        — the auditor's written conclusion on the MOC test as
--                       a whole. Surfaced into the Audit Summary Memo.
-- Idempotent so safe against Supabase.

ALTER TABLE journal_risk_entries
  ADD COLUMN IF NOT EXISTS ai_insight        text,
  ADD COLUMN IF NOT EXISTS ai_flag           boolean,
  ADD COLUMN IF NOT EXISTS ai_processed_at   timestamp(3),
  ADD COLUMN IF NOT EXISTS error_schedule_id text;

ALTER TABLE journal_risk_runs
  ADD COLUMN IF NOT EXISTS conclusion       text,
  ADD COLUMN IF NOT EXISTS conclusion_by_id text,
  ADD COLUMN IF NOT EXISTS conclusion_at    timestamp(3);

-- AuditErrorSchedule rows raised from a JournalRiskEntry get the entry id
-- back on `linked_from_id` with `linked_from_type = 'journal_risk_entry'`;
-- the cross-link on the entry side gives O(1) lookup of "has this journal
-- already been raised as an error?".
CREATE INDEX IF NOT EXISTS journal_risk_entries_error_schedule_id_idx
  ON journal_risk_entries(error_schedule_id);
