-- Add role, period allocation, and service allocation to client portal users
ALTER TABLE "client_portal_users" ADD COLUMN IF NOT EXISTS "role" TEXT;
ALTER TABLE "client_portal_users" ADD COLUMN IF NOT EXISTS "allocated_period_ids" JSONB;
ALTER TABLE "client_portal_users" ADD COLUMN IF NOT EXISTS "allocated_services" JSONB;
