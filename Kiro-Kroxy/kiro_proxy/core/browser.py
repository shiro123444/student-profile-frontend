"""浏览器检测和打开"""
import os
import shlex
import shutil
import subprocess
import platform
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class BrowserInfo:
    id: str
    name: str
    path: str
    supports_incognito: bool
    incognito_arg: str = ""


# 浏览器配置
BROWSER_CONFIGS = {
    "chrome": {
        "names": ["google-chrome", "google-chrome-stable", "chrome", "chromium", "chromium-browser"],
        "display": "Chrome",
        "incognito": "--incognito",
    },
    "firefox": {
        "names": ["firefox", "firefox-esr"],
        "display": "Firefox",
        "incognito": "--private-window",
    },
    "edge": {
        "names": ["microsoft-edge", "microsoft-edge-stable", "msedge"],
        "display": "Edge",
        "incognito": "--inprivate",
    },
    "brave": {
        "names": ["brave", "brave-browser"],
        "display": "Brave",
        "incognito": "--incognito",
    },
    "opera": {
        "names": ["opera"],
        "display": "Opera",
        "incognito": "--private",
    },
    "vivaldi": {
        "names": ["vivaldi", "vivaldi-stable"],
        "display": "Vivaldi",
        "incognito": "--incognito",
    },
}


def detect_browsers() -> List[BrowserInfo]:
    """检测系统安装的浏览器"""
    browsers = []
    system = platform.system().lower()

    if system == "windows":
        import winreg

        def normalize_exe_path(raw: str) -> Optional[str]:
            if not raw:
                return None
            expanded = os.path.expandvars(raw.strip())
            try:
                parts = shlex.split(expanded, posix=False)
            except ValueError:
                parts = [expanded]
            candidate = (parts[0] if parts else expanded).strip().strip('"')
            if os.path.exists(candidate):
                return candidate
            lower = expanded.lower()
            exe_idx = lower.find(".exe")
            if exe_idx != -1:
                candidate = expanded[:exe_idx + 4].strip().strip('"')
                if os.path.exists(candidate):
                    return candidate
            return None

        def get_reg_path(exe_name: str) -> Optional[str]:
            name = f"{exe_name}.exe"
            for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                try:
                    with winreg.OpenKey(root, rf"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\{name}") as key:
                        value, _ = winreg.QueryValueEx(key, "")
                        path = normalize_exe_path(value)
                        if path:
                            return path
                except (FileNotFoundError, OSError, WindowsError):
                    pass
            return None

        for browser_id, config in BROWSER_CONFIGS.items():
            path = None
            for exe_name in config["names"]:
                path = get_reg_path(exe_name)
                if path:
                    break
            if not path:
                for exe_name in config["names"]:
                    path = shutil.which(exe_name)
                    if path:
                        break
            if path:
                browsers.append(BrowserInfo(
                    id=browser_id,
                    name=config["display"],
                    path=path,
                    supports_incognito=bool(config.get("incognito")),
                    incognito_arg=config.get("incognito", ""),
                ))
    else:
        for browser_id, config in BROWSER_CONFIGS.items():
            for name in config["names"]:
                path = shutil.which(name)
                if path:
                    browsers.append(BrowserInfo(
                        id=browser_id,
                        name=config["display"],
                        path=path,
                        supports_incognito=bool(config.get("incognito")),
                        incognito_arg=config.get("incognito", ""),
                    ))
                    break
    
    # 添加默认浏览器选项
    if browsers:
        browsers.insert(0, BrowserInfo(
            id="default",
            name="默认浏览器",
            path="xdg-open" if system == "linux" else "open",
            supports_incognito=False,
            incognito_arg="",
        ))
    
    return browsers


def open_url(url: str, browser_id: str = "default", incognito: bool = False) -> bool:
    """用指定浏览器打开 URL"""
    browsers = detect_browsers()
    browser = next((b for b in browsers if b.id == browser_id), None)
    
    if not browser:
        # 降级到默认
        browser = browsers[0] if browsers else None
    
    if not browser:
        return False
    
    try:
        if browser.id == "default":
            # 使用系统默认浏览器
            system = platform.system().lower()
            if system == "linux":
                subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            elif system == "darwin":
                subprocess.Popen(["open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                os.startfile(url)
        else:
            # 使用指定浏览器
            args = [browser.path]
            if incognito and browser.supports_incognito and browser.incognito_arg:
                args.append(browser.incognito_arg)
            args.append(url)
            subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        return True
    except Exception as e:
        print(f"[Browser] 打开失败: {e}")
        return False


def get_browsers_info() -> List[dict]:
    """获取浏览器信息列表"""
    return [
        {
            "id": b.id,
            "name": b.name,
            "supports_incognito": b.supports_incognito,
        }
        for b in detect_browsers()
    ]
