-- ─── Schedule Specialist Reviews ────────────────────────────────────────
-- Each row represents a request sent from an auditor to a firm-wide
-- specialist (Ethics Partner, MRLO, Management Board, ACP, or any
-- other role the firm has configured) asking them to review a
-- specific schedule on an engagement and accept / reject it with
-- free-text comments.
--
-- Access model: each review has a unique `token` that lets the
-- specialist open the review page without logging in — the token
-- goes in the email link, and the landing page loads the review
-- + engagement schedule directly by token. This keeps the door
-- open to specialists who aren't Acumon users. We rotate the token
-- on each new send so an expired link can't be reused.

CREATE TABLE IF NOT EXISTS "schedule_specialist_reviews" (
  "id"              TEXT NOT NULL,
  "firm_id"         TEXT NOT NULL,
  "engagement_id"   TEXT NOT NULL,
  "schedule_key"    TEXT NOT NULL,
  -- Role the reviewer is playing (e.g. 'ethics_partner', 'mrlo',
  -- 'management_board', 'acp'). Stored as free text so firms can add
  -- custom roles beyond the four seeded ones.
  "role"            TEXT NOT NULL,
  "assignee_name"   TEXT NOT NULL,
  "assignee_email"  TEXT NOT NULL,
  -- State machine: pending → accepted | rejected
  "status"          TEXT NOT NULL DEFAULT 'pending',
  "comments"        TEXT,
  -- Opaque token for magic-link access. Indexed for fast lookup.
  "token"           TEXT NOT NULL,
  "sent_by_id"      TEXT,
  "sent_by_name"    TEXT,
  "sent_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_at"      TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "schedule_specialist_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedule_specialist_reviews_token_key" UNIQUE ("token"),

  CONSTRAINT "schedule_specialist_reviews_firm_id_fkey"
    FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "schedule_specialist_reviews_engagement_id_fkey"
    FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── Indexes ─────────────────────────────────────────────────────
-- Engagement + schedule lookups (primary usage: render reviews at
-- the bottom of a schedule).
CREATE INDEX IF NOT EXISTS "schedule_specialist_reviews_engagement_id_idx"
  ON "schedule_specialist_reviews"("engagement_id");
CREATE INDEX IF NOT EXISTS "schedule_specialist_reviews_engagement_id_schedule_key_idx"
  ON "schedule_specialist_reviews"("engagement_id", "schedule_key");
-- Firm scope — tenant safety filter.
CREATE INDEX IF NOT EXISTS "schedule_specialist_reviews_firm_id_idx"
  ON "schedule_specialist_reviews"("firm_id");
-- Recent-first listing where needed (admin dashboards etc.).
CREATE INDEX IF NOT EXISTS "schedule_specialist_reviews_sent_at_idx"
  ON "schedule_specialist_reviews"("sent_at" DESC);
