"""NVIDIA NIM embedding client."""

from __future__ import annotations

import httpx

from app.config import settings
from app.services.cache_service import get_cache_service

# Conservative default for mixed embedding models.
MAX_CHARS_PER_CHUNK = 450


def _truncate(text: str, max_chars: int = MAX_CHARS_PER_CHUNK) -> str:
    """Truncate text to fit within the model's token limit."""
    if len(text) <= max_chars:
        return text
    # Try to break at a sentence/paragraph boundary
    truncated = text[:max_chars]
    for sep in ("\n\n", "\n", "。", ".", " "):
        idx = truncated.rfind(sep)
        if idx > max_chars // 2:
            return truncated[: idx + len(sep)]
    return truncated


class EmbeddingClient:
    """Calls NVIDIA NIM /embeddings endpoint for text vectorization.

    Supports multiple models:
    - nv-embedqa-e5-v5 (1024 dims) — documents/text
    - nv-embedcode-7b-v1 (4096 dims) — code
    """

    def __init__(self, model: str | None = None, max_chars: int = MAX_CHARS_PER_CHUNK) -> None:
        self.base_url = settings.nvidia_base_url
        self.model = model or settings.nvidia_embed_model
        self.api_key = settings.nvidia_api_key or settings.openai_api_key
        self.cache = get_cache_service()
        self.max_chars = max(64, int(max_chars))

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Batch embed texts. Truncates long texts and splits into batches of 96."""
        truncated = [_truncate(t, self.max_chars) for t in texts]
        all_embeddings: list[list[float] | None] = [None] * len(truncated)
        missing_indices: list[int] = []

        for idx, text in enumerate(truncated):
            cached = await self.cache.get_embedding(
                model=self.model,
                input_type="passage",
                text=text,
            )
            if cached is not None:
                all_embeddings[idx] = cached
            else:
                missing_indices.append(idx)

        batch_size = 96
        if missing_indices:
            async with httpx.AsyncClient(timeout=30) as client:
                for offset in range(0, len(missing_indices), batch_size):
                    batch_indices = missing_indices[offset : offset + batch_size]
                    batch = [truncated[i] for i in batch_indices]

                    resp = await client.post(
                        f"{self.base_url}/embeddings",
                        headers={
                            "Authorization": f"Bearer {self.api_key}",
                            "Content-Type": "application/json",
                        },
                        json={
                            "model": self.model,
                            "input": batch,
                            "input_type": "passage",
                            "encoding_format": "float",
                        },
                    )
                    resp.raise_for_status()
                    data = resp.json()
                    batch_embeddings = [item["embedding"] for item in data["data"]]

                    for local_idx, embedding in enumerate(batch_embeddings):
                        original_idx = batch_indices[local_idx]
                        original_text = truncated[original_idx]
                        all_embeddings[original_idx] = embedding
                        await self.cache.set_embedding(
                            model=self.model,
                            input_type="passage",
                            text=original_text,
                            embedding=embedding,
                        )

        if any(e is None for e in all_embeddings):
            raise RuntimeError("embedding batch incomplete")
        return [e for e in all_embeddings if e is not None]

    async def embed_query(self, text: str) -> list[float]:
        """Embed a single query text."""
        truncated = _truncate(text, self.max_chars)

        cached = await self.cache.get_embedding(
            model=self.model,
            input_type="query",
            text=truncated,
        )
        if cached is not None:
            return cached

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self.base_url}/embeddings",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "input": [truncated],
                    "input_type": "query",
                    "encoding_format": "float",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            embedding = data["data"][0]["embedding"]

        await self.cache.set_embedding(
            model=self.model,
            input_type="query",
            text=truncated,
            embedding=embedding,
        )
        return embedding
