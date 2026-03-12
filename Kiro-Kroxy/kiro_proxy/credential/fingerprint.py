"""设备指纹生成"""
import hashlib
import platform
import subprocess
from pathlib import Path
from typing import Optional


def get_raw_machine_id() -> Optional[str]:
    """获取系统原始 Machine ID"""
    system = platform.system()
    
    try:
        if system == "Darwin":
            result = subprocess.run(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                capture_output=True, text=True, timeout=5
            )
            for line in result.stdout.split("\n"):
                if "IOPlatformUUID" in line:
                    return line.split("=")[1].strip().strip('"').lower()
        
        elif system == "Linux":
            for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"]:
                if Path(path).exists():
                    return Path(path).read_text().strip().lower()
        
        elif system == "Windows":
            result = subprocess.run(
                ["wmic", "csproduct", "get", "UUID"],
                capture_output=True, text=True, timeout=5,
                creationflags=0x08000000
            )
            lines = [l.strip() for l in result.stdout.split("\n") if l.strip()]
            if len(lines) > 1:
                return lines[1].lower()
    except Exception:
        pass
    
    return None


def generate_machine_id(
    profile_arn: Optional[str] = None, 
    client_id: Optional[str] = None
) -> str:
    """生成基于凭证的唯一 Machine ID
    
    每个凭证生成独立的 Machine ID，避免多账号共用同一指纹被检测。
    优先级：profileArn > clientId > 系统硬件 ID
    生成稳定的指纹（不含时间因子），与 kiro.rs 行为一致。
    """
    unique_key = None
    if profile_arn:
        unique_key = profile_arn
    elif client_id:
        unique_key = client_id
    else:
        unique_key = get_raw_machine_id() or "KIRO_DEFAULT_MACHINE"
    
    hasher = hashlib.sha256()
    hasher.update(unique_key.encode())
    hasher.update(b"kiro-proxy-stable-v1")  # 固定盐值，确保稳定性
    
    return hasher.hexdigest()


def get_kiro_version() -> str:
    """获取 Kiro IDE 版本号"""
    if platform.system() == "Darwin":
        kiro_paths = [
            "/Applications/Kiro.app/Contents/Info.plist",
            str(Path.home() / "Applications/Kiro.app/Contents/Info.plist"),
        ]
        for plist_path in kiro_paths:
            try:
                result = subprocess.run(
                    ["defaults", "read", plist_path, "CFBundleShortVersionString"],
                    capture_output=True, text=True, timeout=5
                )
                version = result.stdout.strip()
                if version:
                    return version
            except Exception:
                pass
    
    return "0.9.2"  # 与 kiro.rs 默认版本保持一致


# 伪装 OS 列表（与 kiro.rs 保持一致）
# Kiro IDE 只有 macOS 和 Windows 客户端，Linux 服务器不应暴露真实 OS
_FAKE_OS_VERSIONS = ["darwin#24.6.0", "win32#10.0.22631"]
_cached_os = None

def get_system_info() -> tuple:
    """获取系统运行时信息 (os_name, node_version)
    
    为防止被检测为非正常客户端，伪装为 macOS 或 Windows（与 kiro.rs 一致）。
    每次进程启动随机选择一个 OS，之后保持不变。
    """
    global _cached_os
    if _cached_os is None:
        import random
        _cached_os = random.choice(_FAKE_OS_VERSIONS)
    
    node_version = "22.21.1"  # 与 kiro.rs 默认值保持一致
    return _cached_os, node_version
