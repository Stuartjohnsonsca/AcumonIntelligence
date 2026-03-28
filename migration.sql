-- CreateTable
CREATE TABLE "firms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data_region" TEXT NOT NULL DEFAULT 'uk',
    "taxonomy_source_type" TEXT,
    "taxonomy_endpoint_url" TEXT,
    "chart_of_accounts_blob_path" TEXT,
    "chart_of_accounts_container" TEXT,
    "chart_of_accounts_file_name" TEXT,
    "chart_of_accounts_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "ethics_partner_id" TEXT,

    CONSTRAINT "firms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "display_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "two_factor_method" TEXT NOT NULL DEFAULT 'email',
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_firm_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_portfolio_owner" BOOLEAN NOT NULL DEFAULT false,
    "is_methodology_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_resource_admin" BOOLEAN NOT NULL DEFAULT false,
    "entra_object_id" TEXT,
    "job_title" TEXT,
    "department" TEXT,
    "office_location" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "url_prefix" TEXT NOT NULL,
    "expiry_days" INTEGER NOT NULL,
    "price_1" DOUBLE PRECISION NOT NULL,
    "price_5" DOUBLE PRECISION NOT NULL,
    "price_10" DOUBLE PRECISION NOT NULL,
    "price_20" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_changes" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "price_1" DOUBLE PRECISION NOT NULL,
    "price_5" DOUBLE PRECISION NOT NULL,
    "price_10" DOUBLE PRECISION NOT NULL,
    "price_20" DOUBLE PRECISION NOT NULL,
    "committed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),

    CONSTRAINT "price_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "software" TEXT,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "sector" TEXT,
    "portfolio_manager_id" TEXT,
    "crm_account_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "read_only" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_api_keys" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "api_key" TEXT NOT NULL,
    "org_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "purchased_by_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "expiry_date" TIMESTAMP(3) NOT NULL,
    "stripe_payment_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_client_assignments" (
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_client_assignments_pkey" PRIMARY KEY ("user_id","client_id")
);

