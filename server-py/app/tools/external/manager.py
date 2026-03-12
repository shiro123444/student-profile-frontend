"""External MCP manager.

Loads `mcp_servers.yaml` and exposes:
- external tool packages for ToolRegistry (metadata + placeholder handlers)
- Claude Agent SDK `mcp_servers` configs (stdio/sse/http)
- health diagnostics for configured external servers
"""

from __future__ import annotations

import logging
import os
import re
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from claude_agent_sdk import SdkMcpTool

from app.config import settings

logger = logging.getLogger(__name__)

_DEFAULT_ROLES = ["student", "teacher", "admin"]
_ENV_PATTERN = re.compile(r"\$\{([A-Z0-9_]+)\}")


@dataclass
class ExternalToolConfig:
    """Single tool declaration under an external MCP server."""

    local_name: str
    remote_name: str
    description: str = ""
    input_schema: dict[str, Any] = field(default_factory=dict)
    roles: list[str] = field(default_factory=lambda: list(_DEFAULT_ROLES))
    annotations: dict[str, Any] | None = None
    risk: str | None = None


@dataclass
class ExternalServerConfig:
    """External MCP server declaration loaded from YAML."""

    server_id: str
    type: str
    enabled: bool = True
    description: str = ""
    category: str = "external"
    command: str | None = None
    args: list[str] = field(default_factory=list)
    env: dict[str, str] = field(default_factory=dict)
    url: str | None = None
    headers: dict[str, str] = field(default_factory=dict)
    roles: list[str] = field(default_factory=lambda: list(_DEFAULT_ROLES))
    tools: list[ExternalToolConfig] = field(default_factory=list)


@dataclass
class ExternalRegistryPackage:
    """Intermediate package format consumed by ToolRegistry."""

    name: str
    manifest: dict[str, Any]
    tools: list[SdkMcpTool]
    mcp_refs: dict[str, str]
    source: str = "external"


