"""实时日志广播模块 - 通过 SSE 向 WebUI 推送日志"""
import asyncio
import sys
import io
import time
import json
import re
import logging
from typing import Set, AsyncGenerator


class LogBroadcaster:
    """捕获 stdout/stderr 输出并广播给所有 SSE 客户端"""
    
    def __init__(self, max_buffer: int = 1000):
        self._clients: Set[asyncio.Queue] = set()
        self._buffer: list = []  # 最近的日志缓冲
        self._max_buffer = max_buffer
        self._original_stdout = None
        self._original_stderr = None
        self._installed = False
    
    def install(self):
        """安装 stdout/stderr 拦截器"""
        if self._installed:
            return
        self._original_stdout = sys.stdout
        self._original_stderr = sys.stderr
        sys.stdout = _StreamInterceptor(self._original_stdout, self, "INFO")
        sys.stderr = _StreamInterceptor(self._original_stderr, self, "ERROR")
        
        # 同时挂钩 logging 模块
        handler = _BroadcastLogHandler(self)
        handler.setLevel(logging.DEBUG)
        logging.root.addHandler(handler)
        
        self._installed = True
    
    def add_log(self, message: str, level: str = "INFO"):
        """添加一条日志并广播"""
        if not message.strip():
            return
        
        # 自动检测日志级别
        detected_level = self._detect_level(message, level)
        
        entry = {
            "timestamp": time.time(),
            "level": detected_level,
            "message": message.rstrip('\n'),
        }
        
        # 写入缓冲区
        self._buffer.append(entry)
        if len(self._buffer) > self._max_buffer:
            self._buffer = self._buffer[-self._max_buffer:]
        
        # 广播给所有客户端
        dead_clients = set()
        for queue in self._clients:
            try:
                queue.put_nowait(entry)
            except asyncio.QueueFull:
                dead_clients.add(queue)
        
        # 清理满队列的客户端
        for client in dead_clients:
            self._clients.discard(client)
    
    def _detect_level(self, message: str, default: str = "INFO") -> str:
        """从日志消息中检测级别"""
        msg_upper = message.upper()
        # 检查常见日志格式前缀
        if re.match(r'^\s*(ERROR|CRITICAL|FATAL)', msg_upper):
            return "ERROR"
        if re.match(r'^\s*(WARN|WARNING)', msg_upper):
            return "WARN"
        if re.match(r'^\s*DEBUG', msg_upper):
            return "DEBUG"
        if re.match(r'^\s*INFO', msg_upper):
            return "INFO"
        # 检查消息内容中的关键词
        if any(kw in msg_upper for kw in ['ERROR', 'EXCEPTION', 'TRACEBACK', 'FAILED']):
            return "ERROR"
        if any(kw in msg_upper for kw in ['WARNING', 'WARN']):
            return "WARN"
        if any(kw in msg_upper for kw in ['DEBUG', '🔍']):
            return "DEBUG"
        return default
    
    async def subscribe(self) -> AsyncGenerator[str, None]:
        """SSE 订阅：返回历史日志 + 实时流"""
        queue: asyncio.Queue = asyncio.Queue(maxsize=500)
        
        # 先发送缓冲区中的历史日志
        for entry in self._buffer[-200:]:
            data = json.dumps(entry, ensure_ascii=False)
            yield f"data: {data}\n\n"
        
        # 注册客户端
        self._clients.add(queue)
        try:
            while True:
                try:
                    entry = await asyncio.wait_for(queue.get(), timeout=30.0)
                    data = json.dumps(entry, ensure_ascii=False)
                    yield f"data: {data}\n\n"
                except asyncio.TimeoutError:
                    # 发送心跳保持连接
                    yield ": heartbeat\n\n"
        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            self._clients.discard(queue)
    
    def get_buffer(self, limit: int = 200) -> list:
        """获取缓冲区中的日志"""
        return self._buffer[-limit:]


class _StreamInterceptor(io.TextIOBase):
    """拦截 stdout/stderr 写入，同时保留原始输出"""
    
    def __init__(self, original_stream, broadcaster: LogBroadcaster, default_level: str):
        self._original = original_stream
        self._broadcaster = broadcaster
        self._default_level = default_level
    
    def write(self, text: str) -> int:
        # 始终写入原始流
        result = self._original.write(text)
        # 广播非空内容
        if text and text.strip():
            self._broadcaster.add_log(text, self._default_level)
        return result
    
    def flush(self):
        self._original.flush()
    
    def fileno(self):
        return self._original.fileno()
    
    def isatty(self):
        return self._original.isatty()
    
    @property
    def encoding(self):
        return getattr(self._original, 'encoding', 'utf-8')
    
    def readable(self):
        return False
    
    def writable(self):
        return True
    
    def seekable(self):
        return False


class _BroadcastLogHandler(logging.Handler):
    """logging Handler 将日志发送到广播器"""
    
    LEVEL_MAP = {
        logging.DEBUG: "DEBUG",
        logging.INFO: "INFO",
        logging.WARNING: "WARN",
        logging.ERROR: "ERROR",
        logging.CRITICAL: "ERROR",
    }
    
    def __init__(self, broadcaster: LogBroadcaster):
        super().__init__()
        self._broadcaster = broadcaster
    
    def emit(self, record: logging.LogRecord):
        try:
            level = self.LEVEL_MAP.get(record.levelno, "INFO")
            message = self.format(record)
            self._broadcaster.add_log(message, level)
        except Exception:
            pass


# 全局实例
log_broadcaster = LogBroadcaster()
