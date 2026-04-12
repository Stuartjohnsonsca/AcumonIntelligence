-- Planning Letter schema migration
-- Run this on the production Supabase database via the SQL Editor.
-- All statements are idempotent (IF NOT EXISTS) so it is safe to re-run.

-- ─── Firm: letterhead, branding, regulatory ─────────────────────────────────
ALTER TABLE firms ADD COLUMN IF NOT EXISTS logo_storage_path TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS group_logo_storage_path TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS registered_company_number TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS statutory_auditor_number TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS legal_status TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS registered_office_address TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS letterhead_header_text TEXT;
ALTER TABLE firms ADD COLUMN IF NOT EXISTS letterhead_footer_text TEXT;

-- ─── Client: postal address (for letters) ───────────────────────────────────
ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;

-- ─── RMM: per-engagement risk category ──────────────────────────────────────
-- Values: 'significant_risk' | 'area_of_focus' | NULL
-- Drives the Planning Letter's Significant Risks / Areas of Focus sections.
ALTER TABLE audit_rmm_rows ADD COLUMN IF NOT EXISTS row_category TEXT;

-- ─── Contacts: informed management flag ────────────────────────────────────
ALTER TABLE audit_client_contacts ADD COLUMN IF NOT EXISTS is_informed_management BOOLEAN NOT NULL DEFAULT FALSE;
