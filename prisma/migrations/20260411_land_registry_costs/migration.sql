-- CreateTable
CREATE TABLE "land_registry_costs" (
    "id" TEXT NOT NULL,
    "firm_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "engagement_id" TEXT,
    "execution_id" TEXT,
    "user_id" TEXT NOT NULL,
    "api_name" TEXT NOT NULL,
    "title_number" TEXT,
    "property_address" TEXT,
    "document_type" TEXT,
    "document_path" TEXT,
    "cost_gbp" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "land_registry_costs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "land_registry_costs_firm_id_created_at_idx" ON "land_registry_costs"("firm_id", "created_at");

-- CreateIndex
CREATE INDEX "land_registry_costs_client_id_created_at_idx" ON "land_registry_costs"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "land_registry_costs_engagement_id_idx" ON "land_registry_costs"("engagement_id");

-- CreateIndex
CREATE INDEX "land_registry_costs_execution_id_idx" ON "land_registry_costs"("execution_id");
