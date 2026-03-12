"""Built-in tool for controlled cross-agent delegation."""

from __future__ import annotations

import uuid
import json
from typing import Any

from claude_agent_sdk import ToolAnnotations, tool

from app.agents.registry import AGENT_REGISTRY
from app.services.agent_request_context import get_agent_request_context
from app.services.coding_runtime import get_coding_runtime_context
from app.services.delegation_runtime import (
    allowed_targets_for,
    delegation_scope,
    format_chain,
    validate_delegation,
)
from app.services.run_scratchpad import append_reasoning, append_tool_result

_RUNTIME_ALLOW_KEYS = {"mode", "engine", "engine_model", "model_tier", "output_format"}


def _result(data: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}


def _error(message: str) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": message}], "is_error": True}


def _build_delegate_context(
    *,
    source_agent: str,
    target_agent: str,
    chain: list[str],
    args: dict[str, Any],
) -> dict[str, Any] | None:
    context_patch = args.get("context_patch")
    context_payload: dict[str, Any] = {}

    if isinstance(context_patch, dict):
        for key, value in context_patch.items():
            if key in {"_runtime", "_tenant"}:
                continue
            context_payload[str(key)] = value

    runtime_payload: dict[str, Any] = {}
    runtime_patch = args.get("runtime")
    if isinstance(runtime_patch, dict):
        for key in _RUNTIME_ALLOW_KEYS:
            if key in runtime_patch:
                runtime_payload[key] = runtime_patch[key]

    coding_ctx = get_coding_runtime_context()
    if coding_ctx.enabled:
        runtime_payload.setdefault(
            "coding",
            {
                "enabled": True,
                "workspace_id": coding_ctx.workspace_id,
                "approval_mode": coding_ctx.approval_mode,
                "allow_network": coding_ctx.allow_network,
            },
        )
        if coding_ctx.policy_profile:
            runtime_payload["coding"]["policy_profile"] = coding_ctx.policy_profile

    if runtime_payload:
        context_payload["_runtime"] = runtime_payload

    context_payload["_delegation"] = {
        "source_agent": source_agent,
        "target_agent": target_agent,
        "chain": chain,
    }

    return context_payload or None


def _build_delegated_prompt(task: str, expected_output: str | None = None) -> str:
    prompt = str(task or "").strip()
    expected = str(expected_output or "").strip()
    if expected:
        prompt += f"\n\n期望输出：\n{expected}"
    return prompt


