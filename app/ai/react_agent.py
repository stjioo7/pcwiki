"""
app/ai/react_agent.py - 核心 ReAct (Reasoning + Acting) 多轮推理与工具调用流式分发引擎
完全基于 OpenAI 标准 JSON Function Calling 协议，集成 100% 本地闭环数据工具集
"""

import json
import httpx
from typing import Dict, Any, AsyncGenerator, List
from app.core.config import get_active_provider_config
from app.ai.prompts import REACT_TACTICAL_AUDITOR_SYSTEM_PROMPT
from app.ai.tools import OPENAI_TOOLS, execute_local_tool

MAX_REACT_STEPS = 6


def format_team_payload_to_user_prompt(payload: Dict[str, Any]) -> str:
    """将前端传递的队伍实数、联防盲点、速度线与玩家战术疑问整理为清晰的 User Prompt"""
    fmt = payload.get("format", "double")
    fmt_cn = "双打 (Doubles VGC)" if fmt == "double" else "单打 (Singles 6选3)"
    slots = payload.get("slots", [])
    blind_spots = payload.get("blindSpots", [])
    counters = payload.get("counters", [])
    speed_tiers = payload.get("speedTiers", [])
    user_query = payload.get("userQuery", "").strip()

    prompt_lines = [
        f"【当前对战模式】：{fmt_cn}",
        "【队伍 6 只宝可梦配置与 50 级精确实数】："
    ]

    for idx, slot in enumerate(slots, 1):
        if not slot:
            prompt_lines.append(f"  - 卡位 {idx}: [空置]")
            continue
        name = slot.get("name", "未命名")
        types = "/".join(slot.get("types", ["Normal"]))
        ability = slot.get("ability", "默认特性")
        item = slot.get("item", "无道具")
        nature = slot.get("nature", "固执")
        moves = ", ".join(slot.get("moves", []))
        stats = slot.get("stats", {})
        stats_str = f"HP {stats.get('hp', '-')}/物攻 {stats.get('atk', '-')}/物防 {stats.get('def', '-')}/特攻 {stats.get('spa', '-')}/特防 {stats.get('spd', '-')}/速度 {stats.get('spe', '-')}"
        prompt_lines.append(f"  - 卡位 {idx}: {name} [{types}] | 道具: {item} | 特性: {ability} | 性格: {nature} | 招式: [{moves}] | 50级实数: ({stats_str})")

    if blind_spots:
        prompt_lines.append(f"【确定性 18 属性联防高危盲点 (2+ 共有弱点)】: {', '.join(blind_spots)}")

    if counters:
        threat_summaries = []
        for c in counters[:5]:
            c_name = c.get("name", "")
            reasons = "; ".join(c.get("reasons", []))
            threat_summaries.append(f"{c_name} ({reasons})")
        prompt_lines.append(f"【天梯 Top 20 威胁审查预警】: {', '.join(threat_summaries)}")

    if speed_tiers:
        spe_str = " > ".join([f"{s.get('name')}({s.get('spe')})" for s in speed_tiers if s])
        prompt_lines.append(f"【队内 50 级速度阶梯】: {spe_str}")

    if user_query:
        prompt_lines.append(f"\n【★ 玩家提出的重点战术疑问与假想敌备注 ★】:\n「{user_query}」\n请在推理取证与战术报告中，重点针对上述玩家疑问进行对位伤害计算与选出破局推演！")

    prompt_lines.append("\n请启动 ReAct 推理，根据需要主动调用本地工具验证伤害斩杀线、速度超速对比、天梯主流配置或赛事冠亚军构筑，最终输出规范的四段式战术诊断报告。")
    return "\n".join(prompt_lines)


