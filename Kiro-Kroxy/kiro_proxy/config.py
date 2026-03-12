"""配置模块"""
import json
import re
from pathlib import Path

KIRO_API_URL = "https://q.us-east-1.amazonaws.com/generateAssistantResponse"
MODELS_URL = "https://q.us-east-1.amazonaws.com/ListAvailableModels"
TOKEN_PATH = Path.home() / ".aws/sso/cache/kiro-auth-token.json"

# 配额管理配置
QUOTA_COOLDOWN_SECONDS = 300  # 配额超限冷却时间（秒）

# 模型映射
MODEL_MAPPING = {
    # Claude 3.5 -> Kiro Claude 4
    "claude-3-5-sonnet-20241022": "claude-sonnet-4",
    "claude-3-5-sonnet-latest": "claude-sonnet-4",
    "claude-3-5-sonnet": "claude-sonnet-4",
    "claude-3-5-haiku-20241022": "claude-haiku-4.5",
    "claude-3-5-haiku-latest": "claude-haiku-4.5",
    # Claude 3
    "claude-3-opus-20240229": "claude-opus-4.5",
    "claude-3-opus-latest": "claude-opus-4.5",
    "claude-3-sonnet-20240229": "claude-sonnet-4",
    "claude-3-haiku-20240307": "claude-haiku-4.5",
    # Claude 4
    "claude-4-sonnet": "claude-sonnet-4",
    "claude-4-opus": "claude-opus-4.5",
    # OpenAI GPT -> Claude
    "gpt-4o": "claude-sonnet-4",
    "gpt-4o-mini": "claude-haiku-4.5",
    "gpt-4-turbo": "claude-sonnet-4",
    "gpt-4": "claude-sonnet-4",
    "gpt-3.5-turbo": "claude-haiku-4.5",
    # OpenAI o1 -> Claude Opus
    "o1": "claude-opus-4.5",
    "o1-preview": "claude-opus-4.5",
    "o1-mini": "claude-sonnet-4",
    # Gemini -> Claude
    "gemini-2.0-flash": "claude-sonnet-4",
    "gemini-2.0-flash-thinking": "claude-opus-4.5",
    "gemini-1.5-pro": "claude-sonnet-4.5",
    "gemini-1.5-flash": "claude-sonnet-4",
    # 连字符版本号别名（兼容 VS Code Copilot / Cherry Studio 等客户端）
    "claude-sonnet-4-5": "claude-sonnet-4.5",
    "claude-haiku-4-5": "claude-haiku-4.5",
    "claude-opus-4-5": "claude-opus-4.5",
    "claude-opus-4-6": "claude-opus-4.6",
    # 别名
    "sonnet": "claude-sonnet-4",
    "haiku": "claude-haiku-4.5",
    "opus": "claude-opus-4.5",
}

# 内置 Kiro 模型
BUILTIN_KIRO_MODELS = {"auto", "claude-sonnet-4.5", "claude-sonnet-4", "claude-haiku-4.5", "claude-opus-4.5", "claude-opus-4.6"}

# Thinking 模型变体（带 -thinking 后缀，映射到基础模型 + 启用 thinking）
THINKING_MODEL_VARIANTS = {
    "claude-sonnet-4-5-thinking", "claude-sonnet-4.5-thinking",
    "claude-opus-4-5-thinking", "claude-opus-4.5-thinking",
    "claude-opus-4-6-thinking", "claude-opus-4.6-thinking",
    "claude-haiku-4-5-thinking", "claude-haiku-4.5-thinking",
    "claude-sonnet-4-thinking",
}

# 需要 Enterprise 账号的模型（Free/BuilderId 账号不支持）
ENTERPRISE_ONLY_MODELS = {"claude-opus-4.5", "claude-opus-4.6"}

def is_enterprise_only_model(model: str) -> bool:
    """检查模型是否需要 Enterprise 账号"""
    return model in ENTERPRISE_ONLY_MODELS

# 运行时自定义模型（从配置加载）
_custom_models = {}  # {model_id: {"name": "...", "description": "..."}}

