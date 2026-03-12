"""Vision-based PDF extraction with multi-provider support.

Providers:
  - nemoretriever-parse: NVIDIA structured OCR (tool_calls → bbox + type)
  - kimi-k2.5: Moonshot VLM, strong Chinese OCR (returns markdown)
  - nemotron-parse: NVIDIA next-gen parser
  - Any OpenAI-compatible VLM on NVIDIA NIM
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from dataclasses import dataclass, field

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

SKIP_TYPES = {"Page-header", "Page-footer"}

# Models that return structured tool_calls (markdown_bbox)
STRUCTURED_MODELS = {"nvidia/nemoretriever-parse", "nvidia/nemotron-parse"}

# System prompt for VLM models to produce structured markdown
VLM_SYSTEM_PROMPT = (
    "你是一个精确的文档 OCR 助手。请将图片中的内容完整转录为结构化 Markdown。"
    "规则：1) 用 ## 标记章节标题 2) 用 | 表格语法还原表格 "
    "3) 用 $...$ 包裹公式 4) 图注用 > 引用块 "
    "5) 列表用 - 或 1. 6) 保持原文语言，不要翻译或总结。"
)


@dataclass
class StructuredElement:
    """A single semantic element extracted from a PDF page."""

    text: str
    element_type: str  # Section-header / Text / Table / List / Caption / ...
    page_number: int
    bbox: dict | None = field(default=None, repr=False)


class VisionExtractor:
    """PDF → PNG (PyMuPDF) → Vision model → StructuredElement list.

    Supports multiple vision providers via NVIDIA NIM endpoint.
    """

    def __init__(self, model: str | None = None) -> None:
        self.api_key = settings.nvidia_api_key or settings.openai_api_key
        self.base_url = settings.nvidia_base_url.rstrip("/")
        self.model = model or settings.nvidia_vision_model
        self.dpi = settings.vision_extract_dpi
        self.max_concurrent = settings.vision_max_concurrent
        self._is_structured = self.model in STRUCTURED_MODELS

    async def extract(self, file_path: str) -> list[StructuredElement]:
        """Extract structured elements from all pages of a PDF."""
        images = self._render_pages(file_path)
        if not images:
            return []

        semaphore = asyncio.Semaphore(self.max_concurrent)
        tasks = [
            self._extract_page(img_b64, page_num, semaphore)
            for page_num, img_b64 in images
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        elements: list[StructuredElement] = []
        for result in results:
            if isinstance(result, Exception):
                logger.warning("Vision extraction failed for a page: %s", result)
                continue
            elements.extend(result)

        return elements

    def _render_pages(self, file_path: str) -> list[tuple[int, str]]:
        """Render each PDF page to base64 PNG using PyMuPDF."""
        try:
            import fitz  # PyMuPDF
        except ImportError:
            logger.error("PyMuPDF not installed. Run: pip install pymupdf")
            return []

        pages: list[tuple[int, str]] = []
        try:
            doc = fitz.open(file_path)
            zoom = self.dpi / 72.0
            matrix = fitz.Matrix(zoom, zoom)

            for i, page in enumerate(doc):
                pix = page.get_pixmap(matrix=matrix)
                png_bytes = pix.tobytes("png")
                b64 = base64.b64encode(png_bytes).decode("ascii")
                pages.append((i + 1, b64))

            doc.close()
        except Exception:
            logger.exception("Failed to render PDF: %s", file_path)
            return []

        logger.info("Rendered %d pages from %s (DPI=%d)", len(pages), file_path, self.dpi)
        return pages

    async def _extract_page(
        self,
        img_b64: str,
        page_number: int,
        semaphore: asyncio.Semaphore,
    ) -> list[StructuredElement]:
        """Call vision model for a single page image."""
        async with semaphore:
            if self._is_structured:
                return await self._call_structured(img_b64, page_number)
            return await self._call_vlm(img_b64, page_number)

    async def _call_structured(
        self, img_b64: str, page_number: int
    ) -> list[StructuredElement]:
        """Call nemoretriever-parse / nemotron-parse (structured tool_calls)."""
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/png;base64,{img_b64}",
                                    },
                                }
                            ],
                        }
                    ],
                    "max_tokens": 2048,
                    "stream": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        return self._parse_structured_response(data, page_number)

    async def _call_vlm(
        self, img_b64: str, page_number: int
    ) -> list[StructuredElement]:
        """Call a general VLM (Phi-4, Llama-90b, etc.) that returns markdown."""
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": VLM_SYSTEM_PROMPT},
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/png;base64,{img_b64}",
                                    },
                                },
                                {
                                    "type": "text",
                                    "text": "请完整转录这一页的内容。",
                                },
                            ],
                        },
                    ],
                    "max_tokens": 4096,
                    "stream": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )
        if not content:
            return []

        return self._parse_markdown_to_elements(content, page_number)

    # ── Response parsers ──────────────────────────────────────────────

    def _parse_structured_response(
        self, data: dict, page_number: int
    ) -> list[StructuredElement]:
        """Parse nemoretriever-parse response (tool_calls → markdown_bbox)."""
        elements: list[StructuredElement] = []

        choice = data.get("choices", [{}])[0]
        message = choice.get("message", {})

        tool_calls = message.get("tool_calls", [])
        for tc in tool_calls:
            fn = tc.get("function", {})
            if fn.get("name") != "markdown_bbox":
                continue

            args_str = fn.get("arguments", "[]")
            try:
                parsed = json.loads(args_str)
            except json.JSONDecodeError:
                logger.warning("Failed to parse markdown_bbox arguments for page %d", page_number)
                continue

            items = parsed
            if items and isinstance(items[0], list):
                items = items[0]

            for item in items:
                if not isinstance(item, dict):
                    continue
                elem_type = item.get("type", "Text")
                text = (item.get("text") or "").strip()
                if not text or elem_type in SKIP_TYPES:
                    continue
                elements.append(
                    StructuredElement(
                        text=text,
                        element_type=elem_type,
                        page_number=page_number,
                        bbox=item.get("bbox"),
                    )
                )

        # Fallback: if no tool_calls, try plain content
        if not elements:
            content = (message.get("content") or "").strip()
            if content:
                elements.extend(self._parse_markdown_to_elements(content, page_number))

        return elements

    @staticmethod
    def _parse_markdown_to_elements(
        markdown: str, page_number: int
    ) -> list[StructuredElement]:
        """Parse markdown text into StructuredElements by detecting structure."""
        elements: list[StructuredElement] = []
        lines = markdown.split("\n")
        buf: list[str] = []
        current_type = "Text"

        def flush():
            text = "\n".join(buf).strip()
            if text:
                elements.append(
                    StructuredElement(
                        text=text, element_type=current_type, page_number=page_number
                    )
                )
            buf.clear()

        in_table = False
        in_formula = False

        for line in lines:
            stripped = line.strip()

            # Headings
            if re.match(r"^#{1,6}\s+", stripped):
                flush()
                current_type = "Section-header"
                buf.append(stripped)
                flush()
                current_type = "Text"
                continue

            # Table rows
            if "|" in stripped and stripped.startswith("|"):
                if not in_table:
                    flush()
                    current_type = "Table"
                    in_table = True
                buf.append(stripped)
                continue
            elif in_table:
                flush()
                in_table = False
                current_type = "Text"

            # Block formula ($$...$$)
            if stripped.startswith("$$"):
                if in_formula:
                    buf.append(stripped)
                    flush()
                    in_formula = False
                    current_type = "Text"
                else:
                    flush()
                    current_type = "Formula"
                    in_formula = True
                    buf.append(stripped)
                continue

            if in_formula:
                buf.append(stripped)
                continue

            # Blockquote (caption)
            if stripped.startswith(">"):
                flush()
                current_type = "Caption"
                buf.append(stripped.lstrip("> "))
                flush()
                current_type = "Text"
                continue

            # List items
            if re.match(r"^[-*]\s+", stripped) or re.match(r"^\d+\.\s+", stripped):
                if current_type != "List-item":
                    flush()
                    current_type = "List-item"
                buf.append(stripped)
                continue
            elif current_type == "List-item":
                flush()
                current_type = "Text"

            # Regular text
            if stripped:
                buf.append(stripped)
            elif buf:
                flush()

        flush()
        return elements
