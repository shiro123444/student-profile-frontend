"""Kiro API 调用模块 - 兼容层

此文件保留用于向后兼容，实际实现已移至 providers/kiro.py。
"""
from .providers.kiro import KiroProvider
from .credential import generate_machine_id, get_kiro_version, get_system_info, quota_manager

# 创建默认 provider 实例
_default_provider = KiroProvider()


def build_headers(
    token: str, 
    agent_mode: str = "vibe",
    machine_id: str = None,
    profile_arn: str = None,
    client_id: str = None
) -> dict:
    """构建 Kiro API 请求头"""
    if machine_id:
        return _default_provider.build_headers(token, agent_mode, machine_id=machine_id)
    
    # 如果提供了凭证信息，生成对应的 machine_id
    if profile_arn or client_id:
        mid = generate_machine_id(profile_arn, client_id)
        return _default_provider.build_headers(token, agent_mode, machine_id=mid)
    
    return _default_provider.build_headers(token, agent_mode)


def build_kiro_request(
    user_content: str,
    model: str,
    history: list = None,
    tools: list = None,
    images: list = None,
    tool_results: list = None
) -> dict:
    """构建 Kiro API 请求体"""
    return _default_provider.build_request(
        user_content=user_content,
        model=model,
        history=history,
        tools=tools,
        images=images,
        tool_results=tool_results
    )


def parse_event_stream(raw: bytes) -> str:
    """解析 AWS event-stream 格式，返回文本内容"""
    return _default_provider.parse_response_text(raw)


def parse_event_stream_full(raw: bytes) -> dict:
    """解析 AWS event-stream 格式，返回完整结构"""
    return _default_provider.parse_response(raw)


def is_quota_exceeded_error(status_code: int, error_text: str) -> bool:
    """检查是否为配额超限错误"""
    return quota_manager.is_quota_exceeded_error(status_code, error_text)
