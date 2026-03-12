"""ToolRegistry — unified registry for builtin/custom/external MCP tools.

Each builtin/custom tool package is a folder containing:
  - manifest.yaml  (name, version, description, tools list, permissions)
  - tools.py       (tool functions decorated with @tool)

External MCP servers are loaded from `mcp_servers.yaml` via
`app.tools.external.manager.ExternalMcpManager` and merged into the same
registry view.
"""

from __future__ import annotations

import importlib
import logging
from pathlib import Path
from typing import Any

import yaml

from claude_agent_sdk import SdkMcpTool

logger = logging.getLogger(__name__)


class ToolPackage:
    """Represents a discovered tool package (builtin/custom/external)."""

    __slots__ = ("path", "manifest", "tools", "source")

    def __init__(self, path: Path, manifest: dict[str, Any], tools: list, source: str):
        self.path = path
        self.manifest = manifest
        self.tools = tools  # list of SdkMcpTool objects
        self.source = source  # "builtin" | "custom" | "external"

    @property
    def name(self) -> str:
        return self.manifest["name"]

    @property
    def version(self) -> str:
        return self.manifest.get("version", "0.0.0")

    @property
    def tool_names(self) -> list[str]:
        return [t.name for t in self.tools]

    @property
    def allowed_roles(self) -> list[str]:
        perms = self.manifest.get("permissions", {})
        return perms.get("roles", ["student", "teacher", "admin"])


