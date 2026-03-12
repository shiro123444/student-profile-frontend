"""历史消息管理器 - 处理对话长度限制

提供多种策略处理 Kiro API 的输入长度限制：
1. 自动截断 - 保留最近 N 条消息
2. 智能摘要 - 压缩早期消息（需要额外 API 调用）
3. 错误重试 - 捕获错误后截断重试
4. 预估检测 - 发送前预估并截断
"""
import json
import httpx
import time
from typing import List, Dict, Any, Tuple, Optional, Callable
from dataclasses import dataclass, field
from collections import OrderedDict
from enum import Enum


@dataclass
class SummaryCacheEntry:
    summary: str
    old_history_count: int
    old_history_chars: int
    updated_at: float


class SummaryCache:
    """轻量摘要缓存（按会话）"""

    def __init__(self, max_entries: int = 128):
        self._entries: "OrderedDict[str, SummaryCacheEntry]" = OrderedDict()
        self._max_entries = max_entries

    def get(
        self,
        key: str,
        old_history_count: int,
        old_history_chars: int,
        min_delta_messages: int,
        min_delta_chars: int,
        max_age_seconds: int
    ) -> Optional[str]:
        entry = self._entries.get(key)
        if not entry:
            return None

        now = time.time()
        if max_age_seconds > 0 and now - entry.updated_at > max_age_seconds:
            self._entries.pop(key, None)
            return None

        if old_history_count - entry.old_history_count >= min_delta_messages:
            return None

        if old_history_chars - entry.old_history_chars >= min_delta_chars:
            return None

        self._entries.move_to_end(key)
        return entry.summary

    def set(
        self,
        key: str,
        summary: str,
        old_history_count: int,
        old_history_chars: int
    ):
        self._entries[key] = SummaryCacheEntry(
            summary=summary,
            old_history_count=old_history_count,
            old_history_chars=old_history_chars,
            updated_at=time.time()
        )
        self._entries.move_to_end(key)
        if len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)


class TruncateStrategy(str, Enum):
    """截断策略"""
    NONE = "none"                    # 不截断
    AUTO_TRUNCATE = "auto_truncate"  # 自动截断（保留最近 N 条）
    SMART_SUMMARY = "smart_summary"  # 智能摘要
    ERROR_RETRY = "error_retry"      # 错误时截断重试
    PRE_ESTIMATE = "pre_estimate"    # 预估检测


@dataclass
class HistoryConfig:
    """历史消息配置"""
    # 启用的策略（可多选）- 默认启用主动截断+错误重试+预估检测
    strategies: List[TruncateStrategy] = field(default_factory=lambda: [
        TruncateStrategy.AUTO_TRUNCATE,
        TruncateStrategy.ERROR_RETRY,
        TruncateStrategy.PRE_ESTIMATE,
    ])
    
    # 自动截断配置（kiro.rs 不做截断，这里保留更宽松的安全限制）
    max_messages: int = 100          # 最大消息数（kiro.rs 无限制，这里设安全上限）
    max_chars: int = 800000          # 最大字符数（约 266k tokens，kiro.rs 无限制）
    
    # 智能摘要配置
    summary_keep_recent: int = 8     # 摘要时保留最近 N 条完整消息
    summary_threshold: int = 700000  # 触发摘要的字符数阈值
    summary_max_length: int = 2000   # 摘要最大长度
    
    # 错误重试配置
    retry_max_messages: int = 30     # 重试时保留的消息数
    max_retries: int = 3             # 最大重试次数
    
    # 预估配置
    estimate_threshold: int = 900000  # 预估阈值（字符数）
    chars_per_token: float = 3.0      # 每 token 约等于多少字符

    # 摘要缓存（保守策略）
    summary_cache_enabled: bool = True          # 是否启用摘要缓存
    summary_cache_min_delta_messages: int = 3   # 旧历史新增 N 条后刷新摘要
    summary_cache_min_delta_chars: int = 4000   # 旧历史新增字符数阈值
    summary_cache_max_age_seconds: int = 180    # 摘要最大复用时间

    # 是否添加截断警告
    add_warning_header: bool = True
    
    def to_dict(self) -> dict:
        return {
            "strategies": [s.value for s in self.strategies],
            "max_messages": self.max_messages,
            "max_chars": self.max_chars,
            "summary_keep_recent": self.summary_keep_recent,
            "summary_threshold": self.summary_threshold,
            "summary_max_length": self.summary_max_length,
            "retry_max_messages": self.retry_max_messages,
            "max_retries": self.max_retries,
            "estimate_threshold": self.estimate_threshold,
            "chars_per_token": self.chars_per_token,
            "summary_cache_enabled": self.summary_cache_enabled,
            "summary_cache_min_delta_messages": self.summary_cache_min_delta_messages,
            "summary_cache_min_delta_chars": self.summary_cache_min_delta_chars,
            "summary_cache_max_age_seconds": self.summary_cache_max_age_seconds,
            "add_warning_header": self.add_warning_header,
        }
    
    @classmethod
    def from_dict(cls, data: dict) -> "HistoryConfig":
        strategies = [TruncateStrategy(s) for s in data.get("strategies", ["auto_truncate", "error_retry", "pre_estimate"])]
        return cls(
            strategies=strategies,
            max_messages=data.get("max_messages", 100),
            max_chars=data.get("max_chars", 800000),
            summary_keep_recent=data.get("summary_keep_recent", 8),
            summary_threshold=data.get("summary_threshold", 700000),
            summary_max_length=data.get("summary_max_length", 2000),
            retry_max_messages=data.get("retry_max_messages", 30),
            max_retries=data.get("max_retries", 3),
            estimate_threshold=data.get("estimate_threshold", 900000),
            chars_per_token=data.get("chars_per_token", 3.0),
            summary_cache_enabled=data.get("summary_cache_enabled", True),
            summary_cache_min_delta_messages=data.get("summary_cache_min_delta_messages", 3),
            summary_cache_min_delta_chars=data.get("summary_cache_min_delta_chars", 4000),
            summary_cache_max_age_seconds=data.get("summary_cache_max_age_seconds", 180),
            add_warning_header=data.get("add_warning_header", True),
        )


