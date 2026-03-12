#!/usr/bin/env python3
"""
Kiro Proxy 服务安装脚本
支持 Windows (任务计划程序) 和 Linux (systemd)
"""
import sys
import os
import subprocess
from pathlib import Path


def is_admin():
    """检查是否有管理员权限"""
    if sys.platform == "win32":
        try:
            import ctypes
            return ctypes.windll.shell32.IsUserAnAdmin()
        except:
            return False
    else:
        return os.geteuid() == 0


def get_python_path():
    """获取 Python 可执行文件路径（优先使用虚拟环境）"""
    script_dir = get_script_path()
    
    # 检查是否有虚拟环境
    if sys.platform == "win32":
        venv_python = script_dir / "venv" / "Scripts" / "python.exe"
    else:
        venv_python = script_dir / "venv" / "bin" / "python"
    
    if venv_python.exists():
        print(f"✓ 检测到虚拟环境: {venv_python}")
        return str(venv_python)
    
    # 使用当前 Python
    print(f"✓ 使用系统 Python: {sys.executable}")
    return sys.executable


def get_script_path():
    """获取项目根目录（脚本的父目录）"""
    return Path(__file__).parent.parent.absolute()


def install_windows_service():
    """在 Windows 上安装为开机自启服务（任务计划程序）"""
    print("=== Windows 服务安装 ===\n")
    
    python_exe = get_python_path()
    script_dir = get_script_path()
    run_script = script_dir / "run.py"
    
    # 检查依赖
    print("检查依赖...")
    result = subprocess.run(
        [python_exe, "-c", "import fastapi"],
        capture_output=True
    )
    if result.returncode != 0:
        print("❌ 依赖未安装！")
        print(f"   请先运行: {python_exe} -m pip install -r requirements.txt")
        sys.exit(1)
    print("✓ 依赖检查通过\n")
    
    # 默认端口
    port = input("请输入端口号 (默认 8080): ").strip() or "8080"
    
    # 创建 VBS 启动脚本（隐藏窗口）
    vbs_script = script_dir / "start_kiro_proxy.vbs"
    vbs_content = f'''Set WshShell = CreateObject("WScript.Shell")
WshShell.Run """{python_exe}"" ""{run_script}"" --no-ui {port}", 0, False
Set WshShell = Nothing
'''
    vbs_script.write_text(vbs_content, encoding="utf-8")
    print(f"✓ 创建启动脚本: {vbs_script}")
    
    # 创建任务计划程序命令
    task_name = "KiroProxyService"
    
    # 删除旧任务（如果存在）
    subprocess.run(
        f'schtasks /Delete /TN "{task_name}" /F',
        shell=True,
        capture_output=True
    )
    
    # 创建新任务
    cmd = f'''schtasks /Create /TN "{task_name}" /TR "wscript.exe \\"{vbs_script}\\"" /SC ONLOGON /RL HIGHEST /F'''
    
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    
    if result.returncode == 0:
        print(f"\n✅ 服务安装成功！")
        print(f"   任务名称: {task_name}")
        print(f"   端口: {port}")
        print(f"   访问地址: http://localhost:{port}")
        print(f"\n服务将在下次登录时自动启动")
        print(f"\n管理命令:")
        print(f"  查看任务: schtasks /Query /TN {task_name}")
        print(f"  删除任务: schtasks /Delete /TN {task_name} /F")
        print(f"  立即运行: schtasks /Run /TN {task_name}")
        
        # 询问是否立即启动
        start_now = input("\n是否立即启动服务? (y/n): ").strip().lower()
        if start_now == 'y':
            subprocess.run(f'schtasks /Run /TN "{task_name}"', shell=True)
            print("✓ 服务已启动")
    else:
        print(f"\n❌ 安装失败: {result.stderr}")
        print("\n请以管理员身份运行此脚本")


