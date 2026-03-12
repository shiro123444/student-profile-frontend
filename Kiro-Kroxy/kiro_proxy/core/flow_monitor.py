"""Flow Monitor - LLM 流量监控

记录完整的请求/响应数据，支持查询、过滤、导出。
"""
import json
import time
import uuid
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from collections import deque
from enum import Enum


class FlowState(str, Enum):
    """Flow 状态"""
    PENDING = "pending"      # 等待响应
    STREAMING = "streaming"  # 流式传输中
    COMPLETED = "completed"  # 完成
    ERROR = "error"          # 错误


@dataclass
class Message:
    """消息"""
    role: str  # user/assistant/system/tool
    content: Any  # str 或 list
    name: Optional[str] = None  # tool name
    tool_call_id: Optional[str] = None


@dataclass
class TokenUsage:
    """Token 使用量"""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    
    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass
class FlowRequest:
    """请求数据"""
    method: str
    path: str
    headers: Dict[str, str]
    body: Dict[str, Any]
    
    # 解析后的字段
    model: str = ""
    messages: List[Message] = field(default_factory=list)
    system: str = ""
    tools: List[Dict] = field(default_factory=list)
    stream: bool = False
    max_tokens: int = 0
    temperature: float = 1.0


@dataclass
class FlowResponse:
    """响应数据"""
    status_code: int
    headers: Dict[str, str] = field(default_factory=dict)
    body: Any = None
    
    # 解析后的字段
    content: str = ""
    tool_calls: List[Dict] = field(default_factory=list)
    stop_reason: str = ""
    usage: TokenUsage = field(default_factory=TokenUsage)
    
    # 流式响应
    chunks: List[str] = field(default_factory=list)
    chunk_count: int = 0


@dataclass
class FlowError:
    """错误信息"""
    type: str  # rate_limit_error, api_error, etc.
    message: str
    status_code: int = 0
    raw: str = ""


@dataclass 
class FlowTiming:
    """时间信息"""
    created_at: float = 0
    first_byte_at: Optional[float] = None
    completed_at: Optional[float] = None
    
    @property
    def ttfb_ms(self) -> Optional[float]:
        """Time to first byte"""
        if self.first_byte_at and self.created_at:
            return (self.first_byte_at - self.created_at) * 1000
        return None
    
    @property
    def duration_ms(self) -> Optional[float]:
        """Total duration"""
        if self.completed_at and self.created_at:
            return (self.completed_at - self.created_at) * 1000
        return None


@dataclass
class LLMFlow:
    """完整的 LLM 请求流"""
    id: str
    state: FlowState
    
    # 路由信息
    protocol: str  # anthropic, openai, gemini
    account_id: Optional[str] = None
    account_name: Optional[str] = None
    
    # 请求/响应
    request: Optional[FlowRequest] = None
    response: Optional[FlowResponse] = None
    error: Optional[FlowError] = None
    
    # 时间
    timing: FlowTiming = field(default_factory=FlowTiming)
    
    # 元数据
    tags: List[str] = field(default_factory=list)
    notes: str = ""
    bookmarked: bool = False
    
    # 重试信息
    retry_count: int = 0
    parent_flow_id: Optional[str] = None
    
    def to_dict(self) -> dict:
        """转换为字典"""
        d = {
            "id": self.id,
            "state": self.state.value,
            "protocol": self.protocol,
            "account_id": self.account_id,
            "account_name": self.account_name,
            "timing": {
                "created_at": self.timing.created_at,
                "first_byte_at": self.timing.first_byte_at,
                "completed_at": self.timing.completed_at,
                "ttfb_ms": self.timing.ttfb_ms,
                "duration_ms": self.timing.duration_ms,
            },
            "tags": self.tags,
            "notes": self.notes,
            "bookmarked": self.bookmarked,
            "retry_count": self.retry_count,
        }
        
        if self.request:
            d["request"] = {
                "method": self.request.method,
                "path": self.request.path,
                "model": self.request.model,
                "stream": self.request.stream,
                "message_count": len(self.request.messages),
                "has_tools": bool(self.request.tools),
                "has_system": bool(self.request.system),
            }
        
        if self.response:
            d["response"] = {
                "status_code": self.response.status_code,
                "content_length": len(self.response.content),
                "has_tool_calls": bool(self.response.tool_calls),
                "stop_reason": self.response.stop_reason,
                "chunk_count": self.response.chunk_count,
                "usage": asdict(self.response.usage),
            }
        
        if self.error:
            d["error"] = asdict(self.error)
        
        return d
    
    def to_full_dict(self) -> dict:
        """转换为完整字典（包含请求/响应体）"""
        d = self.to_dict()
        
        if self.request:
            d["request"]["headers"] = self.request.headers
            d["request"]["body"] = self.request.body
            d["request"]["messages"] = [asdict(m) if hasattr(m, '__dataclass_fields__') else m for m in self.request.messages]
            d["request"]["system"] = self.request.system
            d["request"]["tools"] = self.request.tools
        
        if self.response:
            d["response"]["headers"] = self.response.headers
            d["response"]["body"] = self.response.body
            d["response"]["content"] = self.response.content
            d["response"]["tool_calls"] = self.response.tool_calls
            d["response"]["chunks"] = self.response.chunks[-10:]  # 只保留最后10个chunk
        
        return d


