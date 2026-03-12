"""请求统计增强"""
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List
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
    """统计管理器"""
    
    def __init__(self):
        self.by_account: Dict[str, AccountStats] = defaultdict(AccountStats)
        self.by_model: Dict[str, ModelStats] = defaultdict(ModelStats)
        self.hourly_requests: Dict[int, int] = defaultdict(int)  # hour -> count
    
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
    
    def _cleanup_hourly(self):
        """清理超过 24 小时的数据"""
        current_hour = int(time.time() // 3600)
        cutoff = current_hour - 24
        self.hourly_requests = defaultdict(
            int,
            {h: c for h, c in self.hourly_requests.items() if h > cutoff}
        )
    
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
