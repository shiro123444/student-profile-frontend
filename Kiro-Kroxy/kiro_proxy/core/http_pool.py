"""全局 HTTP 客户端连接池

借鉴 kiro.rs 的连接池设计：
- 按用途分类复用 httpx.AsyncClient 实例
- 避免每次请求都新建 TCP/TLS 连接
- 显著减少延迟（每请求节省 100-300ms）
"""
import httpx
from typing import Optional


class HttpClientPool:
    """全局 HTTP 客户端池
    
    按用途维护不同配置的 AsyncClient 实例：
    - api_client: Kiro API 调用（长超时，流式）
    - short_client: Token 刷新、健康检查等短请求
    - model_client: 模型列表等轻量请求
    """
    
    def __init__(self):
        self._api_client: Optional[httpx.AsyncClient] = None
        self._short_client: Optional[httpx.AsyncClient] = None
        self._model_client: Optional[httpx.AsyncClient] = None
    
    @property
    def api_client(self) -> httpx.AsyncClient:
        """Kiro API 调用专用（超时 720s，支持流式，参考 kiro.rs）"""
        if self._api_client is None or self._api_client.is_closed:
            self._api_client = httpx.AsyncClient(
                verify=False,
                timeout=httpx.Timeout(720.0, connect=30.0),
                limits=httpx.Limits(
                    max_connections=50,
                    max_keepalive_connections=20,
                    keepalive_expiry=120,
                ),
                http2=False,  # Kiro API 不需要 HTTP/2
            )
        return self._api_client
    
    @property
    def short_client(self) -> httpx.AsyncClient:
        """短请求专用（超时 60s，Token刷新/健康检查/摘要生成等）"""
        if self._short_client is None or self._short_client.is_closed:
            self._short_client = httpx.AsyncClient(
                verify=False,
                timeout=httpx.Timeout(60.0, connect=15.0),
                limits=httpx.Limits(
                    max_connections=20,
                    max_keepalive_connections=10,
                    keepalive_expiry=60,
                ),
            )
        return self._short_client
    
    @property
    def model_client(self) -> httpx.AsyncClient:
        """轻量请求专用（超时 30s，模型列表等）"""
        if self._model_client is None or self._model_client.is_closed:
            self._model_client = httpx.AsyncClient(
                verify=False,
                timeout=httpx.Timeout(30.0, connect=10.0),
                limits=httpx.Limits(
                    max_connections=10,
                    max_keepalive_connections=5,
                    keepalive_expiry=30,
                ),
            )
        return self._model_client
    
    async def close_all(self):
        """关闭所有客户端连接"""
        for client in [self._api_client, self._short_client, self._model_client]:
            if client and not client.is_closed:
                await client.aclose()
        self._api_client = None
        self._short_client = None
        self._model_client = None
    
    async def warmup(self):
        """预热连接池（启动时调用）"""
        # 访问属性触发创建
        _ = self.api_client
        _ = self.short_client
        _ = self.model_client


# 全局连接池实例
http_pool = HttpClientPool()