def install_linux_service():
    """在 Linux 上安装为 systemd 服务"""
    print("=== Linux 服务安装 (systemd) ===\n")
    
    if not is_admin():
        print("❌ 需要 root 权限，请使用 sudo 运行此脚本")
        sys.exit(1)
    
    python_exe = get_python_path()
    script_dir = get_script_path()
    run_script = script_dir / "run.py"
    
    # 检查依赖
    print("检查依赖...")
    result = subprocess.run(
        [python_exe, "-c", "import fastapi"],
        capture_output=True
    )
    if result.returncode != 0:
        print("❌ 依赖未安装！")
        print(f"   请先运行: {python_exe} -m pip install -r requirements.txt")
        sys.exit(1)
    print("✓ 依赖检查通过\n")
    
    # 默认端口
    port = input("请输入端口号 (默认 8080): ").strip() or "8080"
    
    # 获取当前用户（实际用户，非 root）
    actual_user = os.environ.get('SUDO_USER', os.environ.get('USER', 'root'))
    
    # 创建 systemd 服务文件
    service_content = f"""[Unit]
Description=Kiro API Proxy Service
After=network.target

[Service]
Type=simple
User={actual_user}
WorkingDirectory={script_dir}
ExecStart={python_exe} {run_script} --no-ui {port}
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"""
    
    service_file = Path("/etc/systemd/system/kiro-proxy.service")
    service_file.write_text(service_content)
    print(f"✓ 创建服务文件: {service_file}")
    
    # 重载 systemd
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    print("✓ 重载 systemd")
    
    # 启用服务
    subprocess.run(["systemctl", "enable", "kiro-proxy.service"], check=True)
    print("✓ 启用开机自启")
    
    print(f"\n✅ 服务安装成功！")
    print(f"   服务名称: kiro-proxy.service")
    print(f"   端口: {port}")
    print(f"   访问地址: http://localhost:{port}")
    print(f"\n管理命令:")
    print(f"  启动服务: sudo systemctl start kiro-proxy")
    print(f"  停止服务: sudo systemctl stop kiro-proxy")
    print(f"  重启服务: sudo systemctl restart kiro-proxy")
    print(f"  查看状态: sudo systemctl status kiro-proxy")
    print(f"  查看日志: sudo journalctl -u kiro-proxy -f")
    print(f"  禁用自启: sudo systemctl disable kiro-proxy")
    print(f"  卸载服务: sudo systemctl stop kiro-proxy && sudo systemctl disable kiro-proxy && sudo rm /etc/systemd/system/kiro-proxy.service && sudo systemctl daemon-reload")
    
    # 询问是否立即启动
    start_now = input("\n是否立即启动服务? (y/n): ").strip().lower()
    if start_now == 'y':
        subprocess.run(["systemctl", "start", "kiro-proxy.service"], check=True)
        print("✓ 服务已启动")
        print("\n查看状态:")
        subprocess.run(["systemctl", "status", "kiro-proxy.service", "--no-pager"])


def uninstall_windows_service():
    """卸载 Windows 服务"""
    task_name = "KiroProxyService"
    result = subprocess.run(
        f'schtasks /Delete /TN "{task_name}" /F',
        shell=True,
        capture_output=True,
        text=True
    )
    
    if result.returncode == 0:
        print(f"✅ 服务已卸载: {task_name}")
        
        # 删除 VBS 脚本
        vbs_script = get_script_path() / "start_kiro_proxy.vbs"
        if vbs_script.exists():
            vbs_script.unlink()
            print(f"✓ 删除启动脚本: {vbs_script}")
    else:
        print(f"❌ 卸载失败或服务不存在")


def uninstall_linux_service():
    """卸载 Linux 服务"""
    if not is_admin():
        print("❌ 需要 root 权限，请使用 sudo 运行此脚本")
        sys.exit(1)
    
    try:
        subprocess.run(["systemctl", "stop", "kiro-proxy.service"], check=False)
        subprocess.run(["systemctl", "disable", "kiro-proxy.service"], check=False)
        
        service_file = Path("/etc/systemd/system/kiro-proxy.service")
        if service_file.exists():
            service_file.unlink()
        
        subprocess.run(["systemctl", "daemon-reload"], check=True)
        
        print("✅ 服务已卸载")
    except Exception as e:
        print(f"❌ 卸载失败: {e}")


def main():
    print("=" * 50)
    print("  Kiro Proxy 服务管理")
    print("=" * 50)
    print()
    
    if len(sys.argv) > 1 and sys.argv[1] == "uninstall":
        print("卸载服务...\n")
        if sys.platform == "win32":
            uninstall_windows_service()
        else:
            uninstall_linux_service()
        return
    
    print("此脚本将安装 Kiro Proxy 为系统服务（开机自启）")
    print()
    
    if sys.platform == "win32":
        print("平台: Windows")
        print("方式: 任务计划程序")
        print()
        install_windows_service()
    elif sys.platform.startswith("linux"):
        print("平台: Linux")
        print("方式: systemd")
        print()
        install_linux_service()
    else:
        print(f"❌ 不支持的平台: {sys.platform}")
        sys.exit(1)


if __name__ == "__main__":
    main()