@tool(
    "delegate_to_agent",
    "将当前子任务委托给更合适的 agent 执行（受白名单、深度和环路保护）。",
    {
        "type": "object",
        "properties": {
            "target_agent": {
                "type": "string",
                "description": "目标 agent 名称（如 document-reader / learning-coach）",
            },
            "task": {
                "type": "string",
                "description": "要委托的明确任务描述",
            },
            "expected_output": {
                "type": "string",
                "description": "可选，期望返回格式或交付物说明",
            },
            "context_patch": {
                "type": "object",
                "description": "可选，补充给目标 agent 的上下文（自动过滤 _runtime/_tenant）",
            },
            "runtime": {
                "type": "object",
                "description": "可选，目标 agent 的 runtime 覆盖（mode/engine/model_tier 等）",
            },
            "max_response_chars": {
                "type": "integer",
                "default": 3000,
                "description": "返回结果最大字符数（防止上下文膨胀）",
            },
        },
        "required": ["target_agent", "task"],
    },
    annotations=ToolAnnotations(idempotentHint=True),
)
async def delegate_to_agent(args: dict[str, Any]) -> dict[str, Any]:
    request_ctx = get_agent_request_context()
    source_agent = str(request_ctx.agent_name or "").strip()
    target_agent = str(args.get("target_agent") or "").strip()
    task = str(args.get("task") or "").strip()

    if not source_agent:
        return _error("委托失败：缺少来源 agent 上下文")
    if not task:
        return _error("委托失败：task 不能为空")
    if target_agent not in AGENT_REGISTRY:
        return _error(f"委托失败：未知目标 agent '{target_agent}'")

    allowed, reason, normalized_chain = validate_delegation(
        source_agent=source_agent,
        target_agent=target_agent,
    )
    if not allowed:
        return _error(f"委托被拒绝：{reason}")

    delegated_prompt = _build_delegated_prompt(
        task=task,
        expected_output=str(args.get("expected_output") or "").strip(),
    )

    max_chars = max(400, min(int(args.get("max_response_chars", 3000)), 12_000))
    depth = max(0, len(normalized_chain) - 1)

    append_reasoning(
        f"handoff_start: {source_agent} -> {target_agent} (depth={depth})",
        source="handoff",
    )

    try:
        from app.services import AgentService

        with delegation_scope(source_agent, target_agent) as active_chain:
            delegated_context = _build_delegate_context(
                source_agent=source_agent,
                target_agent=target_agent,
                chain=active_chain,
                args=args,
            )
            service = AgentService()
            result = await service.query(
                agent_name=target_agent,
                prompt=delegated_prompt,
                student_id=request_ctx.student_id or None,
                context=delegated_context,
                role=request_ctx.role or "student",
            )

        response = str(result.get("response") or "")
        response_truncated = len(response) > max_chars
        response_text = response[:max_chars]

        summary = response_text.replace("\n", " ").strip()[:220] or "delegation completed"
        append_tool_result(
            tool=f"delegate_to_agent:{target_agent}",
            status="ok",
            summary=summary,
            ref=format_chain(active_chain),
        )
        append_reasoning(
            f"handoff_done: {source_agent} -> {target_agent} ({result.get('engine_used')}/{result.get('mode_used')})",
            source="handoff",
        )

        return _result(
            {
                "delegated": True,
                "source_agent": source_agent,
                "target_agent": target_agent,
                "chain": active_chain,
                "allowed_targets": sorted(allowed_targets_for(source_agent)),
                "response": response_text,
                "response_truncated": response_truncated,
                "structured_output": result.get("structured_output"),
                "engine_used": result.get("engine_used"),
                "model_used": result.get("model_used"),
                "mode_used": result.get("mode_used"),
                "cost_usd": float(result.get("cost_usd") or 0.0),
                "input_tokens": int(result.get("input_tokens") or 0),
                "output_tokens": int(result.get("output_tokens") or 0),
            }
        )
    except Exception as exc:
        append_reasoning(
            f"handoff_error: {source_agent} -> {target_agent} ({exc})",
            source="handoff",
        )
        append_tool_result(
            tool=f"delegate_to_agent:{target_agent}",
            status="error",
            summary=str(exc)[:220],
            ref=format_chain(normalized_chain),
        )
        return _error(f"委托执行失败：{exc}")