def _load_custom_models():
    """从配置文件加载自定义模型"""
    global _custom_models
    try:
        from .core.persistence import load_config
        config = load_config()
        _custom_models = config.get("custom_models", {})
    except Exception:
        pass

def get_all_kiro_models() -> set:
    """获取所有 Kiro 模型 ID（内置 + 自定义）"""
    return BUILTIN_KIRO_MODELS | set(_custom_models.keys())

def get_custom_models() -> dict:
    """获取自定义模型列表"""
    return _custom_models.copy()

def add_custom_model(model_id: str, name: str = "", description: str = "") -> bool:
    """添加自定义模型"""
    global _custom_models
    _custom_models[model_id] = {
        "name": name or model_id,
        "description": description,
    }
    _save_custom_models()
    return True

def remove_custom_model(model_id: str) -> bool:
    """删除自定义模型"""
    global _custom_models
    if model_id in _custom_models:
        del _custom_models[model_id]
        _save_custom_models()
        return True
    return False

def _save_custom_models():
    """保存自定义模型到配置文件"""
    try:
        from .core.persistence import load_config, save_config
        config = load_config()
        config["custom_models"] = _custom_models
        save_config(config)
    except Exception as e:
        print(f"[Config] 保存自定义模型失败: {e}")

# 兼容旧代码
KIRO_MODELS = BUILTIN_KIRO_MODELS

# 预编译正则：匹配 claude-{family}-{major}-{minor} 连字符版本号格式
_CLAUDE_DASH_VERSION_RE = re.compile(
    r'^(claude-(?:sonnet|haiku|opus)-(\d+))-(\d+)'
)

def _normalize_model_id(model: str) -> str:
    """将连字符版本号归一化为点号格式
    
    例如:
        claude-sonnet-4-5          → claude-sonnet-4.5
        claude-opus-4-6            → claude-opus-4.6
        claude-sonnet-4-5-20250929 → claude-sonnet-4.5-20250929
        claude-sonnet-4.5          → claude-sonnet-4.5（不变）
    """
    m = _CLAUDE_DASH_VERSION_RE.match(model)
    if m:
        prefix = m.group(1)       # claude-sonnet-4
        minor = m.group(3)        # 5
        rest = model[m.end():]    # -20250929 或空
        return f"{prefix}.{minor}{rest}"
    return model


def map_model_name(model: str) -> str:
    """将外部模型名称映射到 Kiro 支持的名称
    
    支持多种格式：
    - 点号版本: claude-sonnet-4.5
    - 连字符版本: claude-sonnet-4-5（自动转换为点号）
    - 带日期后缀: claude-sonnet-4-5-20250929
    - GPT/Gemini 别名: gpt-4o → claude-sonnet-4
    - 简短别名: sonnet, haiku, opus
    """
    if not model:
        return "claude-sonnet-4"
    
    # 精确匹配静态映射表（包含连字符别名）
    if model in MODEL_MAPPING:
        return MODEL_MAPPING[model]
    
    # 精确匹配内置/自定义模型
    all_models = get_all_kiro_models()
    if model in all_models:
        return model
    
    # 支持 thinking 变体：保留原始名称（handler 层会解析 -thinking 后缀）
    if model in THINKING_MODEL_VARIANTS:
        return model
    normalized_for_thinking = _normalize_model_id(model)
    if normalized_for_thinking in THINKING_MODEL_VARIANTS:
        return normalized_for_thinking
    
    # 连字符→点号归一化后再匹配
    normalized = _normalize_model_id(model)
    if normalized != model:
        if normalized in MODEL_MAPPING:
            return MODEL_MAPPING[normalized]
        if normalized in all_models:
            return normalized
    
    # 模糊匹配（兜底）
    model_lower = model.lower()
    if "opus" in model_lower:
        if "4.6" in model_lower or "4-6" in model_lower:
            return "claude-opus-4.6"
        return "claude-opus-4.5"
    if "haiku" in model_lower:
        return "claude-haiku-4.5"
    if "sonnet" in model_lower:
        if "4.5" in model_lower or "4-5" in model_lower:
            return "claude-sonnet-4.5"
        return "claude-sonnet-4"
    return "claude-sonnet-4"
