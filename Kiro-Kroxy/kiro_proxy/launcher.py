"""
Kiro Proxy 启动器 - 端口配置 UI
使用 tkinter 创建启动配置界面
"""
import sys
import socket
import json
import webbrowser
import threading
from pathlib import Path


def get_config_path() -> Path:
    """获取配置文件路径"""
    if sys.platform == "win32":
        config_dir = Path.home() / "AppData" / "Local" / "KiroProxy"
    else:
        config_dir = Path.home() / ".config" / "kiro-proxy"
    config_dir.mkdir(parents=True, exist_ok=True)
    return config_dir / "launcher.json"


def load_config() -> dict:
    """加载启动器配置"""
    config_path = get_config_path()
    if config_path.exists():
        try:
            return json.loads(config_path.read_text(encoding="utf-8"))
        except:
            pass
    return {"port": 8080, "remember_port": True, "auto_open_browser": True, "language": "zh"}


def save_config(config: dict):
    """保存启动器配置"""
    config_path = get_config_path()
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")


def check_port_available(port: int) -> bool:
    """检查端口是否可用"""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1)
            s.bind(("0.0.0.0", port))
            return True
    except OSError:
        return False


def launch_with_ui():
    """显示端口配置 UI 并启动服务器"""
    try:
        import tkinter as tk
        from tkinter import ttk, messagebox
    except ImportError:
        # tkinter 不可用，直接启动
        print("[!] tkinter 不可用，使用默认端口 8080 启动")
        from kiro_proxy.main import run
        run(8080)
        return
    
    config = load_config()
    
    # 创建主窗口
    root = tk.Tk()
    root.title("Kiro API Proxy")
    root.resizable(False, False)
    
    # 设置窗口大小和位置（居中）
    window_width = 400
    window_height = 320
    screen_width = root.winfo_screenwidth()
    screen_height = root.winfo_screenheight()
    x = (screen_width - window_width) // 2
    y = (screen_height - window_height) // 2
    root.geometry(f"{window_width}x{window_height}+{x}+{y}")
    
    # 设置样式
    style = ttk.Style()
    if sys.platform == "win32":
        style.theme_use("vista")
    
    # 主框架
    main_frame = ttk.Frame(root, padding=20)
    main_frame.pack(fill="both", expand=True)
    
    # 标题
    title_label = ttk.Label(
        main_frame, 
        text="🚀 Kiro API Proxy",
        font=("Segoe UI", 18, "bold") if sys.platform == "win32" else ("SF Pro", 18, "bold")
    )
    title_label.pack(pady=(0, 5))
    
    # 版本
    version_label = ttk.Label(main_frame, text="v1.7.16", foreground="gray")
    version_label.pack(pady=(0, 20))
    
    # 端口设置框架
    port_frame = ttk.Frame(main_frame)
    port_frame.pack(fill="x", pady=10)
    
    port_label = ttk.Label(port_frame, text="Port 端口:")
    port_label.pack(side="left")
    
    port_var = tk.StringVar(value=str(config.get("port", 8080)))
    port_entry = ttk.Entry(port_frame, textvariable=port_var, width=10, justify="center")
    port_entry.pack(side="left", padx=10)
    
    port_hint = ttk.Label(port_frame, text="(1024-65535)", foreground="gray")
    port_hint.pack(side="left")
    
    # 状态标签
    status_var = tk.StringVar(value="")
    status_label = ttk.Label(main_frame, textvariable=status_var, foreground="gray")
    status_label.pack(pady=5)
    
    # 选项框架
    options_frame = ttk.Frame(main_frame)
    options_frame.pack(fill="x", pady=10)
    
    remember_var = tk.BooleanVar(value=config.get("remember_port", True))
    remember_check = ttk.Checkbutton(options_frame, text="Remember port 记住端口", variable=remember_var)
    remember_check.pack(anchor="w")
    
    browser_var = tk.BooleanVar(value=config.get("auto_open_browser", True))
    browser_check = ttk.Checkbutton(options_frame, text="Auto open browser 自动打开浏览器", variable=browser_var)
    browser_check.pack(anchor="w")
    
    # 语言选择
    lang_frame = ttk.Frame(main_frame)
    lang_frame.pack(fill="x", pady=5)
    
    lang_label = ttk.Label(lang_frame, text="Language 语言:")
    lang_label.pack(side="left")
    
    lang_var = tk.StringVar(value=config.get("language", "zh"))
    lang_combo = ttk.Combobox(lang_frame, textvariable=lang_var, state="readonly", width=15)
    lang_combo["values"] = ("zh - 中文", "en - English")
    lang_combo.set("zh - 中文" if lang_var.get() == "zh" else "en - English")
    lang_combo.pack(side="left", padx=10)
    
    # 按钮框架
    button_frame = ttk.Frame(main_frame)
    button_frame.pack(pady=20)
    
    result = {"port": None, "auto_open": False, "language": "zh"}
    
    def validate_and_check():
        """验证端口并检查可用性"""
        try:
            port = int(port_var.get())
            if port < 1024 or port > 65535:
                status_var.set("❌ Port range / 端口范围: 1024-65535")
                status_label.configure(foreground="red")
                return None
            
            if not check_port_available(port):
                status_var.set(f"❌ Port {port} in use / 端口已被占用")
                status_label.configure(foreground="red")
                return None
            
            status_var.set(f"✅ Port {port} available / 可用")
            status_label.configure(foreground="green")
            return port
        except ValueError:
            status_var.set("❌ Invalid port / 请输入有效端口号")
            status_label.configure(foreground="red")
            return None
    
    def on_port_change(*args):
        """端口变化时验证"""
        validate_and_check()
    
    port_var.trace_add("write", on_port_change)
    
    def on_start():
        """点击启动按钮"""
        port = validate_and_check()
        if port is None:
            return
        
        # 获取语言设置
        lang = lang_combo.get().split(" - ")[0]
        
        # 保存配置
        if remember_var.get():
            save_config({
                "port": port,
                "remember_port": True,
                "auto_open_browser": browser_var.get(),
                "language": lang
            })
        
        result["port"] = port
        result["auto_open"] = browser_var.get()
        result["language"] = lang
        root.quit()
        root.destroy()
    
    def on_cancel():
        """点击取消按钮"""
        root.quit()
        root.destroy()
    
    start_btn = ttk.Button(button_frame, text="▶ Start 启动", command=on_start, width=18)
    start_btn.pack(side="left", padx=5)
    
    cancel_btn = ttk.Button(button_frame, text="Cancel 取消", command=on_cancel, width=12)
    cancel_btn.pack(side="left", padx=5)
    
    # 绑定回车键
    root.bind("<Return>", lambda e: on_start())
    root.bind("<Escape>", lambda e: on_cancel())
    
    # 初始验证
    validate_and_check()
    
    # 聚焦到端口输入框
    port_entry.focus_set()
    port_entry.select_range(0, tk.END)
    
    # 运行主循环
    root.mainloop()
    
    # 用户选择后启动服务器
    if result["port"]:
        port = result["port"]
        auto_open = result["auto_open"]
        
        # 自动打开浏览器
        if auto_open:
            def open_browser():
                import time
                time.sleep(1.5)  # 等待服务器启动
                webbrowser.open(f"http://localhost:{port}")
            threading.Thread(target=open_browser, daemon=True).start()
        
        # 加载选定的语言
        from kiro_proxy.web.i18n import load_language
        load_language(result["language"])
        
        # 启动服务器
        from kiro_proxy.main import run
        run(port)


if __name__ == "__main__":
    launch_with_ui()
