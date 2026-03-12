"""
i18n 模块 - 多语言支持

在启动时加载语言文件，提供翻译函数。
"""
import json
import sys
from pathlib import Path

# 当前语言
_current_lang = "zh"
_translations = {}
_loaded = False

# 语言文件目录 - 支持 PyInstaller 打包
if hasattr(sys, '_MEIPASS'):
    # PyInstaller 打包后的临时目录
    I18N_DIR = Path(sys._MEIPASS) / "kiro_proxy" / "web" / "i18n"
else:
    # 源码运行
    I18N_DIR = Path(__file__).parent / "i18n"


def load_language(lang: str = "zh") -> dict:
    """加载语言文件"""
    global _current_lang, _translations, _loaded
    
    lang_file = I18N_DIR / f"{lang}.json"
    if not lang_file.exists():
        lang_file = I18N_DIR / "zh.json"  # 回退到中文
        lang = "zh"
    
    try:
        with open(lang_file, "r", encoding="utf-8") as f:
            _translations = json.load(f)
        _current_lang = lang
        _loaded = True
        print(f"[i18n] 已加载语言: {lang}")
    except Exception as e:
        print(f"[i18n] 加载语言文件失败: {e}")
        _translations = {}
    
    return _translations


def _ensure_loaded():
    """确保语言已加载"""
    global _loaded
    if not _loaded:
        load_language("zh")


def t(key: str) -> str:
    """获取翻译文本"""
    _ensure_loaded()
    return _translations.get(key, key)


def get_current_lang() -> str:
    """获取当前语言"""
    _ensure_loaded()
    return _current_lang


def get_translations() -> dict:
    """获取所有翻译"""
    _ensure_loaded()
    return _translations.copy()


def get_available_languages() -> list:
    """获取可用语言列表"""
    languages = []
    for f in I18N_DIR.glob("*.json"):
        try:
            with open(f, "r", encoding="utf-8") as fp:
                data = json.load(fp)
                languages.append({
                    "code": f.stem,
                    "name": data.get("name", f.stem)
                })
        except:
            pass
    return languages