_summary_cache = SummaryCache()


class HistoryManager:
    """历史消息管理器"""
    
    def __init__(self, config: HistoryConfig = None, cache_key: Optional[str] = None):
        self.config = config or HistoryConfig()
        self._truncated = False
        self._truncate_info = ""
        self.cache_key = cache_key
        self.original_history_len = 0  # 截断前的原始消息数
        self.truncated_history_len = 0  # 截断后的消息数
    
    @property
    def was_truncated(self) -> bool:
        """是否发生了截断"""
        return self._truncated
    
    @property
    def truncate_info(self) -> str:
        """截断信息"""
        return self._truncate_info
    
    def reset(self):
        """重置状态"""
        self._truncated = False
        self._truncate_info = ""
        self.original_history_len = 0
        self.truncated_history_len = 0

    def set_cache_key(self, cache_key: Optional[str]):
        """设置摘要缓存 key"""
        self.cache_key = cache_key

    def _summary_cache_key(self, target_count: int) -> Optional[str]:
        if not self.cache_key:
            return None
        return f"{self.cache_key}:{target_count}"
    
    def estimate_tokens(self, text: str) -> int:
        """估算 token 数量"""
        return int(len(text) / self.config.chars_per_token)
    
    def estimate_history_size(self, history: List[dict]) -> Tuple[int, int]:
        """估算历史消息大小
        
        Returns:
            (message_count, char_count)
        """
        char_count = len(json.dumps(history, ensure_ascii=False))
        return len(history), char_count

    def estimate_request_chars(self, history: List[dict], user_content: str = "") -> Tuple[int, int, int]:
        """估算请求字符数 (history_chars, user_chars, total_chars)"""
        history_chars = len(json.dumps(history, ensure_ascii=False))
        user_chars = len(user_content or "")
        return history_chars, user_chars, history_chars + user_chars
    
    def truncate_by_count(self, history: List[dict], max_count: int) -> List[dict]:
        """按消息数量截断"""
        if len(history) <= max_count:
            return history
        
        original_count = len(history)
        truncated = history[-max_count:]
        self._truncated = True
        self._truncate_info = f"按数量截断: {original_count} -> {len(truncated)} 条消息"
        return truncated
    
    def truncate_by_chars(self, history: List[dict], max_chars: int) -> List[dict]:
        """按字符数截断"""
        total_chars = len(json.dumps(history, ensure_ascii=False))
        if total_chars <= max_chars:
            return history
        
        original_count = len(history)
        # 从后往前保留
        result = []
        current_chars = 0
        
        for msg in reversed(history):
            msg_chars = len(json.dumps(msg, ensure_ascii=False))
            if current_chars + msg_chars > max_chars and result:
                break
            result.insert(0, msg)
            current_chars += msg_chars
        
        if len(result) < original_count:
            self._truncated = True
            self._truncate_info = f"按字符数截断: {original_count} -> {len(result)} 条消息 ({total_chars} -> {current_chars} 字符)"
        
        return result

    def trim_tool_content_in_history(self, history: List[dict], max_tool_content_chars: int = 2000) -> List[dict]:
        """[已禁用] 截断历史中 toolResults 和 toolUses 的内容。
        
        为了对齐 kiro.rs（不进行任何截断），此功能已被禁用。
        """
        # 为了对齐 kiro.rs 的行为（不截断），直接返回原始历史
        return history
        
        # --- 以下是旧的截断逻辑，已保留但不会执行 ---
        import copy
        result = copy.deepcopy(history)
        trimmed_count = 0

        for msg in result:
            # 截断 userInputMessage 中的 toolResults
            if "userInputMessage" in msg:
                ctx = msg["userInputMessage"].get("userInputMessageContext", {})
                tool_results = ctx.get("toolResults", [])
                for tr in tool_results:
                    content_list = tr.get("content", [])
                    for item in content_list:
                        if isinstance(item, dict) and "text" in item:
                            text = item["text"]
                            if len(text) > max_tool_content_chars:
                                item["text"] = text[:max_tool_content_chars] + f"\n...[truncated {len(text) - max_tool_content_chars} chars]"
                                trimmed_count += 1

            # 截断 assistantResponseMessage 中的 toolUses input
            if "assistantResponseMessage" in msg:
                tool_uses = msg["assistantResponseMessage"].get("toolUses", [])
                for tu in tool_uses:
                    inp = tu.get("input", {})
                    if isinstance(inp, dict):
                        for key, val in inp.items():
                            if isinstance(val, str) and len(val) > max_tool_content_chars:
                                inp[key] = val[:max_tool_content_chars] + f"\n...[truncated {len(val) - max_tool_content_chars} chars]"
                                trimmed_count += 1

            # 也截断 OpenAI 格式的 tool 角色消息内容
            if msg.get("role") == "tool":
                content = msg.get("content", "")
                if isinstance(content, str) and len(content) > max_tool_content_chars:
                    msg["content"] = content[:max_tool_content_chars] + f"\n...[truncated {len(content) - max_tool_content_chars} chars]"
                    trimmed_count += 1

        if trimmed_count > 0:
            print(f"[HistoryManager] 截断了 {trimmed_count} 个工具内容块 (max={max_tool_content_chars} chars)")

        return result
    
    def _extract_text(self, content) -> str:
        """从消息内容中提取文本"""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = []
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    texts.append(item.get("text", ""))
                elif isinstance(item, str):
                    texts.append(item)
            return "\n".join(texts)
        if isinstance(content, dict):
            return content.get("text", "") or content.get("content", "")
        return str(content) if content else ""
    
    def _format_history_for_summary(self, history: List[dict]) -> str:
        """格式化历史消息用于生成摘要"""
        lines = []
        for msg in history:
            role = "unknown"
            content = ""
            if "userInputMessage" in msg:
                role = "user"
                content = msg.get("userInputMessage", {}).get("content", "")
            elif "assistantResponseMessage" in msg:
                role = "assistant"
                content = msg.get("assistantResponseMessage", {}).get("content", "")
            else:
                role = msg.get("role", "unknown")
                content = self._extract_text(msg.get("content", ""))
            # 截断过长的单条消息
            if len(content) > 500:
                content = content[:500] + "..."
            lines.append(f"[{role}]: {content}")
        return "\n".join(lines)

    def _entry_kind(self, msg: dict) -> str:
        """提取消息类型"""
        if "userInputMessage" in msg:
            return "U"
        if "assistantResponseMessage" in msg:
            return "A"
        role = msg.get("role")
        if role == "user":
            return "U"
        if role == "assistant":
            return "A"
        return "?"

    def summarize_history_structure(self, history: List[dict], max_items: int = 12) -> str:
        """生成历史结构摘要"""
        if not history:
            return "len=0"

        kinds = [self._entry_kind(msg) for msg in history]
        counts = {"U": 0, "A": 0, "?": 0}
        for k in kinds:
            counts[k] = counts.get(k, 0) + 1

        alternating = True
        for i in range(1, len(kinds)):
            if kinds[i] == kinds[i - 1] or kinds[i] == "?" or kinds[i - 1] == "?":
                alternating = False
                break

        tool_uses = 0
        tool_results = 0
        for msg in history:
            if "assistantResponseMessage" in msg:
                tool_uses += len(msg["assistantResponseMessage"].get("toolUses", []) or [])
            if "userInputMessage" in msg:
                ctx = msg["userInputMessage"].get("userInputMessageContext", {})
                tool_results += len(ctx.get("toolResults", []) or [])

        if len(kinds) <= max_items:
            seq = "".join(kinds)
        else:
            head_len = max_items // 2
            tail_len = max_items - head_len
            seq = f"{''.join(kinds[:head_len])}...{''.join(kinds[-tail_len:])}"

        return (
            f"len={len(history)} seq={seq} alt={'yes' if alternating else 'no'} "
            f"U={counts['U']} A={counts['A']} ?={counts['?']} "
            f"tool_uses={tool_uses} tool_results={tool_results}"
        )

    def _build_summary_history(
        self,
        summary: str,
        recent_history: List[dict],
        debug_label: Optional[str] = None
    ) -> List[dict]:
        """用摘要替换旧历史，保留最近完整上下文
        
        关键规则：
        1. 历史必须以 user 消息开头
        2. user/assistant 必须严格交替
        3. 当 assistant 有 toolUses 时，下一条 user 必须有对应的 toolResults
        4. 当 assistant 没有 toolUses 时，下一条 user 不能有 toolResults
        """
        if any("userInputMessage" in h or "assistantResponseMessage" in h for h in recent_history):
            # 如果 recent_history 以 assistant 开头，跳过它
            if recent_history and "assistantResponseMessage" in recent_history[0]:
                recent_history = recent_history[1:]

            # 收集所有 toolUse IDs（用于后续验证）
            tool_use_ids = set()
            for msg in recent_history:
                if "assistantResponseMessage" in msg:
                    for tu in msg["assistantResponseMessage"].get("toolUses", []) or []:
                        tu_id = tu.get("toolUseId")
                        if tu_id:
                            tool_use_ids.add(tu_id)

            # 检查 recent_history 的第一条消息
            first_user_has_tool_results = False
            if recent_history and "userInputMessage" in recent_history[0]:
                ctx = recent_history[0].get("userInputMessage", {}).get("userInputMessageContext", {})
                first_user_has_tool_results = bool(ctx.get("toolResults"))
            
            # 如果第一条 user 消息有 toolResults，需要清除它
            # 因为摘要后的 assistant 占位消息没有 toolUses
            if first_user_has_tool_results:
                recent_history[0]["userInputMessage"].pop("userInputMessageContext", None)

            # 过滤孤立的 toolResults（没有对应 toolUse）
            # 重新收集 tool_use_ids（因为可能已经修改了 recent_history）
            tool_use_ids = set()
            for msg in recent_history:
                if "assistantResponseMessage" in msg:
                    for tu in msg["assistantResponseMessage"].get("toolUses", []) or []:
                        tu_id = tu.get("toolUseId")
                        if tu_id:
                            tool_use_ids.add(tu_id)

            if tool_use_ids:
                for msg in recent_history:
                    if "userInputMessage" in msg:
                        ctx = msg.get("userInputMessage", {}).get("userInputMessageContext", {})
                        results = ctx.get("toolResults")
                        if results:
                            filtered = [r for r in results if r.get("toolUseId") in tool_use_ids]
                            if filtered:
                                ctx["toolResults"] = filtered
                            else:
                                ctx.pop("toolResults", None)
                            if not ctx:
                                msg["userInputMessage"].pop("userInputMessageContext", None)
            else:
                # 没有任何 toolUses，清除所有 toolResults
                for msg in recent_history:
                    if "userInputMessage" in msg:
                        msg["userInputMessage"].pop("userInputMessageContext", None)

            model_id = "claude-sonnet-4"
            for msg in reversed(recent_history):
                if "userInputMessage" in msg:
                    model_id = msg["userInputMessage"].get("modelId", model_id)
                    break
                if "assistantResponseMessage" in msg:
                    model_id = msg["assistantResponseMessage"].get("modelId", model_id)
                    break

            summary_msg = {
                "userInputMessage": {
                    "content": f"[Earlier conversation summary]\n{summary}\n\n[Continuing from recent messages...]",
                    "modelId": model_id,
                    "origin": "AI_EDITOR",
                }
            }
            result = [summary_msg]
            # 占位 assistant 消息（没有 toolUses）
            result.append({
                "assistantResponseMessage": {
                    "content": "I understand the context. Let's continue."
                }
            })
            result.extend(recent_history)
            if debug_label:
                print(f"[HistoryManager] {debug_label}: {self.summarize_history_structure(result)}")
            return result

        summary_msg = {
            "role": "user",
            "content": f"[Earlier conversation summary]\n{summary}\n\n[Continuing from recent messages...]"
        }
        result = [summary_msg]
        result.append({
            "role": "assistant",
            "content": "I understand the context. Let's continue."
        })
        result.extend(recent_history)
        if debug_label:
            print(f"[HistoryManager] {debug_label}: {self.summarize_history_structure(result)}")
        return result
    
    async def generate_summary(self, history: List[dict], api_caller: Callable) -> Optional[str]:
        """生成历史消息摘要
        
        Args:
            history: 需要摘要的历史消息
            api_caller: API 调用函数，签名为 async (prompt: str) -> str
        
        Returns:
            摘要文本，失败返回 None
        """
        if not history:
            return None
        
        formatted = self._format_history_for_summary(history)
        # 限制输入长度
        if len(formatted) > 10000:
            formatted = formatted[:10000] + "\n...(truncated)"
        
        prompt = f"""请简洁地总结以下对话历史的关键信息，包括：
1. 用户的主要目标和需求
2. 已完成的重要操作
3. 当前的工作状态和上下文

对话历史：
{formatted}

请用中文输出摘要，控制在 {self.config.summary_max_length} 字符以内："""
        
        try:
            summary = await api_caller(prompt)
            if summary and len(summary) > self.config.summary_max_length:
                summary = summary[:self.config.summary_max_length] + "..."
            return summary
        except Exception as e:
            print(f"[HistoryManager] 生成摘要失败: {e}")
            return None
    
    async def compress_with_summary(
        self, 
        history: List[dict], 
        api_caller: Callable
    ) -> List[dict]:
        """使用智能摘要压缩历史消息
        
        Args:
            history: 历史消息
            api_caller: API 调用函数
        
        Returns:
            压缩后的历史消息
        """
        total_chars = len(json.dumps(history, ensure_ascii=False))
        if total_chars <= self.config.summary_threshold:
            return history
        
        if len(history) <= self.config.summary_keep_recent:
            return history
        
        # 分离早期消息和最近消息
        keep_recent = self.config.summary_keep_recent
        old_history = history[:-keep_recent]
        recent_history = history[-keep_recent:]
        
        # 生成摘要
        summary = await self.generate_summary(old_history, api_caller)
        
        if not summary:
            # 摘要失败，回退到带占位摘要的截断（确保历史格式合法）
            self._truncated = True
            generic_summary = "Earlier conversation context was too long to summarize. Continuing from recent messages."
            result = self._build_summary_history(generic_summary, recent_history, "摘要失败回退结构")
            self._truncate_info = f"摘要生成失败，回退截断: {len(history)} -> {len(result)} 条消息"
            return result

        # 构建带摘要的历史
        result = self._build_summary_history(summary, recent_history, "智能摘要结构")
        
        self._truncated = True
        self._truncate_info = f"智能摘要: {len(history)} -> {len(result)} 条消息 (摘要 {len(summary)} 字符)"
        
        return result

    async def compress_before_auto_truncate(
        self,
        history: List[dict],
        api_caller: Callable
    ) -> List[dict]:
        """在自动截断前生成摘要，保留最近完整上下文"""
        if len(history) <= 1:
            return history

        # 预留 2 条消息（summary + assistant 占位）
        if self.config.max_messages <= 2:
            return history

        keep_recent = min(len(history) - 1, self.config.max_messages - 2)
        if keep_recent <= 0:
            return history

        old_history = history[:-keep_recent]
        recent_history = history[-keep_recent:]

        summary = await self.generate_summary(old_history, api_caller)
        if not summary:
            return history

        result = self._build_summary_history(summary, recent_history, "自动截断前摘要结构")

        self._truncated = True
        self._truncate_info = f"自动截断前摘要: {len(history)} -> {len(result)} 条消息 (摘要 {len(summary)} 字符)"
        
        return result

    async def handle_length_error_async(
        self,
        history: List[dict],
        retry_count: int = 0,
        api_caller: Optional[Callable] = None
    ) -> Tuple[List[dict], bool]:
        """处理长度超限错误（优先摘要旧历史再重试）

        Args:
            history: 历史消息
            retry_count: 当前重试次数
            api_caller: API 调用函数，用于生成摘要

        Returns:
            (truncated_history, should_retry)
        """
        if TruncateStrategy.ERROR_RETRY not in self.config.strategies:
            return history, False

        if retry_count >= self.config.max_retries:
            return history, False

        if not history:
            return history, False

        self.reset()

        factor = 1.0 - (retry_count * 0.3)
        target_count = max(5, int(self.config.retry_max_messages * factor))

        # 即使消息数已经 <= target_count，如果内容仍然太大，
        # 通过截断工具内容来减少 token 占用
        if len(history) <= target_count:
            total_chars = len(json.dumps(history, ensure_ascii=False))
            if total_chars > 100000:  # 100k chars ≈ 33k tokens
                # 根据重试次数逐步更激进地截断工具内容（kiro.rs 不截断，这里保守处理）
                max_tool_chars = max(500, 2000 - retry_count * 500)
                trimmed = self.trim_tool_content_in_history(history, max_tool_content_chars=max_tool_chars)
                new_chars = len(json.dumps(trimmed, ensure_ascii=False))
                if new_chars < total_chars:
                    self._truncated = True
                    self._truncate_info = f"工具内容截断 (第 {retry_count + 1} 次): {total_chars} -> {new_chars} 字符 (max_tool={max_tool_chars})"
                    return trimmed, True
            return history, False

        if api_caller:
            old_history = history[:-target_count]
            recent_history = history[-target_count:]
            cache_key = self._summary_cache_key(target_count)
            old_count = len(old_history)
            old_chars = len(json.dumps(old_history, ensure_ascii=False))
            cached = None
            if cache_key and self.config.summary_cache_enabled:
                cached = _summary_cache.get(
                    cache_key,
                    old_count,
                    old_chars,
                    self.config.summary_cache_min_delta_messages,
                    self.config.summary_cache_min_delta_chars,
                    self.config.summary_cache_max_age_seconds
                )
            if cached:
                result = self._build_summary_history(cached, recent_history, "错误重试摘要缓存结构")
                self._truncated = True
                self._truncate_info = f"错误重试摘要(缓存) (第 {retry_count + 1} 次): {len(history)} -> {len(result)} 条消息"
                return result, True

            summary = await self.generate_summary(old_history, api_caller)
            if summary:
                result = self._build_summary_history(summary, recent_history, "错误重试摘要结构")
                self._truncated = True
                self._truncate_info = f"错误重试摘要 (第 {retry_count + 1} 次): {len(history)} -> {len(result)} 条消息 (摘要 {len(summary)} 字符)"
                if cache_key and self.config.summary_cache_enabled:
                    _summary_cache.set(cache_key, summary, old_count, old_chars)
                return result, True

        # 摘要失败或无 api_caller，回退到按数量截断 + 工具内容截断
        self.reset()
        truncated = self.truncate_by_count(history, target_count)
        # 额外截断工具内容（kiro.rs 不截断，这里保守处理）
        max_tool_chars = max(500, 2000 - retry_count * 500)
        truncated = self.trim_tool_content_in_history(truncated, max_tool_content_chars=max_tool_chars)
        if len(truncated) < len(history) or json.dumps(truncated, ensure_ascii=False) != json.dumps(history, ensure_ascii=False):
            self._truncate_info = f"错误重试截断+工具截断 (第 {retry_count + 1} 次): {len(history)} -> {len(truncated)} 条消息 (max_tool={max_tool_chars})"
            return truncated, True

        return history, False
    
    def should_pre_truncate(self, history: List[dict], user_content: str) -> bool:
        """检查是否需要预截断"""
        if TruncateStrategy.PRE_ESTIMATE not in self.config.strategies:
            return False
        
        total_chars = len(json.dumps(history, ensure_ascii=False)) + len(user_content)
        return total_chars > self.config.estimate_threshold
    
    def should_summarize(self, history: List[dict]) -> bool:
        """检查是否需要摘要（智能摘要或自动截断前摘要）"""
        return self.should_smart_summarize(history) or self.should_auto_truncate_summarize(history)

    def should_pre_summary_for_error_retry(self, history: List[dict], user_content: str = "") -> bool:
        """错误重试触发前的预摘要判定"""
        if TruncateStrategy.ERROR_RETRY not in self.config.strategies:
            return False
        if not history:
            return False
        _, _, total_chars = self.estimate_request_chars(history, user_content)
        return total_chars > self.config.estimate_threshold

    def should_smart_summarize(self, history: List[dict]) -> bool:
        """检查是否需要智能摘要"""
        if TruncateStrategy.SMART_SUMMARY not in self.config.strategies:
            return False

        total_chars = len(json.dumps(history, ensure_ascii=False))
        return total_chars > self.config.summary_threshold and len(history) > self.config.summary_keep_recent

    def should_auto_truncate_summarize(self, history: List[dict]) -> bool:
        """检查是否需要自动截断前摘要"""
        if TruncateStrategy.AUTO_TRUNCATE not in self.config.strategies:
            return False

        if len(history) <= 1:
            return False

        total_chars = len(json.dumps(history, ensure_ascii=False))
        return len(history) > self.config.max_messages or total_chars > self.config.max_chars
    
    def pre_process(self, history: List[dict], user_content: str = "") -> List[dict]:
        """预处理历史消息（发送前，同步版本）
        
        根据配置的策略进行预处理（不包括智能摘要）
        """
        self.reset()
        self.original_history_len = len(history) if history else 0
        
        if not history:
            return history
        
        result = history
        
        # 策略 1: 自动截断
        if TruncateStrategy.AUTO_TRUNCATE in self.config.strategies:
            # 先按数量截断
            result = self.truncate_by_count(result, self.config.max_messages)
            # 再按字符数截断
            result = self.truncate_by_chars(result, self.config.max_chars)
        
        # 策略 4: 预估检测
        if TruncateStrategy.PRE_ESTIMATE in self.config.strategies:
            total_chars = len(json.dumps(result, ensure_ascii=False)) + len(user_content)
            if total_chars > self.config.estimate_threshold:
                # 计算需要保留的消息数
                target_chars = int(self.config.estimate_threshold * 0.8)  # 留 20% 余量
                result = self.truncate_by_chars(result, target_chars)
        
        # 最后：截断工具调用内容（减少每条消息的 token 占用）
        total_chars = len(json.dumps(result, ensure_ascii=False))
        if total_chars > 100000:  # 100k chars ≈ 33k tokens，仍然很大
            result = self.trim_tool_content_in_history(result, max_tool_content_chars=2000)
        
        return result
    
    async def pre_process_async(
        self, 
        history: List[dict], 
        user_content: str = "",
        api_caller: Callable = None
    ) -> List[dict]:
        """预处理历史消息（发送前，异步版本，支持智能摘要）
        
        Args:
            history: 历史消息
            user_content: 当前用户消息
            api_caller: API 调用函数，用于生成摘要
        """
        self.reset()
        self.original_history_len = len(history) if history else 0
        
        if not history:
            return history
        
        result = history

        # 错误重试预摘要（避免首次请求直接超限）
        pre_summarized = False
        if TruncateStrategy.ERROR_RETRY in self.config.strategies and api_caller:
            if self.should_pre_summary_for_error_retry(result, user_content):
                target_count = self.config.retry_max_messages
                if len(result) > target_count:
                    old_history = result[:-target_count]
                    recent_history = result[-target_count:]
                    cache_key = self._summary_cache_key(target_count)
                    old_count = len(old_history)
                    old_chars = len(json.dumps(old_history, ensure_ascii=False))
                    cached = None
                    if cache_key and self.config.summary_cache_enabled:
                        cached = _summary_cache.get(
                            cache_key,
                            old_count,
                            old_chars,
                            self.config.summary_cache_min_delta_messages,
                            self.config.summary_cache_min_delta_chars,
                            self.config.summary_cache_max_age_seconds
                        )
                    if cached:
                        result = self._build_summary_history(cached, recent_history, "错误重试预摘要缓存结构")
                        self._truncated = True
                        self._truncate_info = f"错误重试预摘要(缓存): {len(history)} -> {len(result)} 条消息"
                        pre_summarized = True
                    else:
                        summary = await self.generate_summary(old_history, api_caller)
                        if summary:
                            result = self._build_summary_history(summary, recent_history, "错误重试预摘要结构")
                            self._truncated = True
                            self._truncate_info = f"错误重试预摘要: {len(history)} -> {len(result)} 条消息 (摘要 {len(summary)} 字符)"
                            pre_summarized = True
                            if cache_key and self.config.summary_cache_enabled:
                                _summary_cache.set(cache_key, summary, old_count, old_chars)
        
        # 策略 2: 智能摘要（优先级最高）
        summary_applied = False
        if TruncateStrategy.SMART_SUMMARY in self.config.strategies and api_caller:
            if self.should_smart_summarize(result) and not pre_summarized:
                result = await self.compress_with_summary(result, api_caller)
                summary_applied = True
                # 摘要后如果还是太长，继续其他策略

        # 自动截断前摘要（保留最新完整上下文）
        if (
            TruncateStrategy.AUTO_TRUNCATE in self.config.strategies
            and api_caller
            and not summary_applied
            and self.should_auto_truncate_summarize(result)
        ):
            result = await self.compress_before_auto_truncate(result, api_caller)
        
        # 策略 1: 自动截断
        if TruncateStrategy.AUTO_TRUNCATE in self.config.strategies:
            result = self.truncate_by_count(result, self.config.max_messages)
            result = self.truncate_by_chars(result, self.config.max_chars)
        
        # 策略 4: 预估检测
        if TruncateStrategy.PRE_ESTIMATE in self.config.strategies:
            total_chars = len(json.dumps(result, ensure_ascii=False)) + len(user_content)
            if total_chars > self.config.estimate_threshold:
                target_chars = int(self.config.estimate_threshold * 0.8)
                result = self.truncate_by_chars(result, target_chars)
        
        # 最后：截断工具调用内容（减少每条消息的 token 占用）
        total_chars = len(json.dumps(result, ensure_ascii=False))
        if total_chars > 100000:  # 100k chars ≈ 33k tokens，仍然很大
            result = self.trim_tool_content_in_history(result, max_tool_content_chars=2000)
        
        self.truncated_history_len = len(result)
        return result
    
    def handle_length_error(self, history: List[dict], retry_count: int = 0) -> Tuple[List[dict], bool]:
        """处理长度超限错误
        
        Args:
            history: 历史消息
            retry_count: 当前重试次数
        
        Returns:
            (truncated_history, should_retry)
        """
        # 策略 3: 错误重试
        if TruncateStrategy.ERROR_RETRY not in self.config.strategies:
            return history, False
        
        if retry_count >= self.config.max_retries:
            return history, False
        
        # 根据重试次数逐步减少消息
        factor = 1.0 - (retry_count * 0.3)  # 每次减少 30%
        target_count = max(5, int(self.config.retry_max_messages * factor))
        
        self.reset()
        truncated = self.truncate_by_count(history, target_count)
        
        if len(truncated) < len(history):
            self._truncate_info = f"错误重试截断 (第 {retry_count + 1} 次): {len(history)} -> {len(truncated)} 条消息"
            return truncated, True
        
        return history, False
    
    def get_warning_header(self) -> Optional[str]:
        """获取截断警告头"""
        if not self.config.add_warning_header or not self._truncated:
            return None
        return self._truncate_info


# 全局配置实例
_history_config = HistoryConfig()


def get_history_config() -> HistoryConfig:
    """获取历史消息配置"""
    return _history_config


def set_history_config(config: HistoryConfig):
    """设置历史消息配置"""
    global _history_config
    _history_config = config


def update_history_config(data: dict):
    """更新历史消息配置"""
    global _history_config
    _history_config = HistoryConfig.from_dict(data)


def is_content_length_error(status_code: int, error_text: str) -> bool:
    """检查是否为内容长度超限错误"""
    if "CONTENT_LENGTH_EXCEEDS_THRESHOLD" in error_text:
        return True
    if "Input is too long" in error_text:
        return True
    # 更宽松的匹配
    lowered = error_text.lower()
    if "too long" in lowered and ("input" in lowered or "content" in lowered or "message" in lowered):
        return True
    return False
