"""Provider 基类"""
from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, Tuple


class BaseProvider(ABC):
    """Provider 基类
    
    所有 Provider（Kiro、Gemini、Qwen 等）都应继承此类。
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Provider 名称"""
        pass
    
    @property
    @abstractmethod
    def api_url(self) -> str:
        """API 端点 URL"""
        pass
    
    @abstractmethod
    def build_headers(self, token: str, **kwargs) -> Dict[str, str]:
        """构建请求头"""
        pass
    
    @abstractmethod
    def build_request(self, messages: list, model: str, **kwargs) -> Dict[str, Any]:
        """构建请求体"""
        pass
    
    @abstractmethod
    def parse_response(self, raw: bytes) -> Dict[str, Any]:
        """解析响应"""
        pass
    
    @abstractmethod
    async def refresh_token(self) -> Tuple[bool, str]:
        """刷新 token，返回 (success, new_token_or_error)"""
        pass
    
    def is_quota_exceeded(self, status_code: int, error_text: str) -> bool:
        """检查是否为配额超限错误"""
        return status_code in {429, 503, 529}