class ExternalMcpManager:
    """Loads and serves external MCP integration metadata."""

    def __init__(self):
        self._enabled = bool(settings.external_mcp_enabled)
        self._config_path = Path(settings.external_mcp_config_path)
        self._servers: dict[str, ExternalServerConfig] = {}
        self._load_errors: list[str] = []
        self._loaded = False

    def set_runtime_config(self, enabled: bool, config_path: str | Path) -> None:
        self._enabled = bool(enabled)
        self._config_path = Path(config_path)
        self._loaded = False

    def reload(self, force: bool = False) -> None:
        """Load config file if needed."""
        if self._loaded and not force:
            return

        self._servers.clear()
        self._load_errors.clear()
        self._loaded = True

        if not self._enabled:
            logger.info("External MCP disabled")
            return

        cfg = self._config_path
        if not cfg.exists():
            msg = f"External MCP config not found: {cfg}"
            self._load_errors.append(msg)
            logger.warning(msg)
            return

        try:
            with cfg.open("r", encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
        except Exception as exc:
            msg = f"Failed to load external MCP config {cfg}: {exc}"
            self._load_errors.append(msg)
            logger.exception(msg)
            return

        servers_raw = raw.get("servers")
        if not isinstance(servers_raw, list):
            msg = f"Invalid external MCP config: 'servers' must be a list ({cfg})"
            self._load_errors.append(msg)
            logger.warning(msg)
            return

        for item in servers_raw:
            try:
                parsed = self._parse_server(item)
            except Exception as exc:
                msg = f"Invalid external MCP server entry: {exc}"
                self._load_errors.append(msg)
                logger.warning(msg)
                continue

            if not parsed.enabled:
                logger.info("External MCP server disabled: %s", parsed.server_id)
                continue
            self._servers[parsed.server_id] = parsed

        logger.info("External MCP loaded: %d servers", len(self._servers))

    def build_registry_packages(self) -> list[ExternalRegistryPackage]:
        """Convert external server config to ToolRegistry package entries."""
        self.reload()
        packages: list[ExternalRegistryPackage] = []

        for server in self._servers.values():
            if not server.tools:
                logger.info("External MCP server '%s' has no declared tools", server.server_id)
                continue

            tools: list[SdkMcpTool] = []
            mcp_refs: dict[str, str] = {}
            tool_overrides: dict[str, Any] = {}

            for t in server.tools:
                tools.append(self._build_proxy_tool(server, t))
                mcp_refs[t.local_name] = f"mcp__{server.server_id}__{t.remote_name}"
                override_payload: dict[str, Any] = {}
                if sorted(t.roles) != sorted(server.roles):
                    override_payload["roles"] = list(t.roles)
                if isinstance(t.risk, str) and t.risk:
                    override_payload["risk"] = t.risk
                if override_payload:
                    tool_overrides[t.local_name] = override_payload

            manifest = {
                "name": f"external-{server.server_id}",
                "version": "1.0.0",
                "description": server.description or f"External MCP server '{server.server_id}'",
                "category": server.category,
                "permissions": {
                    "roles": list(server.roles),
                    "tool_overrides": tool_overrides,
                },
                "external": {
                    "server_id": server.server_id,
                    "transport": server.type,
                },
            }

            packages.append(
                ExternalRegistryPackage(
                    name=manifest["name"],
                    manifest=manifest,
                    tools=tools,
                    mcp_refs=mcp_refs,
                    source="external",
                )
            )

        return packages

    def get_claude_mcp_servers(self) -> dict[str, dict[str, Any]]:
        """Return external `mcp_servers` mapping for ClaudeAgentOptions."""
        self.reload()
        result: dict[str, dict[str, Any]] = {}

        for server in self._servers.values():
            if server.type == "stdio":
                if not server.command:
                    logger.warning("External MCP stdio server '%s' missing command", server.server_id)
                    continue
                payload: dict[str, Any] = {
                    "type": "stdio",
                    "command": server.command,
                }
                if server.args:
                    payload["args"] = list(server.args)
                if server.env:
                    payload["env"] = dict(server.env)
                result[server.server_id] = payload
                continue

            if server.type in {"sse", "http"}:
                if not server.url:
                    logger.warning("External MCP %s server '%s' missing url", server.type, server.server_id)
                    continue
                payload = {
                    "type": server.type,
                    "url": server.url,
                }
                if server.headers:
                    payload["headers"] = dict(server.headers)
                result[server.server_id] = payload
                continue

            logger.warning("External MCP server '%s' uses unsupported type '%s'", server.server_id, server.type)

        return result

    def health(self) -> dict[str, Any]:
        """Diagnostics for tools health API."""
        self.reload()

        servers: list[dict[str, Any]] = []
        for server in self._servers.values():
            status = "ok"
            detail = "configured"

            if server.type == "stdio":
                if not server.command:
                    status = "invalid"
                    detail = "missing command"
                elif shutil.which(server.command) is None:
                    status = "warning"
                    detail = f"command not found in PATH: {server.command}"
            elif server.type in {"sse", "http"}:
                if not server.url:
                    status = "invalid"
                    detail = "missing url"

            servers.append(
                {
                    "id": server.server_id,
                    "type": server.type,
                    "enabled": server.enabled,
                    "tool_count": len(server.tools),
                    "status": status,
                    "detail": detail,
                }
            )

        return {
            "enabled": self._enabled,
            "config_path": str(self._config_path),
            "server_count": len(servers),
            "servers": servers,
            "errors": list(self._load_errors),
        }

    def _build_proxy_tool(self, server: ExternalServerConfig, tool_cfg: ExternalToolConfig) -> SdkMcpTool:
        """Build a real MCP client handler that dispatches to the external server."""
        from app.tools.external.mcp_client import (
            call_mcp_tool_http,
            call_mcp_tool_sse,
            call_mcp_tool_stdio,
        )

        server_id = server.server_id
        server_type = server.type
        remote_name = tool_cfg.remote_name

        if server_type == "stdio":
            command = server.command or ""
            args = list(server.args)
            env = dict(server.env)

            async def _stdio_handler(tool_args: dict[str, Any]) -> dict[str, Any]:
                logger.debug(
                    "MCP stdio dispatch: server=%s tool=%s", server_id, remote_name
                )
                return await call_mcp_tool_stdio(
                    command=command,
                    args=args,
                    env=env,
                    tool_name=remote_name,
                    tool_args=tool_args or {},
                )

            handler = _stdio_handler

        elif server_type == "sse":
            url = server.url or ""
            headers = dict(server.headers)

            async def _sse_handler(tool_args: dict[str, Any]) -> dict[str, Any]:
                logger.debug(
                    "MCP SSE dispatch: server=%s url=%s tool=%s", server_id, url, remote_name
                )
                return await call_mcp_tool_sse(
                    url=url,
                    headers=headers,
                    tool_name=remote_name,
                    tool_args=tool_args or {},
                )

            handler = _sse_handler

        else:  # http (streamable-HTTP, modern transport)
            url = server.url or ""
            headers = dict(server.headers)

            async def _http_handler(tool_args: dict[str, Any]) -> dict[str, Any]:
                logger.debug(
                    "MCP HTTP dispatch: server=%s url=%s tool=%s", server_id, url, remote_name
                )
                return await call_mcp_tool_http(
                    url=url,
                    headers=headers,
                    tool_name=remote_name,
                    tool_args=tool_args or {},
                )

            handler = _http_handler

        return SdkMcpTool(
            name=tool_cfg.local_name,
            description=tool_cfg.description
            or f"External MCP tool '{remote_name}' from server '{server_id}'",
            input_schema=tool_cfg.input_schema or {},
            handler=handler,
            annotations=tool_cfg.annotations,
        )

    def _parse_server(self, item: Any) -> ExternalServerConfig:
        if not isinstance(item, dict):
            raise ValueError("server entry must be object")

        server_id = str(item.get("id") or "").strip()
        if not server_id:
            raise ValueError("server.id is required")

        server_type = str(item.get("type") or "stdio").strip().lower()
        if server_type not in {"stdio", "sse", "http"}:
            raise ValueError(f"server '{server_id}' invalid type: {server_type}")

        enabled = bool(item.get("enabled", True))
        description = str(item.get("description") or "")
        category = str(item.get("category") or "external")
        roles = self._normalize_roles(item.get("roles"), default=_DEFAULT_ROLES)

        command, cmd_args = self._normalize_stdio_command(item.get("command"), item.get("args"))
        env = self._normalize_dict(item.get("env"), expand=True)

        url = self._expand_env_text(str(item.get("url") or "")) if item.get("url") else None
        headers = self._normalize_dict(item.get("headers"), expand=True)

        tools = self._parse_tools(item.get("tools"), server_roles=roles)

        return ExternalServerConfig(
            server_id=server_id,
            type=server_type,
            enabled=enabled,
            description=description,
            category=category,
            command=command,
            args=cmd_args,
            env=env,
            url=url,
            headers=headers,
            roles=roles,
            tools=tools,
        )

    def _parse_tools(self, raw: Any, server_roles: list[str]) -> list[ExternalToolConfig]:
        if not raw:
            return []
        if not isinstance(raw, list):
            raise ValueError("server.tools must be a list")

        parsed: list[ExternalToolConfig] = []
        for item in raw:
            if isinstance(item, str):
                name = item.strip()
                if not name:
                    continue
                parsed.append(
                    ExternalToolConfig(
                        local_name=name,
                        remote_name=name,
                        roles=list(server_roles),
                    )
                )
                continue

            if not isinstance(item, dict):
                continue

            remote_name = str(item.get("name") or "").strip()
            if not remote_name:
                continue
            local_name = str(item.get("alias") or remote_name).strip() or remote_name

            desc = str(item.get("description") or "")
            input_schema = item.get("input_schema")
            if not isinstance(input_schema, dict):
                input_schema = {}

            roles = self._normalize_roles(item.get("roles"), default=server_roles)
            annotations_raw = item.get("annotations")
            annotations = annotations_raw if isinstance(annotations_raw, dict) else None

            risk_raw = str(item.get("risk") or "").strip().lower()
            risk = risk_raw if risk_raw in {"low", "medium", "high"} else None

            parsed.append(
                ExternalToolConfig(
                    local_name=local_name,
                    remote_name=remote_name,
                    description=desc,
                    input_schema=input_schema,
                    roles=roles,
                    annotations=annotations,
                    risk=risk,
                )
            )

        return parsed

    def _normalize_stdio_command(
        self, command: Any, args: Any
    ) -> tuple[str | None, list[str]]:
        resolved_args = self._normalize_str_list(args)

        if isinstance(command, str):
            cmd = self._expand_env_text(command.strip())
            return (cmd or None), resolved_args

        if isinstance(command, list):
            parts = [self._expand_env_text(str(p)) for p in command if str(p).strip()]
            if not parts:
                return None, resolved_args
            cmd = parts[0]
            merged = parts[1:] + resolved_args
            return cmd, merged

        return None, resolved_args

    def _normalize_str_list(self, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, (str, int, float, bool)):
            text = self._expand_env_text(str(value)).strip()
            return [text] if text else []
        if not isinstance(value, list):
            return []

        result: list[str] = []
        for item in value:
            text = self._expand_env_text(str(item)).strip()
            if text:
                result.append(text)
        return result

    def _normalize_dict(self, value: Any, expand: bool = False) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}
        result: dict[str, str] = {}
        for key, item in value.items():
            text = str(item)
            result[str(key)] = self._expand_env_text(text) if expand else text
        return result

    def _normalize_roles(self, value: Any, default: list[str]) -> list[str]:
        roles = self._normalize_str_list(value)
        return roles or list(default)

    def _expand_env_text(self, value: str) -> str:
        if not value:
            return value

        missing: list[str] = []

        def _replace(match: re.Match[str]) -> str:
            key = match.group(1)
            env_val = os.getenv(key)
            if env_val is None:
                missing.append(key)
                return ""
            return env_val

        expanded = _ENV_PATTERN.sub(_replace, value)
        if missing:
            logger.warning("External MCP env vars not set: %s", ", ".join(sorted(set(missing))))
        return expanded


_manager: ExternalMcpManager | None = None


def get_external_mcp_manager() -> ExternalMcpManager:
    """Get singleton external MCP manager."""
    global _manager
    if _manager is None:
        _manager = ExternalMcpManager()
    return _manager
