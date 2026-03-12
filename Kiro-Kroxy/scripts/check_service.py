#!/usr/bin/env python3
"""
检查 Kiro Proxy 服务状态
"""
import sys
import subprocess


def check_windows():
    """检查 Windows 服务状态"""
    print("=== Windows 服务状态 ===\n")
    
    # 检查任务计划
    result = subprocess.run(
        'schtasks /Query /TN KiroProxyService /FO LIST',
        shell=True,
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print("✅ 任务计划已安装")
        print(result.stdout)
        
        # 检查 VBS 脚本（在项目根目录）
        from pathlib import Path
        vbs_script = Path(__file__).parent.parent / "start_kiro_proxy.vbs"
        if vbs_script.exists():
            print(f"\n✅ 启动脚本存在: {vbs_script}")
            content = vbs_script.read_text(encoding="utf-8")
            # 检查是否使用虚拟环境
            if "venv" in content:
                print("   使用虚拟环境 Python ✓")
            else:
                print("   ⚠️  使用系统 Python（如果有虚拟环境，建议重新安装）")
        else:
            print(f"\n⚠️  启动脚本不存在: {vbs_script}")
    else:
        print("❌ 任务计划未安装")
        print("   运行 'python scripts/install_service.py' 安装服务")
        return False
    
    return True


def check_linux():
    """检查 Linux 服务状态"""
    print("=== Linux 服务状态 ===\n")
    
    # 检查服务状态
    result = subprocess.run(
        ["systemctl", "status", "kiro-proxy.service", "--no-pager"],
        capture_output=True,
        text=True
    )
    
    if "could not be found" in result.stderr or "not be found" in result.stdout:
        print("❌ 服务未安装")
        print("   运行 'sudo python3 scripts/install_service.py' 安装服务")
        return False
    
    print(result.stdout)
    
    # 检查是否启用
    result = subprocess.run(
        ["systemctl", "is-enabled", "kiro-proxy.service"],
        capture_output=True,
        text=True
    )
    
    if result.stdout.strip() == "enabled":
        print("\n✅ 开机自启已启用")
    else:
        print("\n⚠️  开机自启未启用")
    
    # 检查服务文件中的 Python 路径
    from pathlib import Path
    service_file = Path("/etc/systemd/system/kiro-proxy.service")
    if service_file.exists():
        content = service_file.read_text()
        if "venv" in content:
            print("   使用虚拟环境 Python ✓")
        else:
            print("   使用系统 Python")
    
    return True


def check_api(port=8080):
    """检查 API 是否可访问"""
    print(f"\n=== API 连接测试 ===\n")
    
    url = f"http://localhost:{port}/api/status"
    
    try:
        # 使用 urllib 代替 requests（标准库）
        import urllib.request
        import json
        
        response = urllib.request.urlopen(url, timeout=5)
        if response.status == 200:
            print(f"✅ 服务运行正常")
            print(f"   访问地址: http://localhost:{port}")
            data = json.loads(response.read().decode())
            stats = data.get('stats', {})
            print(f"   账号数量: {stats.get('accounts_total', 0)}")
            print(f"   可用账号: {stats.get('accounts_available', 0)}")
            print(f"   运行时间: {stats.get('uptime_seconds', 0)} 秒")
            return True
        else:
            print(f"⚠️  服务响应异常: {response.status}")
            return False
    except urllib.error.URLError:
        print(f"❌ 无法连接到服务")
        print(f"   请检查服务是否已启动")
        print(f"   端口: {port}")
        return False
    except Exception as e:
        print(f"❌ 连接失败: {e}")
        return False


def main():
    print("=" * 50)
    print("  Kiro Proxy 服务状态检查")
    print("=" * 50)
    print()
    
    # 检查服务安装状态
    if sys.platform == "win32":
        service_ok = check_windows()
    elif sys.platform.startswith("linux"):
        service_ok = check_linux()
    else:
        print(f"❌ 不支持的平台: {sys.platform}")
        return
    
    # 检查 API 连接
    if service_ok:
        # 尝试常见端口
        for port in [8080, 8081, 8082]:
            if check_api(port):
                break
        else:
            print("\n提示: 如果服务刚安装，可能需要重启或手动启动")
            if sys.platform == "win32":
                print("      运行: schtasks /Run /TN KiroProxyService")
            else:
                print("      运行: sudo systemctl start kiro-proxy")


if __name__ == "__main__":
    main()
