"""HuggingFace FIM Engine — lightweight engine for inline code completion.

Uses HuggingFace Serverless Inference API with native FIM tokens.
Only supports streaming text generation (no tools, no chat).
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_STOP_TOKENS = [
    "<|endoftext|>",
    "<|fim_prefix|>",
    "<|fim_suffix|>",
    "<|fim_middle|>",
    "<|fim_pad|>",
    "<|file_separator|>",
    "\n\n\n",
]


async def hf_fim_stream(prompt: str) -> AsyncIterator[str]:
    """Stream FIM completion from HuggingFace Serverless API.

    *prompt* must already contain FIM tokens
    (<|fim_prefix|>, <|fim_suffix|>, <|fim_middle|>).

    Yields SSE-formatted JSON events compatible with the
    frontend's existing parser.
    """
    api_key = settings.hf_api_key
    base_url = settings.hf_base_url.rstrip("/")
    model = settings.hf_fim_model
    url = f"{base_url}/{model}"

    if not api_key:
        yield _text_event("[HF API key not configured]")
        yield _done_event()
        return

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": 128,
            "temperature": 0.1,
            "stop": _STOP_TOKENS,
            "return_full_text": False,
        },
        "stream": True,
    }

    t0 = time.monotonic()
    text_buf = ""

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(15.0)
        ) as client:
            async with client.stream(
                "POST", url, json=body, headers=headers,
            ) as resp:
                if resp.status_code != 200:
                    err = await resp.aread()
                    logger.warning(
                        "[hf-fim] HTTP %s: %s",
                        resp.status_code,
                        err[:300],
                    )
                    yield _text_event(
                        f"[HF API error {resp.status_code}]"
                    )
                    yield _done_event()
                    return

                async for raw_line in resp.aiter_lines():
                    line = raw_line.strip()
                    if not line:
                        continue

                    # HF streaming: "data: {...}" lines
                    if line.startswith("data:"):
                        data_str = line[5:].strip()
                        if not data_str:
                            continue
                        try:
                            chunk = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        token = ""
                        # Format: {"token": {"text": "..."}}
                        if "token" in chunk:
                            token = chunk["token"].get(
                                "text", ""
                            )
                        elif "generated_text" in chunk:
                            token = chunk["generated_text"]

                        if not token:
                            continue

                        # Stop on special tokens
                        if any(
                            st in token for st in _STOP_TOKENS
                        ):
                            break

                        text_buf += token
                        yield _text_event(token)

        ttfb = time.monotonic() - t0
        logger.info(
            "[hf-fim] model=%s len=%d ttfb=%.2fs",
            model,
            len(text_buf),
            ttfb,
        )

    except httpx.ConnectError as exc:
        logger.warning("[hf-fim] connect error: %s", exc)
        yield _text_event("[HF connection error]")
    except httpx.ReadTimeout:
        logger.warning("[hf-fim] read timeout")
        yield _text_event("[HF timeout]")
    except Exception as exc:
        logger.warning("[hf-fim] unexpected: %s", exc)
        yield _text_event(f"[HF error: {exc}]")

    yield _done_event()


def _text_event(content: str) -> str:
    return (
        "data: "
        + json.dumps(
            {"type": "text", "content": content},
            ensure_ascii=False,
        )
        + "\n"
    )


def _done_event() -> str:
    return "data: [DONE]\n"