class ToolRegistry:
    """Scans and builds a unified tool catalog."""

    def __init__(self):
        self._packages: dict[str, ToolPackage] = {}
        self._tool_map: dict[str, Any] = {}
        self._tool_to_package: dict[str, str] = {}
        self._tool_to_mcp_ref: dict[str, str] = {}
        self._tool_to_mcp_server: dict[str, str] = {}
        self._mcp_ref_to_tool: dict[str, str] = {}

    def scan(self, extra_dirs: list[Path] | None = None):
        """Scan builtin/custom directories and optional external MCP config."""
        self._reset()

        builtin_dir = Path(__file__).parent / "builtin"
        self._scan_directory(builtin_dir, source="builtin")

        if extra_dirs:
            for d in extra_dirs:
                if d.is_dir():
                    self._scan_directory(d, source="custom")

        self._scan_external_mcp()

        logger.info(
            "ToolRegistry loaded: %d packages, %d tools",
            len(self._packages),
            len(self._tool_map),
        )

    def _reset(self):
        self._packages.clear()
        self._tool_map.clear()
        self._tool_to_package.clear()
        self._tool_to_mcp_ref.clear()
        self._tool_to_mcp_server.clear()
        self._mcp_ref_to_tool.clear()

    def _scan_directory(self, directory: Path, source: str):
        """Scan directory for packages containing manifest.yaml + tools.py."""
        if not directory.is_dir():
            return

        for child in sorted(directory.iterdir()):
            if not child.is_dir() or child.name.startswith("_"):
                continue

            manifest_path = child / "manifest.yaml"
            tools_path = child / "tools.py"
            if not manifest_path.exists() or not tools_path.exists():
                logger.debug("Skipping %s — missing manifest.yaml or tools.py", child.name)
                continue

            try:
                self._load_package(child, manifest_path, tools_path, source)
            except Exception:
                logger.exception("Failed to load tool package: %s", child.name)

    def _load_package(
        self, pkg_dir: Path, manifest_path: Path, tools_path: Path, source: str
    ):
        """Load a single builtin/custom package."""
        with open(manifest_path, encoding="utf-8") as f:
            manifest = yaml.safe_load(f) or {}

        pkg_name = manifest.get("name")
        if not pkg_name:
            logger.warning("Skipping package without name: %s", manifest_path)
            return

        declared_tools = set(manifest.get("tools", []))

        rel = tools_path.relative_to(Path(__file__).parent.parent.parent)
        module_path = str(rel).replace("/", ".").removesuffix(".py")
        module = importlib.import_module(module_path)

        discovered_tools: list[SdkMcpTool] = []
        for attr_name in dir(module):
            obj = getattr(module, attr_name)
            if not isinstance(obj, SdkMcpTool):
                continue
            if declared_tools and obj.name not in declared_tools:
                logger.warning(
                    "Tool '%s' in %s/tools.py not declared in manifest — skipping",
                    obj.name,
                    pkg_name,
                )
                continue
            discovered_tools.append(obj)

        if not discovered_tools:
            logger.warning("No tools found in %s/tools.py", pkg_name)
            return

        package = ToolPackage(
            path=pkg_dir,
            manifest=manifest,
            tools=discovered_tools,
            source=source,
        )
        self._register_package(package, mcp_server="pathmind")

        logger.info(
            "Loaded [%s] %s v%s — %d tools: %s",
            source,
            pkg_name,
            package.version,
            len(package.tools),
            ", ".join(package.tool_names),
        )

    def _scan_external_mcp(self):
        """Load external MCP servers from config and merge into registry."""
        try:
            from app.tools.external import get_external_mcp_manager

            manager = get_external_mcp_manager()
            packages = manager.build_registry_packages()
        except Exception:
            logger.exception("Failed to load external MCP packages")
            return

        for ext_pkg in packages:
            package = ToolPackage(
                path=Path(f"__external__/{ext_pkg.name}"),
                manifest=ext_pkg.manifest,
                tools=ext_pkg.tools,
                source=ext_pkg.source,
            )
            self._register_package(
                package,
                mcp_server=ext_pkg.manifest.get("external", {}).get("server_id", "external"),
                explicit_mcp_refs=ext_pkg.mcp_refs,
            )

            logger.info(
                "Loaded [external] %s — %d tools: %s",
                package.name,
                len(package.tools),
                ", ".join(package.tool_names),
            )

    def _register_package(
        self,
        package: ToolPackage,
        mcp_server: str,
        explicit_mcp_refs: dict[str, str] | None = None,
    ) -> None:
        """Register package/tools into unified internal maps."""
        tools_to_keep: list[SdkMcpTool] = []

        for tool_obj in package.tools:
            tool_name = tool_obj.name
            if tool_name in self._tool_map:
                logger.warning(
                    "Duplicate tool name '%s' from package '%s' (existing package '%s') — skipping",
                    tool_name,
                    package.name,
                    self._tool_to_package.get(tool_name),
                )
                continue

            mcp_ref = None
            if explicit_mcp_refs:
                mcp_ref = explicit_mcp_refs.get(tool_name)
            if not mcp_ref:
                mcp_ref = f"mcp__{mcp_server}__{tool_name}"

            self._tool_map[tool_name] = tool_obj
            self._tool_to_package[tool_name] = package.name
            self._tool_to_mcp_ref[tool_name] = mcp_ref
            self._tool_to_mcp_server[tool_name] = mcp_server
            self._mcp_ref_to_tool[mcp_ref] = tool_name
            tools_to_keep.append(tool_obj)

        if not tools_to_keep:
            logger.warning("Skipping package '%s' — all tools conflicted", package.name)
            return

        package.tools = tools_to_keep
        self._packages[package.name] = package

    # ── Public API ──────────────────────────────────────────

    def get_all_tools(self) -> list:
        return list(self._tool_map.values())

    def get_tool_map(self) -> dict[str, Any]:
        return dict(self._tool_map)

    def get_tool(self, name: str):
        return self._tool_map.get(name)

    def get_package(self, name: str) -> ToolPackage | None:
        return self._packages.get(name)

    def get_packages(self) -> dict[str, ToolPackage]:
        return dict(self._packages)

    def get_manifests(self) -> dict[str, dict[str, Any]]:
        return {name: pkg.manifest for name, pkg in self._packages.items()}

    def get_tool_package_name(self, tool_name: str) -> str | None:
        return self._tool_to_package.get(tool_name)

    def get_mcp_tool_ref(self, tool_name: str) -> str | None:
        return self._tool_to_mcp_ref.get(tool_name)

    def get_mcp_tool_refs(self, tool_names: list[str]) -> list[str]:
        refs: list[str] = []
        for name in tool_names:
            ref = self.get_mcp_tool_ref(name)
            if ref:
                refs.append(ref)
        return refs

    def resolve_tool_name(self, raw_name: str) -> str | None:
        """Resolve a raw tool identifier to local registry tool name.

        Accepts local names (e.g. `search_notes`) and fully qualified MCP
        names (e.g. `mcp__pathmind__search_notes`).
        """
        if raw_name in self._tool_map:
            return raw_name

        if raw_name in self._mcp_ref_to_tool:
            return self._mcp_ref_to_tool[raw_name]

        if raw_name.startswith("mcp__"):
            parts = raw_name.split("__", 2)
            if len(parts) == 3:
                bare = parts[2]
                if bare in self._tool_map:
                    return bare

        return None

    def get_tool_mcp_server(self, tool_name: str) -> str | None:
        return self._tool_to_mcp_server.get(tool_name)

    def get_tools_for_role(self, role: str) -> list:
        tools = []
        for pkg in self._packages.values():
            if role in pkg.allowed_roles:
                tools.extend(pkg.tools)
        return tools

    def get_tool_names_for_role(self, role: str) -> list[str]:
        return [t.name for t in self.get_tools_for_role(role)]

    def list_info(self) -> list[dict[str, Any]]:
        return [
            {
                "name": pkg.name,
                "version": pkg.version,
                "description": pkg.manifest.get("description", ""),
                "category": pkg.manifest.get("category", ""),
                "source": pkg.source,
                "tools": pkg.tool_names,
                "roles": pkg.allowed_roles,
            }
            for pkg in self._packages.values()
        ]

    def health(self) -> dict[str, Any]:
        external: dict[str, Any] = {}
        try:
            from app.tools.external import get_external_mcp_manager

            external = get_external_mcp_manager().health()
        except Exception:
            logger.exception("Failed to collect external MCP health")
            external = {"enabled": False, "errors": ["external health unavailable"]}

        return {
            "packages": len(self._packages),
            "tools": len(self._tool_map),
            "sources": {
                "builtin": len([p for p in self._packages.values() if p.source == "builtin"]),
                "custom": len([p for p in self._packages.values() if p.source == "custom"]),
                "external": len([p for p in self._packages.values() if p.source == "external"]),
            },
            "external_mcp": external,
        }


_registry: ToolRegistry | None = None


def get_registry() -> ToolRegistry:
    """Get or create global ToolRegistry singleton."""
    global _registry
    if _registry is None:
        _registry = ToolRegistry()
        _registry.scan()
    return _registry
