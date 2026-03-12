"""Minimal example: override DataAdapter and use WebAgent SDK contracts."""

from __future__ import annotations

from typing import Any, Mapping

from app.services.webagent_core import (
    DataAdapter,
    TenantContext,
    get_data_adapter,
    parse_tenant_context,
    set_data_adapter,
)


class DemoAdapter:
    """Example adapter for tests or external SDK embedding."""

    async def get_json(
        self,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        tenant: TenantContext | None = None,
        timeout_s: float = 10.0,
    ) -> Any:
        return {
            "path": path,
            "params": dict(params or {}),
            "tenant": tenant.tenant_id if tenant else "public",
            "source": "demo-adapter",
        }

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
        return {
            "path": path,
            "payload": payload,
            "tenant": tenant.tenant_id if tenant else "public",
            "source": "demo-adapter",
        }


async def run_demo() -> None:
    custom_adapter: DataAdapter = DemoAdapter()
    set_data_adapter(custom_adapter)

    tenant = parse_tenant_context(
        {"tenant_id": "demo-tenant", "role": "admin", "user_id": "u-001"},
        student_id="stu-001",
    )

    adapter = get_data_adapter()
    profile = await adapter.get_json("/students/stu-001/profile", tenant=tenant)
    print(profile)


if __name__ == "__main__":
    import asyncio

    asyncio.run(run_demo())
