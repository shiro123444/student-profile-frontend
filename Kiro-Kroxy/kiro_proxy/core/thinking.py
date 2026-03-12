"""Thinking 模式支持 — 参考 kiro.rs 实现

Kiro API 通过在系统消息前注入 XML 标签来启用 thinking 模式：
- <thinking_mode>enabled</thinking_mode><max_thinking_length>N</max_thinking_length>
- <thinking_mode>adaptive</thinking_mode><thinking_effort>high|medium|low</thinking_effort>

响应中，模型的思考过程包裹在 <thinking>...</thinking> 标签中，
需要解析后转换为 Anthropic/OpenAI 兼容的 thinking 格式。
"""
import re
from dataclasses import dataclass
from typing import Optional

# thinking budget 上限（参考 kiro.rs: 24576）
MAX_BUDGET_TOKENS = 24576
DEFAULT_BUDGET_TOKENS = 20000

# 标签常量
THINKING_START_TAG = "<thinking>"
THINKING_END_TAG = "</thinking>"

# 需要跳过的引用字符（当 thinking 标签被这些字符包裹时，不是真正的标签）
QUOTE_CHARS = set("`\"'\\#!@$%^&*()-_=+[]{};<>,.?/")


@dataclass
class ThinkingConfig:
    """Thinking 配置"""
    enabled: bool = False
    thinking_type: str = "disabled"  # "enabled", "adaptive", "disabled"
    budget_tokens: int = DEFAULT_BUDGET_TOKENS
    effort: str = "high"  # "high", "medium", "low"（adaptive 模式用）

    def is_enabled(self) -> bool:
        return self.thinking_type in ("enabled", "adaptive")


def parse_thinking_from_request(body: dict) -> ThinkingConfig:
    """从 Anthropic Messages API 请求中解析 thinking 配置
    
    支持格式：
    - {"thinking": {"type": "enabled", "budget_tokens": 20000}}
    - {"thinking": {"type": "adaptive"}} + {"output": {"effort": "high"}}
    - {"thinking": {"type": "disabled"}}
    """
    thinking = body.get("thinking")
    if not thinking or not isinstance(thinking, dict):
        return ThinkingConfig()
    
    thinking_type = thinking.get("type", "disabled")
    if thinking_type not in ("enabled", "adaptive", "disabled"):
        return ThinkingConfig()
    
    budget = thinking.get("budget_tokens", DEFAULT_BUDGET_TOKENS)
    budget = min(int(budget), MAX_BUDGET_TOKENS)
    
    effort = "high"
    output_config = body.get("output", {})
    if isinstance(output_config, dict) and "effort" in output_config:
        effort = output_config["effort"]
    
    return ThinkingConfig(
        enabled=thinking_type in ("enabled", "adaptive"),
        thinking_type=thinking_type,
        budget_tokens=budget,
        effort=effort,
    )


def parse_thinking_from_model_name(model: str) -> Optional[ThinkingConfig]:
    """从模型名中检测 -thinking 后缀，自动启用 thinking 模式
    
    例如：
    - claude-sonnet-4-5-thinking -> enabled
    - claude-opus-4-6-thinking -> adaptive
    """
    model_lower = model.lower()
    if "thinking" not in model_lower:
        return None
    
    # Opus 4.6 用 adaptive 模式
    is_opus_4_6 = "opus" in model_lower and ("4-6" in model_lower or "4.6" in model_lower)
    thinking_type = "adaptive" if is_opus_4_6 else "enabled"
    
    return ThinkingConfig(
        enabled=True,
        thinking_type=thinking_type,
        budget_tokens=DEFAULT_BUDGET_TOKENS,
        effort="medium" if is_opus_4_6 else "high",
    )


def generate_thinking_prefix(config: ThinkingConfig) -> Optional[str]:
    """生成 thinking XML 前缀，注入到系统消息前面
    
    Returns:
        XML 字符串, 或 None（未启用 thinking）
    """
    if not config.is_enabled():
        return None
    
    if config.thinking_type == "enabled":
        return (
            f"<thinking_mode>enabled</thinking_mode>"
            f"<max_thinking_length>{config.budget_tokens}</max_thinking_length>"
        )
    elif config.thinking_type == "adaptive":
        return (
            f"<thinking_mode>adaptive</thinking_mode>"
            f"<thinking_effort>{config.effort}</thinking_effort>"
        )
    return None


