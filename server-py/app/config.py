"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """PathMind Agent Service configuration."""

    # Server
    host: str = "0.0.0.0"
    port: int = 9090
    debug: bool = False

    # Uvicorn runtime
    uvicorn_workers: int = 1
    uvicorn_timeout_keep_alive_s: int = 30
    uvicorn_timeout_graceful_shutdown_s: int = 30
    uvicorn_limit_concurrency: int = 0
    uvicorn_backlog: int = 2048
    uvicorn_log_level: str = "info"

    # Go backend URL (for MCP tools to call)
    go_backend_url: str = "http://127.0.0.1:18080/api"

    # Claude API (compatible with Anthropic format)
    anthropic_api_key: str = ""
    anthropic_base_url: str = "https://api.anthropic.com"
    default_model: str = "claude-sonnet-4.6"
    sonnet_fallback_model: str = "claude-sonnet-4.5"
    haiku_model: str = "claude-haiku-4.5"
    opus_model: str = "claude-sonnet-4.6"

    # Anthropic streaming tuning
    anthropic_first_byte_timeout_sec: int = 12
    anthropic_stream_read_timeout_sec: int = 20

    # NVIDIA Embedding API
    nvidia_api_key: str = ""
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
    nvidia_embed_model: str = "baai/bge-m3"
    nvidia_code_embed_model: str = "nvidia/nv-embedcode-7b-v1"
    nvidia_parse_model: str = "nvidia/nemoretriever-parse"
    nvidia_vision_model: str = "meta/llama-3.2-90b-vision-instruct"
    nvidia_rerank_model: str = "nvidia/llama-3.2-nemoretriever-300m-embed-v2"
    embedding_dimensions: int = 1024
    vision_extract_dpi: int = 200
    vision_max_concurrent: int = 3
    rag_prefer_text_extraction: bool = True
    rag_text_min_chars: int = 300
    rag_use_structured_parser: bool = False
    rag_rerank_enabled: bool = True
    rag_rerank_max_candidates: int = 24
    rag_rerank_max_chars: int = 800

    # PostgreSQL (for pgvector)
    database_url: str = "postgresql://postgres:postgres@localhost:5432/pathmind"

    # Redis
    redis_url: str = "redis://localhost:6379/0"

    # Cache (Redis)
    cache_enabled: bool = True
    embedding_cache_enabled: bool = True
    rag_query_cache_enabled: bool = True
    note_search_cache_enabled: bool = True
    unified_search_cache_enabled: bool = True
    embedding_cache_ttl_sec: int = 86400
    rag_query_cache_ttl_sec: int = 600
    note_search_cache_ttl_sec: int = 600
    unified_search_cache_ttl_sec: int = 300

    # File uploads (shared with Go backend)
    upload_dir: str = "./uploads"

    # OpenAI-compatible API (Qwen / GPT / DeepSeek)
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_default_model: str = "qwen/qwen3-next-80b-a3b-instruct"

    # HuggingFace Serverless API (FIM base models for inline completion)
    hf_api_key: str = ""
    hf_base_url: str = "https://router.huggingface.co/hf-inference/models"
    hf_fim_model: str = "Qwen/Qwen2.5-Coder-7B"

    # Agent defaults
    agent_max_budget_usd: float = 0.50
    agent_max_turns: int = 20
    openai_max_turns: int = 10
    agent_delegation_enabled: bool = True
    agent_delegation_max_depth: int = 2

    # External MCP integration
    external_mcp_enabled: bool = False
    external_mcp_config_path: str = "./mcp_servers.yaml"
    external_mcp_openai_timeout_sec: int = 45
    external_mcp_builtin_priority: bool = True
    external_mcp_fallback_to_internal: bool = True

    # Coding workflow feature flags
    coding_enabled: bool = False
    coding_approvals_enabled: bool = True
    coding_audit_enabled: bool = True

    # Coding sandbox policy (comma-separated values)
    coding_workspace_roots: str = "."
    coding_blocked_paths: str = "/etc,/var,/proc,/sys,~/.ssh,~/.config"
    coding_allowed_commands: str = "git,python,python3,node,npm,pnpm,yarn,uv,pip,pytest,go,make,bash,sh"
    coding_shell_default_timeout_sec: int = 30
    coding_shell_max_timeout_sec: int = 300
    coding_max_output_chars: int = 8000
    coding_max_file_bytes: int = 10485760
    coding_network_enabled: bool = False
    coding_approval_timeout_sec: int = 60
    coding_high_risk_max_concurrency: int = 1
    coding_low_risk_retry_count: int = 1
    coding_low_risk_retry_backoff_ms: int = 300
    coding_medium_risk_requires_approval: bool = True
    coding_external_default_risk: str = "high"
    coding_external_readonly_risk: str = "medium"
    coding_external_openworld_risk: str = "high"

    # Coding policy templates (versioned JSON + hot reload)
    coding_policy_profiles_enabled: bool = True
    coding_policy_profiles_path: str = "./coding_policy_profiles.json"
    coding_policy_default_profile: str = "strict_v1"

    model_config = {"env_file": ".env", "env_prefix": "PATHMIND_"}


settings = Settings()