@tool(
    "delegate_batch_agents",
    "按批次委托多个子任务给不同 agent，支持 best_effort / all_or_nothing 最小事务协议。",
    {
        "type": "object",
        "properties": {
            "requests": {
                "type": "array",
                "description": "批次委托请求列表",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "target_agent": {"type": "string"},
                        "task": {"type": "string"},
                        "expected_output": {"type": "string"},
                        "context_patch": {"type": "object"},
                        "runtime": {"type": "object"},
                        "max_response_chars": {"type": "integer"},
                    },
                    "required": ["target_agent", "task"],
                },
            },
            "mode": {
                "type": "string",
                "enum": ["best_effort", "all_or_nothing"],
                "default": "best_effort",
                "description": "批次执行语义：best_effort 继续执行，all_or_nothing 首失败即停止",
            },
            "max_response_chars": {
                "type": "integer",
                "default": 2000,
                "description": "每个子任务返回文本的最大字符数",
            },
            "max_items": {
                "type": "integer",
                "default": 6,
                "description": "本次批次最多执行的请求数量（防止过大批次）",
            },
        },
        "required": ["requests"],
    },
    annotations=ToolAnnotations(idempotentHint=True),
)
async def delegate_batch_agents(args: dict[str, Any]) -> dict[str, Any]:
    request_ctx = get_agent_request_context()
    source_agent = str(request_ctx.agent_name or "").strip()
    if not source_agent:
        return _error("批次委托失败：缺少来源 agent 上下文")

    requests = args.get("requests")
    if not isinstance(requests, list) or len(requests) == 0:
        return _error("批次委托失败：requests 不能为空")

    mode = str(args.get("mode") or "best_effort").strip().lower()
    if mode not in {"best_effort", "all_or_nothing"}:
        mode = "best_effort"

    max_items = max(1, min(int(args.get("max_items", 6)), 12))
    effective_requests = requests[:max_items]
    max_chars_default = max(400, min(int(args.get("max_response_chars", 2000)), 12_000))
    batch_id = str(uuid.uuid4())

    from app.services import AgentService

    service = AgentService()
    items: list[dict[str, Any]] = []
    success_count = 0
    failed_count = 0
    skipped_count = 0
    stopped_on_failure = False

    for idx, raw_item in enumerate(effective_requests, start=1):
        item = raw_item if isinstance(raw_item, dict) else {}
        item_id = str(item.get("id") or f"step-{idx}")
        target_agent = str(item.get("target_agent") or "").strip()
        task = str(item.get("task") or "").strip()

        if stopped_on_failure:
            skipped_count += 1
            items.append(
                {
                    "id": item_id,
                    "target_agent": target_agent,
                    "status": "skipped",
                    "reason": "all_or_nothing stopped after previous failure",
                }
            )
            continue

        if target_agent not in AGENT_REGISTRY:
            failed_count += 1
            items.append(
                {
                    "id": item_id,
                    "target_agent": target_agent,
                    "status": "failed",
                    "error": f"unknown target agent: {target_agent}",
                }
            )
            if mode == "all_or_nothing":
                stopped_on_failure = True
            continue

        if not task:
            failed_count += 1
            items.append(
                {
                    "id": item_id,
                    "target_agent": target_agent,
                    "status": "failed",
                    "error": "task is empty",
                }
            )
            if mode == "all_or_nothing":
                stopped_on_failure = True
            continue

        allowed, reason, normalized_chain = validate_delegation(
            source_agent=source_agent,
            target_agent=target_agent,
        )
        if not allowed:
            failed_count += 1
            items.append(
                {
                    "id": item_id,
                    "target_agent": target_agent,
                    "status": "failed",
                    "error": reason,
                    "chain": normalized_chain,
                }
            )
            if mode == "all_or_nothing":
                stopped_on_failure = True
            continue

        delegated_prompt = _build_delegated_prompt(
            task=task,
            expected_output=str(item.get("expected_output") or ""),
        )
        max_chars = max(
            400,
            min(int(item.get("max_response_chars") or max_chars_default), 12_000),
        )

        try:
            append_reasoning(
                f"handoff_batch_start: {source_agent} -> {target_agent} ({item_id})",
                source="handoff",
            )

            with delegation_scope(source_agent, target_agent) as active_chain:
                delegated_context = _build_delegate_context(
                    source_agent=source_agent,
                    target_agent=target_agent,
                    chain=active_chain,
                    args=item,
                )
                result = await service.query(
                    agent_name=target_agent,
                    prompt=delegated_prompt,
                    student_id=request_ctx.student_id or None,
                    context=delegated_context,
                    role=request_ctx.role or "student",
                )

            response = str(result.get("response") or "")
            response_text = response[:max_chars]
            response_truncated = len(response) > max_chars

            success_count += 1
            items.append(
                {
                    "id": item_id,
                    "target_agent": target_agent,
                    "status": "success",
                    "chain": active_chain,
                    "response": response_text,
                    "response_truncated": response_truncated,
                    "structured_output": result.get("structured_output"),
                    "engine_used": result.get("engine_used"),
                    "model_used": result.get("model_used"),
                    "mode_used": result.get("mode_used"),
                    "cost_usd": float(result.get("cost_usd") or 0.0),
                    "input_tokens": int(result.get("input_tokens") or 0),
                    "output_tokens": int(result.get("output_tokens") or 0),
                }
            )
            append_reasoning(
                f"handoff_batch_done: {source_agent} -> {target_agent} ({item_id})",
                source="handoff",
            )
        except Exception as exc:
            failed_count += 1
            items.append(
                {
                    "id": item_id,
                    "target_agent": target_agent,
                    "status": "failed",
                    "error": str(exc),
                }
            )
            append_reasoning(
                f"handoff_batch_error: {source_agent} -> {target_agent} ({item_id}) {exc}",
                source="handoff",
            )
            if mode == "all_or_nothing":
                stopped_on_failure = True

    total = len(effective_requests)
    skipped_count += max(0, total - len(items))
    if len(items) < total:
        for idx in range(len(items) + 1, total + 1):
            items.append(
                {
                    "id": f"step-{idx}",
                    "target_agent": "",
                    "status": "skipped",
                    "reason": "not scheduled",
                }
            )

    committed = failed_count == 0 or mode == "best_effort"
    status = "ok" if committed else "error"

    append_tool_result(
        tool="delegate_batch_agents",
        status=status,
        summary=f"batch:{mode} success={success_count} failed={failed_count} skipped={skipped_count}",
        ref=batch_id,
    )

    return _result(
        {
            "batch_id": batch_id,
            "source_agent": source_agent,
            "mode": mode,
            "transaction": {
                "protocol": "delegation.batch.v1",
                "mode": mode,
                "committed": committed,
                "stopped_on_failure": stopped_on_failure,
            },
            "summary": {
                "total": total,
                "success": success_count,
                "failed": failed_count,
                "skipped": skipped_count,
            },
            "items": items,
        }
    )