class FlowStore:
    """Flow 存储"""
    
    def __init__(self, max_flows: int = 500, persist_dir: Optional[Path] = None):
        self.flows: deque[LLMFlow] = deque(maxlen=max_flows)
        self.flow_map: Dict[str, LLMFlow] = {}
        self.persist_dir = persist_dir
        self.max_flows = max_flows
        
        # 统计
        self.total_flows = 0
        self.total_tokens_in = 0
        self.total_tokens_out = 0
    
    def add(self, flow: LLMFlow):
        """添加 Flow"""
        # 如果队列满了，移除最旧的
        if len(self.flows) >= self.max_flows:
            old = self.flows[0]
            if old.id in self.flow_map:
                del self.flow_map[old.id]
        
        self.flows.append(flow)
        self.flow_map[flow.id] = flow
        self.total_flows += 1
    
    def get(self, flow_id: str) -> Optional[LLMFlow]:
        """获取 Flow"""
        return self.flow_map.get(flow_id)
    
    def update(self, flow_id: str, **kwargs):
        """更新 Flow"""
        flow = self.flow_map.get(flow_id)
        if flow:
            for k, v in kwargs.items():
                if hasattr(flow, k):
                    setattr(flow, k, v)
    
    def query(
        self,
        protocol: Optional[str] = None,
        model: Optional[str] = None,
        account_id: Optional[str] = None,
        state: Optional[FlowState] = None,
        has_error: Optional[bool] = None,
        bookmarked: Optional[bool] = None,
        min_duration_ms: Optional[float] = None,
        max_duration_ms: Optional[float] = None,
        start_time: Optional[float] = None,
        end_time: Optional[float] = None,
        search: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[LLMFlow]:
        """查询 Flows"""
        results = []
        
        for flow in reversed(self.flows):
            # 过滤条件
            if protocol and flow.protocol != protocol:
                continue
            if model and flow.request and flow.request.model != model:
                continue
            if account_id and flow.account_id != account_id:
                continue
            if state and flow.state != state:
                continue
            if has_error is not None:
                if has_error and not flow.error:
                    continue
                if not has_error and flow.error:
                    continue
            if bookmarked is not None and flow.bookmarked != bookmarked:
                continue
            if min_duration_ms and flow.timing.duration_ms and flow.timing.duration_ms < min_duration_ms:
                continue
            if max_duration_ms and flow.timing.duration_ms and flow.timing.duration_ms > max_duration_ms:
                continue
            if start_time and flow.timing.created_at < start_time:
                continue
            if end_time and flow.timing.created_at > end_time:
                continue
            if search:
                # 简单搜索：在内容中查找
                found = False
                if flow.request and search.lower() in json.dumps(flow.request.body).lower():
                    found = True
                if flow.response and search.lower() in flow.response.content.lower():
                    found = True
                if not found:
                    continue
            
            results.append(flow)
        
        return results[offset:offset + limit]
    
    def get_stats(self) -> dict:
        """获取统计信息"""
        completed = [f for f in self.flows if f.state == FlowState.COMPLETED]
        errors = [f for f in self.flows if f.state == FlowState.ERROR]
        
        # 按模型统计
        model_stats = {}
        for f in self.flows:
            if f.request:
                model = f.request.model or "unknown"
                if model not in model_stats:
                    model_stats[model] = {"count": 0, "errors": 0, "tokens_in": 0, "tokens_out": 0}
                model_stats[model]["count"] += 1
                if f.error:
                    model_stats[model]["errors"] += 1
                if f.response and f.response.usage:
                    model_stats[model]["tokens_in"] += f.response.usage.input_tokens
                    model_stats[model]["tokens_out"] += f.response.usage.output_tokens
        
        # 计算平均延迟
        durations = [f.timing.duration_ms for f in completed if f.timing.duration_ms]
        avg_duration = sum(durations) / len(durations) if durations else 0
        
        return {
            "total_flows": self.total_flows,
            "active_flows": len(self.flows),
            "completed": len(completed),
            "errors": len(errors),
            "error_rate": f"{len(errors) / max(1, len(self.flows)) * 100:.1f}%",
            "avg_duration_ms": round(avg_duration, 2),
            "total_tokens_in": self.total_tokens_in,
            "total_tokens_out": self.total_tokens_out,
            "by_model": model_stats,
        }
    
    def export_jsonl(self, flows: List[LLMFlow]) -> str:
        """导出为 JSONL 格式"""
        lines = []
        for f in flows:
            lines.append(json.dumps(f.to_full_dict(), ensure_ascii=False))
        return "\n".join(lines)
    
    def export_markdown(self, flow: LLMFlow) -> str:
        """导出单个 Flow 为 Markdown"""
        lines = [
            f"# Flow {flow.id}",
            "",
            f"- **Protocol**: {flow.protocol}",
            f"- **State**: {flow.state.value}",
            f"- **Account**: {flow.account_name or flow.account_id or 'N/A'}",
            f"- **Created**: {datetime.fromtimestamp(flow.timing.created_at).isoformat()}",
        ]
        
        if flow.timing.duration_ms:
            lines.append(f"- **Duration**: {flow.timing.duration_ms:.0f}ms")
        
        if flow.request:
            lines.extend([
                "",
                "## Request",
                "",
                f"- **Model**: {flow.request.model}",
                f"- **Stream**: {flow.request.stream}",
                f"- **Messages**: {len(flow.request.messages)}",
            ])
            
            if flow.request.system:
                lines.extend(["", "### System", "", f"```\n{flow.request.system}\n```"])
            
            lines.extend(["", "### Messages", ""])
            for msg in flow.request.messages:
                content = msg.content if isinstance(msg.content, str) else json.dumps(msg.content, ensure_ascii=False)
                lines.append(f"**{msg.role}**: {content[:500]}{'...' if len(content) > 500 else ''}")
                lines.append("")
        
        if flow.response:
            lines.extend([
                "## Response",
                "",
                f"- **Status**: {flow.response.status_code}",
                f"- **Stop Reason**: {flow.response.stop_reason}",
            ])
            
            if flow.response.usage:
                lines.append(f"- **Tokens**: {flow.response.usage.input_tokens} in / {flow.response.usage.output_tokens} out")
            
            if flow.response.content:
                lines.extend(["", "### Content", "", f"```\n{flow.response.content[:2000]}\n```"])
        
        if flow.error:
            lines.extend([
                "",
                "## Error",
                "",
                f"- **Type**: {flow.error.type}",
                f"- **Message**: {flow.error.message}",
            ])
        
        return "\n".join(lines)


class FlowMonitor:
    """Flow 监控器"""
    
    def __init__(self, max_flows: int = 500):
        self.store = FlowStore(max_flows=max_flows)
    
    def create_flow(
        self,
        protocol: str,
        method: str,
        path: str,
        headers: Dict[str, str],
        body: Dict[str, Any],
        account_id: Optional[str] = None,
        account_name: Optional[str] = None,
    ) -> str:
        """创建新的 Flow"""
        flow_id = uuid.uuid4().hex[:12]
        
        # 解析请求
        request = FlowRequest(
            method=method,
            path=path,
            headers={k: v for k, v in headers.items() if k.lower() not in ["authorization"]},
            body=body,
            model=body.get("model", ""),
            stream=body.get("stream", False),
            system=body.get("system", ""),
            tools=body.get("tools", []),
            max_tokens=body.get("max_tokens", 0),
            temperature=body.get("temperature", 1.0),
        )
        
        # 解析消息
        messages = body.get("messages", [])
        for msg in messages:
            request.messages.append(Message(
                role=msg.get("role", "user"),
                content=msg.get("content", ""),
                name=msg.get("name"),
                tool_call_id=msg.get("tool_call_id"),
            ))
        
        flow = LLMFlow(
            id=flow_id,
            state=FlowState.PENDING,
            protocol=protocol,
            account_id=account_id,
            account_name=account_name,
            request=request,
            timing=FlowTiming(created_at=time.time()),
        )
        
        self.store.add(flow)
        return flow_id
    
    def start_streaming(self, flow_id: str):
        """标记开始流式传输"""
        flow = self.store.get(flow_id)
        if flow:
            flow.state = FlowState.STREAMING
            flow.timing.first_byte_at = time.time()
            if not flow.response:
                flow.response = FlowResponse(status_code=200)
    
    def add_chunk(self, flow_id: str, chunk: str):
        """添加流式响应块"""
        flow = self.store.get(flow_id)
        if flow and flow.response:
            flow.response.chunks.append(chunk)
            flow.response.chunk_count += 1
            flow.response.content += chunk
    
    def complete_flow(
        self,
        flow_id: str,
        status_code: int,
        content: str = "",
        tool_calls: List[Dict] = None,
        stop_reason: str = "",
        usage: Optional[TokenUsage] = None,
        headers: Dict[str, str] = None,
    ):
        """完成 Flow"""
        flow = self.store.get(flow_id)
        if not flow:
            return
        
        flow.state = FlowState.COMPLETED
        flow.timing.completed_at = time.time()
        
        if not flow.response:
            flow.response = FlowResponse(status_code=status_code)
        
        flow.response.status_code = status_code
        flow.response.content = content or flow.response.content
        flow.response.tool_calls = tool_calls or []
        flow.response.stop_reason = stop_reason
        flow.response.headers = headers or {}
        
        if usage:
            flow.response.usage = usage
            self.store.total_tokens_in += usage.input_tokens
            self.store.total_tokens_out += usage.output_tokens
    
    def fail_flow(self, flow_id: str, error_type: str, message: str, status_code: int = 0, raw: str = ""):
        """标记 Flow 失败"""
        flow = self.store.get(flow_id)
        if not flow:
            return
        
        flow.state = FlowState.ERROR
        flow.timing.completed_at = time.time()
        flow.error = FlowError(
            type=error_type,
            message=message,
            status_code=status_code,
            raw=raw[:1000],  # 限制长度
        )
    
    def bookmark_flow(self, flow_id: str, bookmarked: bool = True):
        """书签 Flow"""
        flow = self.store.get(flow_id)
        if flow:
            flow.bookmarked = bookmarked
    
    def add_note(self, flow_id: str, note: str):
        """添加备注"""
        flow = self.store.get(flow_id)
        if flow:
            flow.notes = note
    
    def add_tag(self, flow_id: str, tag: str):
        """添加标签"""
        flow = self.store.get(flow_id)
        if flow and tag not in flow.tags:
            flow.tags.append(tag)
    
    def get_flow(self, flow_id: str) -> Optional[LLMFlow]:
        """获取 Flow"""
        return self.store.get(flow_id)
    
    def query(self, **kwargs) -> List[LLMFlow]:
        """查询 Flows"""
        return self.store.query(**kwargs)
    
    def get_stats(self) -> dict:
        """获取统计"""
        return self.store.get_stats()
    
    def export(self, flow_ids: List[str] = None, format: str = "jsonl") -> str:
        """导出 Flows"""
        if flow_ids:
            flows = [self.store.get(fid) for fid in flow_ids if self.store.get(fid)]
        else:
            flows = list(self.store.flows)
        
        if format == "jsonl":
            return self.store.export_jsonl(flows)
        elif format == "markdown" and len(flows) == 1:
            return self.store.export_markdown(flows[0])
        else:
            return json.dumps([f.to_dict() for f in flows], ensure_ascii=False, indent=2)


# 全局实例
flow_monitor = FlowMonitor(max_flows=500)
