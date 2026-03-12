"""RAG pipeline routes - called by Go backend."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class RAGIngestRequest(BaseModel):
    """Request to ingest a document into the RAG pipeline."""

    document_id: str
    file_path: str
    metadata: dict | None = None


class RAGIngestResponse(BaseModel):
    """Response from document ingestion."""

    document_id: str
    chunks_created: int
    status: str


class RAGQueryRequest(BaseModel):
    """Request to query documents via RAG."""

    query: str
    course_id: str | None = None
    limit: int = 5
    uploaded_by: str | None = None


class RAGQueryResult(BaseModel):
    """A single RAG search result."""

    content: str
    document_id: str
    document_title: str
    page_number: int | None = None
    score: float


@router.post("/ingest", response_model=RAGIngestResponse)
async def ingest_document(request: RAGIngestRequest):
    """Ingest a document: extract text, chunk, embed, store in pgvector."""
    from app.services.rag_service import RAGService

    service = RAGService()
    result = await service.ingest(
        document_id=request.document_id,
        file_path=request.file_path,
        metadata=request.metadata,
    )
    return result


@router.post("/query", response_model=list[RAGQueryResult])
async def query_documents(request: RAGQueryRequest):
    """Query documents via semantic search."""
    from app.services.rag_service import RAGService

    service = RAGService()
    results = await service.query(
        query=request.query,
        course_id=request.course_id,
        limit=request.limit,
        uploaded_by=request.uploaded_by,
    )
    return results
