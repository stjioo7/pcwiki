import os
import yaml
from typing import Dict, Optional
from pydantic import BaseModel, Field

class ProviderConfig(BaseModel):
    base_url: str = Field(..., description="LLM OpenAI 兼容接口 Base URL")
    api_key: str = Field("", description="API Key")
    model: str = Field(..., description="模型名称")
    temperature: float = Field(0.3, description="采样温度")
    max_tokens: int = Field(3000, description="最大生成 Token 数量")

class AIConfig(BaseModel):
    active_provider: str = Field("deepseek", description="当前激活的提供商")
    timeout_seconds: float = Field(60.0, description="请求超时时间（秒）")

class AppConfig(BaseModel):
    ai: AIConfig
    providers: Dict[str, ProviderConfig]

_CACHED_CONFIG: Optional[AppConfig] = None

def load_config(force_reload: bool = False) -> AppConfig:
    global _CACHED_CONFIG
    if _CACHED_CONFIG is not None and not force_reload:
        return _CACHED_CONFIG

    config_path = "config.yaml"
    if not os.path.exists(config_path):
        if os.path.exists("config.example.yaml"):
            config_path = "config.example.yaml"
        else:
            raise FileNotFoundError("未找到 config.yaml 或 config.example.yaml 配置文件")

    with open(config_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}

    _CACHED_CONFIG = AppConfig(**data)
    return _CACHED_CONFIG

def get_active_provider_config(force_reload: bool = False) -> tuple[str, ProviderConfig]:
    cfg = load_config(force_reload=force_reload)
    provider_name = cfg.ai.active_provider
    if provider_name not in cfg.providers:
        raise ValueError(f"当前配置的 active_provider '{provider_name}' 不存在于 providers 列表中")
    
    p_cfg = cfg.providers[provider_name]
    
    # 严格校验：若为 ollama 则不强求真实 key，其余 provider 必须具备有效 api_key
    if provider_name != "ollama":
        if not p_cfg.api_key or p_cfg.api_key.strip() in ("", "your-deepseek-api-key", "your-openai-api-key", "your-api-key"):
            raise ValueError(f"【AI 服务未配置】Provider '{provider_name}' 未配置有效的 API Key！请在 config.yaml 中填入有效的 api_key")

    return provider_name, p_cfg
