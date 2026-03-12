"""凭证数据类型"""
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from enum import Enum
from pathlib import Path
from typing import Optional


class CredentialStatus(Enum):
    """凭证状态"""
    ACTIVE = "active"
    COOLDOWN = "cooldown"
    UNHEALTHY = "unhealthy"
    DISABLED = "disabled"
    SUSPENDED = "suspended"  # 账号被封禁


@dataclass
class KiroCredentials:
    """Kiro 凭证信息"""
    access_token: Optional[str] = None
    refresh_token: Optional[str] = None
    client_id: Optional[str] = None
    client_secret: Optional[str] = None
    profile_arn: Optional[str] = None
    expires_at: Optional[str] = None
    region: str = "us-east-1"
    auth_method: str = "social"
    provider: Optional[str] = None  # "Enterprise" / "BuilderId" / "Social"
    client_id_hash: Optional[str] = None
    last_refresh: Optional[str] = None
    start_url: Optional[str] = None
    
    @classmethod
    def from_file(cls, path: str) -> "KiroCredentials":
        """从文件加载凭证"""
        with open(path) as f:
            data = json.load(f)
        
        return cls(
            access_token=data.get("accessToken"),
            refresh_token=data.get("refreshToken"),
            client_id=data.get("clientId"),
            client_secret=data.get("clientSecret"),
            profile_arn=data.get("profileArn"),
            expires_at=data.get("expiresAt") or data.get("expire"),
            region=data.get("region", "us-east-1"),
            auth_method=data.get("authMethod", "social"),
            provider=data.get("provider"),
            client_id_hash=data.get("clientIdHash"),
            last_refresh=data.get("lastRefresh"),
            start_url=data.get("startUrl"),
        )
    
    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "accessToken": self.access_token,
            "refreshToken": self.refresh_token,
            "clientId": self.client_id,
            "clientSecret": self.client_secret,
            "profileArn": self.profile_arn,
            "expiresAt": self.expires_at,
            "region": self.region,
            "authMethod": self.auth_method,
            "provider": self.provider,
            "clientIdHash": self.client_id_hash,
            "lastRefresh": self.last_refresh,
            "startUrl": self.start_url,
        }
    
    def save_to_file(self, path: str):
        """保存凭证到文件"""
        existing = {}
        if Path(path).exists():
            try:
                with open(path) as f:
                    existing = json.load(f)
            except Exception:
                pass
        
        existing.update({k: v for k, v in self.to_dict().items() if v is not None})
        
        with open(path, "w") as f:
            json.dump(existing, f, indent=2)
    
    def is_expired(self) -> bool:
        """检查 token 是否已过期"""
        if not self.expires_at:
            return True
        
        try:
            if "T" in self.expires_at:
                expires = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                return expires <= now + timedelta(minutes=5)
            
            expires_ts = int(self.expires_at)
            now_ts = int(time.time())
            return now_ts >= (expires_ts - 300)
        except Exception:
            return True
    
    def is_expiring_soon(self, minutes: int = 10) -> bool:
        """检查 token 是否即将过期"""
        if not self.expires_at:
            return False
        
        try:
            if "T" in self.expires_at:
                expires = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                return expires < now + timedelta(minutes=minutes)
            
            expires_ts = int(self.expires_at)
            now_ts = int(time.time())
            return now_ts >= (expires_ts - minutes * 60)
        except Exception:
            return False
