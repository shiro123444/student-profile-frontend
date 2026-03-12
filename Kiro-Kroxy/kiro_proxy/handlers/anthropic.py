"""Anthropic 协议处理 - /v1/messages"""
import json
import uuid
import time
import asyncio
import httpx
from fastapi import Request, HTTPException
from fastapi.responses import StreamingResponse

from ..config import KIRO_API_URL, map_model_name
from ..core import state, RetryableRequest, is_retryable_error, stats_manager, flow_monitor, TokenUsage
from ..core.state import RequestLog
from ..core.history_manager import HistoryManager, get_history_config, is_content_length_error, TruncateStrategy
from ..core.error_handler import classify_error, ErrorType, format_error_log
from ..core.rate_limiter import get_rate_limiter
from ..core.thinking import (
    parse_thinking_from_request, parse_thinking_from_model_name,
    generate_thinking_prefix, inject_thinking_into_history,
    strip_thinking_suffix_from_model, ThinkingStreamParser, ThinkingConfig,
)
from ..core.http_pool import http_pool
from ..credential import quota_manager
from ..kiro_api import build_headers, build_kiro_request, parse_event_stream_full, parse_event_stream
from ..converters import (
    generate_session_id,
    convert_anthropic_tools_to_kiro,
    convert_anthropic_messages_to_kiro,
    convert_kiro_response_to_anthropic,
    extract_images_from_content,
    fix_history_alternation,
)
import struct


def _parse_aws_event_headers(data: bytes) -> dict:
    """解析 AWS event-stream 二进制 headers（借鉴 kiro.rs header.rs）"""
    headers = {}
    offset = 0
    while offset < len(data):
        if offset >= len(data):
            break
        name_len = data[offset]
        offset += 1
        if name_len == 0 or offset + name_len > len(data):
            break
        name = data[offset:offset+name_len].decode('utf-8', errors='ignore')
        offset += name_len
        if offset >= len(data):
            break
        value_type = data[offset]
        offset += 1
        if value_type == 7:  # String
            if offset + 2 > len(data):
                break
            value_len = struct.unpack('>H', data[offset:offset+2])[0]
            offset += 2
            if offset + value_len > len(data):
                break
            value = data[offset:offset+value_len].decode('utf-8', errors='ignore')
            offset += value_len
            headers[name] = value
        elif value_type == 0:  # bool true
            headers[name] = True
        elif value_type == 1:  # bool false
            headers[name] = False
        else:
            break
    return headers


def _parse_event_type(headers_bytes: bytes) -> str:
    """从二进制 headers 中提取 :event-type"""
    h = _parse_aws_event_headers(headers_bytes)
    return h.get(':event-type', '')


def _parse_message_type(headers_bytes: bytes) -> str:
    """从二进制 headers 中提取 :message-type"""
    h = _parse_aws_event_headers(headers_bytes)
    return h.get(':message-type', '')


def _parse_exception_type(headers_bytes: bytes) -> str:
    """从二进制 headers 中提取 :exception-type"""
    h = _parse_aws_event_headers(headers_bytes)
    return h.get(':exception-type', '')


