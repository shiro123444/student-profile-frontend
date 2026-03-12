#!/usr/bin/env python3
"""Kiro API Proxy 启动脚本"""
import sys

# ============================================================
# PyInstaller 显式导入块
# 这些导入确保 PyInstaller 能够检测到所有必要的模块
# 不要删除这些导入，即使 IDE 显示它们未被使用
# ============================================================
import kiro_proxy
import kiro_proxy.main
import kiro_proxy.launcher
import kiro_proxy.cli
import kiro_proxy.config
import kiro_proxy.converters
import kiro_proxy.web
try:
    import kiro_proxy.web.webui
except Exception:
    pass
import kiro_proxy.web.i18n
import kiro_proxy.core
import kiro_proxy.core.account
import kiro_proxy.core.state
import kiro_proxy.core.persistence
import kiro_proxy.core.scheduler
import kiro_proxy.core.stats
import kiro_proxy.core.retry
import kiro_proxy.core.browser
import kiro_proxy.core.flow_monitor
import kiro_proxy.core.usage
import kiro_proxy.handlers
import kiro_proxy.handlers.anthropic
import kiro_proxy.handlers.openai
import kiro_proxy.handlers.responses
import kiro_proxy.handlers.gemini
import kiro_proxy.handlers.admin
import kiro_proxy.credential
import kiro_proxy.credential.types
import kiro_proxy.credential.fingerprint
import kiro_proxy.credential.quota
import kiro_proxy.credential.refresher
import kiro_proxy.auth
import kiro_proxy.auth.device_flow
# ============================================================

if __name__ == "__main__":
    # CLI 子命令模式
    if len(sys.argv) > 1 and sys.argv[1] in ("accounts", "login", "status", "serve"):
        from kiro_proxy.cli import main
        main()
    
    # --no-ui 模式：跳过 UI 直接启动
    elif len(sys.argv) > 1 and sys.argv[1] == "--no-ui":
        port = int(sys.argv[2]) if len(sys.argv) > 2 else 8080
        from kiro_proxy.main import run
        run(port)
    
    # 兼容旧的启动方式: python run.py [port] (数字参数)
    elif len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
        from kiro_proxy.main import run
        run(port)
    
    # 默认：显示端口配置 UI
    else:
        from kiro_proxy.launcher import launch_with_ui
        launch_with_ui()
