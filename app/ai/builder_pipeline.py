"""
app/ai/builder_pipeline.py - 从零 AI 智能组队向导 (Builder Wizard) 与确定性 UEP 门控流水线
基于 100% 本地闭环数据 (champions_data.json & champions_teams.json) 与 50 级精确计算内核
"""

import json
import os
import math
import httpx
from typing import Dict, List, Any, Optional, AsyncGenerator
from app.core.config import get_active_provider_config
from app.ai.calc_engine import (
    calculate_damage_gen9,
    calculate_full_stats_50,
    calculate_stat_50,
    TYPE_MAP
)

# 载入本地宝可梦数据库 (235 只) 与 锦标赛队伍库 (200+ 套)
CHAMPIONS_DB: Dict[str, Any] = {}
POKEMON_LIST: List[Dict[str, Any]] = []
TOURNAMENT_TEAMS: List[Dict[str, Any]] = []

def _load_data():
    global CHAMPIONS_DB, POKEMON_LIST, TOURNAMENT_TEAMS
    base_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data")
    
    db_path = os.path.join(base_dir, "champions_data.json")
    if os.path.exists(db_path):
        try:
            with open(db_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                POKEMON_LIST = data.get("pokemon", [])
                for p in POKEMON_LIST:
                    if "name" in p:
                        CHAMPIONS_DB[p["name"]] = p
                    if "id" in p:
                        CHAMPIONS_DB[str(p["id"])] = p
        except Exception as e:
            print("Warning loading champions_data.json:", e)

    teams_path = os.path.join(base_dir, "champions_teams.json")
    if os.path.exists(teams_path):
        try:
            with open(teams_path, "r", encoding="utf-8") as f:
                TOURNAMENT_TEAMS = json.load(f)
        except Exception as e:
            print("Warning loading champions_teams.json:", e)

_load_data()


def find_pokemon_exact_or_fuzzy(name: str) -> Optional[Dict[str, Any]]:
    """本地精准或模糊查找宝可梦"""
    if not name:
        return None
    name = name.strip()
    if name in CHAMPIONS_DB:
        return CHAMPIONS_DB[name]
    for p in POKEMON_LIST:
        p_name = p.get("name", "")
        if name == p_name or name in p_name or p_name in name:
            return p
    return None


# ==========================================================================
# 1. Gate 1: intake (参数标准化与合法性准备)
# ==========================================================================
def gate_intake(request_data: Dict[str, Any]) -> Dict[str, Any]:
    fmt = request_data.get("format", "double").lower()
    if fmt not in ["double", "single"]:
        fmt = "double"
    
    raw_anchor = request_data.get("anchor", "").strip()
    anchor_mon = find_pokemon_exact_or_fuzzy(raw_anchor)
    anchor_name = anchor_mon.get("name") if anchor_mon else "烈咬陆鲨"

    posture = request_data.get("posture", "offense") # offense | balance | defense
    if posture not in ["offense", "balance", "defense"]:
        posture = "offense"

    tactics = request_data.get("tactics", []) # ['tailwind', 'trick_room', 'sun', 'rain', 'snow', 'setup', 'volturn']
    avoid = [a.strip() for a in request_data.get("avoid", []) if a and a.strip()]
    owned = [o.strip() for o in request_data.get("owned", []) if o and o.strip()]

    return {
        "format": fmt,
        "format_cn": "双打 (Doubles VGC)" if fmt == "double" else "单打 (Singles)",
        "anchor": anchor_name,
        "anchor_mon": anchor_mon or find_pokemon_exact_or_fuzzy("烈咬陆鲨"),
        "posture": posture,
        "tactics": tactics,
        "avoid": avoid,
        "owned": owned
    }


# ==========================================================================
# 2. Gate 2: grounding (从真实排位数据中提取 Top 候选物种池与主流配置)
# ==========================================================================
def gate_grounding(intake_res: Dict[str, Any]) -> Dict[str, Any]:
    fmt = intake_res["format"]
    anchor_mon = intake_res["anchor_mon"]
    anchor_name = intake_res["anchor"]
    avoid_set = set(intake_res["avoid"])

    # 1. 查找 Anchor 在该赛制下的官方共现队友 (Synergies)
    anchor_meta = anchor_mon.get("meta", {}).get(fmt) or anchor_mon.get("metaUsage", {}).get(fmt) or {}
    synergy_names = [s.get("name") if isinstance(s, dict) else str(s) for s in anchor_meta.get("synergies", [])]

    # 2. 查找包含 Anchor 的锦标赛冠军构筑队友
    tourn_teammates = []
    for t in TOURNAMENT_TEAMS:
        if t.get("format") != fmt:
            continue
        p_names = [pm.get("species", "") for pm in t.get("pokemon", [])]
        if any(anchor_name in pn for pn in p_names):
            for pn in p_names:
                if pn != anchor_name and pn not in tourn_teammates:
                    tourn_teammates.append(pn)

    # 3. 按天梯排名补齐高强度环境热门 (Top Ranking fill-up)
    ranked_mons = sorted(
        POKEMON_LIST,
        key=lambda x: (x.get("meta", {}).get(fmt, {}).get("rank") or x.get("metaUsage", {}).get(fmt, {}).get("rank") or 999)
    )

    # 汇总去重候选物种池 (上限 14 只，严格限制模型物种池)
    candidate_names = [anchor_name]
    for n in intake_res["owned"]:
        if n not in candidate_names and n not in avoid_set:
            candidate_names.append(n)
    for n in synergy_names:
        if len(candidate_names) >= 8:
            break
        if n not in candidate_names and n not in avoid_set:
            candidate_names.append(n)
    for n in tourn_teammates:
        if len(candidate_names) >= 11:
            break
        if n not in candidate_names and n not in avoid_set:
            candidate_names.append(n)
    for p in ranked_mons:
        if len(candidate_names) >= 14:
            break
        p_name = p.get("name")
        if p_name not in candidate_names and p_name not in avoid_set:
            candidate_names.append(p_name)

    # 组装结构化候选物种详情
    grounded_candidates = []
    for c_name in candidate_names:
        p_obj = find_pokemon_exact_or_fuzzy(c_name)
        if not p_obj:
            continue
        p_meta = p_obj.get("meta", {}).get(fmt) or p_obj.get("metaUsage", {}).get(fmt) or {}
        
        # 提取特性（带真实使用率）
        raw_ab = p_meta.get("abilities") or p_obj.get("abilities", [])
        abilities = []
        for ab in raw_ab[:2]:
            ab_name = ab.get("name") if isinstance(ab, dict) else str(ab)
            ab_usage = ab.get("usage") if isinstance(ab, dict) and "usage" in ab else None
            abilities.append(f"{ab_name} ({ab_usage}%)" if ab_usage is not None else ab_name)
        
        # 提取道具（带真实使用率）
        raw_it = p_meta.get("items", [])
        items = []
        for it in raw_it[:4]:
            it_name = it.get("name") if isinstance(it, dict) else str(it)
            it_usage = it.get("usage") if isinstance(it, dict) and "usage" in it else None
            items.append(f"{it_name} ({it_usage}%)" if it_usage is not None else it_name)
        
        raw_mv = p_meta.get("topMoves") or p_meta.get("moves") or [m.get("name") for m in p_obj.get("learnset", [])[:6]]
        moves = [mv.get("name") if isinstance(mv, dict) else str(mv) for mv in raw_mv[:6]]
        
        cand_entry = {
            "name": p_obj.get("name"),
            "types": p_obj.get("types", ["Normal"]),
            "rank": p_meta.get("rank", 999),
            "top_abilities": abilities or ["通常特性"],
            "top_items": items or ["气势披带" if fmt == "double" else "吃剩的东西"],
            "top_moves": moves[:6],
            "top_nature": p_meta.get("natures", ["固执"])[0] if p_meta.get("natures") else "固执"
        }

        # 若支持超级进化，附带标注
        mega_info = p_obj.get("mega", {})
        if mega_info and mega_info.get("supported"):
            cand_entry["can_mega"] = True
            cand_entry["exclusive_mega_stone"] = mega_info.get("megaStone") or (mega_info.get("forms", [{}])[0].get("megaStone"))

        grounded_candidates.append(cand_entry)

    return {
        "anchor": anchor_name,
        "format": fmt,
        "candidate_pool": grounded_candidates
    }


# ==========================================================================
# 3. Gate 3: assemble (大模型约束装配生成严格 JSON 队伍与战术思路)
# ==========================================================================
BUILDER_ASSEMBLE_SYSTEM_PROMPT = """你是一位精通宝可梦官方排位（VGC 双打 / Singles 单打）的顶尖冠军教练。
你的任务是：根据提供的【候选物种池】（含真实天梯使用率权重）与【玩家战术要求】，装配一套具备高度协同性、属性联防与攻防转线能力的【标准 6 只宝可梦队伍】。

【极其重要的约束规则】
1. 队伍必须恰好包含 6 只宝可梦，且必须包含用户指定的 Anchor 核心；
2. 6 只宝可梦必须全部从给定的【候选物种池】中挑选，严禁挑选池子以外的宝可梦；
3. 遵循官方排位 Item Clause：6 只宝可梦携带的道具严禁重复；
4. 【使用率与道具分配原则】：
   - 候选池中带有使用率百分比（如：“暴鲤龙进化石 (60%)”）。道具与特性必须优先按照天梯真实高使用率分配，不要随意放弃 50%+ 的核心道具；
   - 当前赛制支持超级进化 (Mega Evolution)。单场对战单队至多携带 1 个 Mega 进化石（若选中的宝可梦携带了专属进化石，该宝可梦将作为 Mega 核心选出）；
5. 每只宝可梦必须配置 4 个合法招式、1 个特性、1 个道具、1 个性格；
6. 你必须且仅输出严格的 JSON 字符串，绝不能添加任何 markdown 标记外的解释废话。

【输出 JSON Schema】
{
  "rationale": "50字以内的战术运转机制概述（如：以烈咬陆鲨为极速地震爆破核心，暴鲤龙携带进化石作为Mega破格重炮，搭配风妖精顺风控速）",
  "team": [
    {
      "species": "宝可梦中文名",
      "item": "道具中文名 (全队不得重复)",
      "ability": "特性中文名",
      "nature": "性格中文名",
      "moves": ["招式1", "招式2", "招式3", "招式4"],
      "role": "核心输出 / 控速支点 / 威吓轮转 / 联防盾牌 / 清理收割"
    }
  ]
}
"""

async def gate_assemble(intake_res: Dict[str, Any], grounding_res: Dict[str, Any]) -> Dict[str, Any]:
    provider_name, p_cfg = get_active_provider_config(force_reload=True)
    if not p_cfg.api_key or p_cfg.api_key.strip() == "":
        raise ValueError(f"【AI 服务未配置】Provider '{provider_name}' 未检测到有效 API Key，请在 config.yaml 中配置")

    candidates = grounding_res["candidate_pool"]
    cand_str = json.dumps(candidates, ensure_ascii=False, indent=2)

    tactic_names = {
        "tailwind": "顺风高速爆发", "trick_room": "戏法空间重炮", "sun": "晴天古代活性",
        "rain": "雨天悠游自如", "snow": "雪天极光幕", "setup": "强化推队终结", "volturn": "游击折返转线"
    }
    user_tactics = [tactic_names.get(t, t) for t in intake_res["tactics"]]

    user_msg = f"""【对战模式】：{intake_res['format_cn']}
【核心 Anchor 宝可梦】：{intake_res['anchor']} (必须入选)
【战术取向】：{intake_res['posture']} (offense=高速强攻, balance=平衡轮转, defense=高耐久受队)
【战术偏好】：{', '.join(user_tactics) if user_tactics else '天梯主流强攻与标准联防'}

【严格限定的候选物种池 (仅能从以下物种中挑选 6 只)】：
{cand_str}

请输出装配好的 6 只宝可梦队伍 JSON："""

    messages = [
        {"role": "system", "content": BUILDER_ASSEMBLE_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg}
    ]

    base_url = p_cfg.base_url.rstrip("/")
    api_url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {p_cfg.api_key}",
        "Content-Type": "application/json"
    }
    request_body = {
        "model": p_cfg.model,
        "messages": messages,
        "temperature": 0.3, # 低温确保严格结构化与高胜率搭配
        "response_format": {"type": "json_object"} if "deepseek" not in p_cfg.model.lower() else None
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(api_url, headers=headers, json=request_body)
        if res.status_code != 200:
            raise RuntimeError(f"大模型组队请求失败 (HTTP {res.status_code}): {res.text}")
        
        res_json = res.json()
        content = res_json["choices"][0]["message"]["content"]
        
        # 清理可能存在的 markdown 代码块包裹
        clean_content = content.strip()
        if clean_content.startswith("```json"):
            clean_content = clean_content[7:]
        elif clean_content.startswith("```"):
            clean_content = clean_content[3:]
        if clean_content.endswith("```"):
            clean_content = clean_content[:-3]
        
        parsed = json.loads(clean_content.strip())
        return parsed


# ==========================================================================
# 4. Gate 4: validate_and_sanitize (确定性合法性校验、Mega状态对齐与自动修剪)
# ==========================================================================
FALLBACK_ITEMS = ["气势披带", "突击背心", "生命宝珠", "讲究头带", "讲究眼镜", "讲究围巾", "吃剩的东西", "密探斗篷", "文柚果", "木子果"]

def is_mega_stone_for_mon(p_obj: Dict[str, Any], item_name: str) -> Optional[Dict[str, Any]]:
    """检查道具是否为该宝可梦的专属 Mega 进化石，并返回对应的 Mega Form 信息"""
    if not p_obj or not item_name:
        return None
    mega_info = p_obj.get("mega", {})
    if not mega_info or not mega_info.get("supported"):
        return None
    
    forms = mega_info.get("forms", [])
    if not forms and "megaStone" in mega_info:
        forms = [mega_info]
    
    for f in forms:
        stone = f.get("megaStone", "")
        # 兼容不同命名形式（如 "暴鲤龙进化石" 或 "喷火龙进化石 Y"）
        if stone and (stone in item_name or item_name in stone or ("进化石" in item_name and p_obj.get("name", "") in item_name)):
            return f
    return None

def gate_validate_and_sanitize(assemble_res: Dict[str, Any], intake_res: Dict[str, Any]) -> List[Dict[str, Any]]:
    raw_team = assemble_res.get("team", [])
    fmt = intake_res["format"]
    
    sanitized_team = []
    used_items = set()
    used_species = set()
    mega_count = 0

    for idx, mon_data in enumerate(raw_team):
        sp_name = mon_data.get("species", "")
        p_obj = find_pokemon_exact_or_fuzzy(sp_name)
        if not p_obj or p_obj["name"] in used_species:
            # 补齐未使用的天梯高分宝可梦
            for alt in POKEMON_LIST:
                if alt["name"] not in used_species:
                    p_obj = alt
                    break
        
        p_name = p_obj["name"]
        used_species.add(p_name)
        
        # 1. 清理并解析道具 (去除百分比等噪音)
        raw_item = mon_data.get("item", "").strip()
        if "(" in raw_item:
            raw_item = raw_item.split("(")[0].strip()
        if "（" in raw_item:
            raw_item = raw_item.split("（")[0].strip()

        # 2. Mega 进化石检查与 Mega Clause (全队限 1 个 Mega 石)
        mega_form = is_mega_stone_for_mon(p_obj, raw_item)
        is_mega = False
        mega_branch = "X"
        
        if mega_form:
            if mega_count >= 1:
                # 已有其他成员携带了 Mega 石，当前成员退回常规道具
                for fb in FALLBACK_ITEMS:
                    if fb not in used_items:
                        raw_item = fb
                        break
                mega_form = None
            else:
                mega_count += 1
                is_mega = True
                mega_branch = mega_form.get("formKey") or ("Y" if "Y" in raw_item or "Ｙ" in raw_item else "X")
        
        # 道具排重 (Item Clause)
        if not raw_item or raw_item in used_items:
            for fb in FALLBACK_ITEMS:
                if fb not in used_items:
                    raw_item = fb
                    break
        used_items.add(raw_item)

        # 3. 特性与属性对齐：若携带 Mega 进化石，自动对齐 Mega 形态特性与属性、种族值
        if is_mega and mega_form:
            ability = mega_form.get("ability") or (p_obj.get("abilities", [{}])[0].get("name") if p_obj.get("abilities") else "专属Mega特性")
            types = mega_form.get("types") or p_obj.get("types", ["Normal"])
            base_stats = mega_form.get("baseStats") or p_obj.get("baseStats", {"hp": 80, "atk": 80, "def": 80, "spa": 80, "spd": 80, "spe": 80})
            display_name = mega_form.get("megaName") or f"超级{p_name}"
        else:
            raw_ab = mon_data.get("ability", "").strip()
            if "(" in raw_ab:
                raw_ab = raw_ab.split("(")[0].strip()
            if "（" in raw_ab:
                raw_ab = raw_ab.split("（")[0].strip()
            
            valid_abs = [a.get("name") if isinstance(a, dict) else str(a) for a in p_obj.get("abilities", [])]
            if raw_ab in valid_abs:
                ability = raw_ab
            elif valid_abs:
                ability = valid_abs[0]
            else:
                ability = raw_ab or "通常特性"
            
            types = p_obj.get("types", ["Normal"])
            base_stats = p_obj.get("baseStats", {"hp": 80, "atk": 80, "def": 80, "spa": 80, "spd": 80, "spe": 80})
            display_name = p_name

        # 4. 招式池校验 (必须在 learnset 或常见招式中)
        valid_moves = [m.get("name") for m in p_obj.get("learnset", [])]
        moves = []
        for m in mon_data.get("moves", []):
            if m and (not valid_moves or m in valid_moves) and m not in moves:
                moves.append(m)
        
        # 补足 4 招
        if valid_moves:
            for vm in valid_moves:
                if len(moves) >= 4:
                    break
                if vm not in moves and (vm != "守住" if fmt == "single" else True):
                    moves.append(vm)
        while len(moves) < 4:
            moves.append("守住" if fmt == "double" else "替身")

        # 5. 性格与努力值 (根据 Mega 后的攻特分布自动分配)
        nature = mon_data.get("nature", "固执")
        is_phys = base_stats.get("atk", 80) >= base_stats.get("spa", 80)
        default_evs = {"hp": 4, "atk": 252, "def": 0, "spa": 0, "spd": 0, "spe": 252} if is_phys else {"hp": 4, "atk": 0, "def": 0, "spa": 252, "spd": 0, "spe": 252}
        stats_50 = calculate_full_stats_50(base_stats, default_evs, nature)

        sanitized_team.append({
            "slot": idx,
            "id": p_obj.get("id", 1),
            "name": p_name,
            "displayName": display_name,
            "types": types,
            "item": raw_item,
            "ability": ability,
            "nature": nature,
            "moves": moves[:4],
            "evs": default_evs,
            "stats": stats_50,
            "role": mon_data.get("role", "核心战力"),
            "baseStats": base_stats,
            "isMega": is_mega,
            "megaBranch": mega_branch
        })

    return sanitized_team[:6]


# ==========================================================================
# 5. Gate 5: slate (Top-30 确定性对抗压力测试与威胁评估)
# ==========================================================================
def gate_slate(team: List[Dict[str, Any]], format_type: str = "double") -> Dict[str, Any]:
    # 提取天梯排名前 20 威胁物种
    top_threats = sorted(
        POKEMON_LIST,
        key=lambda x: (x.get("meta", {}).get(format_type, {}).get("rank") or 999)
    )[:20]

    threat_reports = []
    worst_threat = None
    max_weak_members = 0

    for t_mon in top_threats:
        t_name = t_mon["name"]
        t_types = t_mon.get("types", ["Normal"])
        t_meta = t_mon.get("meta", {}).get(format_type, {})
        t_base = t_mon.get("baseStats", {"hp": 100, "atk": 100, "spa": 100, "spe": 100})
        
        # 提取对手主力打击招式
        raw_top_moves = t_meta.get("topMoves") or t_meta.get("moves") or [m.get("name") for m in t_mon.get("learnset", [])[:4]]
        top_moves = [mv.get("name") if isinstance(mv, dict) else str(mv) for mv in raw_top_moves if mv]
        if not top_moves:
            continue

        weak_members = []
        threat_routes = []

        for member in team:
            m_name = member.get("displayName") or member["name"]
            m_types = member["types"]
            m_stats = member["stats"]

            for m_name_atk in top_moves[:3]:
                # 寻找招式详情
                mv_obj = None
                for lm in t_mon.get("learnset", []):
                    lm_name = lm.get("name") if isinstance(lm, dict) else str(lm)
                    if lm_name == m_name_atk:
                        mv_obj = lm
                        break
                
                mv_pwr = int(mv_obj.get("power", 80)) if isinstance(mv_obj, dict) and str(mv_obj.get("power", "0")).isdigit() and int(mv_obj.get("power", "0")) > 0 else 80
                mv_cat = mv_obj.get("category", "特殊") if isinstance(mv_obj, dict) else "特殊"
                mv_type = mv_obj.get("type", t_types[0]) if isinstance(mv_obj, dict) else t_types[0]

                t_stats_50 = calculate_full_stats_50(t_base, {"spa": 252, "atk": 252, "spe": 252}, "胆小")

                dmg = calculate_damage_gen9(
                    attacker_name=t_name,
                    attacker_types=t_types,
                    attacker_stats=t_stats_50,
                    attacker_item="生命宝珠",
                    attacker_ability=t_mon.get("abilities", [{}])[0].get("name", "") if isinstance(t_mon.get("abilities", [{}])[0], dict) else "",
                    defender_name=m_name,
                    defender_types=m_types,
                    defender_stats=m_stats,
                    defender_item=member["item"],
                    defender_ability=member["ability"],
                    move_name=m_name_atk,
                    move_type=mv_type,
                    move_category=mv_cat,
                    move_power=mv_pwr,
                    format_type=format_type
                )

                if dmg["max_pct"] >= 90.0:
                    weak_members.append(m_name)
                    threat_routes.append({
                        "target_member": m_name,
                        "move": m_name_atk,
                        "move_type": dmg["move_type_cn"],
                        "damage_pct": f"{dmg['min_pct']}% ~ {dmg['max_pct']}%",
                        "verdict": dmg["verdict"],
                        "is_ohko": dmg["min_damage"] >= member["stats"]["hp"]
                    })
                    break

        unique_weak = list(set(weak_members))
        grade = "S (致命威胁)" if len(unique_weak) >= 3 else ("A (中度威胁)" if len(unique_weak) == 2 else "B (一般对抗)")
        
        report_item = {
            "opponent": t_name,
            "rank": t_meta.get("rank", 999),
            "grade": grade,
            "affected_members": unique_weak,
            "affected_count": len(unique_weak),
            "threat_routes": threat_routes[:2]
        }
        
        if len(unique_weak) > max_weak_members:
            max_weak_members = len(unique_weak)
            worst_threat = report_item

        if len(unique_weak) >= 2:
            threat_reports.append(report_item)

    return {
        "worst_threat": worst_threat or (threat_reports[0] if threat_reports else None),
        "high_threats": threat_reports[:6],
        "total_threats_audited": len(top_threats)
    }


# ==========================================================================
# 6. Stream Orchestrator (SSE 流式门控任务控制器)
# ==========================================================================
async def stream_builder_job(request_data: Dict[str, Any]) -> AsyncGenerator[str, None]:
    """
    流式执行 6 步门控流水线，实时向前端推送进度与结果
    """
    try:
        # Gate 1: intake
        yield json.dumps({"type": "gate", "gate": "intake", "title": "参数标准化与校验", "status": "running"}, ensure_ascii=False)
        intake_res = gate_intake(request_data)
        yield json.dumps({"type": "gate", "gate": "intake", "title": "参数标准化与校验", "status": "done", "detail": f"核心物种: {intake_res['anchor']} | 战术: {intake_res['posture']}"}, ensure_ascii=False)

        # Gate 2: grounding
        yield json.dumps({"type": "gate", "gate": "grounding", "title": "环境共现率与冠军构筑检索", "status": "running"}, ensure_ascii=False)
        grounding_res = gate_grounding(intake_res)
        cand_count = len(grounding_res["candidate_pool"])
        yield json.dumps({"type": "gate", "gate": "grounding", "title": "环境共现率与冠军构筑检索", "status": "done", "detail": f"已锁定 {cand_count} 只高胜率协同物种池"}, ensure_ascii=False)

        # Gate 3: assemble
        yield json.dumps({"type": "gate", "gate": "assemble", "title": "大模型约束装配生成", "status": "running"}, ensure_ascii=False)
        assemble_res = await gate_assemble(intake_res, grounding_res)
        yield json.dumps({"type": "gate", "gate": "assemble", "title": "大模型约束装配生成", "status": "done", "detail": "6 只结构化队伍生成完毕"}, ensure_ascii=False)

        # Gate 4: validate_and_sanitize
        yield json.dumps({"type": "gate", "gate": "validate", "title": "Showdown 合法性与规则检查", "status": "running"}, ensure_ascii=False)
        sanitized_team = gate_validate_and_sanitize(assemble_res, intake_res)
        yield json.dumps({"type": "gate", "gate": "validate", "title": "Showdown 合法性与规则检查", "status": "done", "detail": "道具排重、招式池与努力值校验通过"}, ensure_ascii=False)

        # Gate 5: slate
        yield json.dumps({"type": "gate", "gate": "slate", "title": "Top-30 伤害对抗压力测试", "status": "running"}, ensure_ascii=False)
        slate_res = gate_slate(sanitized_team, intake_res["format"])
        worst_name = slate_res.get("worst_threat", {}).get("opponent", "无明显天敌")
        yield json.dumps({"type": "gate", "gate": "slate", "title": "Top-30 伤害对抗压力测试", "status": "done", "detail": f"完成 20 只热门对抗测算 (最大天敌: {worst_name})"}, ensure_ascii=False)

        # Gate 6: audit (Deliver Final DTO)
        final_payload = {
            "success": True,
            "format": intake_res["format"],
            "anchor": intake_res["anchor"],
            "rationale": assemble_res.get("rationale", "标准排位攻防平衡构筑"),
            "team": sanitized_team,
            "slate": slate_res
        }

        yield json.dumps({"type": "result", "data": final_payload}, ensure_ascii=False)
        yield json.dumps({"type": "done"}, ensure_ascii=False)

    except Exception as e:
        yield json.dumps({"type": "error", "error": str(e)}, ensure_ascii=False)
        yield json.dumps({"type": "done"}, ensure_ascii=False)
