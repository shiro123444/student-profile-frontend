"""请求统计增强 - 含 JSON 持久化"""
import json
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List
from pathlib import Path
import time


@dataclass
class AccountStats:
    """账号统计"""
    total_requests: int = 0
    total_errors: int = 0
    total_tokens_in: int = 0
    total_tokens_out: int = 0
    last_request_time: float = 0
    
    def record(self, success: bool, tokens_in: int = 0, tokens_out: int = 0):
        self.total_requests += 1
        if not success:
            self.total_errors += 1
        self.total_tokens_in += tokens_in
        self.total_tokens_out += tokens_out
        self.last_request_time = time.time()
    
    @property
    def error_rate(self) -> float:
        if self.total_requests == 0:
            return 0
        return self.total_errors / self.total_requests


@dataclass
class ModelStats:
    """模型统计"""
    total_requests: int = 0
    total_errors: int = 0
    total_latency_ms: float = 0
    
    def record(self, success: bool, latency_ms: float):
        self.total_requests += 1
        if not success:
            self.total_errors += 1
        self.total_latency_ms += latency_ms
    
    @property
    def avg_latency_ms(self) -> float:
        if self.total_requests == 0:
            return 0
        return self.total_latency_ms / self.total_requests


class StatsManager:
    """统计管理器 - 含 JSON 文件持久化"""
    
    PERSIST_PATH = Path.home() / ".kiro-proxy" / "stats.json"
    SAVE_DEBOUNCE_SECONDS = 30  # 最小保存间隔
    
    def __init__(self):
        self.by_account: Dict[str, AccountStats] = defaultdict(AccountStats)
        self.by_model: Dict[str, ModelStats] = defaultdict(ModelStats)
        self.hourly_requests: Dict[int, int] = defaultdict(int)  # hour -> count
        self._last_save_time: float = 0
        self._dirty: bool = False
        self._load_from_disk()
    
    def record_request(
        self,
        account_id: str,
        model: str,
        success: bool,
        latency_ms: float,
        tokens_in: int = 0,
        tokens_out: int = 0
    ):
        """记录请求"""
        # 按账号统计
        self.by_account[account_id].record(success, tokens_in, tokens_out)
        
        # 按模型统计
        self.by_model[model].record(success, latency_ms)
        
        # 按小时统计
        hour = int(time.time() // 3600)
        self.hourly_requests[hour] += 1
        
        # 清理旧数据（保留 24 小时）
        self._cleanup_hourly()
        
        # 带防抖的持久化
        self._dirty = True
        now = time.time()
        if now - self._last_save_time >= self.SAVE_DEBOUNCE_SECONDS:
            self._save_to_disk()
    
    def _cleanup_hourly(self):
        """清理超过 24 小时的数据"""
        current_hour = int(time.time() // 3600)
        cutoff = current_hour - 24
        self.hourly_requests = defaultdict(
            int,
            {h: c for h, c in self.hourly_requests.items() if h > cutoff}
        )
    
    def _load_from_disk(self):
        """从 JSON 文件恢复统计（重启后不丢失）"""
        try:
            if self.PERSIST_PATH.exists():
                data = json.loads(self.PERSIST_PATH.read_text())
                for acc_id, acc_data in data.get("by_account", {}).items():
                    s = AccountStats()
                    s.total_requests = acc_data.get("total_requests", 0)
                    s.total_errors = acc_data.get("total_errors", 0)
                    s.total_tokens_in = acc_data.get("total_tokens_in", 0)
                    s.total_tokens_out = acc_data.get("total_tokens_out", 0)
                    s.last_request_time = acc_data.get("last_request_time", 0)
                    self.by_account[acc_id] = s
                for model, model_data in data.get("by_model", {}).items():
                    m = ModelStats()
                    m.total_requests = model_data.get("total_requests", 0)
                    m.total_errors = model_data.get("total_errors", 0)
                    m.total_latency_ms = model_data.get("total_latency_ms", 0)
                    self.by_model[model] = m
                for h, c in data.get("hourly_requests", {}).items():
                    self.hourly_requests[int(h)] = c
                print(f"[Stats] 从磁盘恢复统计: {len(self.by_account)} 账号, {len(self.by_model)} 模型")
        except Exception as e:
            print(f"[Stats] 加载统计文件失败: {e}")
    
    def _save_to_disk(self):
        """持久化统计到 JSON 文件"""
        try:
            self.PERSIST_PATH.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "by_account": {
                    acc_id: {
                        "total_requests": s.total_requests,
                        "total_errors": s.total_errors,
                        "total_tokens_in": s.total_tokens_in,
                        "total_tokens_out": s.total_tokens_out,
                        "last_request_time": s.last_request_time,
                    }
                    for acc_id, s in self.by_account.items()
                },
                "by_model": {
                    model: {
                        "total_requests": m.total_requests,
                        "total_errors": m.total_errors,
                        "total_latency_ms": m.total_latency_ms,
                    }
                    for model, m in self.by_model.items()
                },
                "hourly_requests": dict(self.hourly_requests),
                "saved_at": time.time(),
            }
            self.PERSIST_PATH.write_text(json.dumps(data, indent=2))
            self._last_save_time = time.time()
            self._dirty = False
        except Exception as e:
            print(f"[Stats] 保存统计文件失败: {e}")
    
    def force_save(self):
        """强制保存（关闭时调用）"""
        if self._dirty:
            self._save_to_disk()
    
    def get_account_stats(self, account_id: str) -> dict:
        """获取账号统计"""
        stats = self.by_account.get(account_id, AccountStats())
        return {
            "total_requests": stats.total_requests,
            "total_errors": stats.total_errors,
            "error_rate": f"{stats.error_rate * 100:.1f}%",
            "total_tokens_in": stats.total_tokens_in,
            "total_tokens_out": stats.total_tokens_out,
            "last_request": stats.last_request_time
        }
    
    def get_model_stats(self, model: str) -> dict:
        """获取模型统计"""
        stats = self.by_model.get(model, ModelStats())
        return {
            "total_requests": stats.total_requests,
            "total_errors": stats.total_errors,
            "avg_latency_ms": round(stats.avg_latency_ms, 2)
        }
    
    def get_all_stats(self) -> dict:
        """获取所有统计"""
        return {
            "by_account": {
                acc_id: self.get_account_stats(acc_id)
                for acc_id in self.by_account
            },
            "by_model": {
                model: self.get_model_stats(model)
                for model in self.by_model
            },
            "hourly_requests": dict(self.hourly_requests),
            "requests_last_24h": sum(self.hourly_requests.values())
        }


# 全局统计实例
stats_manager = StatsManager()