async def stream_react_diagnose(payload: Dict[str, Any]) -> AsyncGenerator[str, None]:
    """
    ReAct 智能体主循环：
    1. 组装上下文与 System Prompt；
    2. 循环调用 LLM (支持 tool_calls)；
    3. 解析 tool_calls 并执行本地 100% 确定性工具；
    4. 将 Observation 灌回上下文继续思考；
    5. 当 LLM 输出最终总结文本时，以 token 流式发送给前端；
    6. 输出完成后发送 done 事件。
    """
    provider_name, p_cfg = get_active_provider_config(force_reload=True)

    if not p_cfg.api_key or p_cfg.api_key.strip() == "":
        yield json.dumps({
            "type": "error",
            "error": f"【AI 服务未配置】Provider '{provider_name}' 未检测到有效 API Key，请在 config.yaml 中配置有效的 api_key"
        }, ensure_ascii=False)
        return

    user_prompt = format_team_payload_to_user_prompt(payload)

    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": REACT_TACTICAL_AUDITOR_SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]

    base_url = p_cfg.base_url.rstrip("/")
    api_url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {p_cfg.api_key}",
        "Content-Type": "application/json"
    }

    step_count = 0
    client_timeout = httpx.Timeout(connect=10.0, read=90.0, write=15.0, pool=10.0)

    async with httpx.AsyncClient(timeout=client_timeout) as client:
        while step_count < MAX_REACT_STEPS:
            step_count += 1
            request_body = {
                "model": p_cfg.model,
                "messages": messages,
                "tools": OPENAI_TOOLS,
                "tool_choice": "auto",
                "temperature": p_cfg.temperature,
                "stream": True
            }

            accumulated_content = ""
            accumulated_reasoning = ""
            tool_calls_map: Dict[int, Dict[str, Any]] = {}

            try:
                async with client.stream("POST", api_url, headers=headers, json=request_body) as response:
                    if response.status_code != 200:
                        err_text = await response.aread()
                        yield json.dumps({
                            "type": "error",
                            "error": f"LLM API 响应异常 (HTTP {response.status_code}): {err_text.decode('utf-8', errors='ignore')}"
                        }, ensure_ascii=False)
                        return

                    async for raw_line in response.aiter_lines():
                        line = raw_line.strip()
                        if not line or not line.startswith("data:"):
                            continue

                        data_str = line[5:].strip()
                        if data_str == "[DONE]":
                            break

                        try:
                            chunk = json.loads(data_str)
                            choices = chunk.get("choices", [])
                            if not choices:
                                continue

                            delta = choices[0].get("delta", {})

                            # 1. 深度思考流 (如 DeepSeek-R1 reasoning_content)
                            if "reasoning_content" in delta and delta["reasoning_content"]:
                                r_token = delta["reasoning_content"]
                                accumulated_reasoning += r_token
                                yield json.dumps({
                                    "type": "thought",
                                    "content": r_token
                                }, ensure_ascii=False)

                            # 2. 工具调用增量流
                            if "tool_calls" in delta and delta["tool_calls"]:
                                for tc_chunk in delta["tool_calls"]:
                                    tc_idx = tc_chunk.get("index", 0)
                                    if tc_idx not in tool_calls_map:
                                        tool_calls_map[tc_idx] = {
                                            "id": tc_chunk.get("id", f"call_{step_count}_{tc_idx}"),
                                            "name": "",
                                            "arguments": ""
                                        }
                                    if tc_chunk.get("id"):
                                        tool_calls_map[tc_idx]["id"] = tc_chunk["id"]
                                    fn = tc_chunk.get("function", {})
                                    if fn.get("name"):
                                        tool_calls_map[tc_idx]["name"] += fn["name"]
                                    if fn.get("arguments"):
                                        tool_calls_map[tc_idx]["arguments"] += fn["arguments"]

                            # 3. 常规文本内容流 (最终战术报告或思考文本)
                            if "content" in delta and delta["content"]:
                                c_token = delta["content"]
                                accumulated_content += c_token
                                # 仅当未发起 tool_calls 时才作为最终报告流式分发
                                if not tool_calls_map:
                                    yield json.dumps({
                                        "type": "token",
                                        "content": c_token
                                    }, ensure_ascii=False)

                        except json.JSONDecodeError:
                            continue

            except Exception as e:
                yield json.dumps({
                    "type": "error",
                    "error": f"请求大模型服务异常: {str(e)}"
                }, ensure_ascii=False)
                return

            # 如果本轮 LLM 发起了工具调用
            if tool_calls_map:
                tool_calls_for_history = []
                for idx, tc in tool_calls_map.items():
                    call_id = tc.get("id") or f"call_{step_count}_{idx}"
                    tool_name = tc.get("name", "")
                    raw_args = tc.get("arguments", "{}")

                    try:
                        parsed_args = json.loads(raw_args) if raw_args.strip() else {}
                    except Exception:
                        parsed_args = {}

                    tool_calls_for_history.append({
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "arguments": raw_args
                        }
                    })

                    # 通知前端：开始调用工具
                    yield json.dumps({
                        "type": "tool_call",
                        "id": call_id,
                        "name": tool_name,
                        "args": parsed_args
                    }, ensure_ascii=False)

                    # 100% 本地执行确定性工具
                    tool_result = execute_local_tool(tool_name, parsed_args)

                    # 通知前端：工具执行完成与结果
                    yield json.dumps({
                        "type": "tool_result",
                        "id": call_id,
                        "name": tool_name,
                        "result": tool_result
                    }, ensure_ascii=False)

                # 将 Assistant 的 tool_calls 与每个 Tool 的 Observation 追加到对话历史
                messages.append({
                    "role": "assistant",
                    "content": accumulated_content or None,
                    "tool_calls": tool_calls_for_history
                })

                for tc in tool_calls_for_history:
                    c_id = tc["id"]
                    t_name = tc["function"]["name"]
                    raw_a = tc["function"]["arguments"]
                    try:
                        p_a = json.loads(raw_a) if raw_a.strip() else {}
                    except Exception:
                        p_a = {}
                    res_obs = execute_local_tool(t_name, p_a)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": c_id,
                        "name": t_name,
                        "content": json.dumps(res_obs, ensure_ascii=False)
                    })

                # 继续下一轮 ReAct 思考与综合
                continue

            else:
                # 没有工具调用，说明 LLM 已完成思考并输出了最终战术报告
                break

    # 循环结束，发送完成事件
    yield json.dumps({
        "type": "done"
    }, ensure_ascii=False)
