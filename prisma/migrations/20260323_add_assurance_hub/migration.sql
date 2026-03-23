-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "sector" TEXT;

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

-- CreateIndex
CREATE INDEX "assurance_learnings_firm_id_idx" ON "assurance_learnings"("firm_id");

-- CreateIndex
CREATE INDEX "assurance_learnings_sector_sub_tool_idx" ON "assurance_learnings"("sector", "sub_tool");

-- CreateIndex
CREATE INDEX "assurance_learnings_pattern_type_idx" ON "assurance_learnings"("pattern_type");

