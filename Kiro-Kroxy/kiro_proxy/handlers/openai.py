"""OpenAI 协议处理 - /v1/chat/completions"""
import json
import uuid
import time
import asyncio
import struct
import httpx
import binascii
from ..core.http_pool import http_pool
from datetime import datetime
from fastapi import Request, HTTPException
from fastapi.responses import StreamingResponse

from ..config import KIRO_API_URL, map_model_name
from ..core import state, Account, is_retryable_error, stats_manager, flow_monitor, TokenUsage
from ..core.state import RequestLog
from ..core.history_manager import HistoryManager, get_history_config, is_content_length_error
from ..core.error_handler import classify_error, ErrorType, format_error_log
from ..core.rate_limiter import get_rate_limiter
from ..core.thinking import (
    parse_thinking_from_model_name, parse_thinking_from_request,
    generate_thinking_prefix, inject_thinking_into_history,
    strip_thinking_suffix_from_model, ThinkingStreamParser, ThinkingConfig,
)
from ..kiro_api import build_headers, build_kiro_request, parse_event_stream, parse_event_stream_full
from ..converters import (
    generate_session_id,
    convert_openai_messages_to_kiro,
    convert_kiro_response_to_openai,
    extract_images_from_content,
    fix_history_alternation,
)


async def handle_chat_completions(request: Request):
    """处理 /v1/chat/completions 请求"""
    start_time = time.time()
    log_id = uuid.uuid4().hex[:8]
    
    body = await request.json()
    model = map_model_name(body.get("model", "claude-sonnet-4"))
    messages = body.get("messages", [])
    stream = body.get("stream", False)
    tools = body.get("tools", None)
    tool_choice = body.get("tool_choice", None)

    # 检查模型名是否有 -thinking 后缀
    thinking_config = parse_thinking_from_model_name(model)
    if thinking_config is None:
        thinking_config = ThinkingConfig()  # disabled
    # 如果是 thinking 变体模型，去掉后缀得到实际模型 ID
    if "-thinking" in model.lower():
        model = map_model_name(strip_thinking_suffix_from_model(model))

    # 调试：打印原始请求的关键信息
    print(f"[OpenAI] Request: model={body.get('model')} -> {model}, messages={len(messages)}, stream={stream}, tools={len(tools) if tools else 0}")
    
    # 调试：检查消息中的内容类型
    for mi, msg in enumerate(messages):
        content = msg.get("content", "")
        role = msg.get("role", "")
        if isinstance(content, list):
            block_types = [b.get("type", "unknown") if isinstance(b, dict) else "str" for b in content]
            print(f"[OpenAI] msg[{mi}] role={role}, content blocks: {block_types}")
        elif isinstance(content, str):
            # 截断过长的文本
            preview = content[:50] + "..." if len(content) > 50 else content
            print(f"[OpenAI] msg[{mi}] role={role}, content: {preview}")
    
    if not messages:
        raise HTTPException(400, "messages required")
    
    session_id = generate_session_id(messages)
    account = state.get_available_account(session_id, model=model)
    
    if not account:
        raise HTTPException(503, "All accounts are rate limited or unavailable")
    
    # 创建 Flow 记录
    flow_id = flow_monitor.create_flow(
        protocol="openai",
        method="POST",
        path="/v1/chat/completions",
        headers=dict(request.headers),
        body=body,
        account_id=account.id,
        account_name=account.name,
    )
    
    # 检查 token 是否即将过期，尝试刷新
    if account.is_token_expiring_soon(5):
        print(f"[OpenAI] Token 即将过期，尝试刷新: {account.id}")
        success, msg = await account.refresh_token()
        if not success:
            print(f"[OpenAI] Token 刷新失败: {msg}")
    
    token = account.get_token()
    if not token:
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
        print(f"[OpenAI] 限速: {reason}")
        await asyncio.sleep(wait_seconds)
    
    # 使用增强的转换函数
    user_content, history, tool_results, kiro_tools = convert_openai_messages_to_kiro(
        messages, model, tools, tool_choice
    )
    
    # 历史消息预处理
    history_manager = HistoryManager(get_history_config(), cache_key=session_id)
    
    async def call_summary(prompt: str) -> str:
        req = build_kiro_request(prompt, "claude-haiku-4.5", [])
        try:
            resp = await http_pool.short_client.post(KIRO_API_URL, json=req, headers=headers)
            if resp.status_code == 200:
                return parse_event_stream(resp.content)
        except Exception as e:
            print(f"[Summary] API 调用失败: {e}")
        return ""

    # 检查是否需要智能摘要或错误重试预摘要
    if history_manager.should_summarize(history) or history_manager.should_pre_summary_for_error_retry(history, user_content):
        history = await history_manager.pre_process_async(history, user_content, call_summary)
    else:
        history = history_manager.pre_process(history, user_content)
    
    # 摘要/截断后再次修复历史交替和 toolUses/toolResults 配对
    history = fix_history_alternation(history)
    
    if history_manager.was_truncated:
        print(f"[OpenAI] {history_manager.truncate_info}")

    
    # 提取最后一条消息中的图片
    images = []
    if messages:
        last_msg = messages[-1]
        if last_msg.get("role") == "user":
            _, images = await extract_images_from_content(last_msg.get("content", ""))
    
    kiro_request = build_kiro_request(
        user_content, model, history, 
        images=images,
        tools=kiro_tools if kiro_tools else None,
        tool_results=tool_results if tool_results else None
    )
    
    # 注入 thinking 前缀到历史消息
    if thinking_config.is_enabled():
        thinking_prefix = generate_thinking_prefix(thinking_config)
        if thinking_prefix:
            history = inject_thinking_into_history(history, thinking_prefix, model)
            print(f"[OpenAI] Thinking mode: {thinking_config.thinking_type}, budget={thinking_config.budget_tokens}")
            # 重新构建请求（history 已更新）
            kiro_request = build_kiro_request(
                user_content, model, history,
                images=images,
                tools=kiro_tools if kiro_tools else None,
                tool_results=tool_results if tool_results else None
            )
    
    # 流式请求使用真正的流式传输（参考 kiro.rs：直接转发上游流，而非缓冲后fake-stream）
    if stream:
        return await _handle_openai_stream(
            kiro_request, headers, account, model, log_id, start_time,
            session_id, flow_id, history, user_content, kiro_tools,
            images, tool_results, history_manager, thinking_config
        )
    
    error_msg = None
    status_code = 200
    result = None  # parse_event_stream_full 返回的完整结构
    current_account = account
    # 动态重试次数：参考 kiro.rs min(credentials * 3, 9)
    max_retries = min(len(state.accounts) * 3, 9) if len(state.accounts) > 1 else 3
    
    for retry in range(max_retries + 1):
        try:
            resp = await http_pool.api_client.post(KIRO_API_URL, json=kiro_request, headers=headers)
            status_code = resp.status_code
            
            # 处理 429 瞬态限流（参考 kiro.rs：不禁用凭据，不截断历史，仅退避重试）
            # 429 是速率限制，不是内容过长，截断历史无意义
            if resp.status_code == 429:
                current_account.error_count += 1
                
                if retry < max_retries:
                    # kiro.rs 风格退避：200ms * 2^attempt，上限 2s，加 25% 随机抖动
                    import random
                    base_ms = min(200 * (2 ** retry), 2000)
                    jitter = random.randint(0, max(base_ms // 4, 1))
                    wait_time = (base_ms + jitter) / 1000.0
                    print(f"[OpenAI] 429 瞬态限流，退避 {wait_time:.1f}s 后重试 ({retry + 1}/{max_retries}): {current_account.id}")
                    await asyncio.sleep(wait_time)
                    continue

                if flow_id:
                    flow_monitor.fail_flow(flow_id, "rate_limit_error", "Rate limited after retries", 429)
                raise HTTPException(429, "Rate limited after retries, please try again later")
            
            # 402 月度配额耗尽
            if resp.status_code == 402 and "MONTHLY_REQUEST_COUNT" in resp.text:
                current_account.mark_quota_exceeded("Monthly quota exhausted")
                next_account = state.get_next_available_account(current_account.id, model=model)
                if next_account and retry < max_retries:
                    print(f"[OpenAI] 月度配额耗尽，切换账号: {current_account.id} -> {next_account.id}")
                    current_account = next_account
                    token = current_account.get_token()
                    creds = current_account.get_credentials()
                    headers = build_headers(
                        token,
                        machine_id=current_account.get_machine_id(),
                        profile_arn=creds.profile_arn if creds else None,
                        client_id=creds.client_id if creds else None
                    )
                    continue
                if flow_id:
                    flow_monitor.fail_flow(flow_id, "rate_limit_error", "Monthly quota exhausted", 429)
                raise HTTPException(429, "Monthly quota exhausted for all accounts")
            
            # 处理可重试的服务端错误
            if is_retryable_error(resp.status_code):
                if retry < max_retries:
                    print(f"[OpenAI] 服务端错误 {resp.status_code}，重试 {retry + 1}/{max_retries}")
                    await asyncio.sleep(0.5 * (2 ** retry))
                    continue
                if flow_id:
                    flow_monitor.fail_flow(flow_id, "api_error", "Server error after retries", resp.status_code)
                raise HTTPException(resp.status_code, f"Server error after {max_retries} retries")
            
            if resp.status_code != 200:
                error_msg = resp.text
                print(f"=== Kiro API Error ===")
                print(f"Status: {resp.status_code}")
                print(f"Response: {resp.text[:500]}")
                print(f"Request model: {model}")
                print(f"History len: {len(history) if history else 0}")
                print(f"Tool results: {len(tool_results) if tool_results else 0}")
                if resp.status_code == 400:
                    print(f"Kiro request keys: {list(kiro_request.keys())}")
                print(f"======================")
                
                # 使用统一的错误处理
                error = classify_error(resp.status_code, error_msg)
                print(format_error_log(error, current_account.id))
                
                # 账号封禁 - 禁用账号
                if error.should_disable_account:
                    current_account.enabled = False
                    from ..credential import CredentialStatus
                    current_account.status = CredentialStatus.SUSPENDED
                    print(f"[OpenAI] 账号 {current_account.id} 已被禁用 (封禁)")
                
                # 配额超限 - 仅在真正的月度配额耗尽时标记冷却
                # 瞬态 429 已在前面处理，这里只处理其他错误码中含限流关键词的情况
                if error.type == ErrorType.RATE_LIMITED:
                    if "MONTHLY_REQUEST_COUNT" in (error_msg or ""):
                        current_account.mark_quota_exceeded(error_msg[:100])
                    else:
                        current_account.error_count += 1
                
                # 认证失败 - 先尝试刷新 token，再切换账号（参考 kiro.rs: 401 先刷新再故障转移）
                if error.type == ErrorType.AUTH_FAILED and retry < max_retries:
                    print(f"[OpenAI] 401 认证失败，尝试刷新 token: {current_account.id}")
                    refresh_ok, refresh_msg = await current_account.refresh_token()
                    if refresh_ok:
                        print(f"[OpenAI] Token 刷新成功，重试: {current_account.id}")
                        headers["Authorization"] = f"Bearer {current_account.get_token()}"
                        retry += 1
                        continue
                    else:
                        print(f"[OpenAI] Token 刷新失败: {refresh_msg}")
                
                # 尝试切换账号
                if error.should_switch_account:
                    next_account = state.get_next_available_account(current_account.id, model=model)
                    if next_account and retry < max_retries:
                        print(f"[OpenAI] 切换账号: {current_account.id} -> {next_account.id}")
                        current_account = next_account
                        headers["Authorization"] = f"Bearer {current_account.get_token()}"
                        continue
                
                # 检查是否为内容长度超限错误，尝试截断重试
                if error.type == ErrorType.CONTENT_TOO_LONG:
                    history_chars, user_chars, total_chars = history_manager.estimate_request_chars(
                        history, user_content
                    )
                    print(f"[OpenAI] 内容长度超限: history={history_chars} chars, user={user_chars} chars, total={total_chars} chars")
                    truncated_history, should_retry = await history_manager.handle_length_error_async(
                        history, retry, call_summary
                    )
                    if should_retry:
                        print(f"[OpenAI] 内容长度超限，{history_manager.truncate_info}")
                        history = truncated_history
                        kiro_request = build_kiro_request(
                            user_content, model, history,
                            images=images,
                            tools=kiro_tools if kiro_tools else None,
                            tool_results=tool_results if tool_results else None
                        )
                        continue
                    else:
                        print(f"[OpenAI] 内容长度超限但未重试: retry={retry}/{max_retries}")
                
                if flow_id:
                    flow_monitor.fail_flow(flow_id, error.type.value if hasattr(error.type, 'value') else str(error.type), error.user_message, resp.status_code, error_msg[:500])
                raise HTTPException(resp.status_code, error.user_message)
            
            # 成功：解析完整响应（包含 tool_uses）
            result = parse_event_stream_full(resp.content)
            current_account.request_count += 1
            current_account.last_used = time.time()
            current_account.error_count = 0  # 成功后重置错误计数（kiro.rs: report_success）
            get_rate_limiter().record_request(current_account.id)
            break
                
        except HTTPException:
            raise
        except httpx.TimeoutException:
            error_msg = "Request timeout"
            status_code = 408
            if retry < max_retries:
                print(f"[OpenAI] 请求超时，重试 {retry + 1}/{max_retries}")
                await asyncio.sleep(0.5 * (2 ** retry))
                continue
            if flow_id:
                flow_monitor.fail_flow(flow_id, "timeout", "Request timeout after retries", 408)
            raise HTTPException(408, "Request timeout after retries")
        except httpx.ConnectError:
            error_msg = "Connection error"
            status_code = 502
            if retry < max_retries:
                print(f"[OpenAI] 连接错误，重试 {retry + 1}/{max_retries}")
                await asyncio.sleep(0.5 * (2 ** retry))
                continue
            if flow_id:
                flow_monitor.fail_flow(flow_id, "connect_error", "Connection error after retries", 502)
            raise HTTPException(502, "Connection error after retries")
        except Exception as e:
            error_msg = str(e)
            status_code = 500
            # 检查是否为可重试的网络错误
            if is_retryable_error(None, e) and retry < max_retries:
                print(f"[OpenAI] 网络错误，重试 {retry + 1}/{max_retries}: {type(e).__name__}")
                await asyncio.sleep(0.5 * (2 ** retry))
                continue
            if flow_id:
                flow_monitor.fail_flow(flow_id, "internal_error", str(e), 500)
            raise HTTPException(500, str(e))
    
    # 记录日志
    duration = (time.time() - start_time) * 1000
    state.add_log(RequestLog(
        id=log_id,
        timestamp=time.time(),
        method="POST",
        path="/v1/chat/completions",
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
    
    msg_id = f"chatcmpl-{log_id}"
    
    # 非流式：直接用 convert_kiro_response_to_openai
    response = convert_kiro_response_to_openai(result, model, msg_id)
    
    # 完成 Flow
    if flow_id:
        full_content = "".join(result.get("content", []))
        flow_monitor.complete_flow(
            flow_id,
            status_code=200,
            content=full_content,
            tool_calls=result.get("tool_uses", []),
            stop_reason=result.get("stop_reason", "stop"),
            usage=TokenUsage(
                input_tokens=result.get("input_tokens", 0),
                output_tokens=result.get("output_tokens", 0),
            ),
        )
    
    return response


class KiroStreamProcessor:
    """处理 Kiro Event Stream 的增量解析"""
    def __init__(self):
        self.buffer = bytearray()
        self.tool_input_buffer = {}

    @staticmethod
    def _parse_binary_headers(data: bytes) -> dict:
        """Parse AWS event-stream binary headers.
        
        Format: [name_len(1) | name(N) | value_type(1) | value_len(2) | value(M)] ...
        value_type 7 = string
        """
        headers = {}
        pos = 0
        while pos < len(data):
            if pos + 1 > len(data):
                break
            name_len = data[pos]
            pos += 1
            if pos + name_len > len(data):
                break
            name = data[pos:pos + name_len].decode('utf-8', errors='ignore')
            pos += name_len
            if pos + 1 > len(data):
                break
            value_type = data[pos]
            pos += 1
            if value_type == 7:  # string
                if pos + 2 > len(data):
                    break
                value_len = struct.unpack('>H', data[pos:pos + 2])[0]
                pos += 2
                if pos + value_len > len(data):
                    break
                value = data[pos:pos + value_len].decode('utf-8', errors='ignore')
                pos += value_len
                headers[name] = value
            else:
                # Skip unknown types - can't determine length, break
                break
        return headers

    def process(self, chunk: bytes):
        """处理新收到的数据块，生成解析出的事件"""
        self.buffer.extend(chunk)
        
        while len(self.buffer) >= 12:  # 最小头部长度
            total_len = int.from_bytes(self.buffer[0:4], 'big')
            if total_len > len(self.buffer):
                break  # 数据不够，等待下一个块
            
            # 取出完整的一帧数据
            frame_data = self.buffer[:total_len]
            # 从缓冲区移除已处理的数据
            del self.buffer[:total_len]
            
            # 使用 providers/kiro.py 中的解析逻辑解析单帧
            # 注意：这里我们复用类似的逻辑，或者直接调用 parse_one_frame
            # 为了简便和直接控制，这里内联解析逻辑
            
            # CRC32 校验
            prelude_crc = int.from_bytes(frame_data[8:12], 'big')
            expected_prelude_crc = binascii.crc32(frame_data[0:8]) & 0xFFFFFFFF
            if prelude_crc != expected_prelude_crc:
                continue
            
            msg_crc = int.from_bytes(frame_data[total_len-4:total_len], 'big')
            expected_msg_crc = binascii.crc32(frame_data[0:total_len-4]) & 0xFFFFFFFF
            if msg_crc != expected_msg_crc:
                continue
            
            headers_len = int.from_bytes(frame_data[4:8], 'big')
            header_start = 12
            header_end = header_start + headers_len
            headers_data = frame_data[header_start:header_end]
            
            # Parse binary headers properly (AWS event-stream format)
            event_type = None
            msg_type = None
            exception_type = None
            try:
                parsed_hdrs = self._parse_binary_headers(headers_data)
                event_type = parsed_hdrs.get(':event-type')
                msg_type = parsed_hdrs.get(':message-type')
                exception_type = parsed_hdrs.get(':exception-type')
            except Exception:
                pass
            
            payload_start = header_end
            payload_end = total_len - 4
            
            if payload_start < payload_end:
                try:
                    payload = json.loads(frame_data[payload_start:payload_end].decode('utf-8'))
                    
                    # 1. 处理 toolUseEvent
                    if event_type == 'toolUseEvent' or 'toolUseId' in payload:
                        yield {
                            "type": "tool_use",
                            "toolUseId": payload.get('toolUseId'),
                            "name": payload.get('name'),
                            "input": payload.get('input'),
                            "stop": payload.get('stop', False)
                        }
                    
                    # 2. 处理 assistantResponseEvent
                    elif event_type == 'assistantResponseEvent' or 'content' in payload:
                        # 兼容直接在这里返回 tool 相关的字段 (防御性)
                        if 'toolUseId' in payload:
                             yield {
                                "type": "tool_use",
                                "toolUseId": payload.get('toolUseId'),
                                "name": payload.get('name'),
                                "input": payload.get('input'),
                                "stop": payload.get('stop', False)
                            }
                        if 'content' in payload:
                            content = payload['content']
                            if content:
                                yield {
                                    "type": "content",
                                    "content": content
                                }
                    
                    # 3. 处理 contextUsageEvent
                    elif event_type == 'contextUsageEvent' or 'contextUsagePercentage' in payload:
                        percentage = payload.get('contextUsagePercentage', 0)
                        if percentage > 0:
                            yield {
                                "type": "context_usage",
                                "usage": percentage
                            }
                    
                    # 4. 处理 exception (ContentLengthExceededException)
                    elif msg_type == 'exception':
                        yield {
                            "type": "context_usage",
                            "usage": 100,
                            "exception": exception_type or 'unknown'
                        }
                except Exception:
                    pass


async def _handle_openai_stream(
    kiro_request: dict, headers: dict, account: Account, model: str, log_id: str,
    start_time: float, session_id: str, flow_id: str, history: list, user_content: str,
    kiro_tools: list, images: list, tool_results: list, history_manager: HistoryManager,
    thinking_config: ThinkingConfig
):
    """处理流式请求"""
    
    msg_id = f"chatcmpl-{log_id}"
    created = int(time.time())
    
    async def generate():
        current_account = account
        # 动态重试次数
        max_retries = min(len(state.accounts) * 3, 9) if len(state.accounts) > 1 else 3
        
        # 记录 input tokens (估算)
        input_tokens_count = 0  # 暂时无法精确获取，可在结束时统计
        output_tokens_count = 0
        full_content = ""
        tool_uses = []
        stop_reason = None
        
        # 思考模式解析器
        thinking_parser = None
        if thinking_config.is_enabled():
            thinking_parser = ThinkingStreamParser(thinking_config)

        # 当前正在调用的工具 buffer (tool_id -> {name, input_parts})
        active_tools = {}
        
        for retry in range(max_retries + 1):
            try:
                # 每次重试更新 headers (可能换账号)
                req_headers = headers.copy()
                req_headers["Authorization"] = f"Bearer {current_account.get_token()}"
                
                async with http_pool.api_client.stream("POST", KIRO_API_URL, json=kiro_request, headers=req_headers, timeout=60.0) as resp:
                    # 处理非 200 状态码
                    if resp.status_code != 200:
                        # 读取错误信息（流式响应需要 read()）
                        error_text = await resp.aread()
                        error_text = error_text.decode('utf-8', errors='ignore')
                        
                        # 处理 429 瞬态限流
                        if resp.status_code == 429:
                            current_account.error_count += 1
                            if retry < max_retries:
                                import random
                                base_ms = min(200 * (2 ** retry), 2000)
                                jitter = random.randint(0, max(base_ms // 4, 1))
                                wait_time = (base_ms + jitter) / 1000.0
                                # 只有未开始输出内容时才能重试
                                print(f"[OpenAI Stream] 429 限流，退避 {wait_time:.1f}s: {current_account.id}")
                                await asyncio.sleep(wait_time)
                                continue
                            if flow_id:
                                flow_monitor.fail_flow(flow_id, "rate_limit_error", "Rate limited after retries", 429)
                            raise HTTPException(429, "Rate limited")

                        # 402 月度配额耗尽
                        if resp.status_code == 402 and "MONTHLY_REQUEST_COUNT" in error_text:
                            current_account.mark_quota_exceeded("Monthly quota exhausted")
                            next_account = state.get_next_available_account(current_account.id, model=model)
                            if next_account and retry < max_retries:
                                print(f"[OpenAI Stream] 月度配额耗尽，切换账号: {current_account.id} -> {next_account.id}")
                                current_account = next_account
                                retry += 1  # 不减少重试次数，或者保持
                                continue
                        
                        # 错误分类处理
                        error = classify_error(resp.status_code, error_text)
                        
                        # 认证失败 - 刷新 Token
                        if error.type == ErrorType.AUTH_FAILED and retry < max_retries:
                             print(f"[OpenAI Stream] 401 认证失败，尝试刷新: {current_account.id}")
                             success, _ = await current_account.refresh_token()
                             if success:
                                 continue
                             # 刷新失败则尝试切换账号（如果有 helper）
                        
                        # 切换账号建议
                        if error.should_switch_account:
                            next_account = state.get_next_available_account(current_account.id, model=model)
                            if next_account and retry < max_retries:
                                print(f"[OpenAI Stream] 错误 {resp.status_code}，切换账号: {current_account.id} -> {next_account.id}")
                                current_account = next_account
                                continue

                        # 其他错误
                        if is_retryable_error(resp.status_code):
                            if retry < max_retries:
                                await asyncio.sleep(0.5 * (2 ** retry))
                                continue
                        
                        print(f"[OpenAI Stream] Error {resp.status_code}: {error_text[:200]}")
                        if flow_id:
                             flow_monitor.fail_flow(flow_id, "api_error", error.user_message, resp.status_code, error_text[:500])
                        raise HTTPException(resp.status_code, error_text)
                    
                    # 成功连接，开始流式传输
                    if retry > 0:
                        print(f"[OpenAI Stream] 重试成功: {current_account.id}")
                    
                    processor = KiroStreamProcessor()
                    current_account.request_count += 1
                    current_account.last_used = time.time()
                    get_rate_limiter().record_request(current_account.id)
                    
                    # 发送初始角色 (OpenAI 规范可选，但在某些客户端友好)
                    yield f"data: {json.dumps({'id': msg_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'role': 'assistant'}, 'finish_reason': None}]})}\n\n"
                    
                    # 使用 asyncio.wait_for 实现 ping保活机制 (参考 kiro.rs 每25s ping)
                    stream_iterator = resp.aiter_bytes()
                    if hasattr(stream_iterator, '__aiter__'):
                         stream_iterator = stream_iterator.__aiter__()

                    while True:
                        try:
                            # 等待下一个 chunk，超时时间 25s
                            chunk = await asyncio.wait_for(stream_iterator.__anext__(), timeout=25.0)
                        except asyncio.TimeoutError:
                            # 超时则发送 ping
                            yield ": ping\n\n"
                            continue
                        except StopAsyncIteration:
                            # 流结束
                            break
                        except Exception as e:
                            # 其他异常，如果是连接中断可能会在这里抛出
                            raise e

                        for event in processor.process(chunk):
                            
                            # 1. 处理 Content
                            if event['type'] == 'content':
                                content = event['content']
                                
                                # 思考模式处理
                                if thinking_parser:
                                    thinking_events = thinking_parser.process_chunk(content)
                                    for te in thinking_events:
                                        if te['type'] == 'thinking':
                                            # 输出 reasoning_content (兼容 DeepSeek 格式及部分支持 thinking 的客户端)
                                            reasoning = te['text']
                                            if reasoning:
                                                yield f"data: {json.dumps({'id': msg_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'reasoning_content': reasoning}, 'finish_reason': None}]})}\n\n"
                                        elif te['type'] == 'text':
                                            txt = te['text']
                                            if txt:
                                                full_content += txt
                                                output_tokens_count += 1
                                                yield f"data: {json.dumps({'id': msg_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'content': txt}, 'finish_reason': None}]})}\n\n"
                                else:
                                    if content:
                                        full_content += content
                                        output_tokens_count += 1 # 粗略估计
                                        yield f"data: {json.dumps({'id': msg_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'content': content}, 'finish_reason': None}]})}\n\n"

                            # 2. 处理 Tool Use
                            elif event['type'] == 'tool_use':
                                t_id = event.get('toolUseId')
                                t_name = event.get('name')
                                t_input = event.get('input') # 可能是片段
                                t_stop = event.get('stop')
                                
                                if t_id:
                                    # 如果是新工具调用
                                    if t_id not in active_tools:
                                        # 查找这是第几个工具调用
                                        tool_index = len(tool_uses)
                                        active_tools[t_id] = {
                                            "index": tool_index,
                                            "name": t_name or "",
                                            "input": "",
                                            "id": t_id
                                        }
                                        tool_data = {
                                            "id": t_id,
                                            "type": "function",
                                            "function": {
                                                "name": t_name,
                                                "arguments": ""
                                            }
                                        }
                                        tool_uses.append({"id": t_id, "name": t_name, "input": {}})
                                        
                                        # 发送 tool_call start with id/name
                                        yield f"data: {json.dumps({'id': msg_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'tool_calls': [{'index': tool_index, 'id': t_id, 'type': 'function', 'function': {'name': t_name, 'arguments': ''}}]}, 'finish_reason': None}]})}\n\n"
                                    
                                    # 处理 input 片段
                                    if t_input:
                                        tool_idx = active_tools[t_id]["index"]
                                        active_tools[t_id]["input"] += t_input
                                        # 发送 arguments delta
                                        yield f"data: {json.dumps({'id': msg_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {'tool_calls': [{'index': tool_idx, 'function': {'arguments': t_input}}]}, 'finish_reason': None}]})}\n\n"
                                    
                                    # 如果这个工具调用结束了 (Kiro 有时会发 stop=True，有时不发，toolUseId 变化或者流结束算结束)
                                    if t_stop:
                                        pass 

                            # 3. 处理 Context Usage
                            elif event['type'] == 'context_usage':
                                percentage = event.get('usage', 0)
                                # 估算 input_tokens: percentage * 200000 / 100 = percentage * 2000
                                input_tokens_count = int(percentage * 2000)
                                if percentage >= 100:
                                    stop_reason = "length"
                                # yield f"data: {json.dumps({'id': msg_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'usage': {'prompt_tokens': input_tokens_count, 'completion_tokens': output_tokens_count, 'total_tokens': input_tokens_count + output_tokens_count}})}\n\n" 

                    # 流结束，决定 finish_reason
                    if len(tool_uses) > 0:
                        stop_reason = "tool_calls"
                        # 补全 tool_uses 里的 input
                        for t_id, t_info in active_tools.items():
                             # 在 flow 记录中使用完整 input
                            try:
                                full_input_json = json.loads(t_info["input"])
                            except:
                                # 不使用 {"raw": ...} 避免污染工具参数名
                                print(f"[OpenAI Stream] Failed to parse tool input JSON for {t_info.get('name', 'unknown')}: truncated?")
                                full_input_json = {}
                            
                            # 更新 tool_uses 列表中的 input
                            for u in tool_uses:
                                if u["id"] == t_id:
                                    u["input"] = full_input_json
                                    if not u["name"]: u["name"] = t_info["name"]

                    else:
                        stop_reason = "stop"

                    yield f"data: {json.dumps({'id': msg_id, 'object': 'chat.completion.chunk', 'created': created, 'model': model, 'choices': [{'index': 0, 'delta': {}, 'finish_reason': stop_reason}]})}\n\n"
                    yield "data: [DONE]\n\n"
                    
                    # 成功完成，跳出重试循环
                    break
            
            except Exception as e:
                # 只有未输出内容时才重试
                if output_tokens_count == 0 and retry < max_retries:
                     print(f"[OpenAI Stream] 异常重试 {retry}: {e}")
                     await asyncio.sleep(1)
                     continue
                
                # 如果已经输出了部分内容，无法撤回，只能中断
                print(f"[OpenAI Stream] 流中断: {e}")
                # 尝试发送错误信息给客户端 (虽然客户端可能已经解析错误)
                try:
                    err_json = json.dumps({"error": {"message": str(e), "type": "stream_error"}})
                    yield f"data: {err_json}\n\n"
                except:
                    pass
                break
        
        # 记录 Flow
        if flow_id:
            flow_monitor.complete_flow(
                flow_id,
                status_code=200,
                content=full_content,
                tool_calls=tool_uses,
                stop_reason=stop_reason,
                usage=TokenUsage(
                    input_tokens=input_tokens_count,
                    output_tokens=output_tokens_count,
                ),
            )

    return StreamingResponse(generate(), media_type="text/event-stream")


def _stream_openai_response(result: dict, model: str, msg_id: str, flow_id: str = None, full_content: str = ""):
    """将 Kiro 完整响应转为 OpenAI SSE 流式格式
    
    按照 OpenAI streaming 规范:
    - 文本内容通过 delta.content 逐块发送
    - 工具调用通过 delta.tool_calls 发送（先发 name+id，再发 arguments）
    - finish_reason 在最后一个 chunk 中设置
    """
    tool_uses = result.get("tool_uses", [])
    stop_reason = result.get("stop_reason", "stop")
    
    # 映射 finish_reason
    if tool_uses:
        finish_reason = "tool_calls"
    elif stop_reason == "max_tokens":
        finish_reason = "length"
    else:
        finish_reason = "stop"
    
    async def generate():
        created = int(time.time())
        
        # 流式发送文本内容
        text = "".join(result.get("content", []))
        if text:
            # 逐块发送文本，每块 80 字符（比原来 20 大，减少 chunk 数量）
            chunk_size = 80
            for i in range(0, len(text), chunk_size):
                chunk_text = text[i:i + chunk_size]
                data = {
                    "id": msg_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {"content": chunk_text},
                        "finish_reason": None
                    }]
                }
                yield f"data: {json.dumps(data)}\n\n"
                await asyncio.sleep(0.01)
        
        # 流式发送工具调用（OpenAI streaming tool call 格式）
        for idx, tool_use in enumerate(tool_uses):
            tool_call_id = tool_use.get("id", "")
            if not tool_call_id:
                tool_call_id = f"call_{uuid.uuid4().hex[:24]}"
            
            func_name = tool_use.get("name", "")
            func_args = json.dumps(tool_use.get("input", {}))
            
            # 第一个 chunk: 发送 tool_call 的 id, type, name (arguments 为空)
            data = {
                "id": msg_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [{
                    "index": 0,
                    "delta": {
                        "tool_calls": [{
                            "index": idx,
                            "id": tool_call_id,
                            "type": "function",
                            "function": {
                                "name": func_name,
                                "arguments": ""
                            }
                        }]
                    },
                    "finish_reason": None
                }]
            }
            yield f"data: {json.dumps(data)}\n\n"
            await asyncio.sleep(0.01)
            
            # 后续 chunks: 分块发送 arguments
            arg_chunk_size = 200
            for j in range(0, max(len(func_args), 1), arg_chunk_size):
                arg_chunk = func_args[j:j + arg_chunk_size]
                if not arg_chunk:
                    break
                data = {
                    "id": msg_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "delta": {
                            "tool_calls": [{
                                "index": idx,
                                "function": {
                                    "arguments": arg_chunk
                                }
                            }]
                        },
                        "finish_reason": None
                    }]
                }
                yield f"data: {json.dumps(data)}\n\n"
                await asyncio.sleep(0.01)
        
        # 最终 chunk: finish_reason
        end_data = {
            "id": msg_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": finish_reason
            }]
        }
        yield f"data: {json.dumps(end_data)}\n\n"
        yield "data: [DONE]\n\n"
        
        # 完成 Flow
        if flow_id:
            flow_monitor.complete_flow(
                flow_id,
                status_code=200,
                content=full_content,
                tool_calls=tool_uses,
                stop_reason=stop_reason,
                usage=TokenUsage(
                    input_tokens=result.get("input_tokens", 0),
                    output_tokens=result.get("output_tokens", 0),
                ),
            )
    
    return StreamingResponse(generate(), media_type="text/event-stream")