def _extract_text_from_content(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            parts.append(_extract_text_from_content(item))
        return "".join(parts)
    if isinstance(content, dict):
        if "text" in content and isinstance(content.get("text"), str):
            return content["text"]
        if "content" in content:
            return _extract_text_from_content(content.get("content"))
    return ""


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return (len(text) + 3) // 4


def _count_tokens_from_messages(messages, system: str = "") -> int:
    total = _estimate_tokens(system) if system else 0
    for msg in messages or []:
        total += _estimate_tokens(_extract_text_from_content(msg.get("content")))
    return total


def _handle_kiro_error(status_code: int, error_text: str, account):
    """处理 Kiro API 错误，返回 (http_status, error_type, error_message)"""
    error = classify_error(status_code, error_text)
    
    # 打印友好的错误日志
    print(format_error_log(error, account.id if account else None))
    
    # 账号封禁 - 禁用账号
    if error.should_disable_account and account:
        account.enabled = False
        from ..credential import CredentialStatus
        account.status = CredentialStatus.SUSPENDED
        print(f"[Account] 账号 {account.id} 已被禁用 (封禁)")
    
    # 配额超限 - 仅在真正的月度配额耗尽时标记冷却
    elif error.type == ErrorType.RATE_LIMITED and account:
        if "MONTHLY_REQUEST_COUNT" in (error_text or ""):
            account.mark_quota_exceeded(error.message[:100])
        else:
            account.error_count += 1
    
    # 映射错误类型
    error_type_map = {
        ErrorType.ACCOUNT_SUSPENDED: (403, "authentication_error"),
        ErrorType.RATE_LIMITED: (429, "rate_limit_error"),
        ErrorType.CONTENT_TOO_LONG: (400, "invalid_request_error"),
        ErrorType.AUTH_FAILED: (401, "authentication_error"),
        ErrorType.SERVICE_UNAVAILABLE: (503, "api_error"),
        ErrorType.MODEL_UNAVAILABLE: (503, "overloaded_error"),
        ErrorType.UNKNOWN: (500, "api_error"),
    }
    
    http_status, err_type = error_type_map.get(error.type, (500, "api_error"))
    return http_status, err_type, error.user_message, error


async def handle_count_tokens(request: Request):
    '''Handle /v1/messages/count_tokens requests.'''
    body = await request.json()
    messages = body.get("messages", [])
    system = body.get("system", "")
    if not messages and not system:
        raise HTTPException(400, "messages required")
    return {"input_tokens": _count_tokens_from_messages(messages, system)}


async def _call_kiro_for_summary(prompt: str, account, headers: dict) -> str:
    """调用 Kiro API 生成摘要（内部使用）"""
    kiro_request = build_kiro_request(prompt, "claude-haiku-4.5", [])  # 用快速模型生成摘要
    try:
        resp = await http_pool.short_client.post(KIRO_API_URL, json=kiro_request, headers=headers)
        if resp.status_code == 200:
            return parse_event_stream(resp.content)
    except Exception as e:
        print(f"[Summary] API 调用失败: {e}")
    return ""


async def handle_messages(request: Request):
    """处理 /v1/messages 请求"""
    start_time = time.time()
    log_id = uuid.uuid4().hex[:8]
    
    body = await request.json()
    model = map_model_name(body.get("model", "claude-sonnet-4"))
    messages = body.get("messages", [])
    system = body.get("system", "")
    stream = body.get("stream", False)
    tools = body.get("tools", [])
    
    # 解析 thinking 配置
    thinking_config = parse_thinking_from_request(body)
    # 检查模型名是否有 -thinking 后缀
    model_thinking = parse_thinking_from_model_name(model)
    # 参考 kiro.rs override_thinking_from_model_name:
    # 模型名中的 -thinking 后缀始终覆写 thinking 配置
    # 特别是 opus-4.6 必须用 adaptive 模式（enabled 模式容易无限思考）
    if model_thinking:
        if thinking_config.is_enabled() and thinking_config.thinking_type != model_thinking.thinking_type:
            print(f"[Anthropic] Thinking 模式冲突: 请求={thinking_config.thinking_type}, 模型名={model_thinking.thinking_type}, 使用模型名配置")
        thinking_config = model_thinking
    elif thinking_config.is_enabled():
        # 请求中指定了 thinking 但模型名没有 -thinking 后缀
        # 额外检查: opus-4.6 必须用 adaptive 模式（参考 kiro.rs）
        model_lower = model.lower()
        if "opus" in model_lower and ("4-6" in model_lower or "4.6" in model_lower):
            if thinking_config.thinking_type == "enabled":
                print(f"[Anthropic] opus-4.6 强制使用 adaptive 模式（原始: enabled）")
                thinking_config.thinking_type = "adaptive"
                thinking_config.effort = "high"
    # 如果是 thinking 变体模型，去掉后缀得到实际模型 ID
    if "-thinking" in model.lower():
        model = map_model_name(strip_thinking_suffix_from_model(model))
    
    # 调试：打印原始请求的关键信息
    print(f"[Anthropic] Request: model={body.get('model')} -> {model}, messages={len(messages)}, stream={stream}, tools={len(tools)}")
    
    # 调试：检查消息中的内容类型（特别是图片）
    for mi, msg in enumerate(messages):
        content = msg.get("content", "")
        if isinstance(content, list):
            block_types = [b.get("type", "unknown") if isinstance(b, dict) else "str" for b in content]
            print(f"[Anthropic] msg[{mi}] role={msg.get('role')}, content blocks: {block_types}")
            for b in content:
                if isinstance(b, dict) and b.get("type") in ("image", "image_url", "file"):
                    src = b.get("source", b.get("image_url", {}))
                    src_type = src.get("type", "unknown") if isinstance(src, dict) else "unknown"
                    has_data = bool(src.get("data", "")) if isinstance(src, dict) else False
                    has_url = bool(src.get("url", "")) if isinstance(src, dict) else False
                    print(f"[Anthropic] 图片块: type={b.get('type')}, source_type={src_type}, has_data={has_data}, has_url={has_url}")
    
    if not messages:
        raise HTTPException(400, "messages required")
    
    session_id = generate_session_id(messages)
    account = state.get_available_account(session_id, model=model)
    
    if not account:
        raise HTTPException(503, "All accounts are rate limited or unavailable")
    
    # 创建 Flow 记录
    flow_id = flow_monitor.create_flow(
        protocol="anthropic",
        method="POST",
        path="/v1/messages",
        headers=dict(request.headers),
        body=body,
        account_id=account.id,
        account_name=account.name,
    )
    
    # 检查 token 是否即将过期，尝试刷新
    if account.is_token_expiring_soon(5):
        print(f"[Anthropic] Token 即将过期，尝试刷新: {account.id}")
        success, msg = await account.refresh_token()
        if not success:
            print(f"[Anthropic] Token 刷新失败: {msg}")
    
    token = account.get_token()
    if not token:
        flow_monitor.fail_flow(flow_id, "authentication_error", f"Failed to get token for account {account.name}")
        raise HTTPException(500, f"Failed to get token for account {account.name}")
    
    # 使用账号的动态 Machine ID（提前构建，供摘要使用）
    creds = account.get_credentials()
    headers = build_headers(
        token,
        machine_id=account.get_machine_id(),
        profile_arn=creds.profile_arn if creds else None,
        client_id=creds.client_id if creds else None
    )
    
    # 限速检查
    rate_limiter = get_rate_limiter()
    can_request, wait_seconds, reason = rate_limiter.can_request(account.id)
    if not can_request:
        print(f"[Anthropic] 限速: {reason}")
        await asyncio.sleep(wait_seconds)
    
    # 转换消息格式
    user_content, history, tool_results = convert_anthropic_messages_to_kiro(messages, system)
    
    # 历史消息预处理
    history_manager = HistoryManager(get_history_config(), cache_key=session_id)
    
    # 检查是否需要智能摘要或错误重试预摘要
    async def api_caller(prompt: str) -> str:
        return await _call_kiro_for_summary(prompt, account, headers)
    if history_manager.should_summarize(history) or history_manager.should_pre_summary_for_error_retry(history, user_content):
        history = await history_manager.pre_process_async(history, user_content, api_caller)
    else:
        history = history_manager.pre_process(history, user_content)
    
    # 摘要/截断后再次修复历史交替和 toolUses/toolResults 配对
    from ..converters import fix_history_alternation
    history = fix_history_alternation(history)
    
    if history_manager.was_truncated:
        print(f"[Anthropic] {history_manager.truncate_info}")
    
    # 提取最后一条消息中的图片
    images = []
    if messages:
        last_msg = messages[-1]
        if last_msg.get("role") == "user":
            _, images = await extract_images_from_content(last_msg.get("content", ""))
    
    if images:
        print(f"[Anthropic] 检测到 {len(images)} 张图片, formats: {[img.get('format') for img in images]}, sizes: {[len(img.get('source', {}).get('bytes', '')) for img in images]} chars")
        # 如果只有图片没有文本，给一个默认提示
        if not user_content or user_content in ("Continue", ""):
            user_content = "Please analyze the provided image(s)."
            print(f"[Anthropic] 图片消息无文本，使用默认提示")
    
    # 构建 Kiro 请求
    kiro_tools = convert_anthropic_tools_to_kiro(tools) if tools else None
    
    # 注入 thinking 前缀到历史消息
    if thinking_config.is_enabled():
        thinking_prefix = generate_thinking_prefix(thinking_config)
        if thinking_prefix:
            history = inject_thinking_into_history(history, thinking_prefix, model)
            print(f"[Anthropic] Thinking mode: {thinking_config.thinking_type}, budget={thinking_config.budget_tokens}")
    
    kiro_request = build_kiro_request(user_content, model, history, kiro_tools, images, tool_results)
    
    # 估算 input_tokens（参考 kiro.rs token::count_all_tokens）
    # 用于 message_start 中报告给 Claude Code，触发 auto-compact
    estimated_input_tokens = _count_tokens_from_messages(messages, system)
    # Claude Code 发送的 max_tokens
    requested_max_tokens = body.get("max_tokens", 32000)
    
    if stream:
        return await _handle_stream(kiro_request, headers, account, model, log_id, start_time, session_id, flow_id, history, user_content, kiro_tools, images, tool_results, history_manager, thinking_config, estimated_input_tokens, requested_max_tokens)
    else:
        return await _handle_non_stream(kiro_request, headers, account, model, log_id, start_time, session_id, flow_id, history, user_content, kiro_tools, images, tool_results, history_manager, thinking_config)


async def _handle_stream(kiro_request, headers, account, model, log_id, start_time, session_id=None, flow_id=None, history=None, user_content="", kiro_tools=None, images=None, tool_results=None, history_manager=None, thinking_config=None, estimated_input_tokens=0, requested_max_tokens=32000):
    """Handle streaming responses with auto-retry on quota exceeded and network errors."""
    thinking_enabled = thinking_config.is_enabled() if thinking_config else False
    
    async def generate():
        nonlocal kiro_request, history
        current_account = account
        retry_count = 0
        # 动态重试次数：参考 kiro.rs min(credentials * 3, 9)
        max_retries = min(len(state.accounts) * 3, 9) if len(state.accounts) > 1 else 4
        network_error_count = 0  # 连续网络错误计数
        truncated_for_network_error = False  # 是否已因网络错误截断过
        full_content = ""
        
        while retry_count <= max_retries:
            try:
                async with http_pool.api_client.stream("POST", KIRO_API_URL, json=kiro_request, headers=headers) as response:
                        
                        # 处理 429 瞬态限流（参考 kiro.rs：不禁用凭据，不截断历史，仅退避重试）
                        if response.status_code == 429:
                            current_account.error_count += 1
                            if retry_count < max_retries:
                                import random
                                base_ms = min(200 * (2 ** retry_count), 2000)
                                jitter = random.randint(0, max(base_ms // 4, 1))
                                wait_time = (base_ms + jitter) / 1000.0
                                print(f"[Stream] 429 瞬态限流，退避 {wait_time:.1f}s 后重试 ({retry_count + 1}/{max_retries}): {current_account.id}")
                                retry_count += 1
                                await asyncio.sleep(wait_time)
                                continue
                            
                            if flow_id:
                                flow_monitor.fail_flow(flow_id, "rate_limit_error", "Rate limited after retries", 429)
                            yield f'event: error\ndata: {{"type":"error","error":{{"type":"rate_limit_error","message":"Rate limited after retries"}}}}\n\n'
                            return
                        
                        # 402 月度配额耗尽
                        if response.status_code == 402:
                            resp_text = ""
                            try:
                                resp_bytes = await response.aread()
                                resp_text = resp_bytes.decode()
                            except Exception:
                                pass
                            if "MONTHLY_REQUEST_COUNT" in resp_text:
                                current_account.mark_quota_exceeded("Monthly quota exhausted")
                                next_account = state.get_next_available_account(current_account.id, model=model)
                                if next_account and retry_count < max_retries:
                                    print(f"[Stream] 月度配额耗尽，切换账号: {current_account.id} -> {next_account.id}")
                                    current_account = next_account
                                    token = current_account.get_token()
                                    headers["Authorization"] = f"Bearer {token}"
                                    retry_count += 1
                                    continue
                                if flow_id:
                                    flow_monitor.fail_flow(flow_id, "rate_limit_error", "Monthly quota exhausted", 429)
                                yield f'event: error\ndata: {{"type":"error","error":{{"type":"rate_limit_error","message":"Monthly quota exhausted"}}}}\n\n'
                                return

                        # 处理可重试的服务端错误
                        if is_retryable_error(response.status_code):
                            if retry_count < max_retries:
                                print(f"[Stream] 服务端错误 {response.status_code}，重试 {retry_count + 1}/{max_retries}")
                                retry_count += 1
                                import asyncio
                                await asyncio.sleep(0.5 * (2 ** retry_count))
                                continue
                            if flow_id:
                                flow_monitor.fail_flow(flow_id, "api_error", "Server error after retries", response.status_code)
                            yield f'event: error\ndata: {{"type":"error","error":{{"type":"api_error","message":"Server error after retries"}}}}\n\n'
                            return

                        if response.status_code != 200:
                            error_text = await response.aread()
                            error_str = error_text.decode()
                            print(f"=== Kiro API Error ===")
                            print(f"Status: {response.status_code}")
                            print(f"Response: {error_str[:500]}")
                            print(f"Request model: {model}")
                            print(f"History len: {len(history) if history else 0}")
                            print(f"Tool results: {len(tool_results) if tool_results else 0}")
                            # 对于 400 错误，打印更多请求细节
                            if response.status_code == 400:
                                print(f"Kiro request keys: {list(kiro_request.keys())}")
                                if 'conversationState' in kiro_request:
                                    cs = kiro_request['conversationState']
                                    print(f"  conversationState keys: {list(cs.keys())}")
                                    if 'currentMessage' in cs:
                                        cm = cs['currentMessage']
                                        print(f"  currentMessage keys: {list(cm.keys())}")
                                        if 'userInputMessage' in cm:
                                            uim = cm['userInputMessage']
                                            print(f"  userInputMessage keys: {list(uim.keys())}")
                                            content = uim.get('content', '')
                                            print(f"  content (first 200 chars): {str(content)[:200]}")
                                    if 'history' in cs:
                                        hist = cs['history']
                                        print(f"  history count: {len(hist) if hist else 0}")
                                        if hist:
                                            for i, h in enumerate(hist[:3]):
                                                print(f"    history[{i}] keys: {list(h.keys()) if isinstance(h, dict) else type(h)}")
                            print(f"======================")
                            
                            # 使用统一的错误处理
                            http_status, error_type, error_msg, error_obj = _handle_kiro_error(
                                response.status_code, error_str, current_account
                            )
                            
                            # 认证失败 - 先尝试刷新 token，再切换账号（参考 kiro.rs: 401 先刷新再故障转移）
                            if error_obj.type == ErrorType.AUTH_FAILED and retry_count < max_retries:
                                print(f"[Stream] 401 认证失败，尝试刷新 token: {current_account.id}")
                                refresh_ok, refresh_msg = await current_account.refresh_token()
                                if refresh_ok:
                                    print(f"[Stream] Token 刷新成功，重试: {current_account.id}")
                                    headers["Authorization"] = f"Bearer {current_account.get_token()}"
                                    retry_count += 1
                                    continue
                                else:
                                    print(f"[Stream] Token 刷新失败: {refresh_msg}")
                            
                            # 账号封禁/认证失败/配额超限 - 尝试切换账号
                            if error_obj.should_switch_account:
                                next_account = state.get_next_available_account(current_account.id, model=model)
                                if next_account and retry_count < max_retries:
                                    print(f"[Stream] 切换账号: {current_account.id} -> {next_account.id}")
                                    current_account = next_account
                                    headers["Authorization"] = f"Bearer {current_account.get_token()}"
                                    retry_count += 1
                                    continue
                            
                            # 检查是否为内容长度超限错误，尝试截断重试
                            if error_obj.type == ErrorType.CONTENT_TOO_LONG:
                                history_chars, user_chars, total_chars = history_manager.estimate_request_chars(
                                    history, user_content
                                )
                                print(f"[Stream] 内容长度超限: history={history_chars} chars, user={user_chars} chars, total={total_chars} chars")
                                async def api_caller(prompt: str) -> str:
                                    return await _call_kiro_for_summary(prompt, current_account, headers)
                                truncated_history, should_retry = await history_manager.handle_length_error_async(
                                    history, retry_count, api_caller
                                )
                                if should_retry:
                                    print(f"[Stream] 内容长度超限，{history_manager.truncate_info}")
                                    history = truncated_history
                                    # 重新构建请求
                                    kiro_request = build_kiro_request(user_content, model, history, kiro_tools, images, tool_results)
                                    retry_count += 1
                                    continue
                            
                            if flow_id:
                                flow_monitor.fail_flow(flow_id, error_type, error_msg, response.status_code, error_str)
                            yield f'event: error\ndata: {{"type":"error","error":{{"type":"{error_type}","message":"{error_msg}"}}}}\n\n'
                            return

                        # 标记开始流式传输
                        if flow_id:
                            flow_monitor.start_streaming(flow_id)

                        # 正常处理响应
                        msg_id = f"msg_{log_id}"
                        yield f'event: message_start\ndata: {{"type":"message_start","message":{{"id":"{msg_id}","type":"message","role":"assistant","content":[],"model":"{model}","stop_reason":null,"stop_sequence":null,"usage":{{"input_tokens":{estimated_input_tokens},"output_tokens":0}}}}}}\n\n'
                        yield 'event: ping\ndata: {"type":"ping"}\n\n'

                        full_response = b""
                        thinking_parser = ThinkingStreamParser(thinking_enabled) if thinking_enabled else None
                        block_index = 0
                        thinking_block_started = False
                        text_block_started = False
                        has_text_events = False  # 是否产生过非 thinking 文本事件
                        has_tool_output = False  # 是否产生过 tool_use 事件（实时流式）
                        tool_use_states = {}  # 实时跟踪: tool_use_id -> {name, block_index, stopped, input_parts}
                        context_usage_pct = None  # 跟踪上下文使用率
                        frame_buffer = b""  # 跨 chunk 帧缓冲区
                        thinking_token_count = 0  # thinking 输出 token 估算
                        last_progress_time = time.time()  # 上次进度日志时间
                        event_type_counts = {}  # 统计每种事件类型的数量
                        total_frames = 0  # 总帧数
                        content_extract_errors = 0  # 内容提取错误计数

                        async for chunk in response.aiter_bytes():
                            full_response += chunk
                            frame_buffer += chunk  # 追加到帧缓冲区

                            try:
                                pos = 0
                                while pos < len(frame_buffer):
                                    if pos + 12 > len(frame_buffer):
                                        break
                                    total_len = int.from_bytes(frame_buffer[pos:pos+4], 'big')
                                    if total_len == 0 or total_len > len(frame_buffer) - pos:
                                        break  # 帧不完整，等待更多数据
                                    headers_len = int.from_bytes(frame_buffer[pos+4:pos+8], 'big')
                                    payload_start = pos + 12 + headers_len
                                    payload_end = pos + total_len - 4

                                    if payload_start < payload_end:
                                        try:
                                            payload = json.loads(frame_buffer[payload_start:payload_end].decode('utf-8'))
                                            
                                            # 解析 AWS event-stream 二进制 headers 获取事件类型
                                            headers_bytes = frame_buffer[pos+12:pos+12+headers_len]
                                            evt_type = _parse_event_type(headers_bytes)
                                            msg_type = _parse_message_type(headers_bytes)
                                            
                                            # 统计事件类型
                                            total_frames += 1
                                            et_key = evt_type or msg_type or 'unknown'
                                            event_type_counts[et_key] = event_type_counts.get(et_key, 0) + 1
                                            
                                            # 检测 contextUsageEvent（借鉴 kiro.rs）
                                            if evt_type == 'contextUsageEvent' or 'contextUsagePercentage' in payload:
                                                pct = payload.get('contextUsagePercentage', 0)
                                                context_usage_pct = pct
                                                print(f"[Anthropic Stream] [{log_id}] contextUsageEvent: {pct:.2f}% (input_tokens≈{int(pct * 200000 / 100)})")
                                            
                                            # 检测 exception 消息类型（借鉴 kiro.rs: message_type='exception'）
                                            if msg_type == 'exception':
                                                exc_type = _parse_exception_type(headers_bytes)
                                                if exc_type == 'ContentLengthExceededException':
                                                    context_usage_pct = 100.0
                                                    print(f"[Anthropic Stream] [{log_id}] ContentLengthExceededException detected")
                                            
                                            content = None
                                            if 'assistantResponseEvent' in payload:
                                                raw_content = payload['assistantResponseEvent'].get('content')
                                                # 确保 content 是字符串（API 可能返回不同类型）
                                                if isinstance(raw_content, str):
                                                    content = raw_content
                                                elif raw_content is not None:
                                                    # content 是非字符串类型（list/dict 等），转换为字符串
                                                    if content_extract_errors == 0:
                                                        print(f"[Anthropic Stream] [{log_id}] unexpected content type in assistantResponseEvent: {type(raw_content).__name__}, value={str(raw_content)[:200]}")
                                                    content_extract_errors += 1
                                                    if isinstance(raw_content, list):
                                                        # 可能是 [{"type": "text", "text": "..."}] 格式
                                                        parts = []
                                                        for item in raw_content:
                                                            if isinstance(item, dict) and 'text' in item:
                                                                parts.append(item['text'])
                                                            elif isinstance(item, str):
                                                                parts.append(item)
                                                        content = ''.join(parts)
                                                    else:
                                                        content = str(raw_content)
                                            elif 'content' in payload and evt_type != 'toolUseEvent':  
                                                content = payload['content']
                                                if not isinstance(content, str):
                                                    if content_extract_errors == 0:
                                                        print(f"[Anthropic Stream] [{log_id}] unexpected top-level content type: {type(content).__name__}")
                                                    content_extract_errors += 1
                                                    content = str(content) if content is not None else None
                                            if content:
                                                full_content += content
                                                if flow_id:
                                                    flow_monitor.add_chunk(flow_id, content)
                                                
                                                if thinking_parser:
                                                    # Thinking 模式：解析 <thinking> 标签
                                                    events = thinking_parser.process_chunk(content)
                                                    for evt in events:
                                                        if evt["type"] == "thinking":
                                                            if not thinking_block_started:
                                                                yield f'event: content_block_start\ndata: {{"type":"content_block_start","index":{block_index},"content_block":{{"type":"thinking","thinking":""}}}}\n\n'
                                                                thinking_block_started = True
                                                            thinking_token_count += _estimate_tokens(evt["text"])
                                                            # 每 30 秒记录一次 thinking 进度
                                                            now = time.time()
                                                            if now - last_progress_time >= 30:
                                                                print(f"[Anthropic Stream] [{log_id}] thinking in progress: ~{thinking_token_count} tokens")
                                                                last_progress_time = now
                                                            yield f'event: content_block_delta\ndata: {{"type":"content_block_delta","index":{block_index},"delta":{{"type":"thinking_delta","thinking":{json.dumps(evt["text"])}}}}}\n\n'
                                                        elif evt["type"] == "text":
                                                            has_text_events = True
                                                            if thinking_block_started and not text_block_started:
                                                                # 关闭 thinking 块
                                                                yield f'event: content_block_stop\ndata: {{"type":"content_block_stop","index":{block_index}}}\n\n'
                                                                block_index += 1
                                                                thinking_block_started = False
                                                            if not text_block_started:
                                                                yield f'event: content_block_start\ndata: {{"type":"content_block_start","index":{block_index},"content_block":{{"type":"text","text":""}}}}\n\n'
                                                                text_block_started = True
                                                            yield f'event: content_block_delta\ndata: {{"type":"content_block_delta","index":{block_index},"delta":{{"type":"text_delta","text":{json.dumps(evt["text"])}}}}}\n\n'
                                                else:
                                                    # 普通模式：直接发送文本（使用 block_index 而非硬编码 0）
                                                    if not text_block_started:
                                                        yield f'event: content_block_start\ndata: {{"type":"content_block_start","index":{block_index},"content_block":{{"type":"text","text":""}}}}\n\n'
                                                        text_block_started = True
                                                    yield f'event: content_block_delta\ndata: {{"type":"content_block_delta","index":{block_index},"delta":{{"type":"text_delta","text":{json.dumps(content)}}}}}\n\n'
                                            
                                            # ========== 实时处理 toolUseEvent（参考 kiro.rs process_tool_use）==========
                                            if evt_type == 'toolUseEvent' or (
                                                'toolUseId' in payload and 'name' in payload
                                                and evt_type not in ('assistantResponseEvent', 'contextUsageEvent')
                                            ):
                                                t_id = payload.get('toolUseId', '')
                                                t_name = payload.get('name', '')
                                                t_input = payload.get('input', '')
                                                t_stop = payload.get('stop', False)
                                                
                                                if t_id:
                                                    has_tool_output = True
                                                    
                                                    # 关闭 thinking 块（如果打开）
                                                    if thinking_block_started:
                                                        yield f'event: content_block_stop\ndata: {{"type":"content_block_stop","index":{block_index}}}\n\n'
                                                        block_index += 1
                                                        thinking_block_started = False
                                                    
                                                    # 关闭 text 块（如果打开）
                                                    if text_block_started:
                                                        yield f'event: content_block_stop\ndata: {{"type":"content_block_stop","index":{block_index}}}\n\n'
                                                        block_index += 1
                                                        text_block_started = False
                                                    
                                                    # 首次出现的 tool_use：发送 content_block_start
                                                    if t_id not in tool_use_states:
                                                        ti = block_index
                                                        block_index += 1
                                                        t_name_final = t_name or 'unknown'
                                                        tool_use_states[t_id] = {'name': t_name_final, 'block_index': ti, 'stopped': False, 'input_parts': []}
                                                        start_data = json.dumps({
                                                            "type": "content_block_start",
                                                            "index": ti,
                                                            "content_block": {
                                                                "type": "tool_use",
                                                                "id": t_id,
                                                                "name": t_name_final,
                                                                "input": {}
                                                            }
                                                        })
                                                        yield f'event: content_block_start\ndata: {start_data}\n\n'
                                                    
                                                    ti = tool_use_states[t_id]['block_index']
                                                    
                                                    # 累积 input 片段，用于流结束时检测截断
                                                    if t_input:
                                                        tool_use_states[t_id]['input_parts'].append(t_input)
                                                    
                                                    # 发送 input_json_delta（input 是 JSON 片段字符串）
                                                    if t_input:
                                                        delta_data = json.dumps({
                                                            "type": "content_block_delta",
                                                            "index": ti,
                                                            "delta": {
                                                                "type": "input_json_delta",
                                                                "partial_json": t_input
                                                            }
                                                        })
                                                        yield f'event: content_block_delta\ndata: {delta_data}\n\n'
                                                    
                                                    # stop=true 时关闭此 tool_use 块
                                                    if t_stop:
                                                        tool_use_states[t_id]['stopped'] = True
                                                        yield f'event: content_block_stop\ndata: {{"type":"content_block_stop","index":{ti}}}\n\n'
                                        except Exception as frame_err:
                                            if total_frames <= 3:
                                                print(f"[Anthropic Stream] [{log_id}] frame parse error at frame #{total_frames}: {type(frame_err).__name__}: {str(frame_err)[:200]}")
                                    pos += total_len
                                # 保留未完成的帧数据
                                frame_buffer = frame_buffer[pos:]
                            except Exception as chunk_err:
                                if total_frames <= 1:
                                    print(f"[Anthropic Stream] [{log_id}] chunk processing error: {type(chunk_err).__name__}: {str(chunk_err)[:200]}")

                        # 流结束：刷新 thinking parser 缓冲区
                        if thinking_parser:
                            flush_events = thinking_parser.flush()
                            for evt in flush_events:
                                if evt["type"] == "thinking":
                                    if not thinking_block_started:
                                        yield f'event: content_block_start\ndata: {{"type":"content_block_start","index":{block_index},"content_block":{{"type":"thinking","thinking":""}}}}\n\n'
                                        thinking_block_started = True
                                    yield f'event: content_block_delta\ndata: {{"type":"content_block_delta","index":{block_index},"delta":{{"type":"thinking_delta","thinking":{json.dumps(evt["text"])}}}}}\n\n'
                                elif evt["type"] == "text":
                                    has_text_events = True
                                    if thinking_block_started and not text_block_started:
                                        yield f'event: content_block_stop\ndata: {{"type":"content_block_stop","index":{block_index}}}\n\n'
                                        block_index += 1
                                        thinking_block_started = False
                                    if not text_block_started:
                                        yield f'event: content_block_start\ndata: {{"type":"content_block_start","index":{block_index},"content_block":{{"type":"text","text":""}}}}\n\n'
                                        text_block_started = True
                                    yield f'event: content_block_delta\ndata: {{"type":"content_block_delta","index":{block_index},"delta":{{"type":"text_delta","text":{json.dumps(evt["text"])}}}}}\n\n'
                            
                            # 关闭未关闭的块
                            if thinking_block_started:
                                yield f'event: content_block_stop\ndata: {{"type":"content_block_stop","index":{block_index}}}\n\n'
                                block_index += 1

                        result = parse_event_stream_full(full_response)

                        # 关闭文本块
                        if text_block_started:
                            yield f'event: content_block_stop\ndata: {{"type":"content_block_stop","index":{block_index}}}\n\n'
                            block_index += 1
                        
                        # ========== 关键修复：关闭未关闭的 tool_use 块 + 检测截断 JSON ==========
                        # 借鉴 kiro.rs generate_final_events: 遍历所有 active_blocks，
                        # 对 started && !stopped 的块发送 content_block_stop
                        # 额外检测: 即使 stop=true，如果累积的 JSON 无法解析也算截断
                        truncated_tool_use = False
                        for t_id, t_state in tool_use_states.items():
                            if not t_state.get('stopped', False):
                                # 情况1: 块未关闭（Kiro API 输出中断）
                                truncated_tool_use = True
                                ti = t_state['block_index']
                                print(f"[Anthropic Stream] [{log_id}] auto-closing unclosed tool_use block: {t_state['name']} (id={t_id}, index={ti})")
                                yield f'event: content_block_stop\ndata: {{"type":"content_block_stop","index":{ti}}}\n\n'
                            else:
                                # 情况2: 块已关闭（stop=true），但检查 JSON 是否完整
                                input_str = "".join(t_state.get('input_parts', []))
                                if input_str:
                                    try:
                                        json.loads(input_str)
                                    except Exception:
                                        truncated_tool_use = True
                                        print(f"[Anthropic Stream] [{log_id}] truncated JSON in tool_use block: {t_state['name']} (id={t_id}, {len(input_str)} chars)")
                        
                        # 关键修复：只在真正没有任何文本/工具输出时才创建空 fallback 块
                        # 之前的 bug: has_text_events 只在 thinking 模式下设置，
                        # 非 thinking 模式下即使已发送 828 帧文本，仍会创建空块覆盖有效内容！
                        if not has_text_events and not text_block_started and not has_tool_output:
                            if thinking_enabled:
                                # kiro.rs: 如果只有 thinking 块而没有 text 或 tool_use，
                                # 补发一个 text 块（内容为空格）并设置 stop_reason = "max_tokens"
                                yield f'event: content_block_start\ndata: {{"type":"content_block_start","index":{block_index},"content_block":{{"type":"text","text":""}}}}\n\n'
                                yield f'event: content_block_delta\ndata: {{"type":"content_block_delta","index":{block_index},"delta":{{"type":"text_delta","text":" "}}}}\n\n'
                                yield f'event: content_block_stop\ndata: {{"type":"content_block_stop","index":{block_index}}}\n\n'
                                block_index += 1
                            else:
                                # 非 thinking 模式且无任何内容输出
                                yield f'event: content_block_start\ndata: {{"type":"content_block_start","index":{block_index},"content_block":{{"type":"text","text":""}}}}\n\n'
                                yield f'event: content_block_stop\ndata: {{"type":"content_block_stop","index":{block_index}}}\n\n'

                        # tool_uses 已在流式过程中实时发送，不再在此批量处理

                        stop_reason = result["stop_reason"]
                        
                        # kiro.rs: thinking only (没有 text 和 tool_use) → stop_reason = "max_tokens"
                        # has_tool_output 已在流式过程中实时设置
                        if thinking_enabled and not has_text_events and not has_tool_output:
                            stop_reason = "max_tokens"
                            print(f"[Anthropic Stream] [{log_id}] thinking-only detected (~{thinking_token_count} thinking tokens), setting stop_reason=max_tokens")
                        
                        # 关键修复：当 tool_use 块被截断时（API 输出超限），设置 stop_reason = "max_tokens"
                        # 这样 Claude Code 知道响应被截断，会重试而不是尝试解析不完整的 JSON
                        if truncated_tool_use:
                            stop_reason = "max_tokens"
                            print(f"[Anthropic Stream] [{log_id}] truncated tool_use detected, setting stop_reason=max_tokens")
                        
                        # 流完成时始终记录统计（不仅限于 thinking 模式）
                        stream_duration = time.time() - start_time
                        ctx_str = f", context={context_usage_pct:.1f}%" if context_usage_pct else ""
                        think_str = f", thinking_tokens≈{thinking_token_count}" if thinking_token_count > 0 else ""
                        any_text = has_text_events or text_block_started
                        evt_str = f", events={event_type_counts}" if event_type_counts else ""
                        err_str = f", content_errors={content_extract_errors}" if content_extract_errors > 0 else ""
                        print(f"[Anthropic Stream] [{log_id}] stream completed: {stream_duration:.1f}s{think_str}, has_text={any_text}, has_tools={has_tool_output}, stop={stop_reason}{ctx_str}, frames={total_frames}{evt_str}{err_str}")
                        
                        # 诊断: 如果流有数据但未捕获任何文本内容，记录更多信息
                        if not any_text and not has_tool_output and total_frames > 0:
                            result_text = ''.join(result.get('content', []))
                            print(f"[Anthropic Stream] [{log_id}] WARNING: {total_frames} frames processed but no text/tool output captured!")
                            if result_text:
                                print(f"[Anthropic Stream] [{log_id}] parse_event_stream_full found text: {len(result_text)} chars")
                            if full_content:
                                print(f"[Anthropic Stream] [{log_id}] full_content has {len(full_content)} chars (should have been sent)")
                        
                        # 如果上下文使用率 >= 100%，设置 stop_reason 让 Claude Code 自动 compact
                        if context_usage_pct is not None and context_usage_pct >= 100.0:
                            stop_reason = "model_context_window_exceeded"
                        
                        # 使用 context_usage_pct 计算真实 input_tokens（借鉴 kiro.rs: pct * 200000 / 100）
                        if context_usage_pct is not None and context_usage_pct > 0:
                            real_input_tokens = int(context_usage_pct * 200000 / 100)
                        else:
                            real_input_tokens = result.get("input_tokens", 0) or 100
                        
                        # 关键修复: 当 HistoryManager 截断了历史消息时，按比例放大 input_tokens
                        # 否则 Claude Code 看到的 input_tokens 只反映截断后的 100 条消息，永远不会触发 compact
                        if history_manager and history_manager.was_truncated:
                            orig = history_manager.original_history_len
                            trunc = history_manager.truncated_history_len
                            if trunc > 0 and orig > trunc:
                                scale_factor = orig / trunc
                                scaled_tokens = int(real_input_tokens * scale_factor)
                                # 上限为 200k（不能超过上下文窗口）
                                scaled_tokens = min(scaled_tokens, 200000)
                                print(f"[Anthropic Stream] [{log_id}] history truncated {orig}->{trunc}, scaling input_tokens {real_input_tokens}->{scaled_tokens} (×{scale_factor:.1f})")
                                real_input_tokens = scaled_tokens
                                # 如果放大后接近上限（>80%），考虑设置 stop_reason
                                if real_input_tokens >= 160000 and stop_reason == "end_turn":
                                    stop_reason = "end_turn"  # 保留 end_turn，让 Claude Code 根据 input_tokens 判断
                        
                        real_output_tokens = result.get("output_tokens", 0) or 100
                        # 防止 output_tokens 超过 Claude Code 请求的 max_tokens（否则客户端会报错）
                        if real_output_tokens > requested_max_tokens:
                            real_output_tokens = requested_max_tokens
                        yield f'event: message_delta\ndata: {{"type":"message_delta","delta":{{"stop_reason":"{stop_reason}","stop_sequence":null}},"usage":{{"input_tokens":{real_input_tokens},"output_tokens":{real_output_tokens}}}}}\n\n'
                        yield f'event: message_stop\ndata: {{"type":"message_stop"}}\n\n'

                        # 完成 Flow
                        if flow_id:
                            flow_monitor.complete_flow(
                                flow_id,
                                status_code=200,
                                content=full_content,
                                tool_calls=result.get("tool_uses", []),
                                stop_reason=stop_reason,
                                usage=TokenUsage(
                                    input_tokens=result.get("input_tokens", 0),
                                    output_tokens=result.get("output_tokens", 0),
                                ),
                            )

                        current_account.request_count += 1
                        current_account.last_used = time.time()
                        current_account.error_count = 0  # 成功后重置错误计数（kiro.rs: report_success）
                        get_rate_limiter().record_request(current_account.id)
                        return

            except httpx.TimeoutException:
                if retry_count < max_retries:
                    delay = min(1.0 * (2 ** retry_count), 10.0)
                    print(f"[Stream] 请求超时，重试 {retry_count + 1}/{max_retries}，延迟 {delay:.1f}s")
                    retry_count += 1
                    import asyncio
                    await asyncio.sleep(delay)
                    continue
                # 重试耗尽 - 尝试截断历史后重试
                if not truncated_for_network_error and history and len(history) > 6 and history_manager:
                    truncated_for_network_error = True
                    keep = max(len(history) // 2, 4)
                    history = fix_history_alternation(history[-keep:])
                    kiro_request = build_kiro_request(user_content, model, history, kiro_tools, images, tool_results)
                    retry_count = 0
                    network_error_count = 0
                    print(f"[Stream] 超时重试耗尽，截断历史到 {len(history)} 条后重新尝试")
                    continue
                if flow_id:
                    flow_monitor.fail_flow(flow_id, "timeout_error", "Request timeout after retries", 408)
                yield f'event: error\ndata: {{"type":"error","error":{{"type":"api_error","message":"Request timeout after retries"}}}}\n\n'
                return
            except httpx.ConnectError:
                network_error_count += 1
                if retry_count < max_retries:
                    delay = min(1.0 * (2 ** retry_count), 10.0)
                    # 连续网络错误 ≥2 次时尝试切换账号
                    if network_error_count >= 2:
                        next_account = state.get_next_available_account(current_account.id, model=model)
                        if next_account:
                            print(f"[Stream] 连接错误，切换账号: {current_account.id} -> {next_account.id}，重试 {retry_count + 1}/{max_retries}")
                            current_account = next_account
                            headers["Authorization"] = f"Bearer {current_account.get_token()}"
                            network_error_count = 0
                        else:
                            print(f"[Stream] 连接错误，重试 {retry_count + 1}/{max_retries}，延迟 {delay:.1f}s")
                    else:
                        print(f"[Stream] 连接错误，重试 {retry_count + 1}/{max_retries}，延迟 {delay:.1f}s")
                    retry_count += 1
                    import asyncio
                    await asyncio.sleep(delay)
                    continue
                # ConnectError 重试耗尽 - 尝试截断历史后重试
                if not truncated_for_network_error and history and len(history) > 6 and history_manager:
                    truncated_for_network_error = True
                    keep = max(len(history) // 2, 4)
                    history = fix_history_alternation(history[-keep:])
                    kiro_request = build_kiro_request(user_content, model, history, kiro_tools, images, tool_results)
                    retry_count = 0
                    network_error_count = 0
                    print(f"[Stream] 连接错误重试耗尽，截断历史到 {len(history)} 条后重新尝试")
                    continue
                if flow_id:
                    flow_monitor.fail_flow(flow_id, "connection_error", "Connection error after retries", 502)
                yield f'event: error\ndata: {{"type":"error","error":{{"type":"api_error","message":"Connection error after retries"}}}}\n\n'
                return
            except Exception as e:
                # 检查是否为可重试的网络错误
                if is_retryable_error(None, e) and retry_count < max_retries:
                    network_error_count += 1
                    delay = min(1.0 * (2 ** retry_count), 10.0)
                    # 连续网络错误 ≥2 次时尝试切换账号
                    if network_error_count >= 2:
                        next_account = state.get_next_available_account(current_account.id, model=model)
                        if next_account:
                            print(f"[Stream] 网络错误 {type(e).__name__}，切换账号: {current_account.id} -> {next_account.id}，重试 {retry_count + 1}/{max_retries}")
                            current_account = next_account
                            headers["Authorization"] = f"Bearer {current_account.get_token()}"
                            network_error_count = 0
                        else:
                            print(f"[Stream] 网络错误，重试 {retry_count + 1}/{max_retries}，延迟 {delay:.1f}s: {type(e).__name__}")
                    else:
                        print(f"[Stream] 网络错误，重试 {retry_count + 1}/{max_retries}，延迟 {delay:.1f}s: {type(e).__name__}")
                    retry_count += 1
                    import asyncio
                    await asyncio.sleep(delay)
                    continue
                # 网络错误（含 RemoteProtocolError）重试耗尽 - 尝试截断历史后重试
                if is_retryable_error(None, e) and not truncated_for_network_error and history and len(history) > 6 and history_manager:
                    truncated_for_network_error = True
                    keep = max(len(history) // 2, 4)
                    history = fix_history_alternation(history[-keep:])
                    kiro_request = build_kiro_request(user_content, model, history, kiro_tools, images, tool_results)
                    retry_count = 0
                    network_error_count = 0
                    print(f"[Stream] 网络错误 {type(e).__name__} 重试耗尽，截断历史到 {len(history)} 条后重新尝试")
                    continue
                if flow_id:
                    flow_monitor.fail_flow(flow_id, "api_error", str(e), 500)
                yield f'event: error\ndata: {{"type":"error","error":{{"type":"api_error","message":"{str(e)}"}}}}\n\n'
                return

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _handle_non_stream(kiro_request, headers, account, model, log_id, start_time, session_id=None, flow_id=None, history=None, user_content="", kiro_tools=None, images=None, tool_results=None, history_manager=None, thinking_config=None):
    """Handle non-streaming responses with auto-retry on quota exceeded and network errors."""
    error_msg = None
    status_code = 200
    current_account = account
    # 动态重试次数：参考 kiro.rs min(credentials * 3, 9)
    max_retries = min(len(state.accounts) * 3, 9) if len(state.accounts) > 1 else 4
    network_error_count = 0  # 连续网络错误计数
    truncated_for_network_error = False  # 是否已因网络错误截断过
    retry_ctx = RetryableRequest(max_retries=max_retries, base_delay=1.0)

    retry = 0
    while retry <= max_retries:
        try:
            response = await http_pool.api_client.post(KIRO_API_URL, json=kiro_request, headers=headers)
            status_code = response.status_code

            # 处理 429 瞬态限流（参考 kiro.rs：不禁用凭据，不截断历史，仅退避重试）
            if response.status_code == 429:
                current_account.error_count += 1
                if retry < max_retries:
                    import random
                    base_ms = min(200 * (2 ** retry), 2000)
                    jitter = random.randint(0, max(base_ms // 4, 1))
                    wait_time = (base_ms + jitter) / 1000.0
                    print(f"[NonStream] 429 瞬态限流，退避 {wait_time:.1f}s 后重试 ({retry + 1}/{max_retries}): {current_account.id}")
                    retry += 1
                    await asyncio.sleep(wait_time)
                    continue
                
                if flow_id:
                    flow_monitor.fail_flow(flow_id, "rate_limit_error", "Rate limited after retries", 429)
                raise HTTPException(429, "Rate limited after retries, please try again later")

            # 402 月度配额耗尽
            if response.status_code == 402 and "MONTHLY_REQUEST_COUNT" in response.text:
                current_account.mark_quota_exceeded("Monthly quota exhausted")
                next_account = state.get_next_available_account(current_account.id, model=model)
                if next_account and retry < max_retries:
                    print(f"[NonStream] 月度配额耗尽，切换账号: {current_account.id} -> {next_account.id}")
                    current_account = next_account
                    token = current_account.get_token()
                    creds = current_account.get_credentials()
                    headers["Authorization"] = f"Bearer {token}"
                    retry += 1
                    continue
                if flow_id:
                    flow_monitor.fail_flow(flow_id, "rate_limit_error", "Monthly quota exhausted", 429)
                raise HTTPException(429, "Monthly quota exhausted for all accounts")

            # 处理可重试的服务端错误
            if is_retryable_error(response.status_code):
                if retry < max_retries:
                    print(f"[NonStream] 服务端错误 {response.status_code}，重试 {retry + 1}/{max_retries}")
                    retry += 1
                    await retry_ctx.wait()
                    continue
                if flow_id:
                    flow_monitor.fail_flow(flow_id, "api_error", f"Server error after {max_retries} retries", response.status_code)
                raise HTTPException(response.status_code, f"Server error after {max_retries} retries")

            if response.status_code != 200:
                error_msg = response.text
                print(f"[NonStream] Kiro API Error {response.status_code}: {error_msg[:500]}")
                
                # 使用统一的错误处理
                status, error_type, error_message, error_obj = _handle_kiro_error(
                    response.status_code, error_msg, current_account
                )
                
                # 认证失败 - 先尝试刷新 token，再切换账号（参考 kiro.rs: 401 先刷新再故障转移）
                if error_obj.type == ErrorType.AUTH_FAILED and retry < max_retries:
                    print(f"[NonStream] 401 认证失败，尝试刷新 token: {current_account.id}")
                    refresh_ok, refresh_msg = await current_account.refresh_token()
                    if refresh_ok:
                        print(f"[NonStream] Token 刷新成功，重试: {current_account.id}")
                        headers["Authorization"] = f"Bearer {current_account.get_token()}"
                        retry += 1
                        continue
                    else:
                        print(f"[NonStream] Token 刷新失败: {refresh_msg}")
                
                # 账号封禁/认证失败/配额超限 - 尝试切换账号
                if error_obj.should_switch_account:
                    next_account = state.get_next_available_account(current_account.id, model=model)
                    if next_account and retry < max_retries:
                        print(f"[NonStream] 切换账号: {current_account.id} -> {next_account.id}")
                        current_account = next_account
                        headers["Authorization"] = f"Bearer {current_account.get_token()}"
                        retry += 1
                        continue
                
                # 检查是否为内容长度超限错误，尝试截断重试
                if error_obj.type == ErrorType.CONTENT_TOO_LONG and history_manager:
                    history_chars, user_chars, total_chars = history_manager.estimate_request_chars(
                        history, user_content
                    )
                    print(f"[NonStream] 内容长度超限: history={history_chars} chars, user={user_chars} chars, total={total_chars} chars")
                    async def api_caller(prompt: str) -> str:
                        return await _call_kiro_for_summary(prompt, current_account, headers)
                    truncated_history, should_retry = await history_manager.handle_length_error_async(
                        history, retry, api_caller
                    )
                    if should_retry:
                        print(f"[NonStream] 内容长度超限，{history_manager.truncate_info}")
                        history = truncated_history
                        kiro_request = build_kiro_request(user_content, model, history, kiro_tools, images, tool_results)
                        retry += 1
                        continue
                    else:
                        print(f"[NonStream] 内容长度超限但未重试: retry={retry}/{max_retries}")
                
                if flow_id:
                    flow_monitor.fail_flow(flow_id, error_type, error_message, status, error_msg)
                raise HTTPException(status, error_message)

            result = parse_event_stream_full(response.content)
            current_account.request_count += 1
            current_account.last_used = time.time()
            current_account.error_count = 0  # 成功后重置错误计数（kiro.rs: report_success）
            get_rate_limiter().record_request(current_account.id)

            # 完成 Flow
            if flow_id:
                flow_monitor.complete_flow(
                    flow_id,
                    status_code=200,
                    content=result.get("text", ""),
                    tool_calls=result.get("tool_uses", []),
                    stop_reason=result.get("stop_reason", ""),
                    usage=TokenUsage(
                        input_tokens=result.get("input_tokens", 0),
                        output_tokens=result.get("output_tokens", 0),
                    ),
                )

            return convert_kiro_response_to_anthropic(result, model, f"msg_{log_id}")

        except HTTPException:
            raise
        except httpx.TimeoutException as e:
            error_msg = f"Request timeout: {e}"
            status_code = 408
            if retry < max_retries:
                delay = min(1.0 * (2 ** retry), 10.0)
                print(f"[NonStream] 请求超时，重试 {retry + 1}/{max_retries}，延迟 {delay:.1f}s")
                retry += 1
                await asyncio.sleep(delay)
                continue
            # 重试耗尽 - 尝试截断历史后重试
            if not truncated_for_network_error and history and len(history) > 6 and history_manager:
                truncated_for_network_error = True
                keep = max(len(history) // 2, 4)
                history = fix_history_alternation(history[-keep:])
                kiro_request = build_kiro_request(user_content, model, history, kiro_tools, images, tool_results)
                retry = 0
                print(f"[NonStream] 超时重试耗尽，截断历史到 {len(history)} 条后重新尝试")
                continue
            if flow_id:
                flow_monitor.fail_flow(flow_id, "timeout_error", "Request timeout after retries", 408)
            raise HTTPException(408, "Request timeout after retries")
        except httpx.ConnectError as e:
            error_msg = f"Connection error: {e}"
            status_code = 502
            network_error_count += 1
            if retry < max_retries:
                delay = min(1.0 * (2 ** retry), 10.0)
                # 连续网络错误 ≥2 次时尝试切换账号
                if network_error_count >= 2:
                    next_account = state.get_next_available_account(current_account.id, model=model)
                    if next_account:
                        print(f"[NonStream] 连接错误，切换账号: {current_account.id} -> {next_account.id}，重试 {retry + 1}/{max_retries}")
                        current_account = next_account
                        headers["Authorization"] = f"Bearer {current_account.get_token()}"
                        network_error_count = 0
                    else:
                        print(f"[NonStream] 连接错误，重试 {retry + 1}/{max_retries}，延迟 {delay:.1f}s")
                else:
                    print(f"[NonStream] 连接错误，重试 {retry + 1}/{max_retries}，延迟 {delay:.1f}s")
                await asyncio.sleep(delay)
                retry += 1
                continue
            # ConnectError 重试耗尽 - 尝试截断历史后重试
            if not truncated_for_network_error and history and len(history) > 6 and history_manager:
                truncated_for_network_error = True
                keep = max(len(history) // 2, 4)
                history = fix_history_alternation(history[-keep:])
                kiro_request = build_kiro_request(user_content, model, history, kiro_tools, images, tool_results)
                network_error_count = 0
                retry = 0
                print(f"[NonStream] 连接错误重试耗尽，截断历史到 {len(history)} 条后重新尝试")
                continue
            if flow_id:
                flow_monitor.fail_flow(flow_id, "connection_error", "Connection error after retries", 502)
            raise HTTPException(502, "Connection error after retries")
        except Exception as e:
            error_msg = str(e)
            status_code = 500
            # 检查是否为可重试的网络错误
            if is_retryable_error(None, e) and retry < max_retries:
                network_error_count += 1
                delay = min(1.0 * (2 ** retry), 10.0)
                # 连续网络错误 ≥2 次时尝试切换账号
                if network_error_count >= 2:
                    next_account = state.get_next_available_account(current_account.id, model=model)
                    if next_account:
                        print(f"[NonStream] 网络错误 {type(e).__name__}，切换账号: {current_account.id} -> {next_account.id}，重试 {retry + 1}/{max_retries}")
                        current_account = next_account
                        headers["Authorization"] = f"Bearer {current_account.get_token()}"
                        network_error_count = 0
                    else:
                        print(f"[NonStream] 网络错误，重试 {retry + 1}/{max_retries}，延迟 {delay:.1f}s: {type(e).__name__}: {str(e)[:200]}")
                else:
                    print(f"[NonStream] 网络错误，重试 {retry + 1}/{max_retries}，延迟 {delay:.1f}s: {type(e).__name__}: {str(e)[:200]}")
                await asyncio.sleep(delay)
                retry += 1
                continue
            # 网络错误（含 RemoteProtocolError）重试耗尽 - 尝试截断历史后重试
            if is_retryable_error(None, e) and not truncated_for_network_error and history and len(history) > 6 and history_manager:
                truncated_for_network_error = True
                keep = max(len(history) // 2, 4)
                history = fix_history_alternation(history[-keep:])
                kiro_request = build_kiro_request(user_content, model, history, kiro_tools, images, tool_results)
                network_error_count = 0
                retry = 0
                print(f"[NonStream] 网络错误 {type(e).__name__} 重试耗尽，截断历史到 {len(history)} 条后重新尝试")
                continue
            print(f"[NonStream] 不可重试的错误: {type(e).__name__}: {str(e)[:300]}")
            if flow_id:
                flow_monitor.fail_flow(flow_id, "api_error", str(e), 500)
            raise HTTPException(500, str(e))
        finally:
            if retry == max_retries or status_code == 200:
                duration = (time.time() - start_time) * 1000
                state.add_log(RequestLog(
                    id=log_id,
                    timestamp=time.time(),
                    method="POST",
                    path="/v1/messages",
                    model=model,
                    account_id=current_account.id if current_account else None,
                    status=status_code,
                    duration_ms=duration,
                    error=error_msg
                ))
                # 记录统计
                stats_manager.record_request(
                    account_id=current_account.id if current_account else "unknown",
                    model=model,
                    success=status_code == 200,
                    latency_ms=duration
                )
    
    raise HTTPException(503, "All retries exhausted")
