# Web UI module
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_webui_module():
    module_name = "kiro_proxy.web.webui"
    if module_name in sys.modules:
        return sys.modules[module_name]

    if hasattr(sys, "_MEIPASS"):
        candidate = Path(sys._MEIPASS) / "kiro_proxy" / "web" / "webui.py"
    else:
        candidate = Path(__file__).resolve().parent / "webui.py"

    if not candidate.exists():
        raise ModuleNotFoundError(module_name)

    spec = importlib.util.spec_from_file_location(module_name, candidate)
    if spec is None or spec.loader is None:
        raise ModuleNotFoundError(module_name)

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


try:
    from .webui import get_html_page
except Exception:
    _webui = _load_webui_module()
    get_html_page = _webui.get_html_page
