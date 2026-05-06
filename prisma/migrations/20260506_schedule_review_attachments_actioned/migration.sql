-- ─── Schedule Specialist Reviews — backfill missing columns ─────────
-- The schema.prisma model `ScheduleSpecialistReview` has these columns
-- but the original 20260420 migration never created them. Prisma's
-- generated SELECT references every column, so any GET on
-- /api/engagements/{id}/schedule-reviews 500s on a prod DB that's
-- still on the original schema. Add them idempotently so we can run
-- this safely against any environment.
--
--   attachments      — JSON array of files the specialist attached
--                      when responding ({ id, fileName, storagePath,
--                      containerName, fileSize, mimeType, uploadedAt }).
--                      NULL = nothing attached yet.
--   actioned         — auditor has acted on the response (raised an
--                      RI Matter / Error / Review Point from it).
--   actioned_at      — timestamp the auditor actioned it.
--   actioned_by_id   — user id of the auditor who actioned it.
--   actioned_by_name — display name of the auditor who actioned it
--                      (denormalised so the chip can show a name even
--                      after the user record is gone).

ALTER TABLE "schedule_specialist_reviews"
  ADD COLUMN IF NOT EXISTS "attachments"      JSONB;

ALTER TABLE "schedule_specialist_reviews"
  ADD COLUMN IF NOT EXISTS "actioned"         BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "schedule_specialist_reviews"
  ADD COLUMN IF NOT EXISTS "actioned_at"      TIMESTAMP(3);

ALTER TABLE "schedule_specialist_reviews"
  ADD COLUMN IF NOT EXISTS "actioned_by_id"   TEXT;

ALTER TABLE "schedule_specialist_reviews"
  ADD COLUMN IF NOT EXISTS "actioned_by_name" TEXT;
