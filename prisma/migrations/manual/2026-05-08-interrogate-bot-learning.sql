-- InterrogateBot learning + document RAG.
-- Idempotent so it's safe to re-run.

-- Phase 1: capture every Q&A interaction with reviewer rating + correction.
-- Phase 2 fields (question_embedding, embedding_model) created up-front
-- so we don't need a second migration when retrieval lands.
CREATE TABLE IF NOT EXISTS interrogate_interactions (
  id                   text PRIMARY KEY,
  firm_id              text NOT NULL,
  engagement_id        text NOT NULL REFERENCES audit_engagements(id) ON DELETE CASCADE,
  user_id              text NOT NULL,
  user_name            text,
  question             text NOT NULL,
  answer               text NOT NULL,
  sources              jsonb NOT NULL DEFAULT '[]'::jsonb,
  document_references  jsonb NOT NULL DEFAULT '[]'::jsonb,
  rating               text,
  correction           text,
  rating_at            timestamptz,
  rated_by_id          text,
  question_embedding   jsonb,
  embedding_model      text,
  ai_model             text,
  prompt_tokens        integer,
  completion_tokens    integer,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS interrogate_interactions_firm_idx
  ON interrogate_interactions(firm_id);
CREATE INDEX IF NOT EXISTS interrogate_interactions_engagement_idx
  ON interrogate_interactions(engagement_id);
CREATE INDEX IF NOT EXISTS interrogate_interactions_rating_idx
  ON interrogate_interactions(rating);
CREATE INDEX IF NOT EXISTS interrogate_interactions_user_idx
  ON interrogate_interactions(user_id);

-- Phase 3: AuditDocument content chunked + embedded for RAG.
CREATE TABLE IF NOT EXISTS document_chunks (
  id              text PRIMARY KEY,
  document_id     text NOT NULL REFERENCES audit_documents(id) ON DELETE CASCADE,
  chunk_index     integer NOT NULL,
  content         text NOT NULL,
  embedding       jsonb NOT NULL,
  embedding_model text NOT NULL,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS document_chunks_doc_idx_uniq
  ON document_chunks(document_id, chunk_index);
CREATE INDEX IF NOT EXISTS document_chunks_doc_idx
  ON document_chunks(document_id);
