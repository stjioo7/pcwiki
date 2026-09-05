import json
import logging
from typing import AsyncGenerator, Dict, Any
import httpx

from app.core.config import get_active_provider_config, load_config
from app.ai.prompts import TACTICAL_AUDITOR_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

async def stream_diagnose_team(team_payload: Dict[str, Any]) -> AsyncGenerator[str, None]:
    """
    通过激活的 LLM Provider 异步流式输出队伍深度战术诊断报告
    严格校验 API Key，遇到异常立即抛出，无静默降级
    """
    provider_name, p_cfg = get_active_provider_config(force_reload=True)
    cfg = load_config()
    timeout = cfg.ai.timeout_seconds

    # 1. 序列化输入事实数据
    user_content = json.dumps(team_payload, ensure_ascii=False, indent=2)

    headers = {
        "Content-Type": "application/json"
    }
    if p_cfg.api_key:
        headers["Authorization"] = f"Bearer {p_cfg.api_key}"

    url = p_cfg.base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": p_cfg.model,
        "messages": [
            {"role": "system", "content": TACTICAL_AUDITOR_SYSTEM_PROMPT},
            {"role": "user", "content": f"以下是当前队伍在【{team_payload.get('formatName', '双打')}】赛制下的全量实数与确定性审计数据，请输出四段式深度战术诊断报告：\n\n```json\n{user_content}\n```"}
        ],
        "temperature": p_cfg.temperature,
        "max_tokens": p_cfg.max_tokens,
        "stream": True
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                if response.status_code != 200:
                    error_text = await response.aread()
                    error_msg = f"【LLM Provider 接口错误 ({response.status_code})】: {error_text.decode('utf-8', errors='ignore')}"
                    logger.error(error_msg)
                    raise RuntimeError(error_msg)

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data:"):
                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield content
                        except json.JSONDecodeError:
                            continue
        except httpx.ConnectError as e:
            raise ConnectionError(f"【网络连接失败】无法连接到 LLM Provider ({p_cfg.base_url})，请检查网络或代理配置: {str(e)}")
        except httpx.TimeoutException:
            raise TimeoutError(f"【请求超时】调用 LLM Provider 超时 ({timeout}s)，请重试或检查服务状态")
        except Exception as e:
            if not isinstance(e, (RuntimeError, ConnectionError, TimeoutError, ValueError)):
                raise RuntimeError(f"【AI 推理异常】: {str(e)}")
            raise e
