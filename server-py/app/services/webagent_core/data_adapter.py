"""Data adapter contracts and default implementation for SDK boundary."""

from __future__ import annotations

from typing import Any, Mapping, Protocol, runtime_checkable

import httpx

from app.config import settings
from app.services.webagent_core.contracts import TenantContext


class DataAdapterError(RuntimeError):
    """Raised when data adapter request fails."""


@runtime_checkable
class DataAdapter(Protocol):
    """Stable data access abstraction for SDK portability."""

    async def get_json(
        self,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        tenant: TenantContext | None = None,
        timeout_s: float = 10.0,
    ) -> Any:
        ...

    async def post_json(
        self,
        path: str,
        *,
        payload: Any,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        tenant: TenantContext | None = None,
        timeout_s: float = 10.0,
    ) -> Any:
        ...

    async def put_json(
        self,
        path: str,
        *,
        payload: Any,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        tenant: TenantContext | None = None,
        timeout_s: float = 10.0,
    ) -> Any:
        ...


class HttpDataAdapter:
    """Default PathMind implementation backed by HTTP APIs."""

    def __init__(self, base_url: str | None = None):
        self._base_url = str(base_url or settings.go_backend_url).rstrip("/")

    async def get_json(
        self,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        tenant: TenantContext | None = None,
        timeout_s: float = 10.0,
    ) -> Any:
        return await self._request_json(
            "GET",
            path,
            params=params,
            headers=headers,
            tenant=tenant,
            timeout_s=timeout_s,
        )

    async def post_json(
        self,
        path: str,
        *,
        payload: Any,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        tenant: TenantContext | None = None,
        timeout_s: float = 10.0,
    ) -> Any:
        return await self._request_json(
            "POST",
            path,
            payload=payload,
            params=params,
            headers=headers,
            tenant=tenant,
            timeout_s=timeout_s,
        )

    async def put_json(
        self,
        path: str,
        *,
        payload: Any,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        tenant: TenantContext | None = None,
        timeout_s: float = 10.0,
    ) -> Any:
        return await self._request_json(
            "PUT",
            path,
            payload=payload,
            params=params,
            headers=headers,
            tenant=tenant,
            timeout_s=timeout_s,
        )

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        payload: Any | None = None,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        tenant: TenantContext | None = None,
        timeout_s: float = 10.0,
    ) -> Any:
        url = self._build_url(path)
        final_headers = self._build_headers(headers, tenant)

        try:
            async with httpx.AsyncClient(timeout=timeout_s) as client:
                response = await client.request(
                    method,
                    url,
                    params=dict(params or {}),
                    headers=final_headers,
                    json=payload,
                )
                response.raise_for_status()
                return response.json()
        except Exception as exc:
            raise DataAdapterError(f"{method} {url} failed: {exc}") from exc

    def _build_url(self, path: str) -> str:
        normalized = str(path or "").strip()
        if normalized.startswith("http://") or normalized.startswith("https://"):
            return normalized
        if not normalized.startswith("/"):
            normalized = f"/{normalized}"
        return f"{self._base_url}{normalized}"

    def _build_headers(
        self,
        headers: Mapping[str, str] | None,
        tenant: TenantContext | None,
    ) -> dict[str, str] | None:
        merged = dict(headers or {})
        if tenant:
            merged.setdefault("X-Tenant-ID", tenant.tenant_id)
            if tenant.user_id:
                merged.setdefault("X-User-ID", tenant.user_id)
            if tenant.student_id:
                merged.setdefault("X-Student-ID", tenant.student_id)
        return merged or None


_default_data_adapter: DataAdapter = HttpDataAdapter()


def get_data_adapter() -> DataAdapter:
    """Get process-wide data adapter instance."""
    return _default_data_adapter


def set_data_adapter(adapter: DataAdapter) -> None:
    """Override process-wide data adapter instance (for tests/SDK embedding)."""
    global _default_data_adapter
    _default_data_adapter = adapter


__all__ = [
    "DataAdapter",
    "DataAdapterError",
    "HttpDataAdapter",
    "get_data_adapter",
    "set_data_adapter",
]