def has_thinking_tags(content: str) -> bool:
    """检查内容是否已包含 thinking 标签"""
    return "<thinking_mode>" in content or "<max_thinking_length>" in content


def inject_thinking_into_history(
    history: list, 
    thinking_prefix: str,
    model_id: str = "claude-sonnet-4"
) -> list:
    """将 thinking 前缀注入到历史的系统消息前面
    
    如果历史第一条是 user 消息（系统消息），在其 content 前面注入 thinking 标签。
    如果没有系统消息，创建一个新的 user+assistant 对。
    """
    if not thinking_prefix:
        return history
    
    # 检查第一条消息是否是用户消息（系统消息对）
    if history and "userInputMessage" in history[0]:
        first_content = history[0]["userInputMessage"].get("content", "")
        if not has_thinking_tags(first_content):
            history[0]["userInputMessage"]["content"] = f"{thinking_prefix}\n{first_content}"
        return history
    
    # 没有系统消息，创建 thinking 前缀对
    thinking_pair = [
        {
            "userInputMessage": {
                "content": thinking_prefix,
                "modelId": model_id,
                "origin": "AI_EDITOR",
            }
        },
        {
            "assistantResponseMessage": {
                "content": "I will follow these instructions.",
            }
        },
    ]
    return thinking_pair + history


def strip_thinking_suffix_from_model(model: str) -> str:
    """去掉模型名中的 -thinking 后缀，得到实际模型 ID
    
    例如 claude-sonnet-4-5-thinking -> claude-sonnet-4.5
    """
    return re.sub(r'-thinking$', '', model, flags=re.IGNORECASE)


# ==================== 流式响应 thinking 标签解析 ====================

