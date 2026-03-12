"""Task template catalog for cross-module WebAgent workflows (P7-1)."""

from __future__ import annotations

import copy
import time
import uuid
from typing import Any

_TASK_TEMPLATES: list[dict[str, Any]] = [
    {
        "task_type": "documents_to_notes",
        "label": "文档沉淀到笔记",
        "description": "从 PDF 检索关键内容，生成结构化学习笔记草稿。",
        "target_agent": "document-reader",
        "default_prompt": "请从当前 PDF 资料中提炼重点并输出可直接落地的学习笔记结构。",
        "risk_level": "low",
        "tags": ["documents", "notes", "rag"],
        "steps": [
            {
                "id": "retrieve",
                "label": "检索文档片段",
                "module": "documents",
                "action": "retrieve",
                "risk": "low",
            },
            {
                "id": "summarize",
                "label": "提炼关键信息",
                "module": "advisor",
                "action": "summarize",
                "risk": "low",
            },
            {
                "id": "write_note",
                "label": "生成笔记草稿",
                "module": "notes",
                "action": "write_note",
                "risk": "medium",
            },
        ],
        "receipt_schema": {
            "version": "v1",
            "fields": ["run_id", "task_type", "status", "steps", "approvals", "artifacts"],
        },
    },
    {
        "task_type": "notes_to_graph_analysis",
        "label": "笔记提炼到图谱分析",
        "description": "把笔记中的概念关系整理为图谱分析任务并生成回执。",
        "target_agent": "note-assistant",
        "default_prompt": "请基于当前笔记内容抽取实体与关系，并给出图谱分析路径。",
        "risk_level": "medium",
        "tags": ["notes", "graph"],
        "steps": [
            {
                "id": "extract",
                "label": "抽取实体关系",
                "module": "notes",
                "action": "extract_entities",
                "risk": "low",
            },
            {
                "id": "graph",
                "label": "执行图谱分析",
                "module": "graph",
                "action": "graph_analysis",
                "risk": "medium",
            },
            {
                "id": "receipt",
                "label": "生成分析回执",
                "module": "advisor",
                "action": "receipt",
                "risk": "low",
            },
        ],
        "receipt_schema": {
            "version": "v1",
            "fields": ["run_id", "task_type", "status", "steps", "graph_batch_id", "issues"],
        },
    },
    {
        "task_type": "experiment_retro_report",
        "label": "实验复盘报告",
        "description": "对实验执行过程进行复盘，输出问题清单与修复建议。",
        "target_agent": "web-coder",
        "default_prompt": "请对实验执行过程做复盘，输出问题、根因、修复动作和下一步计划。",
        "risk_level": "medium",
        "tags": ["experiments", "coding"],
        "steps": [
            {
                "id": "collect",
                "label": "采集实验上下文",
                "module": "experiments",
                "action": "collect_context",
                "risk": "low",
            },
            {
                "id": "analyze",
                "label": "代码与结果分析",
                "module": "coding",
                "action": "analyze",
                "risk": "medium",
            },
            {
                "id": "report",
                "label": "产出复盘报告",
                "module": "advisor",
                "action": "report",
                "risk": "low",
            },
        ],
        "receipt_schema": {
            "version": "v1",
            "fields": ["run_id", "task_type", "status", "steps", "risk_level", "next_actions"],
        },
    },
]


def list_task_templates() -> list[dict[str, Any]]:
    """Return task template catalog for UI/agent orchestration."""
    return copy.deepcopy(_TASK_TEMPLATES)


def get_task_template(task_type: str) -> dict[str, Any] | None:
    """Return one task template by task_type."""
    needle = str(task_type or "").strip()
    if not needle:
        return None
    for template in _TASK_TEMPLATES:
        if str(template.get("task_type") or "").strip() == needle:
            return copy.deepcopy(template)
    return None


def create_task_run_id(task_type: str) -> str:
    """Generate stable run id for one task template execution."""
    prefix = str(task_type or "task").strip() or "task"
    suffix = uuid.uuid4().hex[:12]
    return f"task:{prefix}:{suffix}"


def now_ts() -> int:
    """Return unix timestamp in seconds."""
    return int(time.time())
