"""Homepage showcase tools — platform stats, trending careers, MBTI insight, UI commands."""

from __future__ import annotations

import json
from typing import Any

from claude_agent_sdk import ToolAnnotations, tool

from app.services.webagent_core import get_data_adapter

# ── 16 种 MBTI 一句话洞察 (本地数据，无需 API) ──

MBTI_INSIGHTS: dict[str, str] = {
    "INTJ": "战略家 — 独立思考的远见者，擅长将复杂系统化为清晰蓝图",
    "INTP": "逻辑学家 — 永不停歇的思考者，热衷于拆解世界运行的底层逻辑",
    "ENTJ": "指挥官 — 天生的领导者，善于制定计划并推动团队高效执行",
    "ENTP": "辩论家 — 思维敏捷的创新者，享受挑战常规和探索新可能",
    "INFJ": "提倡者 — 安静而坚定的理想主义者，用洞察力影响他人",
    "INFP": "调停者 — 富有想象力的共情者，追求内心价值与意义",
    "ENFJ": "主人公 — 充满魅力的引导者，天生能激发他人的潜能",
    "ENFP": "竞选者 — 热情洋溢的自由灵魂，总能看到生活中的无限可能",
    "ISTJ": "物流师 — 可靠务实的执行者，用条理和责任感构建稳固基础",
    "ISFJ": "守卫者 — 温暖而尽职的守护者，默默为他人创造安全感",
    "ESTJ": "总经理 — 果断高效的组织者，擅长建立秩序和推动落地",
    "ESFJ": "执政官 — 热心周到的协调者，善于营造和谐的团队氛围",
    "ISTP": "鉴赏家 — 冷静灵活的实践者，喜欢动手解决实际问题",
    "ISFP": "探险家 — 敏感而自由的艺术家，用行动表达内心世界",
    "ESTP": "企业家 — 大胆果敢的行动派，在变化中寻找机会",
    "ESFP": "表演者 — 活力四射的乐观者，善于点燃周围人的热情",
}


