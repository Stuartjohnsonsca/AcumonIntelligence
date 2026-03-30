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

-- CreateIndex
CREATE INDEX "ai_usage_client_id_idx" ON "ai_usage"("client_id");

-- CreateIndex
CREATE INDEX "ai_usage_client_id_created_at_idx" ON "ai_usage"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_user_id_idx" ON "ai_usage"("user_id");

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
