"""Sandbox helpers for coding tools.

Implements strict path/command policies for built-in coding tools.
"""

from __future__ import annotations

import re
import shlex
import subprocess
from pathlib import Path
from typing import Any

from app.config import settings


class SandboxViolation(Exception):
    """Raised when an operation violates sandbox policy."""


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [segment.strip() for segment in value.split(",") if segment and segment.strip()]


def _normalize_roots(raw_roots: list[str]) -> list[Path]:
    roots: list[Path] = []
    for item in raw_roots:
        path = Path(item).expanduser()
        if not path.is_absolute():
            path = (Path.cwd() / path).resolve()
        else:
            path = path.resolve()
        roots.append(path)
    return roots


def configured_workspace_roots() -> list[Path]:
    """Configured workspace root directories."""
    raw = _split_csv(settings.coding_workspace_roots)
    if not raw:
        raw = [str(Path.cwd())]
    return _normalize_roots(raw)


def configured_blocked_paths() -> list[Path]:
    """Configured blocked path prefixes."""
    raw = _split_csv(settings.coding_blocked_paths)
    return _normalize_roots(raw)


def configured_allowed_commands() -> set[str]:
    """Configured command whitelist."""
    raw = _split_csv(settings.coding_allowed_commands)
    return {item for item in raw if item}


def resolve_workspace_root(workspace_id: str | None = None) -> Path:
    """Resolve effective workspace root.

    `workspace_id` is normalized as a path segment under the first root.
    """
    roots = configured_workspace_roots()
    base = roots[0]
    if not workspace_id:
        return base

    safe_id = re.sub(r"[^a-zA-Z0-9._-]", "_", workspace_id)
    candidate = (base / safe_id).resolve()
    if not candidate.exists():
        candidate.mkdir(parents=True, exist_ok=True)
    ensure_path_allowed(candidate)
    return candidate


def resolve_path(path: str, workspace_root: Path | None = None) -> Path:
    """Resolve user path into an absolute path with policy checks."""
    root = workspace_root or resolve_workspace_root(None)
    if not path or not str(path).strip():
        target = root
    else:
        candidate = Path(path).expanduser()
        if candidate.is_absolute():
            target = candidate.resolve()
        else:
            target = (root / candidate).resolve()

    ensure_path_allowed(target)
    return target


def ensure_path_allowed(path: Path) -> None:
    """Validate path is inside allowed roots and not under blocked paths."""
    roots = configured_workspace_roots()
    if not any(path.is_relative_to(root) for root in roots):
        raise SandboxViolation(f"路径超出允许范围: {path}")

    for blocked in configured_blocked_paths():
        if path.is_relative_to(blocked):
            raise SandboxViolation(f"路径被策略禁止: {path}")


def ensure_file_size_allowed(path: Path) -> None:
    """Validate file size against configured max bytes."""
    if not path.exists() or not path.is_file():
        return
    max_bytes = max(1024, int(settings.coding_max_file_bytes))
    size = path.stat().st_size
    if size > max_bytes:
        raise SandboxViolation(f"文件超过大小限制({max_bytes} bytes): {path}")


def _forbid_compound_command(command: str) -> None:
    forbidden_tokens = ["&&", "||", "|", ";", "$(", "`", ">", "<"]
    lowered = command.lower()
    if any(token in command for token in forbidden_tokens):
        raise SandboxViolation("命令包含复合/重定向语法，已拒绝")

    blocked_patterns = [
        r"\brm\s+-rf\s+/",
        r"\bdd\s+if=",
        r"\bmkfs\.",
        r":\(\)\s*\{\s*:.*\|.*\}\s*;",
        r"curl\s+.*\|\s*(bash|sh)",
        r"wget\s+.*\|\s*(bash|sh)",
    ]
    for pattern in blocked_patterns:
        if re.search(pattern, lowered):
            raise SandboxViolation("命中危险命令策略，已拒绝")


def _forbid_network_command(command: str) -> None:
    if settings.coding_network_enabled:
        return
    net_keywords = ["curl", "wget", "nc", "ncat", "telnet", "ssh", "scp", "ftp", "rsync"]
    lowered = command.lower()
    if any(keyword in lowered for keyword in net_keywords):
        raise SandboxViolation("当前运行策略禁用网络命令")


def run_shell_command(
    command: str,
    cwd: Path,
    timeout_sec: int | None = None,
    allow_network: bool = False,
) -> dict[str, Any]:
    """Run a shell command under strict policy."""
    ensure_path_allowed(cwd)

    raw = (command or "").strip()
    if not raw:
        raise SandboxViolation("命令不能为空")

    _forbid_compound_command(raw)
    if not allow_network:
        _forbid_network_command(raw)

    parts = shlex.split(raw)
    if not parts:
        raise SandboxViolation("命令不能为空")

    bin_name = parts[0]
    allowed = configured_allowed_commands()
    if allowed and bin_name not in allowed:
        raise SandboxViolation(f"命令不在白名单: {bin_name}")

    default_timeout = max(1, int(settings.coding_shell_default_timeout_sec))
    max_timeout = max(default_timeout, int(settings.coding_shell_max_timeout_sec))
    requested = timeout_sec if isinstance(timeout_sec, int) else default_timeout
    safe_timeout = max(1, min(requested, max_timeout))

    safe_env = {
        "PATH": str(Path("/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")),
        "HOME": str(cwd),
    }

    proc = subprocess.run(
        parts,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=safe_timeout,
        env=safe_env,
        check=False,
    )

    max_chars = max(512, int(settings.coding_max_output_chars))
    stdout = (proc.stdout or "")[:max_chars]
    stderr = (proc.stderr or "")[:max_chars]

    return {
        "command": raw,
        "cwd": str(cwd),
        "exit_code": int(proc.returncode),
        "stdout": stdout,
        "stderr": stderr,
        "timeout_sec": safe_timeout,
        "truncated": len(proc.stdout or "") > max_chars or len(proc.stderr or "") > max_chars,
    }


def run_git_command(args: list[str], cwd: Path, timeout_sec: int = 30) -> dict[str, Any]:
    """Run a git command with sandbox guardrails."""
    if not args:
        raise SandboxViolation("git 参数不能为空")

    allowed_subcommands = {
        "status",
        "diff",
        "add",
        "commit",
        "branch",
        "checkout",
        "switch",
        "log",
    }
    sub = args[0]
    if sub not in allowed_subcommands:
        raise SandboxViolation(f"git 子命令未允许: {sub}")

    if sub == "commit" and "--amend" in args:
        raise SandboxViolation("禁止使用 git commit --amend")

    cmd = "git " + " ".join(shlex.quote(part) for part in args)
    return run_shell_command(cmd, cwd=cwd, timeout_sec=timeout_sec, allow_network=False)
