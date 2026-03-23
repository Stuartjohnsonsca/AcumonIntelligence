-- AlterTable
ALTER TABLE "firms" ADD COLUMN     "taxonomy_endpoint_url" TEXT,
ADD COLUMN     "taxonomy_source_type" TEXT;

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

-- AddForeignKey
ALTER TABLE "ia_feedback_users" ADD CONSTRAINT "ia_feedback_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ia_feedback_users" ADD CONSTRAINT "ia_feedback_users_firm_id_fkey" FOREIGN KEY ("firm_id") REFERENCES "firms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_feedback" ADD CONSTRAINT "assurance_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

