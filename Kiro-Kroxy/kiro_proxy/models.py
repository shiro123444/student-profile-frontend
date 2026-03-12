"""数据模型 - 兼容层

此文件保留用于向后兼容，实际实现已移至 core/ 和 credential/ 模块。
"""
from .core import state, ProxyState, Account
from .core.state import RequestLog
from .credential import CredentialStatus

__all__ = [
    "state",
    "ProxyState", 
    "Account",
    "RequestLog",
    "CredentialStatus",
]
