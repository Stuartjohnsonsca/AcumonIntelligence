-- CreateTable
CREATE TABLE "portal_requests" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "engagement_id" TEXT,
    "section" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "response" TEXT,
    "status" TEXT NOT NULL DEFAULT 'outstanding',
    "requested_by_id" TEXT NOT NULL,
    "requested_by_name" TEXT NOT NULL,
    "responded_by_id" TEXT,
    "responded_by_name" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "portal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_requests_client_id_idx" ON "portal_requests"("client_id");
CREATE INDEX "portal_requests_client_id_status_idx" ON "portal_requests"("client_id", "status");
CREATE INDEX "portal_requests_engagement_id_idx" ON "portal_requests"("engagement_id");

-- AddForeignKey
ALTER TABLE "portal_requests" ADD CONSTRAINT "portal_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
