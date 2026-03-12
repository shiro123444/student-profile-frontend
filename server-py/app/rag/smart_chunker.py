"""Semantic-aware chunking based on document structure."""

from __future__ import annotations

from dataclasses import dataclass

from app.rag.vision_extractor import StructuredElement


@dataclass
class SmartChunk:
    """A semantically meaningful chunk ready for embedding."""

    content: str
    chunk_index: int
    page_number: int
    chunk_type: str  # "section" | "table" | "text" | "mixed"
    heading: str | None = None


def smart_chunk(
    elements: list[StructuredElement],
    max_chars: int = 400,
) -> list[SmartChunk]:
    """Split structured elements into semantic chunks.

    Strategy:
    1. Section-header starts a new chunk
    2. Table/List elements become standalone chunks
    3. Consecutive Text elements merge until max_chars, split at element boundaries
    4. Each chunk is prefixed with its parent heading for retrieval context

    Note: max_chars defaults to 400 to stay within NVIDIA nv-embedqa-e5-v5's
    512 token limit (Chinese text ≈ 1 char → 1-2 tokens).
    """
    chunks: list[SmartChunk] = []
    idx = 0
    current_heading: str | None = None

    # Accumulator for merging consecutive text elements
    text_buf: list[str] = []
    text_page: int = 0
    buf_chars: int = 0

    def _flush_text_buf() -> None:
        nonlocal text_buf, buf_chars, idx
        if not text_buf:
            return
        body = "\n\n".join(text_buf)
        if current_heading:
            body = f"## {current_heading}\n\n{body}"
        chunks.append(
            SmartChunk(
                content=body,
                chunk_index=idx,
                page_number=text_page,
                chunk_type="section" if current_heading else "text",
                heading=current_heading,
            )
        )
        idx += 1
        text_buf.clear()
        buf_chars = 0

    for elem in elements:
        etype = elem.element_type

        if etype == "Section-header":
            # Flush accumulated text before starting new section
            _flush_text_buf()
            current_heading = elem.text
            continue

        if etype in ("Table", "List"):
            # Flush any pending text first
            _flush_text_buf()
            # Table/List as standalone chunk
            content = elem.text
            if current_heading:
                content = f"## {current_heading}\n\n{content}"
            chunks.append(
                SmartChunk(
                    content=content,
                    chunk_index=idx,
                    page_number=elem.page_number,
                    chunk_type="table" if etype == "Table" else "text",
                    heading=current_heading,
                )
            )
            idx += 1
            continue

        # Text / Caption / other → accumulate
        elem_len = len(elem.text)

        # Would exceed max_chars? Flush first.
        if buf_chars > 0 and buf_chars + elem_len + 2 > max_chars:
            _flush_text_buf()

        if not text_buf:
            text_page = elem.page_number

        text_buf.append(elem.text)
        buf_chars += elem_len + 2  # +2 for "\n\n" join

    # Flush remaining
    _flush_text_buf()

    return chunks
