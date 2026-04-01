-- Add sendMgtData, auditorView, addedToRmm to PAR rows
ALTER TABLE "audit_par_rows" ADD COLUMN IF NOT EXISTS "send_mgt_data" JSONB;
ALTER TABLE "audit_par_rows" ADD COLUMN IF NOT EXISTS "auditor_view" TEXT;
ALTER TABLE "audit_par_rows" ADD COLUMN IF NOT EXISTS "added_to_rmm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "audit_par_rows" ADD COLUMN IF NOT EXISTS "added_to_rmm_by" TEXT;
