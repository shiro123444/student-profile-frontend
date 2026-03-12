"""PDF text extraction using pypdf."""

from __future__ import annotations

from dataclasses import dataclass

from pypdf import PdfReader


@dataclass
class PageText:
    """Extracted text from a single PDF page."""

    page_number: int
    text: str


def extract_pdf(file_path: str) -> list[PageText]:
    """Extract text from each page of a PDF file."""
    reader = PdfReader(file_path)
    pages: list[PageText] = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        text = text.strip()
        if text:
            pages.append(PageText(page_number=i + 1, text=text))
    return pages
