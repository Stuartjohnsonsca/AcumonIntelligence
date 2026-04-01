-- Add chat history to portal requests for threaded conversations
ALTER TABLE "portal_requests" ADD COLUMN "chat_history" JSONB;