-- CreateTable
CREATE TABLE "two_factor_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_product_selections" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "url_prefix" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_product_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xero_auth_requests" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "recipient_name" TEXT,
    "token" TEXT NOT NULL,
    "code_verifier" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "responded_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xero_auth_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_connections" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT,
    "org_name" TEXT,
    "connected_by" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accounts_cache" JSONB,
    "accounts_cached_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_xero_auths" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "expires_in" INTEGER NOT NULL,
    "connected_by" TEXT NOT NULL,
    "is_delegated" BOOLEAN NOT NULL DEFAULT false,
    "delegated_token" TEXT,
    "tenants" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_xero_auths_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_jobs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_files" INTEGER NOT NULL DEFAULT 0,
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "accounting_system" TEXT,
    "org_name" TEXT,
    "extracted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "final_reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "extraction_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extraction_files" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "container_name" TEXT NOT NULL,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "was_zipped" BOOLEAN NOT NULL DEFAULT false,
    "zip_source_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "error_message" TEXT,
    "file_hash" TEXT,
    "duplicate_of_id" TEXT,
    "page_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "extracted_records" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "purchaser_name" TEXT,
    "purchaser_tax_id" TEXT,
    "purchaser_country" TEXT,
    "seller_name" TEXT,
    "seller_tax_id" TEXT,
    "seller_country" TEXT,
    "document_ref" TEXT,
    "document_date" TEXT,
    "due_date" TEXT,
    "net_total" DOUBLE PRECISION,
    "duty_total" DOUBLE PRECISION,
    "tax_total" DOUBLE PRECISION,
    "gross_total" DOUBLE PRECISION,
    "line_items" JSONB,
    "account_category" TEXT,
    "raw_extraction" JSONB,
    "field_locations" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extracted_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_category_learning" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_category_learning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "job_id" TEXT,
    "file_id" TEXT,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'Financial Data Extraction',
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "estimated_cost_usd" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "progress" JSONB,
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_summary_jobs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_files" INTEGER NOT NULL DEFAULT 0,
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "doc_summary_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_summary_files" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "container_name" TEXT NOT NULL DEFAULT 'upload-inbox',
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "error_message" TEXT,
    "page_count" INTEGER,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "document_description" TEXT,
    "extracted_text" TEXT,
    "key_terms" JSONB,
    "missing_information" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_summary_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_summary_findings" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "finding" TEXT NOT NULL,
    "clause_reference" TEXT NOT NULL,
    "is_significant_risk" BOOLEAN NOT NULL DEFAULT false,
    "ai_significant_risk" BOOLEAN NOT NULL DEFAULT false,
    "user_response" TEXT,
    "accounting_impact" TEXT,
    "audit_impact" TEXT,
    "add_to_testing" BOOLEAN NOT NULL DEFAULT false,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_summary_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_summary_qa" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "turn_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_summary_qa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_periods" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "period_product_assignments" (
    "id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "product_key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_product_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "firm_id" TEXT,
    "client_id" TEXT,
    "action" TEXT NOT NULL,
    "tool" TEXT,
    "detail" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "route" TEXT,
    "tool" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_sampling_configs" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "confidence_level" DOUBLE PRECISION NOT NULL DEFAULT 95,
    "confidence_factor_table" JSONB,
    "risk_matrix" JSONB,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firm_sampling_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_engagements" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT,
    "audit_area" TEXT,
    "testing_type" TEXT,
    "assertions" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reviewer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sampling_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_audit_data" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "performance_materiality" DOUBLE PRECISION NOT NULL,
    "clearly_trivial" DOUBLE PRECISION NOT NULL,
    "tolerable_misstatement" DOUBLE PRECISION NOT NULL,
    "functional_currency" TEXT NOT NULL DEFAULT 'GBP',
    "data_type" TEXT NOT NULL,
    "test_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sampling_audit_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_populations" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "description" TEXT,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "completeness_statement" TEXT,
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "unit_of_sampling" TEXT,
    "file_hash" TEXT,
    "original_file_name" TEXT,
    "storage_path" TEXT,
    "container_name" TEXT NOT NULL DEFAULT 'upload-inbox',
    "column_mapping" JSONB,
    "data_quality_summary" JSONB,
    "parsed_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sampling_populations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_runs" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "population_id" TEXT NOT NULL,
    "parent_run_id" TEXT,
    "mode" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "stratification" TEXT NOT NULL DEFAULT 'simple',
    "parameters" JSONB NOT NULL,
    "seed" INTEGER,
    "tool_version" TEXT NOT NULL DEFAULT '1.0',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sample_size" INTEGER,
    "result_summary" JSONB,
    "coverage_summary" JSONB,
    "audit_trail_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sampling_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "book_value" DOUBLE PRECISION NOT NULL,
    "audited_value" DOUBLE PRECISION,
    "selected_reason" TEXT,
    "stratum_id" TEXT,
    "test_result" TEXT,
    "wp_reference" TEXT,
    "exception_amount" DOUBLE PRECISION,
    "exception_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sampling_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_strata" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "total_value" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "summary_stats" JSONB,

    CONSTRAINT "sampling_strata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_judgement_chat" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "turn_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sampling_judgement_chat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_reviews" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "reviewer_id" TEXT NOT NULL,
    "notes" TEXT,
    "decision" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sampling_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sampling_export_artifacts" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "artifact_type" TEXT NOT NULL,
    "file_hash" TEXT,
    "storage_path" TEXT,
    "container_name" TEXT NOT NULL DEFAULT 'sampling-artifacts',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sampling_export_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_portal_users" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_portal_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_portal_two_factor" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_portal_two_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_evidence_requests" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "date" TEXT,
    "reference" TEXT,
    "contact" TEXT,
    "invoice_required" BOOLEAN NOT NULL DEFAULT false,
    "payment_required" BOOLEAN NOT NULL DEFAULT false,
    "supplier_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "debtor_confirmation" BOOLEAN NOT NULL DEFAULT false,
    "contract_required" BOOLEAN NOT NULL DEFAULT false,
    "intercompany_required" BOOLEAN NOT NULL DEFAULT false,
    "director_matters" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assigned_to" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_evidence_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence_uploads" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "container_name" TEXT NOT NULL DEFAULT 'audit-evidence',
    "file_size" INTEGER,
    "mime_type" TEXT,
    "evidence_type" TEXT NOT NULL,
    "ai_verified" BOOLEAN,
    "ai_verify_notes" TEXT,
    "firm_accepted" BOOLEAN,
    "firm_reviewed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assurance_chats" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "sub_tool" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assurance_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assurance_chat_messages" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "turn_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assurance_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assurance_engagements" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sub_tool" TEXT NOT NULL,
    "engagement_type" TEXT NOT NULL,
    "sector" TEXT,
    "project_details" JSONB,
    "terms_of_reference" TEXT,
    "tor_generated_at" TIMESTAMP(3),
    "report_content" TEXT,
    "report_generated_at" TIMESTAMP(3),
    "score" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assurance_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assurance_documents" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "uploaded_by_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "container_name" TEXT NOT NULL DEFAULT 'assurance-evidence',
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "document_category" TEXT NOT NULL,
    "ai_review_status" TEXT NOT NULL DEFAULT 'pending',
    "ai_review_result" JSONB,
    "ai_score" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assurance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assurance_reports" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "report_type" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "container_name" TEXT NOT NULL DEFAULT 'assurance-reports',
    "file_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assurance_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assurance_scores" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "sub_tool" TEXT NOT NULL,
    "sector" TEXT,
    "score" INTEGER NOT NULL,
    "scored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "assurance_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assurance_learnings" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "sector" TEXT,
    "sub_tool" TEXT,
    "pattern_type" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "source_count" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assurance_learnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_chats" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "commitment_type" TEXT,
    "action_plan" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_chats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_chat_messages" (
    "id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "turn_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_chart_of_accounts" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "category_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "firm_chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_code_mappings" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "category_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_code_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_to_tb_sessions" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "opening_position_source" TEXT,
    "opening_position_data" JSONB,
    "combine_mode" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_to_tb_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_to_tb_files" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "container_name" TEXT NOT NULL DEFAULT 'upload-inbox',
    "file_size" INTEGER NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "error_message" TEXT,
    "page_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_to_tb_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "bank_name" TEXT,
    "sort_code" TEXT,
    "account_number" TEXT,
    "account_name" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "opening_balance" DOUBLE PRECISION,
    "closing_balance" DOUBLE PRECISION,
    "tab_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transactions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "file_id" TEXT,
    "account_id" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "balance" DOUBLE PRECISION,
    "bank_name" TEXT,
    "sort_code" TEXT,
    "account_number" TEXT,
    "statement_date" TEXT,
    "statement_page" INTEGER,
    "account_code" TEXT,
    "account_name_mapped" TEXT,
    "category_type" TEXT,
    "in_period" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_balance_entries" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "category_type" TEXT NOT NULL,
    "opening_debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opening_credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "combined_debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "combined_credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "column_data" JSONB,
    "journal_data" JSONB,
    "is_from_opening_position" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_balance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_to_tb_journals" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "journal_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_to_tb_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_to_tb_journal_lines" (
    "id" TEXT NOT NULL,
    "journal_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "description" TEXT,
    "debit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "credit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bank_to_tb_journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tool_key" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "period_id" TEXT,
    "client_name" TEXT NOT NULL,
    "period_label" TEXT,
    "tool_path" TEXT NOT NULL,
    "last_accessed" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ia_feedback_users" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ia_feedback_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assurance_feedback" (
    "id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "chat_id" TEXT,
    "user_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assurance_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_chart_of_accounts" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "category_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_audit_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "performance_materiality" DOUBLE PRECISION,
    "clearly_trivial" DOUBLE PRECISION,
    "tolerable_error" DOUBLE PRECISION,
    "functional_currency" TEXT NOT NULL DEFAULT 'GBP',
    "data_source" TEXT,
    "bank_data" JSONB,
    "audit_test_results" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_audit_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_audit_tests" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "test_key" TEXT NOT NULL,
    "test_label" TEXT NOT NULL,
    "is_checked" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "result_data" JSONB,
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_audit_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_audit_files" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "blob_path" TEXT NOT NULL,
    "container" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "extracted_data" JSONB,
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_audit_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fs_assertion_mappings" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "mapping_type" TEXT NOT NULL,
    "row_key" TEXT NOT NULL,
    "row_label" TEXT NOT NULL,
    "completeness" BOOLEAN NOT NULL DEFAULT false,
    "occurrence" BOOLEAN NOT NULL DEFAULT false,
    "cut_off" BOOLEAN NOT NULL DEFAULT false,
    "classification" BOOLEAN NOT NULL DEFAULT false,
    "presentation" BOOLEAN NOT NULL DEFAULT false,
    "existence" BOOLEAN NOT NULL DEFAULT false,
    "valuation" BOOLEAN NOT NULL DEFAULT false,
    "rights" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fs_assertion_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_engagements" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "period_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "audit_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pre_start',
    "methodology_version_id" TEXT,
    "info_request_type" TEXT NOT NULL DEFAULT 'standard',
    "hard_close_date" TIMESTAMP(3),
    "is_group_audit" BOOLEAN NOT NULL DEFAULT false,
    "tb_view_mode" TEXT NOT NULL DEFAULT 'fs_line',
    "created_by_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_team_members" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_specialists" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "specialist_type" TEXT NOT NULL,
    "firm_name" TEXT,

    CONSTRAINT "audit_specialists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_client_contacts" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "is_main_contact" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "audit_client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_agreed_dates" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "target_date" TIMESTAMP(3),
    "revised_target" TIMESTAMP(3),
    "progress" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "audit_agreed_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_information_requests" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_included" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "audit_information_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_intelligence" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT,
    "significant_change" BOOLEAN NOT NULL DEFAULT false,
    "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_intelligence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_intelligence_reviews" (
    "id" TEXT NOT NULL,
    "intelligence_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_intelligence_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_permanent_files" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "section_key" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "audit_permanent_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_ethics" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "audit_ethics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_continuance" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "audit_continuance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_new_client_take_on" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "audit_new_client_take_on_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_materiality" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "audit_materiality_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_par_rows" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "particulars" TEXT NOT NULL,
    "current_year" DOUBLE PRECISION,
    "prior_year" DOUBLE PRECISION,
    "abs_variance" DOUBLE PRECISION,
    "abs_variance_percent" DOUBLE PRECISION,
    "significant_change" BOOLEAN NOT NULL DEFAULT false,
    "sent_to_management" BOOLEAN NOT NULL DEFAULT false,
    "management_response_status" TEXT,
    "reasons" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "audit_par_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_rmm_rows" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "line_item" TEXT NOT NULL,
    "line_type" TEXT NOT NULL,
    "risk_identified" TEXT,
    "amount" DOUBLE PRECISION,
    "assertions" JSONB,
    "relevance" TEXT,
    "complexity_text" TEXT,
    "subjectivity_text" TEXT,
    "change_text" TEXT,
    "uncertainty_text" TEXT,
    "susceptibility_text" TEXT,
    "inherent_risk_level" TEXT,
    "ai_summary" TEXT,
    "is_ai_edited" BOOLEAN NOT NULL DEFAULT false,
    "likelihood" TEXT,
    "magnitude" TEXT,
    "final_risk_assessment" TEXT,
    "control_risk" TEXT,
    "overall_risk" TEXT,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "audit_rmm_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_documents" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "document_name" TEXT NOT NULL,
    "requested_from" TEXT,
    "requested_date" TIMESTAMP(3),
    "requested_by_id" TEXT,
    "uploaded_date" TIMESTAMP(3),
    "uploaded_by_id" TEXT,
    "storage_path" TEXT,
    "container_name" TEXT NOT NULL DEFAULT 'audit-documents',
    "file_size" INTEGER,
    "mime_type" TEXT,
    "visible_to_client" BOOLEAN NOT NULL DEFAULT false,
    "received_by_name" TEXT,
    "received_at" TIMESTAMP(3),
    "verified_on" TIMESTAMP(3),
    "verified_by_name" TEXT,
    "utilised_on" TIMESTAMP(3),
    "utilised_by_name" TEXT,
    "utilised_tab" TEXT,
    "mapped_items" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_tb_rows" (
    "id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "current_year" DOUBLE PRECISION,
    "prior_year" DOUBLE PRECISION,
    "fs_note_level" TEXT,
    "fs_level" TEXT,
    "fs_statement" TEXT,
    "group_name" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "audit_tb_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_configs" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "audit_type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "methodology_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_templates" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "template_type" TEXT NOT NULL,
    "audit_type" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "methodology_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_industries" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "methodology_industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_test_types" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "methodology_test_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_test_banks" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "industry_id" TEXT NOT NULL,
    "fs_line" TEXT NOT NULL,
    "tests" JSONB NOT NULL,
    "assertions" JSONB,

    CONSTRAINT "methodology_test_banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_fs_lines" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "line_type" TEXT NOT NULL,
    "fs_category" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "methodology_fs_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_fs_line_industries" (
    "id" TEXT NOT NULL,
    "fs_line_id" TEXT NOT NULL,
    "industry_id" TEXT NOT NULL,

    CONSTRAINT "methodology_fs_line_industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_tool_settings" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "method_name" TEXT NOT NULL,
    "availability" TEXT NOT NULL,
    "audit_type" TEXT NOT NULL,

    CONSTRAINT "methodology_tool_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "methodology_risk_tables" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "table_type" TEXT NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "methodology_risk_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_staff_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "resource_role" TEXT NOT NULL,
    "concurrent_job_limit" INTEGER NOT NULL,
    "is_ri" BOOLEAN NOT NULL DEFAULT false,
    "weekly_capacity_hrs" DOUBLE PRECISION NOT NULL DEFAULT 37.5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_staff_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_allocations" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "engagement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3) NOT NULL,
    "hours_per_day" DOUBLE PRECISION NOT NULL DEFAULT 7.5,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_jobs" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "audit_type" TEXT NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "target_completion" TIMESTAMP(3) NOT NULL,
    "budget_hours_ri" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "budget_hours_reviewer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "budget_hours_preparer" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_display_id_key" ON "users"("display_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_entra_object_id_key" ON "users"("entra_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_url_prefix_key" ON "products"("url_prefix");

-- CreateIndex
CREATE UNIQUE INDEX "clients_crm_account_id_key" ON "clients"("crm_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_api_keys_api_key_key" ON "client_api_keys"("api_key");

-- CreateIndex
CREATE UNIQUE INDEX "pending_product_selections_session_token_key" ON "pending_product_selections"("session_token");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_key" ON "password_reset_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "access_requests_token_key" ON "access_requests"("token");

-- CreateIndex
CREATE UNIQUE INDEX "xero_auth_requests_token_key" ON "xero_auth_requests"("token");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_connections_client_id_system_key" ON "accounting_connections"("client_id", "system");

-- CreateIndex
CREATE UNIQUE INDEX "account_category_learning_client_id_description_key" ON "account_category_learning"("client_id", "description");

-- CreateIndex
CREATE INDEX "ai_usage_client_id_idx" ON "ai_usage"("client_id");

-- CreateIndex
CREATE INDEX "ai_usage_client_id_created_at_idx" ON "ai_usage"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_user_id_idx" ON "ai_usage"("user_id");

-- CreateIndex
CREATE INDEX "background_tasks_user_id_status_idx" ON "background_tasks"("user_id", "status");

-- CreateIndex
CREATE INDEX "background_tasks_created_at_idx" ON "background_tasks"("created_at");

-- CreateIndex
CREATE INDEX "doc_summary_jobs_client_id_idx" ON "doc_summary_jobs"("client_id");

-- CreateIndex
CREATE INDEX "doc_summary_jobs_user_id_idx" ON "doc_summary_jobs"("user_id");

-- CreateIndex
CREATE INDEX "doc_summary_files_job_id_idx" ON "doc_summary_files"("job_id");

-- CreateIndex
CREATE INDEX "doc_summary_findings_job_id_idx" ON "doc_summary_findings"("job_id");

-- CreateIndex
CREATE INDEX "doc_summary_findings_file_id_idx" ON "doc_summary_findings"("file_id");

-- CreateIndex
CREATE INDEX "doc_summary_qa_file_id_idx" ON "doc_summary_qa"("file_id");

-- CreateIndex
CREATE INDEX "doc_summary_qa_job_id_idx" ON "doc_summary_qa"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_periods_client_id_start_date_key" ON "client_periods"("client_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "period_product_assignments_period_id_product_key_user_id_key" ON "period_product_assignments"("period_id", "product_key", "user_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "activity_logs_firm_id_idx" ON "activity_logs"("firm_id");

-- CreateIndex
CREATE INDEX "activity_logs_client_id_idx" ON "activity_logs"("client_id");

-- CreateIndex
CREATE INDEX "activity_logs_action_idx" ON "activity_logs"("action");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "error_logs_user_id_idx" ON "error_logs"("user_id");

-- CreateIndex
CREATE INDEX "error_logs_route_idx" ON "error_logs"("route");

-- CreateIndex
CREATE INDEX "error_logs_severity_idx" ON "error_logs"("severity");

-- CreateIndex
CREATE INDEX "error_logs_created_at_idx" ON "error_logs"("created_at");

-- CreateIndex
CREATE INDEX "error_logs_resolved_idx" ON "error_logs"("resolved");

-- CreateIndex
CREATE UNIQUE INDEX "firm_sampling_configs_firm_id_key" ON "firm_sampling_configs"("firm_id");

-- CreateIndex
CREATE INDEX "sampling_engagements_client_id_period_id_idx" ON "sampling_engagements"("client_id", "period_id");

-- CreateIndex
CREATE INDEX "sampling_engagements_user_id_idx" ON "sampling_engagements"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sampling_audit_data_engagement_id_key" ON "sampling_audit_data"("engagement_id");

-- CreateIndex
CREATE INDEX "sampling_populations_engagement_id_idx" ON "sampling_populations"("engagement_id");

-- CreateIndex
CREATE INDEX "sampling_runs_engagement_id_idx" ON "sampling_runs"("engagement_id");

-- CreateIndex
CREATE INDEX "sampling_runs_population_id_idx" ON "sampling_runs"("population_id");

-- CreateIndex
CREATE INDEX "sampling_items_run_id_idx" ON "sampling_items"("run_id");

-- CreateIndex
CREATE INDEX "sampling_strata_run_id_idx" ON "sampling_strata"("run_id");

-- CreateIndex
CREATE INDEX "sampling_judgement_chat_run_id_idx" ON "sampling_judgement_chat"("run_id");

-- CreateIndex
CREATE INDEX "sampling_reviews_run_id_idx" ON "sampling_reviews"("run_id");

-- CreateIndex
CREATE INDEX "sampling_export_artifacts_run_id_idx" ON "sampling_export_artifacts"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_portal_users_client_id_email_key" ON "client_portal_users"("client_id", "email");

-- CreateIndex
CREATE INDEX "client_portal_two_factor_user_id_idx" ON "client_portal_two_factor"("user_id");

-- CreateIndex
CREATE INDEX "audit_evidence_requests_run_id_idx" ON "audit_evidence_requests"("run_id");

-- CreateIndex
CREATE INDEX "audit_evidence_requests_client_id_period_id_idx" ON "audit_evidence_requests"("client_id", "period_id");

-- CreateIndex
CREATE INDEX "evidence_uploads_request_id_idx" ON "evidence_uploads"("request_id");

-- CreateIndex
CREATE INDEX "assurance_chats_client_id_user_id_idx" ON "assurance_chats"("client_id", "user_id");

-- CreateIndex
CREATE INDEX "assurance_chats_firm_id_idx" ON "assurance_chats"("firm_id");

-- CreateIndex
CREATE INDEX "assurance_chat_messages_chat_id_idx" ON "assurance_chat_messages"("chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "assurance_engagements_chat_id_key" ON "assurance_engagements"("chat_id");

-- CreateIndex
CREATE INDEX "assurance_engagements_client_id_firm_id_idx" ON "assurance_engagements"("client_id", "firm_id");

-- CreateIndex
CREATE INDEX "assurance_engagements_user_id_idx" ON "assurance_engagements"("user_id");

-- CreateIndex
CREATE INDEX "assurance_documents_engagement_id_idx" ON "assurance_documents"("engagement_id");

-- CreateIndex
CREATE INDEX "assurance_reports_engagement_id_idx" ON "assurance_reports"("engagement_id");

-- CreateIndex
CREATE INDEX "assurance_scores_firm_id_sub_tool_idx" ON "assurance_scores"("firm_id", "sub_tool");

-- CreateIndex
CREATE INDEX "assurance_scores_sector_sub_tool_idx" ON "assurance_scores"("sector", "sub_tool");

-- CreateIndex
CREATE INDEX "assurance_scores_client_id_idx" ON "assurance_scores"("client_id");

-- CreateIndex
CREATE INDEX "assurance_learnings_firm_id_idx" ON "assurance_learnings"("firm_id");

-- CreateIndex
CREATE INDEX "assurance_learnings_sector_sub_tool_idx" ON "assurance_learnings"("sector", "sub_tool");

-- CreateIndex
CREATE INDEX "assurance_learnings_pattern_type_idx" ON "assurance_learnings"("pattern_type");

-- CreateIndex
CREATE INDEX "risk_chats_client_id_user_id_idx" ON "risk_chats"("client_id", "user_id");

-- CreateIndex
CREATE INDEX "risk_chats_firm_id_idx" ON "risk_chats"("firm_id");

-- CreateIndex
CREATE INDEX "risk_chat_messages_chat_id_idx" ON "risk_chat_messages"("chat_id");

-- CreateIndex
CREATE INDEX "firm_chart_of_accounts_firm_id_idx" ON "firm_chart_of_accounts"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "firm_chart_of_accounts_firm_id_account_code_key" ON "firm_chart_of_accounts"("firm_id", "account_code");

-- CreateIndex
CREATE INDEX "account_code_mappings_firm_id_idx" ON "account_code_mappings"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_code_mappings_firm_id_description_key" ON "account_code_mappings"("firm_id", "description");

-- CreateIndex
CREATE INDEX "bank_to_tb_sessions_client_id_period_id_idx" ON "bank_to_tb_sessions"("client_id", "period_id");

-- CreateIndex
CREATE INDEX "bank_to_tb_sessions_user_id_idx" ON "bank_to_tb_sessions"("user_id");

-- CreateIndex
CREATE INDEX "bank_to_tb_files_session_id_idx" ON "bank_to_tb_files"("session_id");

-- CreateIndex
CREATE INDEX "bank_accounts_session_id_idx" ON "bank_accounts"("session_id");

-- CreateIndex
CREATE INDEX "bank_transactions_session_id_idx" ON "bank_transactions"("session_id");

-- CreateIndex
CREATE INDEX "bank_transactions_account_id_idx" ON "bank_transactions"("account_id");

-- CreateIndex
CREATE INDEX "trial_balance_entries_session_id_idx" ON "trial_balance_entries"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "trial_balance_entries_session_id_account_code_key" ON "trial_balance_entries"("session_id", "account_code");

-- CreateIndex
CREATE INDEX "bank_to_tb_journals_session_id_idx" ON "bank_to_tb_journals"("session_id");

-- CreateIndex
CREATE INDEX "bank_to_tb_journals_session_id_category_idx" ON "bank_to_tb_journals"("session_id", "category");

-- CreateIndex
CREATE INDEX "bank_to_tb_journal_lines_journal_id_idx" ON "bank_to_tb_journal_lines"("journal_id");

-- CreateIndex
CREATE INDEX "tool_sessions_user_id_idx" ON "tool_sessions"("user_id");

-- CreateIndex
CREATE INDEX "ia_feedback_users_firm_id_idx" ON "ia_feedback_users"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "ia_feedback_users_user_id_firm_id_key" ON "ia_feedback_users"("user_id", "firm_id");

-- CreateIndex
CREATE INDEX "assurance_feedback_target_type_target_id_idx" ON "assurance_feedback"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "assurance_feedback_chat_id_idx" ON "assurance_feedback"("chat_id");

-- CreateIndex
CREATE INDEX "assurance_feedback_firm_id_idx" ON "assurance_feedback"("firm_id");

-- CreateIndex
CREATE INDEX "client_chart_of_accounts_client_id_idx" ON "client_chart_of_accounts"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_chart_of_accounts_client_id_account_code_key" ON "client_chart_of_accounts"("client_id", "account_code");

-- CreateIndex
CREATE INDEX "bank_audit_sessions_user_id_idx" ON "bank_audit_sessions"("user_id");

-- CreateIndex
CREATE INDEX "bank_audit_sessions_client_id_idx" ON "bank_audit_sessions"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_audit_sessions_client_id_period_id_user_id_key" ON "bank_audit_sessions"("client_id", "period_id", "user_id");

-- CreateIndex
CREATE INDEX "bank_audit_tests_session_id_idx" ON "bank_audit_tests"("session_id");

-- CreateIndex
CREATE INDEX "bank_audit_files_session_id_idx" ON "bank_audit_files"("session_id");

-- CreateIndex
CREATE INDEX "fs_assertion_mappings_client_id_period_id_idx" ON "fs_assertion_mappings"("client_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "fs_assertion_mappings_client_id_period_id_mapping_type_row__key" ON "fs_assertion_mappings"("client_id", "period_id", "mapping_type", "row_key");

-- CreateIndex
CREATE INDEX "audit_engagements_firm_id_idx" ON "audit_engagements"("firm_id");

-- CreateIndex
CREATE INDEX "audit_engagements_created_by_id_idx" ON "audit_engagements"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_engagements_client_id_period_id_audit_type_key" ON "audit_engagements"("client_id", "period_id", "audit_type");

-- CreateIndex
CREATE INDEX "audit_team_members_engagement_id_idx" ON "audit_team_members"("engagement_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_team_members_engagement_id_user_id_key" ON "audit_team_members"("engagement_id", "user_id");

-- CreateIndex
CREATE INDEX "audit_specialists_engagement_id_idx" ON "audit_specialists"("engagement_id");

-- CreateIndex
CREATE INDEX "audit_client_contacts_engagement_id_idx" ON "audit_client_contacts"("engagement_id");

-- CreateIndex
CREATE INDEX "audit_agreed_dates_engagement_id_idx" ON "audit_agreed_dates"("engagement_id");

-- CreateIndex
CREATE INDEX "audit_information_requests_engagement_id_idx" ON "audit_information_requests"("engagement_id");

-- CreateIndex
CREATE INDEX "client_intelligence_client_id_idx" ON "client_intelligence"("client_id");

-- CreateIndex
CREATE INDEX "client_intelligence_firm_id_idx" ON "client_intelligence"("firm_id");

-- CreateIndex
CREATE INDEX "client_intelligence_reviews_intelligence_id_idx" ON "client_intelligence_reviews"("intelligence_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_intelligence_reviews_intelligence_id_user_id_key" ON "client_intelligence_reviews"("intelligence_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_permanent_files_engagement_id_section_key_key" ON "audit_permanent_files"("engagement_id", "section_key");

-- CreateIndex
CREATE UNIQUE INDEX "audit_ethics_engagement_id_key" ON "audit_ethics"("engagement_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_continuance_engagement_id_key" ON "audit_continuance"("engagement_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_new_client_take_on_engagement_id_key" ON "audit_new_client_take_on"("engagement_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_materiality_engagement_id_key" ON "audit_materiality"("engagement_id");

-- CreateIndex
CREATE INDEX "audit_par_rows_engagement_id_idx" ON "audit_par_rows"("engagement_id");

-- CreateIndex
CREATE INDEX "audit_rmm_rows_engagement_id_idx" ON "audit_rmm_rows"("engagement_id");

-- CreateIndex
CREATE INDEX "audit_documents_engagement_id_idx" ON "audit_documents"("engagement_id");

-- CreateIndex
CREATE INDEX "audit_tb_rows_engagement_id_idx" ON "audit_tb_rows"("engagement_id");

-- CreateIndex
CREATE INDEX "methodology_configs_firm_id_idx" ON "methodology_configs"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_configs_firm_id_audit_type_version_key" ON "methodology_configs"("firm_id", "audit_type", "version");

-- CreateIndex
CREATE INDEX "methodology_templates_firm_id_idx" ON "methodology_templates"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_templates_firm_id_template_type_audit_type_key" ON "methodology_templates"("firm_id", "template_type", "audit_type");

-- CreateIndex
CREATE INDEX "methodology_industries_firm_id_idx" ON "methodology_industries"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_industries_firm_id_code_key" ON "methodology_industries"("firm_id", "code");

-- CreateIndex
CREATE INDEX "methodology_test_types_firm_id_idx" ON "methodology_test_types"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_test_types_firm_id_code_key" ON "methodology_test_types"("firm_id", "code");

-- CreateIndex
CREATE INDEX "methodology_test_banks_firm_id_idx" ON "methodology_test_banks"("firm_id");

-- CreateIndex
CREATE INDEX "methodology_test_banks_industry_id_idx" ON "methodology_test_banks"("industry_id");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_test_banks_firm_id_industry_id_fs_line_key" ON "methodology_test_banks"("firm_id", "industry_id", "fs_line");

-- CreateIndex
CREATE INDEX "methodology_fs_lines_firm_id_idx" ON "methodology_fs_lines"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_fs_lines_firm_id_name_key" ON "methodology_fs_lines"("firm_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_fs_line_industries_fs_line_id_industry_id_key" ON "methodology_fs_line_industries"("fs_line_id", "industry_id");

-- CreateIndex
CREATE INDEX "methodology_tool_settings_firm_id_idx" ON "methodology_tool_settings"("firm_id");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_tool_settings_firm_id_tool_name_method_name_aud_key" ON "methodology_tool_settings"("firm_id", "tool_name", "method_name", "audit_type");

-- CreateIndex
CREATE UNIQUE INDEX "methodology_risk_tables_firm_id_table_type_key" ON "methodology_risk_tables"("firm_id", "table_type");

-- CreateIndex
CREATE UNIQUE INDEX "resource_staff_settings_user_id_key" ON "resource_staff_settings"("user_id");

-- CreateIndex
CREATE INDEX "resource_staff_settings_firm_id_idx" ON "resource_staff_settings"("firm_id");

-- CreateIndex
CREATE INDEX "resource_allocations_firm_id_idx" ON "resource_allocations"("firm_id");

-- CreateIndex
CREATE INDEX "resource_allocations_user_id_start_date_end_date_idx" ON "resource_allocations"("user_id", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "resource_allocations_engagement_id_idx" ON "resource_allocations"("engagement_id");

-- CreateIndex
CREATE INDEX "resource_jobs_firm_id_idx" ON "resource_jobs"("firm_id");

-- AddForeignKey
ALTER TABLE "firms" ADD CONSTRAINT "firms_ethics_partner_id_fkey" FOREIGN KEY ("ethics_partner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_portfolio_manager_id_fkey" FOREIGN KEY ("portfolio_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_api_keys" ADD CONSTRAINT "client_api_keys_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_purchased_by_id_fkey" FOREIGN KEY ("purchased_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor_codes" ADD CONSTRAINT "two_factor_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xero_auth_requests" ADD CONSTRAINT "xero_auth_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_connections" ADD CONSTRAINT "accounting_connections_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_files" ADD CONSTRAINT "extraction_files_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "extraction_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_files" ADD CONSTRAINT "extraction_files_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "extraction_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_records" ADD CONSTRAINT "extracted_records_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "extraction_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extracted_records" ADD CONSTRAINT "extracted_records_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "extraction_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_summary_jobs" ADD CONSTRAINT "doc_summary_jobs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_summary_jobs" ADD CONSTRAINT "doc_summary_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_summary_files" ADD CONSTRAINT "doc_summary_files_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "doc_summary_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_summary_findings" ADD CONSTRAINT "doc_summary_findings_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "doc_summary_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_summary_findings" ADD CONSTRAINT "doc_summary_findings_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "doc_summary_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_summary_qa" ADD CONSTRAINT "doc_summary_qa_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "doc_summary_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_summary_qa" ADD CONSTRAINT "doc_summary_qa_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "doc_summary_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_periods" ADD CONSTRAINT "client_periods_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_product_assignments" ADD CONSTRAINT "period_product_assignments_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "client_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period_product_assignments" ADD CONSTRAINT "period_product_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_sampling_configs" ADD CONSTRAINT "firm_sampling_configs_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_engagements" ADD CONSTRAINT "sampling_engagements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_engagements" ADD CONSTRAINT "sampling_engagements_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "client_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_engagements" ADD CONSTRAINT "sampling_engagements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_engagements" ADD CONSTRAINT "sampling_engagements_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_audit_data" ADD CONSTRAINT "sampling_audit_data_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "sampling_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_populations" ADD CONSTRAINT "sampling_populations_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "sampling_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_runs" ADD CONSTRAINT "sampling_runs_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "sampling_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_runs" ADD CONSTRAINT "sampling_runs_population_id_fkey" FOREIGN KEY ("population_id") REFERENCES "sampling_populations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_runs" ADD CONSTRAINT "sampling_runs_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "sampling_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_items" ADD CONSTRAINT "sampling_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sampling_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_items" ADD CONSTRAINT "sampling_items_stratum_id_fkey" FOREIGN KEY ("stratum_id") REFERENCES "sampling_strata"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_strata" ADD CONSTRAINT "sampling_strata_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sampling_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_judgement_chat" ADD CONSTRAINT "sampling_judgement_chat_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sampling_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_reviews" ADD CONSTRAINT "sampling_reviews_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sampling_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_reviews" ADD CONSTRAINT "sampling_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sampling_export_artifacts" ADD CONSTRAINT "sampling_export_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sampling_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_users" ADD CONSTRAINT "client_portal_users_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_portal_two_factor" ADD CONSTRAINT "client_portal_two_factor_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "client_portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_evidence_requests" ADD CONSTRAINT "audit_evidence_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "sampling_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_evidence_requests" ADD CONSTRAINT "audit_evidence_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_evidence_requests" ADD CONSTRAINT "audit_evidence_requests_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "client_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_evidence_requests" ADD CONSTRAINT "audit_evidence_requests_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_uploads" ADD CONSTRAINT "evidence_uploads_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "audit_evidence_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_uploads" ADD CONSTRAINT "evidence_uploads_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "client_portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_chats" ADD CONSTRAINT "assurance_chats_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_chats" ADD CONSTRAINT "assurance_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_chats" ADD CONSTRAINT "assurance_chats_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_chat_messages" ADD CONSTRAINT "assurance_chat_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "assurance_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_engagements" ADD CONSTRAINT "assurance_engagements_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "assurance_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_engagements" ADD CONSTRAINT "assurance_engagements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_engagements" ADD CONSTRAINT "assurance_engagements_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_engagements" ADD CONSTRAINT "assurance_engagements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_documents" ADD CONSTRAINT "assurance_documents_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "assurance_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_reports" ADD CONSTRAINT "assurance_reports_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "assurance_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_scores" ADD CONSTRAINT "assurance_scores_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "assurance_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_scores" ADD CONSTRAINT "assurance_scores_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_chats" ADD CONSTRAINT "risk_chats_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_chats" ADD CONSTRAINT "risk_chats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_chats" ADD CONSTRAINT "risk_chats_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_chat_messages" ADD CONSTRAINT "risk_chat_messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "risk_chats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_chart_of_accounts" ADD CONSTRAINT "firm_chart_of_accounts_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_code_mappings" ADD CONSTRAINT "account_code_mappings_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_to_tb_sessions" ADD CONSTRAINT "bank_to_tb_sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_to_tb_sessions" ADD CONSTRAINT "bank_to_tb_sessions_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "client_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_to_tb_sessions" ADD CONSTRAINT "bank_to_tb_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_to_tb_files" ADD CONSTRAINT "bank_to_tb_files_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "bank_to_tb_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "bank_to_tb_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "bank_to_tb_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "bank_to_tb_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trial_balance_entries" ADD CONSTRAINT "trial_balance_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "bank_to_tb_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_to_tb_journals" ADD CONSTRAINT "bank_to_tb_journals_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "bank_to_tb_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_to_tb_journal_lines" ADD CONSTRAINT "bank_to_tb_journal_lines_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "bank_to_tb_journals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_sessions" ADD CONSTRAINT "tool_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ia_feedback_users" ADD CONSTRAINT "ia_feedback_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ia_feedback_users" ADD CONSTRAINT "ia_feedback_users_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_feedback" ADD CONSTRAINT "assurance_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_chart_of_accounts" ADD CONSTRAINT "client_chart_of_accounts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_audit_sessions" ADD CONSTRAINT "bank_audit_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_audit_sessions" ADD CONSTRAINT "bank_audit_sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_audit_sessions" ADD CONSTRAINT "bank_audit_sessions_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "client_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_audit_tests" ADD CONSTRAINT "bank_audit_tests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "bank_audit_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_audit_files" ADD CONSTRAINT "bank_audit_files_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "bank_audit_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fs_assertion_mappings" ADD CONSTRAINT "fs_assertion_mappings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fs_assertion_mappings" ADD CONSTRAINT "fs_assertion_mappings_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "client_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_engagements" ADD CONSTRAINT "audit_engagements_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_engagements" ADD CONSTRAINT "audit_engagements_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "client_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_engagements" ADD CONSTRAINT "audit_engagements_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_engagements" ADD CONSTRAINT "audit_engagements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_engagements" ADD CONSTRAINT "audit_engagements_methodology_version_id_fkey" FOREIGN KEY ("methodology_version_id") REFERENCES "methodology_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_team_members" ADD CONSTRAINT "audit_team_members_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_team_members" ADD CONSTRAINT "audit_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_specialists" ADD CONSTRAINT "audit_specialists_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_client_contacts" ADD CONSTRAINT "audit_client_contacts_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_agreed_dates" ADD CONSTRAINT "audit_agreed_dates_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_information_requests" ADD CONSTRAINT "audit_information_requests_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_intelligence" ADD CONSTRAINT "client_intelligence_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_intelligence" ADD CONSTRAINT "client_intelligence_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_intelligence_reviews" ADD CONSTRAINT "client_intelligence_reviews_intelligence_id_fkey" FOREIGN KEY ("intelligence_id") REFERENCES "client_intelligence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_intelligence_reviews" ADD CONSTRAINT "client_intelligence_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_permanent_files" ADD CONSTRAINT "audit_permanent_files_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_ethics" ADD CONSTRAINT "audit_ethics_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_continuance" ADD CONSTRAINT "audit_continuance_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_new_client_take_on" ADD CONSTRAINT "audit_new_client_take_on_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_materiality" ADD CONSTRAINT "audit_materiality_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_par_rows" ADD CONSTRAINT "audit_par_rows_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_rmm_rows" ADD CONSTRAINT "audit_rmm_rows_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_documents" ADD CONSTRAINT "audit_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_tb_rows" ADD CONSTRAINT "audit_tb_rows_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_configs" ADD CONSTRAINT "methodology_configs_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_configs" ADD CONSTRAINT "methodology_configs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_templates" ADD CONSTRAINT "methodology_templates_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_industries" ADD CONSTRAINT "methodology_industries_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_test_types" ADD CONSTRAINT "methodology_test_types_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_test_banks" ADD CONSTRAINT "methodology_test_banks_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_test_banks" ADD CONSTRAINT "methodology_test_banks_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "methodology_industries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_fs_lines" ADD CONSTRAINT "methodology_fs_lines_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_fs_line_industries" ADD CONSTRAINT "methodology_fs_line_industries_fs_line_id_fkey" FOREIGN KEY ("fs_line_id") REFERENCES "methodology_fs_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_fs_line_industries" ADD CONSTRAINT "methodology_fs_line_industries_industry_id_fkey" FOREIGN KEY ("industry_id") REFERENCES "methodology_industries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_tool_settings" ADD CONSTRAINT "methodology_tool_settings_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "methodology_risk_tables" ADD CONSTRAINT "methodology_risk_tables_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_staff_settings" ADD CONSTRAINT "resource_staff_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_staff_settings" ADD CONSTRAINT "resource_staff_settings_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_engagement_id_fkey" FOREIGN KEY ("engagement_id") REFERENCES "audit_engagements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_allocations" ADD CONSTRAINT "resource_allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_jobs" ADD CONSTRAINT "resource_jobs_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_jobs" ADD CONSTRAINT "resource_jobs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

