-- Add role and period allocation to client portal users
ALTER TABLE "client_portal_users" ADD COLUMN "role" TEXT;
ALTER TABLE "client_portal_users" ADD COLUMN "allocated_period_ids" JSONB;