class ThinkingStreamParser:
    """解析流式响应中的 <thinking>...</thinking> 标签
    
    将 Kiro 返回的原始文本中嵌入的 thinking 标签
    转换为结构化的 thinking/text 事件。
    
    参考 kiro.rs 的 StreamContext 实现。
    """
    
    def __init__(self, thinking_enabled: bool = False):
        self.thinking_enabled = thinking_enabled
        self.buffer = ""
        self.in_thinking_block = False
        self.thinking_extracted = False
        self.thinking_content = ""
        self.text_content = ""
    
    def _is_quote_char(self, pos: int) -> bool:
        """检查 buffer 中指定位置是否为引用字符"""
        if 0 <= pos < len(self.buffer):
            return self.buffer[pos] in QUOTE_CHARS
        return False
    
    def _find_real_start_tag(self) -> Optional[int]:
        """查找真正的 <thinking> 开始标签（跳过引用中的）"""
        search_start = 0
        while True:
            pos = self.buffer.find(THINKING_START_TAG, search_start)
            if pos < 0:
                return None
            # 检查前后是否有引用字符
            if pos > 0 and self._is_quote_char(pos - 1):
                search_start = pos + 1
                continue
            after_pos = pos + len(THINKING_START_TAG)
            if after_pos < len(self.buffer) and self._is_quote_char(after_pos):
                search_start = pos + 1
                continue
            return pos
    
    def _find_real_end_tag(self) -> Optional[int]:
        """查找真正的 </thinking> 结束标签
        
        真正的结束标签后面应有 \\n\\n 或 \\n，
        或者在缓冲区末尾。
        
        参考 kiro.rs find_real_thinking_end_tag:
        - 必须有 \\n\\n 紧随其后
        - 但如果缓冲区不够长，等待更多数据
        - 注意: 我们比 kiro.rs 更宽松，也接受 \\n（防止某些模型行为差异）
        """
        search_start = 0
        while True:
            pos = self.buffer.find(THINKING_END_TAG, search_start)
            if pos < 0:
                return None
            # 检查引用字符
            if pos > 0 and self._is_quote_char(pos - 1):
                search_start = pos + 1
                continue
            after_pos = pos + len(THINKING_END_TAG)
            if after_pos < len(self.buffer) and self._is_quote_char(after_pos):
                search_start = pos + 1
                continue
            # 检查后面的内容
            after_content = self.buffer[after_pos:]
            if len(after_content) == 0:
                # 标签在缓冲区最末尾，等待更多数据
                return None
            if after_content.startswith("\n\n"):
                return pos
            if after_content.startswith("\n"):
                # 只有一个 \n，可能 \n\n 还没到
                if len(after_content) == 1:
                    return None  # 等待更多数据确认
                # 有 \n + 其他内容 → 接受为有效结束标签（模型可能只输出单个换行）
                return pos
            # </thinking> 后面不是换行 → 这不是真正的结束标签（可能在代码/文本中）
            search_start = pos + 1
    
    def _find_end_tag_at_buffer_end(self) -> Optional[int]:
        """在流结束时，查找缓冲区末尾的 </thinking>（不要求 \\n\\n）"""
        search_start = 0
        while True:
            pos = self.buffer.find(THINKING_END_TAG, search_start)
            if pos < 0:
                return None
            if pos > 0 and self._is_quote_char(pos - 1):
                search_start = pos + 1
                continue
            after_pos = pos + len(THINKING_END_TAG)
            if after_pos < len(self.buffer) and self._is_quote_char(after_pos):
                search_start = pos + 1
                continue
            return pos
    
    def process_chunk(self, text: str) -> list:
        """处理一个文本块，返回事件列表
        
        Returns:
            [{"type": "thinking", "text": "..."}, {"type": "text", "text": "..."}, ...]
        """
        if not self.thinking_enabled:
            return [{"type": "text", "text": text}] if text else []
        
        self.buffer += text
        events = []
        
        while True:
            if not self.in_thinking_block:
                # 寻找 <thinking> 开始标签
                start_pos = self._find_real_start_tag()
                if start_pos is None:
                    # 没有找到标签
                    if self.thinking_extracted:
                        # thinking 已结束，剩余内容都是文本
                        # 但保留安全余量，防止跨 chunk 标签
                        safe_len = len(self.buffer) - len(THINKING_START_TAG) - 1
                        if safe_len > 0:
                            emit = self.buffer[:safe_len]
                            self.buffer = self.buffer[safe_len:]
                            if emit.strip():
                                events.append({"type": "text", "text": emit})
                    break
                
                # 在 <thinking> 之前有文本
                if start_pos > 0:
                    pre_text = self.buffer[:start_pos]
                    # 跳过 thinking 前的纯空白
                    if pre_text.strip():
                        events.append({"type": "text", "text": pre_text})
                
                # 进入 thinking 块
                self.in_thinking_block = True
                self.buffer = self.buffer[start_pos + len(THINKING_START_TAG):]
                # 跳过紧随标签的换行
                if self.buffer.startswith("\n"):
                    self.buffer = self.buffer[1:]
            
            if self.in_thinking_block:
                # 寻找 </thinking> 结束标签
                end_pos = self._find_real_end_tag()
                if end_pos is None:
                    # 还在 thinking 块中，发送缓冲内容（保留安全余量）
                    margin = len(THINKING_END_TAG) + 2  # "</thinking>\n\n"
                    safe_len = len(self.buffer) - margin
                    if safe_len > 0:
                        emit = self.buffer[:safe_len]
                        self.buffer = self.buffer[safe_len:]
                        if emit:
                            events.append({"type": "thinking", "text": emit})
                    break
                
                # 提取 thinking 内容
                thinking_text = self.buffer[:end_pos]
                if thinking_text:
                    events.append({"type": "thinking", "text": thinking_text})
                
                # 跳过 </thinking> 及其后的换行符
                after_end = end_pos + len(THINKING_END_TAG)
                if self.buffer[after_end:].startswith("\n\n"):
                    after_end += 2
                elif self.buffer[after_end:].startswith("\n"):
                    after_end += 1
                self.buffer = self.buffer[after_end:]
                self.in_thinking_block = False
                self.thinking_extracted = True
        
        return events
    
    def flush(self) -> list:
        """流结束时，刷新缓冲区中的剩余内容"""
        events = []
        
        if self.in_thinking_block:
            # 检查是否有结束标签
            end_pos = self._find_end_tag_at_buffer_end()
            if end_pos is not None:
                thinking_text = self.buffer[:end_pos]
                if thinking_text:
                    events.append({"type": "thinking", "text": thinking_text})
                after_end = end_pos + len(THINKING_END_TAG)
                self.buffer = self.buffer[after_end:].lstrip("\n")
                self.in_thinking_block = False
                self.thinking_extracted = True
            else:
                # 没有结束标签，全部作为 thinking
                if self.buffer:
                    events.append({"type": "thinking", "text": self.buffer})
                self.buffer = ""
                return events
        
        # 剩余内容作为文本
        remaining = self.buffer.strip()
        if remaining:
            events.append({"type": "text", "text": remaining})
        self.buffer = ""
        return events
