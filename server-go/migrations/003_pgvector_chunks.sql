-- pgvector extension + document_chunks table for RAG pipeline
-- Requires PostgreSQL 15+ with pgvector extension installed

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1024),
    page_number INTEGER,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dc_doc ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_dc_embed ON document_chunks USING hnsw (embedding vector_cosine_ops);
