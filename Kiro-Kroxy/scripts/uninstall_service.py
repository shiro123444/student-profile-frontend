#!/usr/bin/env python3
"""
Kiro Proxy 服务卸载脚本
"""
import sys
import subprocess
from pathlib import Path


def uninstall_windows():
    """卸载 Windows 服务"""
    print("=== 卸载 Windows 服务 ===\n")
    
    task_name = "KiroProxyService"
    result = subprocess.run(
        f'schtasks /Delete /TN "{task_name}" /F',
        shell=True,
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print(f"✅ 任务计划已删除: {task_name}")
    else:
        print(f"⚠️  任务不存在或已删除")
    
    # 删除 VBS 脚本（在项目根目录）
    vbs_script = Path(__file__).parent.parent / "start_kiro_proxy.vbs"
    if vbs_script.exists():
        vbs_script.unlink()
        print(f"✅ 启动脚本已删除: {vbs_script}")
    
    print("\n✅ 卸载完成")


def uninstall_linux():
    """卸载 Linux 服务"""
    print("=== 卸载 Linux 服务 ===\n")
    
    import os
    if os.geteuid() != 0:
        print("❌ 需要 root 权限，请使用 sudo 运行")
        sys.exit(1)
    
    try:
        # 停止服务
        result = subprocess.run(
            ["systemctl", "stop", "kiro-proxy.service"],
            capture_output=True
        )
        if result.returncode == 0:
            print("✅ 服务已停止")
        
        # 禁用服务
        result = subprocess.run(
            ["systemctl", "disable", "kiro-proxy.service"],
            capture_output=True
        )
        if result.returncode == 0:
            print("✅ 开机自启已禁用")
        
        # 删除服务文件
        service_file = Path("/etc/systemd/system/kiro-proxy.service")
        if service_file.exists():
            service_file.unlink()
            print(f"✅ 服务文件已删除: {service_file}")
        
        # 重载 systemd
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        print("✅ systemd 已重载")
        
        print("\n✅ 卸载完成")
    except Exception as e:
        print(f"❌ 卸载失败: {e}")


if __name__ == "__main__":
    if sys.platform == "win32":
        uninstall_windows()
    elif sys.platform.startswith("linux"):
        uninstall_linux()
    else:
        print(f"❌ 不支持的平台: {sys.platform}")
