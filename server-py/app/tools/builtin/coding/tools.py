"""Built-in coding workflow tools (filesystem / git / shell)."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from claude_agent_sdk import ToolAnnotations, tool

from app.config import settings
from app.services.coding_policy import acquire_high_risk_execution_slot
from app.services.coding_runtime import get_coding_runtime_context
from app.services.coding_sandbox import (
    SandboxViolation,
    ensure_file_size_allowed,
    resolve_path,
    resolve_workspace_root,
    run_git_command,
    run_shell_command,
)


def _result(data: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}


def _error(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def _runtime_workspace_id(args: dict[str, Any]) -> str:
    runtime = get_coding_runtime_context()
    raw = str(args.get("workspace_id") or runtime.workspace_id or "default").strip()
    return raw or "default"


def _runtime_allow_network(args: dict[str, Any]) -> bool:
    runtime = get_coding_runtime_context()
    if "allow_network" in args:
        return bool(args.get("allow_network"))
    return bool(runtime.allow_network)


def _ensure_coding_enabled() -> str | None:
    runtime = get_coding_runtime_context()
    if not settings.coding_enabled:
        return "coding 功能未启用，请先开启 PATHMIND_CODING_ENABLED"
    if not runtime.enabled:
        return "当前会话未开启 coding runtime（context._runtime.coding.enabled=false）"
    return None


def _resolve_base(args: dict[str, Any]) -> Path:
    workspace_id = _runtime_workspace_id(args)
    return resolve_workspace_root(workspace_id)


@tool(
    "code_list_dir",
    "列出代码工作区目录内容。支持递归和条目数量限制。",
    {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "目录路径（相对 workspace）"},
            "recursive": {"type": "boolean", "default": False},
            "limit": {"type": "integer", "default": 200},
            "workspace_id": {"type": "string"},
        },
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def code_list_dir(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        base = _resolve_base(args)
        target = resolve_path(str(args.get("path") or "."), workspace_root=base)
        if not target.exists() or not target.is_dir():
            return _error(f"目录不存在: {target}")

        recursive = bool(args.get("recursive", False))
        limit = max(1, min(int(args.get("limit", 200)), 2000))
        iterator = target.rglob("*") if recursive else target.iterdir()

        items: list[dict[str, Any]] = []
        for item in iterator:
            if len(items) >= limit:
                break
            item_type = "dir" if item.is_dir() else "file"
            size = item.stat().st_size if item.is_file() else 0
            items.append(
                {
                    "path": str(item),
                    "relative": str(item.relative_to(base)),
                    "type": item_type,
                    "size": size,
                }
            )

        return _result(
            {
                "workspace": str(base),
                "path": str(target),
                "recursive": recursive,
                "count": len(items),
                "items": items,
            }
        )
    except (SandboxViolation, ValueError) as exc:
        return _error(f"目录读取被拒绝: {exc}")
    except Exception as exc:
        return _error(f"目录读取失败: {exc}")


@tool(
    "code_read_file",
    "读取代码文件内容，支持行范围。",
    {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "start_line": {"type": "integer", "default": 1},
            "end_line": {"type": "integer", "default": -1},
            "workspace_id": {"type": "string"},
        },
        "required": ["path"],
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def code_read_file(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        base = _resolve_base(args)
        target = resolve_path(str(args["path"]), workspace_root=base)
        if not target.exists() or not target.is_file():
            return _error(f"文件不存在: {target}")

        ensure_file_size_allowed(target)

        start_line = max(1, int(args.get("start_line", 1)))
        end_line = int(args.get("end_line", -1))

        content = target.read_text(encoding="utf-8", errors="ignore")
        lines = content.splitlines()

        if end_line <= 0:
            selected = lines[start_line - 1 :]
        else:
            selected = lines[start_line - 1 : max(start_line - 1, end_line)]

        return _result(
            {
                "path": str(target),
                "line_count": len(lines),
                "start_line": start_line,
                "end_line": end_line,
                "content": "\n".join(selected),
            }
        )
    except (SandboxViolation, ValueError) as exc:
        return _error(f"文件读取被拒绝: {exc}")
    except Exception as exc:
        return _error(f"文件读取失败: {exc}")


@tool(
    "code_write_file",
    "写入代码文件。mode=overwrite 覆盖写入，mode=append 追加写入。",
    {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "content": {"type": "string"},
            "mode": {"type": "string", "enum": ["overwrite", "append"], "default": "overwrite"},
            "workspace_id": {"type": "string"},
        },
        "required": ["path", "content"],
    },
    annotations=ToolAnnotations(destructiveHint=True),
)
async def code_write_file(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        async with acquire_high_risk_execution_slot("code_write_file"):
            base = _resolve_base(args)
            target = resolve_path(str(args["path"]), workspace_root=base)

            mode = str(args.get("mode", "overwrite")).strip().lower()
            if mode not in {"overwrite", "append"}:
                return _error("mode 仅支持 overwrite 或 append")

            content = str(args.get("content", ""))
            max_bytes = max(1024, int(settings.coding_max_file_bytes))
            if len(content.encode("utf-8")) > max_bytes:
                return _error(f"写入内容超过限制({max_bytes} bytes)")

            target.parent.mkdir(parents=True, exist_ok=True)
            open_mode = "w" if mode == "overwrite" else "a"
            with target.open(open_mode, encoding="utf-8") as f:
                f.write(content)

            ensure_file_size_allowed(target)

            return _result(
                {
                    "path": str(target),
                    "mode": mode,
                    "bytes": target.stat().st_size,
                    "workspace": str(base),
                }
            )
    except (SandboxViolation, ValueError) as exc:
        return _error(f"文件写入被拒绝: {exc}")
    except Exception as exc:
        return _error(f"文件写入失败: {exc}")


@tool(
    "code_edit_file",
    "在文件内精确替换 old_content 为 new_content。",
    {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "old_content": {"type": "string"},
            "new_content": {"type": "string"},
            "replace_all": {"type": "boolean", "default": False},
            "workspace_id": {"type": "string"},
        },
        "required": ["path", "old_content", "new_content"],
    },
    annotations=ToolAnnotations(destructiveHint=True),
)
async def code_edit_file(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        async with acquire_high_risk_execution_slot("code_edit_file"):
            base = _resolve_base(args)
            target = resolve_path(str(args["path"]), workspace_root=base)
            if not target.exists() or not target.is_file():
                return _error(f"文件不存在: {target}")

            ensure_file_size_allowed(target)

            old_content = str(args.get("old_content", ""))
            new_content = str(args.get("new_content", ""))
            replace_all = bool(args.get("replace_all", False))

            original = target.read_text(encoding="utf-8", errors="ignore")
            if old_content not in original:
                return _error("old_content 未找到，编辑未执行")

            if replace_all:
                updated = original.replace(old_content, new_content)
                replacements = original.count(old_content)
            else:
                updated = original.replace(old_content, new_content, 1)
                replacements = 1

            target.write_text(updated, encoding="utf-8")
            ensure_file_size_allowed(target)

            return _result(
                {
                    "path": str(target),
                    "replacements": replacements,
                    "bytes": target.stat().st_size,
                }
            )
    except (SandboxViolation, ValueError) as exc:
        return _error(f"文件编辑被拒绝: {exc}")
    except Exception as exc:
        return _error(f"文件编辑失败: {exc}")


@tool(
    "code_search_files",
    "按 glob 模式搜索工作区文件路径。",
    {
        "type": "object",
        "properties": {
            "pattern": {"type": "string", "description": "glob 模式，例如 **/*.py"},
            "path": {"type": "string", "description": "搜索根目录（相对 workspace）", "default": "."},
            "limit": {"type": "integer", "default": 200},
            "workspace_id": {"type": "string"},
        },
        "required": ["pattern"],
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def code_search_files(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        base = _resolve_base(args)
        root = resolve_path(str(args.get("path") or "."), workspace_root=base)
        if not root.exists() or not root.is_dir():
            return _error(f"目录不存在: {root}")

        pattern = str(args.get("pattern", "")).strip()
        if not pattern:
            return _error("pattern 不能为空")

        limit = max(1, min(int(args.get("limit", 200)), 5000))
        matches: list[str] = []
        for item in root.rglob(pattern):
            if len(matches) >= limit:
                break
            matches.append(str(item.relative_to(base)))

        return _result(
            {
                "workspace": str(base),
                "pattern": pattern,
                "count": len(matches),
                "matches": matches,
            }
        )
    except (SandboxViolation, ValueError) as exc:
        return _error(f"文件搜索被拒绝: {exc}")
    except Exception as exc:
        return _error(f"文件搜索失败: {exc}")


@tool(
    "code_grep_content",
    "按正则表达式搜索文件内容，返回匹配行与上下文。",
    {
        "type": "object",
        "properties": {
            "pattern": {"type": "string"},
            "path": {"type": "string", "default": "."},
            "context_lines": {"type": "integer", "default": 2},
            "limit": {"type": "integer", "default": 100},
            "workspace_id": {"type": "string"},
        },
        "required": ["pattern"],
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def code_grep_content(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        base = _resolve_base(args)
        root = resolve_path(str(args.get("path") or "."), workspace_root=base)
        if not root.exists() or not root.is_dir():
            return _error(f"目录不存在: {root}")

        pattern = str(args.get("pattern", "")).strip()
        if not pattern:
            return _error("pattern 不能为空")

        regex = re.compile(pattern)
        context_lines = max(0, min(int(args.get("context_lines", 2)), 10))
        limit = max(1, min(int(args.get("limit", 100)), 2000))

        results: list[dict[str, Any]] = []
        for file_path in root.rglob("*"):
            if not file_path.is_file():
                continue

            try:
                ensure_file_size_allowed(file_path)
                lines = file_path.read_text(encoding="utf-8", errors="ignore").splitlines()
            except Exception:
                continue

            for idx, line in enumerate(lines, start=1):
                if not regex.search(line):
                    continue

                start = max(1, idx - context_lines)
                end = min(len(lines), idx + context_lines)
                snippet = lines[start - 1 : end]

                results.append(
                    {
                        "file": str(file_path.relative_to(base)),
                        "line": idx,
                        "match": line,
                        "context_start": start,
                        "context_end": end,
                        "context": "\n".join(snippet),
                    }
                )

                if len(results) >= limit:
                    break

            if len(results) >= limit:
                break

        return _result(
            {
                "workspace": str(base),
                "pattern": pattern,
                "count": len(results),
                "results": results,
            }
        )
    except re.error as exc:
        return _error(f"无效正则表达式: {exc}")
    except (SandboxViolation, ValueError) as exc:
        return _error(f"内容搜索被拒绝: {exc}")
    except Exception as exc:
        return _error(f"内容搜索失败: {exc}")


@tool(
    "code_git_status",
    "获取当前工作区 Git 状态。",
    {
        "type": "object",
        "properties": {
            "workspace_id": {"type": "string"},
        },
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def code_git_status(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        base = _resolve_base(args)
        data = run_git_command(["status", "--short", "--branch"], cwd=base)
        return _result(data)
    except (SandboxViolation, ValueError) as exc:
        return _error(f"git status 被拒绝: {exc}")
    except Exception as exc:
        return _error(f"git status 失败: {exc}")


@tool(
    "code_git_diff",
    "查看 git diff，支持 staged 和指定文件。",
    {
        "type": "object",
        "properties": {
            "staged": {"type": "boolean", "default": False},
            "path": {"type": "string", "description": "可选文件路径"},
            "workspace_id": {"type": "string"},
        },
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def code_git_diff(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        base = _resolve_base(args)
        cmd = ["diff"]
        if bool(args.get("staged", False)):
            cmd.append("--staged")
        target_path = str(args.get("path") or "").strip()
        if target_path:
            cmd.append(target_path)
        data = run_git_command(cmd, cwd=base)
        return _result(data)
    except (SandboxViolation, ValueError) as exc:
        return _error(f"git diff 被拒绝: {exc}")
    except Exception as exc:
        return _error(f"git diff 失败: {exc}")


@tool(
    "code_git_add",
    "执行 git add（高风险操作，需审批）。",
    {
        "type": "object",
        "properties": {
            "files": {
                "type": "array",
                "items": {"type": "string"},
                "description": "要 add 的文件列表，默认 .",
            },
            "workspace_id": {"type": "string"},
        },
    },
    annotations=ToolAnnotations(destructiveHint=True),
)
async def code_git_add(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        async with acquire_high_risk_execution_slot("code_git_add"):
            base = _resolve_base(args)
            files = args.get("files")
            targets = ["."]
            if isinstance(files, list) and files:
                targets = [str(item) for item in files if str(item).strip()]
            data = run_git_command(["add", *targets], cwd=base)
            return _result(data)
    except (SandboxViolation, ValueError) as exc:
        return _error(f"git add 被拒绝: {exc}")
    except Exception as exc:
        return _error(f"git add 失败: {exc}")


@tool(
    "code_git_commit",
    "执行 git commit（高风险操作，需审批）。",
    {
        "type": "object",
        "properties": {
            "message": {"type": "string"},
            "workspace_id": {"type": "string"},
        },
        "required": ["message"],
    },
    annotations=ToolAnnotations(destructiveHint=True),
)
async def code_git_commit(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        async with acquire_high_risk_execution_slot("code_git_commit"):
            base = _resolve_base(args)
            message = str(args.get("message") or "").strip()
            if not message:
                return _error("commit message 不能为空")
            data = run_git_command(["commit", "-m", message], cwd=base)
            return _result(data)
    except (SandboxViolation, ValueError) as exc:
        return _error(f"git commit 被拒绝: {exc}")
    except Exception as exc:
        return _error(f"git commit 失败: {exc}")


@tool(
    "code_git_branch",
    "执行 git 分支操作（list/create/switch/delete）。",
    {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["list", "create", "switch", "delete"], "default": "list"},
            "name": {"type": "string", "description": "分支名"},
            "workspace_id": {"type": "string"},
        },
    },
    annotations=ToolAnnotations(destructiveHint=True),
)
async def code_git_branch(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        async with acquire_high_risk_execution_slot("code_git_branch"):
            base = _resolve_base(args)
            action = str(args.get("action", "list")).strip().lower()
            name = str(args.get("name") or "").strip()

            if action == "list":
                cmd = ["branch", "--list"]
            elif action == "create":
                if not name:
                    return _error("create 分支需要 name")
                cmd = ["branch", name]
            elif action == "switch":
                if not name:
                    return _error("switch 分支需要 name")
                cmd = ["switch", name]
            elif action == "delete":
                if not name:
                    return _error("delete 分支需要 name")
                cmd = ["branch", "-d", name]
            else:
                return _error("action 无效")

            data = run_git_command(cmd, cwd=base)
            return _result(data)
    except (SandboxViolation, ValueError) as exc:
        return _error(f"git branch 被拒绝: {exc}")
    except Exception as exc:
        return _error(f"git branch 失败: {exc}")


@tool(
    "code_git_log",
    "查看 git log 历史。",
    {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "default": 10},
            "workspace_id": {"type": "string"},
        },
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def code_git_log(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        base = _resolve_base(args)
        limit = max(1, min(int(args.get("limit", 10)), 100))
        data = run_git_command(["log", "--oneline", f"-{limit}"], cwd=base)
        return _result(data)
    except (SandboxViolation, ValueError) as exc:
        return _error(f"git log 被拒绝: {exc}")
    except Exception as exc:
        return _error(f"git log 失败: {exc}")


@tool(
    "code_shell_exec",
    "执行 shell 命令（高风险操作，需审批）。",
    {
        "type": "object",
        "properties": {
            "command": {"type": "string"},
            "cwd": {"type": "string", "description": "工作目录（相对 workspace）"},
            "timeout_sec": {"type": "integer", "default": 30},
            "workspace_id": {"type": "string"},
            "allow_network": {"type": "boolean", "default": False},
        },
        "required": ["command"],
    },
    annotations=ToolAnnotations(destructiveHint=True),
)
async def code_shell_exec(args: dict[str, Any]) -> dict[str, Any]:
    disabled = _ensure_coding_enabled()
    if disabled:
        return _error(disabled)

    try:
        async with acquire_high_risk_execution_slot("code_shell_exec"):
            base = _resolve_base(args)
            cwd = resolve_path(str(args.get("cwd") or "."), workspace_root=base)
            command = str(args.get("command") or "").strip()
            if not command:
                return _error("command 不能为空")

            allow_network = _runtime_allow_network(args)
            timeout_sec = int(args.get("timeout_sec", settings.coding_shell_default_timeout_sec))

            data = run_shell_command(
                command=command,
                cwd=cwd,
                timeout_sec=timeout_sec,
                allow_network=allow_network,
            )
            return _result(data)
    except (SandboxViolation, ValueError) as exc:
        return _error(f"shell 执行被拒绝: {exc}")
    except Exception as exc:
        return _error(f"shell 执行失败: {exc}")
