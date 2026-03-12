"""Versioned coding policy profiles with hot-reload support.

Profiles can be loaded from JSON file and selected per-request via
`context._runtime.coding.policy_profile`.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from app.config import settings
from app.services.coding_runtime import get_coding_runtime_context

logger = logging.getLogger(__name__)

_ALLOWED_RISK_LEVELS = {"low", "medium", "high"}


@dataclass(slots=True)
class CodingPolicyProfile:
    """Effective coding policy profile for current request/runtime."""

    profile_name: str
    source_version: str = "1.0"

    approvals_enabled: bool = True
    approval_timeout_sec: int = 60
    medium_risk_requires_approval: bool = True

    low_risk_retry_count: int = 1
    low_risk_retry_backoff_ms: int = 300
    high_risk_max_concurrency: int = 1

    external_default_risk: str = "high"
    external_readonly_risk: str = "medium"
    external_openworld_risk: str = "high"

    external_mcp_builtin_priority: bool = True
    external_mcp_fallback_to_internal: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class CodingPolicyProfileManager:
    """Loads coding policy profile definitions from disk with hot reload."""

    def __init__(self):
        self._enabled = bool(settings.coding_policy_profiles_enabled)
        self._config_path = Path(settings.coding_policy_profiles_path)
        self._default_profile_name = (
            str(settings.coding_policy_default_profile or "").strip() or "strict_v1"
        )

        self._profiles: dict[str, CodingPolicyProfile] = {}
        self._source_version = "1.0"
        self._loaded = False
        self._last_mtime: float | None = None
        self._last_errors: list[str] = []

    def _settings_default_profile(self, profile_name: str = "settings_default") -> CodingPolicyProfile:
        return CodingPolicyProfile(
            profile_name=profile_name,
            source_version="settings",
            approvals_enabled=bool(settings.coding_approvals_enabled),
            approval_timeout_sec=max(5, min(int(settings.coding_approval_timeout_sec), 300)),
            medium_risk_requires_approval=bool(settings.coding_medium_risk_requires_approval),
            low_risk_retry_count=max(0, min(int(settings.coding_low_risk_retry_count), 3)),
            low_risk_retry_backoff_ms=max(50, min(int(settings.coding_low_risk_retry_backoff_ms), 10_000)),
            high_risk_max_concurrency=max(1, min(int(settings.coding_high_risk_max_concurrency), 8)),
            external_default_risk=self._safe_risk(settings.coding_external_default_risk, "high"),
            external_readonly_risk=self._safe_risk(settings.coding_external_readonly_risk, "medium"),
            external_openworld_risk=self._safe_risk(settings.coding_external_openworld_risk, "high"),
            external_mcp_builtin_priority=bool(settings.external_mcp_builtin_priority),
            external_mcp_fallback_to_internal=bool(settings.external_mcp_fallback_to_internal),
        )

    @staticmethod
    def _safe_risk(value: Any, default: str) -> str:
        raw = str(value or "").strip().lower()
        return raw if raw in _ALLOWED_RISK_LEVELS else default

    @staticmethod
    def _safe_int(value: Any, default: int, min_value: int, max_value: int) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return default
        return max(min_value, min(parsed, max_value))

    def _parse_profile(
        self,
        profile_name: str,
        payload: dict[str, Any],
        source_version: str,
    ) -> CodingPolicyProfile:
        base = self._settings_default_profile(profile_name=profile_name)

        return CodingPolicyProfile(
            profile_name=profile_name,
            source_version=source_version,
            approvals_enabled=bool(payload.get("approvals_enabled", base.approvals_enabled)),
            approval_timeout_sec=self._safe_int(
                payload.get("approval_timeout_sec"),
                base.approval_timeout_sec,
                5,
                300,
            ),
            medium_risk_requires_approval=bool(
                payload.get("medium_risk_requires_approval", base.medium_risk_requires_approval)
            ),
            low_risk_retry_count=self._safe_int(
                payload.get("low_risk_retry_count"),
                base.low_risk_retry_count,
                0,
                3,
            ),
            low_risk_retry_backoff_ms=self._safe_int(
                payload.get("low_risk_retry_backoff_ms"),
                base.low_risk_retry_backoff_ms,
                50,
                10_000,
            ),
            high_risk_max_concurrency=self._safe_int(
                payload.get("high_risk_max_concurrency"),
                base.high_risk_max_concurrency,
                1,
                8,
            ),
            external_default_risk=self._safe_risk(
                payload.get("external_default_risk"),
                base.external_default_risk,
            ),
            external_readonly_risk=self._safe_risk(
                payload.get("external_readonly_risk"),
                base.external_readonly_risk,
            ),
            external_openworld_risk=self._safe_risk(
                payload.get("external_openworld_risk"),
                base.external_openworld_risk,
            ),
            external_mcp_builtin_priority=bool(
                payload.get("external_mcp_builtin_priority", base.external_mcp_builtin_priority)
            ),
            external_mcp_fallback_to_internal=bool(
                payload.get("external_mcp_fallback_to_internal", base.external_mcp_fallback_to_internal)
            ),
        )

    def _resolve_config_path(self) -> Path:
        cfg = self._config_path
        if cfg.is_absolute():
            return cfg
        return (Path.cwd() / cfg).resolve()

    def _load_from_disk(self, cfg: Path) -> tuple[dict[str, CodingPolicyProfile], str, str]:
        with cfg.open("r", encoding="utf-8") as f:
            raw = json.load(f)

        if not isinstance(raw, dict):
            raise ValueError("coding policy config must be an object")

        source_version = str(raw.get("version") or "1.0")
        default_profile = str(raw.get("default_profile") or self._default_profile_name).strip() or self._default_profile_name

        profiles_raw = raw.get("profiles")
        if not isinstance(profiles_raw, dict):
            raise ValueError("coding policy config field 'profiles' must be an object")

        parsed: dict[str, CodingPolicyProfile] = {}
        for profile_name, payload in profiles_raw.items():
            name = str(profile_name or "").strip()
            if not name:
                continue
            if not isinstance(payload, dict):
                continue
            parsed[name] = self._parse_profile(name, payload, source_version)

        if not parsed:
            raise ValueError("coding policy config contains no valid profiles")

        return parsed, default_profile, source_version

    def reload(self, force: bool = False) -> None:
        """Reload profile config if file changed (or force=True)."""
        if not self._enabled:
            self._profiles = {"settings_default": self._settings_default_profile()}
            self._default_profile_name = "settings_default"
            self._source_version = "settings"
            self._last_errors = []
            self._loaded = True
            return

        cfg = self._resolve_config_path()

        if cfg.exists():
            mtime = cfg.stat().st_mtime
            if self._loaded and not force and self._last_mtime is not None and self._last_mtime == mtime:
                return

            try:
                parsed_profiles, default_profile, source_version = self._load_from_disk(cfg)
                self._profiles = parsed_profiles
                self._default_profile_name = default_profile
                self._source_version = source_version
                self._last_mtime = mtime
                self._last_errors = []
                self._loaded = True
                return
            except Exception as exc:
                message = f"Failed to load coding policy profiles from {cfg}: {exc}"
                self._last_errors = [message]
                logger.warning(message)

        else:
            if not self._loaded:
                logger.info("Coding policy profile file not found, using settings fallback: %s", cfg)

        fallback = self._settings_default_profile()
        self._profiles = {fallback.profile_name: fallback}
        self._default_profile_name = fallback.profile_name
        self._source_version = fallback.source_version
        self._last_mtime = cfg.stat().st_mtime if cfg.exists() else None
        self._loaded = True

    def _select_profile_name(self, explicit_profile_name: str | None = None) -> str:
        if explicit_profile_name and explicit_profile_name.strip():
            return explicit_profile_name.strip()

        runtime_ctx = get_coding_runtime_context()
        runtime_profile = str(runtime_ctx.policy_profile or "").strip()
        if runtime_profile:
            return runtime_profile

        if self._default_profile_name:
            return self._default_profile_name

        return "settings_default"

    def get_profile(self, profile_name: str | None = None) -> CodingPolicyProfile:
        self.reload()

        requested = self._select_profile_name(profile_name)
        found = self._profiles.get(requested)
        if found is not None:
            return found

        default_found = self._profiles.get(self._default_profile_name)
        if default_found is not None:
            return default_found

        # should not happen; keep stable fallback
        return self._settings_default_profile()

    def snapshot(self) -> dict[str, Any]:
        self.reload()
        return {
            "enabled": self._enabled,
            "config_path": str(self._resolve_config_path()),
            "default_profile": self._default_profile_name,
            "source_version": self._source_version,
            "profiles": {name: profile.to_dict() for name, profile in self._profiles.items()},
            "errors": list(self._last_errors),
        }


_manager: CodingPolicyProfileManager | None = None


def get_coding_policy_profile_manager() -> CodingPolicyProfileManager:
    global _manager
    if _manager is None:
        _manager = CodingPolicyProfileManager()
    return _manager


def get_effective_coding_policy_profile(profile_name: str | None = None) -> CodingPolicyProfile:
    return get_coding_policy_profile_manager().get_profile(profile_name)
