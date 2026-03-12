"""Text chunking with overlap for RAG pipeline."""

from __future__ import annotations

from dataclasses import dataclass

from app.rag.extractor import PageText


@dataclass
class Chunk:
    """A text chunk ready for embedding."""

    content: str
    page_number: int
    chunk_index: int
    char_start: int
    char_end: int


def chunk_pages(
    pages: list[PageText],
    chunk_size: int = 400,
    overlap: int = 50,
) -> list[Chunk]:
    """Split page texts into overlapping chunks.

    Tries to break at paragraph boundaries to avoid mid-sentence splits.
    Note: chunk_size defaults to 400 to stay within NVIDIA nv-embedqa-e5-v5's
    512 token limit (Chinese text ≈ 1 char → 1-2 tokens).
    """
    chunks: list[Chunk] = []
    idx = 0

    for page in pages:
        text = page.text
        pos = 0
        while pos < len(text):
            end = min(pos + chunk_size, len(text))

            # Try to break at paragraph boundary
            if end < len(text):
                newline = text.rfind("\n", pos + chunk_size - overlap, end)
                if newline > pos:
                    end = newline + 1

            chunk_text = text[pos:end].strip()
            if chunk_text:
                chunks.append(
                    Chunk(
                        content=chunk_text,
                        page_number=page.page_number,
                        chunk_index=idx,
                        char_start=pos,
                        char_end=end,
                    )
                )
                idx += 1

            pos = end - overlap if end < len(text) else len(text)

    return chunks