@tool(
    "get_platform_stats",
    "获取 PathMind 平台整体统计数据：总用户数、实验完成数、MBTI 测试完成数、活跃学习路径数。",
    {
        "type": "object",
        "properties": {},
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def get_platform_stats(args: dict[str, Any]) -> dict[str, Any]:
    adapter = get_data_adapter()
    try:
        data = await adapter.get_json("/stats/platform")
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取平台统计失败: {e}"}], "is_error": True}


@tool(
    "get_trending_careers",
    "获取本周热门职业推荐 TOP 5，基于全平台学生 MBTI 分布和市场趋势。",
    {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "返回数量", "default": 5},
        },
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def get_trending_careers(args: dict[str, Any]) -> dict[str, Any]:
    limit = args.get("limit", 5)
    adapter = get_data_adapter()
    try:
        data = await adapter.get_json("/careers/trending", params={"limit": limit})
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取热门职业失败: {e}"}], "is_error": True}


@tool(
    "get_quick_mbti_insight",
    "根据 MBTI 代码获取一句话性格洞察，无需登录即可使用。",
    {
        "type": "object",
        "properties": {
            "mbti_code": {
                "type": "string",
                "description": "4 字母 MBTI 代码，如 INTJ、ENFP",
            },
        },
        "required": ["mbti_code"],
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def get_quick_mbti_insight(args: dict[str, Any]) -> dict[str, Any]:
    code = args["mbti_code"].upper().strip()
    insight = MBTI_INSIGHTS.get(code)
    if insight:
        return {"content": [{"type": "text", "text": json.dumps(
            {"mbti_code": code, "insight": insight}, ensure_ascii=False
        )}]}
    return {"content": [{"type": "text", "text": f"未知的 MBTI 代码: {code}"}], "is_error": True}


@tool(
    "get_featured_experiments",
    "获取平台精选实验列表（完成率最高、最受欢迎的实验）。",
    {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "返回数量", "default": 3},
        },
    },
    annotations=ToolAnnotations(readOnlyHint=True, idempotentHint=True),
)
async def get_featured_experiments(args: dict[str, Any]) -> dict[str, Any]:
    limit = args.get("limit", 3)
    adapter = get_data_adapter()
    try:
        data = await adapter.get_json("/experiments/featured", params={"limit": limit})
        return {"content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False)}]}
    except Exception as e:
        return {"content": [{"type": "text", "text": f"获取精选实验失败: {e}"}], "is_error": True}


@tool(
    "emit_ui_command",
    "发送前端 UI 临时变更指令。可用指令: highlight(高亮区域), theme_pulse(主题脉冲), spotlight(聚光灯), confetti(庆祝粒子), morph_card(变形卡片), typewriter(打字机效果), focus_note_panel(聚焦笔记面板)。所有变更在用户离开页面后自动复原。",
    {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "enum": [
                    "highlight",
                    "theme_pulse",
                    "spotlight",
                    "confetti",
                    "morph_card",
                    "typewriter",
                    "focus_note_panel",
                ],
                "description": "UI 指令类型",
            },
            "target": {
                "type": "string",
                "description": "目标区域 ID: hero, quick-entry, features, stats, cta, note-panel",
            },
            "params": {
                "type": "object",
                "description": "指令参数，如 {color, duration_ms, text}",
            },
        },
        "required": ["command", "target"],
    },
    annotations=ToolAnnotations(idempotentHint=True),
)
async def emit_ui_command(args: dict[str, Any]) -> dict[str, Any]:
    """Return structured UI command JSON for the frontend to execute."""
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "ui_command": True,
                        "command": args["command"],
                        "target": args["target"],
                        "params": args.get("params", {}),
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


@tool(
    "navigate_page",
    "引导用户跳转到平台的指定页面。必须从 enum 列表中选择路由，不得自行缩写或修改。",
    {
        "type": "object",
        "properties": {
            "to": {
                "type": "string",
                "enum": [
                    "/",
                    "/dashboard",
                    "/mbti-test",
                    "/careers",
                    "/learning-path",
                    "/experiments",
                    "/documents",
                    "/ai-advisor",
                    "/notes",
                    "/graph",
                    "/profile",
                ],
                "description": "目标路由路径，必须从 enum 中选择",
            },
            "reason": {
                "type": "string",
                "description": "跳转原因，会展示给用户",
            },
        },
        "required": ["to"],
    },
    annotations=ToolAnnotations(idempotentHint=True),
)
async def navigate_page(args: dict[str, Any]) -> dict[str, Any]:
    """Return a navigate action for the frontend to execute."""
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "action": "navigate",
                        "to": args["to"],
                        "reason": args.get("reason", ""),
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


# ── Web Agent Protocol: 前端控制工具 ──


@tool(
    "show_toast",
    "在前端显示一条 toast 通知消息。用于向用户展示提示、成功、警告等短暂通知。",
    {
        "type": "object",
        "properties": {
            "message": {
                "type": "string",
                "description": "通知消息内容",
            },
            "level": {
                "type": "string",
                "enum": ["info", "success", "warning"],
                "description": "通知级别: info(信息), success(成功), warning(警告)",
                "default": "info",
            },
        },
        "required": ["message"],
    },
    annotations=ToolAnnotations(idempotentHint=True),
)
async def show_toast(args: dict[str, Any]) -> dict[str, Any]:
    """Return a toast notification for the frontend to display."""
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "toast": True,
                        "message": args["message"],
                        "level": args.get("level", "info"),
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


@tool(
    "scroll_to_section",
    "滚动页面到指定区域。可用目标: hero, quick-entry, features, stats, cta, 或任何带有 data-section-id 的元素。",
    {
        "type": "object",
        "properties": {
            "target": {
                "type": "string",
                "description": "目标区域 ID (对应前端 data-section-id 属性)",
            },
        },
        "required": ["target"],
    },
    annotations=ToolAnnotations(idempotentHint=True),
)
async def scroll_to_section(args: dict[str, Any]) -> dict[str, Any]:
    """Return a scroll-to action for the frontend to execute."""
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "scroll_to": True,
                        "target": args["target"],
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }


@tool(
    "set_theme",
    "切换前端主题为 dark(暗色) 或 light(亮色)。用于根据用户偏好或场景需要调整界面主题。",
    {
        "type": "object",
        "properties": {
            "theme": {
                "type": "string",
                "enum": ["dark", "light"],
                "description": "目标主题: dark 或 light",
            },
        },
        "required": ["theme"],
    },
    annotations=ToolAnnotations(idempotentHint=True),
)
async def set_theme(args: dict[str, Any]) -> dict[str, Any]:
    """Return a theme-switch action for the frontend to execute."""
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(
                    {
                        "set_theme": True,
                        "theme": args["theme"],
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }
