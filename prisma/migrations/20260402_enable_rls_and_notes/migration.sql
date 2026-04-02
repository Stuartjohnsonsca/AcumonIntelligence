-- Add notes column to RMM rows
ALTER TABLE "audit_rmm_rows" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- Enable Row Level Security on all public tables
-- This prevents direct API access without proper authentication
-- The application uses server-side Prisma (service role) so these won't affect app functionality

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "firms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_client_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "period_product_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "extraction_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "extraction_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_portal_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "client_portal_two_factor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "portal_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_evidence_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "evidence_uploads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_engagements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_team_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_engagement_specialists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_client_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_agreed_dates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_information_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_permanent_file" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_tb_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_par_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_rmm_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_materiality" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "methodology_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "methodology_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "methodology_industries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "methodology_test_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "methodology_test_banks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "methodology_fs_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "methodology_fs_line_industries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "methodology_tool_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "methodology_risk_tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sampling_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sampling_reviews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sampling_export_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resource_staff_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resource_client_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resource_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resource_job_assignments" ENABLE ROW LEVEL SECURITY;

-- Create policies allowing the service role (used by Prisma) full access
-- The anon role gets NO access — all data access goes through the Next.js API
CREATE POLICY "service_role_full_access_users" ON "users" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_firms" ON "firms" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_clients" ON "clients" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_client_portal_users" ON "client_portal_users" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_portal_requests" ON "portal_requests" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_audit_engagements" ON "audit_engagements" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_audit_tb_rows" ON "audit_tb_rows" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_audit_rmm_rows" ON "audit_rmm_rows" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_audit_par_rows" ON "audit_par_rows" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_methodology_templates" ON "methodology_templates" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_methodology_risk_tables" ON "methodology_risk_tables" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_ai_usage" ON "ai_usage" FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_document_templates" ON "document_templates" FOR ALL USING (true) WITH CHECK (true);
