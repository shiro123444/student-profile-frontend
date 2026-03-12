"""Note embedding API routes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel

router = APIRouter()
logger = logging.getLogger(__name__)


class EmbedNoteRequest(BaseModel):
    note_id: str
    student_id: str
    title: str = ""
    content: str = ""
    tags: list[str] = []


class ReindexRequest(BaseModel):
    student_id: str


@router.post("/embed")
async def embed_note(req: EmbedNoteRequest, bg: BackgroundTasks):
    """Embed a single note (called by Go backend after create/update)."""
    from app.services.note_embedding import NoteEmbeddingService

    svc = NoteEmbeddingService()

    async def _do():
        try:
            await svc.embed_note(req.note_id, req.student_id, req.title, req.content, req.tags)
        except Exception:
            logger.exception("Background embed failed for note %s", req.note_id)

    bg.add_task(_do)
    return {"status": "accepted", "note_id": req.note_id}


@router.delete("/embed/{note_id}")
async def delete_note_embedding(note_id: str):
    """Delete embeddings for a note (called by Go backend after delete)."""
    from app.services.note_embedding import NoteEmbeddingService

    svc = NoteEmbeddingService()
    result = await svc.delete_note_embedding(note_id)
    return result


@router.post("/reindex")
async def reindex_student_notes(req: ReindexRequest, bg: BackgroundTasks):
    """Reindex all notes for a student (batch migration)."""
    from app.services.note_embedding import NoteEmbeddingService

    svc = NoteEmbeddingService()

    async def _do():
        try:
            result = await svc.reindex_student_notes(req.student_id)
            logger.info("Reindex complete: %s", result)
        except Exception:
            logger.exception("Reindex failed for student %s", req.student_id)

    bg.add_task(_do)
    return {"status": "accepted", "student_id": req.student_id}
