"""
app/ai/tools.py - 100% 本地闭环大模型 ReAct 战术推理工具集与 OpenAI Function Calling 规范
完全基于本地 data/champions_data.json 与 data/champions_teams.json，严禁外部网络请求
"""

import json
import os
from typing import Dict, List, Any, Optional
from app.ai.calc_engine import (
    calculate_damage_gen9,
    compare_speed_tiers,
    calculate_full_stats_50,
    calculate_stat_50,
    TYPE_MAP
)

# 1. 载入本地宝可梦全量数据库 (235 只)
CHAMPIONS_DB: Dict[str, Any] = {}
POKEMON_LIST: List[Dict[str, Any]] = []

def _load_local_data():
    global CHAMPIONS_DB, POKEMON_LIST
    db_path = os.path.join(os.path.dirname(__file__), "..", "..", "data", "champions_data.json")
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
                    if "slug" in p:
                        CHAMPIONS_DB[p["slug"]] = p
        except Exception as e:
            print("Warning loading champions_data.json in tools.py:", e)

_load_local_data()

# 2. 载入本地锦标赛冠亚军队伍库 (200+ 队伍)
TOURNAMENT_TEAMS: List[Dict[str, Any]] = []

def _load_local_teams():
    global TOURNAMENT_TEAMS
    teams_path = os.path.join(os.path.dirname(__file__), "..", "..", "data", "champions_teams.json")
    if os.path.exists(teams_path):
        try:
            with open(teams_path, "r", encoding="utf-8") as f:
                TOURNAMENT_TEAMS = json.load(f)
        except Exception as e:
            print("Warning loading champions_teams.json in tools.py:", e)

_load_local_teams()


def _find_pokemon(query: str) -> Optional[Dict[str, Any]]:
    """在本地库中精准或模糊匹配宝可梦"""
    if not query:
        return None
    query = query.strip()
    if query in CHAMPIONS_DB:
        return CHAMPIONS_DB[query]
    for p in POKEMON_LIST:
        p_name = p.get("name", "")
        if query == p_name or query in p_name or p_name in query:
            return p
    return None

def _find_move(pokemon: Optional[Dict[str, Any]], move_name: str) -> Optional[Dict[str, Any]]:
    """查找招式基本属性与威力"""
    if not move_name:
        return None
    move_name = move_name.strip()
    if pokemon and "learnset" in pokemon:
        for m in pokemon["learnset"]:
            if m.get("name") == move_name or move_name in m.get("name", ""):
                return m
    # 全局常见招式兜底字典 (覆盖常见环境招式威力)
    COMMON_MOVES = {
        "地震": {"name": "地震", "type": "Ground", "category": "物理", "power": 100},
        "热风": {"name": "热风", "type": "Fire", "category": "特殊", "power": 95},
        "魔法闪耀": {"name": "魔法闪耀", "type": "Fairy", "category": "特殊", "power": 80},
        "暗影球": {"name": "暗影球", "type": "Ghost", "category": "特殊", "power": 80},
        "月亮之力": {"name": "月亮之力", "type": "Fairy", "category": "特殊", "power": 95},
        "近身战": {"name": "近身战", "type": "Fighting", "category": "物理", "power": 120},
        "淘金潮": {"name": "淘金潮", "type": "Steel", "category": "特殊", "power": 120},
        "十万伏特": {"name": "十万伏特", "type": "Electric", "category": "特殊", "power": 90},
        "冰冻梁": {"name": "冰冻梁", "type": "Ice", "category": "特殊", "power": 90},
        "水流连打": {"name": "水流连打", "type": "Water", "category": "物理", "power": 75},
        "暗冥强击": {"name": "暗冥强击", "type": "Dark", "category": "物理", "power": 75},
        "突袭": {"name": "突袭", "type": "Dark", "category": "物理", "power": 70},
        "闪焰冲锋": {"name": "闪焰冲锋", "type": "Fire", "category": "物理", "power": 120},
        "击掌奇袭": {"name": "击掌奇袭", "type": "Normal", "category": "物理", "power": 40},
        "急速折返": {"name": "急速折返", "type": "Bug", "category": "物理", "power": 70},
        "伏特替换": {"name": "伏特替换", "type": "Electric", "category": "特殊", "power": 70},
        "龙爪": {"name": "龙爪", "type": "Dragon", "category": "物理", "power": 80},
        "毒击": {"name": "毒击", "type": "Poison", "category": "物理", "power": 80},
        "水炮": {"name": "水炮", "type": "Water", "category": "特殊", "power": 110},
        "守住": {"name": "守住", "type": "Normal", "category": "变化", "power": 0},
    }
    return COMMON_MOVES.get(move_name)


# ==========================================================================
# 4 大本地确定性工具函数实现
# ==========================================================================

def tool_query_pokemon_meta(pokemon_name: str, format: str = "double") -> Dict[str, Any]:
    """
    【本地工具 1】查询指定宝可梦在当前赛制下的官方排位使用率、推荐配置与环境生态
    """
    mon = _find_pokemon(pokemon_name)
    if not mon:
        return {
            "error": f"本地数据库中未找到宝可梦 '{pokemon_name}'",
            "available": False
        }

    fmt = format.lower() if format in ["double", "single"] else "double"
    meta = mon.get("meta", {}).get(fmt) or mon.get("metaUsage", {}).get(fmt) or {}
    base_stats = mon.get("baseStats", {})
    std_stats = calculate_full_stats_50(base_stats, {"hp": 4, "atk": 252, "spe": 252}, "固执")

    return {
        "name": mon.get("name"),
        "id": mon.get("id"),
        "types": mon.get("types", []),
        "types_cn": [TYPE_MAP.get(t, t) for t in mon.get("types", [])],
        "format": "双打 (Doubles)" if fmt == "double" else "单打 (Singles)",
        "meta_rank": meta.get("rank", 999),
        "base_stats": base_stats,
        "standard_50_stats": std_stats,
        "top_abilities": meta.get("abilities", mon.get("abilities", []))[:3],
        "top_items": meta.get("items", [])[:5],
        "top_moves": meta.get("topMoves", meta.get("moves", []))[:8],
        "top_natures": meta.get("natures", [])[:3],
        "top_ev_spreads": meta.get("evSpreads", [])[:3],
        "top_teammates": meta.get("synergies", [])[:5],
        "top_counters": meta.get("counters", [])[:5]
    }

def tool_query_matchup_damage(
    attacker: str,
    defender: str,
    move: str,
    attacker_item: str = "",
    attacker_ability: str = "",
    defender_item: str = "",
    defender_ability: str = "",
    format: str = "double",
    weather: str = "none",
    terrain: str = "none"
) -> Dict[str, Any]:
    """
    【本地工具 2】精确计算第 9 世代 50 级对战伤害、斩杀线与乱数击杀几率
    """
    mon_atk = _find_pokemon(attacker)
    mon_def = _find_pokemon(defender)

    if not mon_atk:
        return {"error": f"未找到攻击方宝可梦: '{attacker}'"}
    if not mon_def:
        return {"error": f"未找到防守方宝可梦: '{defender}'"}

    move_data = _find_move(mon_atk, move)
    if not move_data:
        return {"error": f"未找到招式 '{move}' 的基础威力数据"}

    # 提取或推算攻防方 50 级实数
    atk_base = mon_atk.get("baseStats", {"atk": 100, "spa": 100, "spe": 100})
    def_base = mon_def.get("baseStats", {"hp": 100, "def": 100, "spd": 100})

    # 优先根据物特匹配努力值
    is_phys = (move_data.get("category") in ["物理", "Physical"])
    atk_evs = {"atk": 252, "spe": 252} if is_phys else {"spa": 252, "spe": 252}
    def_evs = {"hp": 252, "def": 4, "spd": 4}

    atk_stats = calculate_full_stats_50(atk_base, atk_evs, "固执" if is_phys else "内敛")
    def_stats = calculate_full_stats_50(def_base, def_evs, "爽朗")

    # 提取默认特性/道具
    if not attacker_ability:
        raw_ab = mon_atk.get("abilities", [""])
        attacker_ability = raw_ab[0].get("name") if isinstance(raw_ab[0], dict) else str(raw_ab[0])
    if not defender_ability:
        raw_def_ab = mon_def.get("abilities", [""])
        defender_ability = raw_def_ab[0].get("name") if isinstance(raw_def_ab[0], dict) else str(raw_def_ab[0])

    power = int(move_data.get("power", 80) if str(move_data.get("power", "80")).isdigit() else 80)

    dmg_result = calculate_damage_gen9(
        attacker_name=mon_atk.get("name", attacker),
        attacker_types=mon_atk.get("types", ["Normal"]),
        attacker_stats=atk_stats,
        attacker_item=attacker_item,
        attacker_ability=attacker_ability,
        defender_name=mon_def.get("name", defender),
        defender_types=mon_def.get("types", ["Normal"]),
        defender_stats=def_stats,
        defender_item=defender_item,
        defender_ability=defender_ability,
        move_name=move_data.get("name", move),
        move_type=move_data.get("type", "Normal"),
        move_category=move_data.get("category", "物理"),
        move_power=power,
        format_type=format,
        weather=weather,
        terrain=terrain
    )

    return {
        "attacker": mon_atk.get("name"),
        "defender": mon_def.get("name"),
        "move": move_data.get("name"),
        "move_power": power,
        "format": format,
        "damage_result": dmg_result
    }

def tool_search_tournament_teams(
    pokemon_names: List[str],
    format: str = "double",
    limit: int = 4
) -> Dict[str, Any]:
    """
    【本地工具 3】在本地 200+ 锦标赛冠亚军队伍库中检索包含指定宝可梦的冠军构筑
    """
    if not TOURNAMENT_TEAMS:
        return {"matched_count": 0, "teams": [], "message": "本地暂无锦标赛队伍缓存"}

    fmt = format.lower() if format in ["double", "single"] else "double"
    matched = []

    # 规范化搜索词
    search_terms = [p.strip() for p in pokemon_names if p and p.strip()]

    for team in TOURNAMENT_TEAMS:
        team_fmt = team.get("format", "double").lower()
        if team_fmt != fmt:
            continue

        team_mons = team.get("pokemon", [])
        mon_names = [m.get("species", "") for m in team_mons]

        # 计算匹配宝可梦交集
        overlap = [p for p in search_terms if any(p in mn or mn in p for mn in mon_names)]
        if overlap:
            matched.append({
                "team_id": team.get("id"),
                "tournament": team.get("tournamentName"),
                "placing": team.get("placingTag", f"第 {team.get('placing')} 名"),
                "player": team.get("player"),
                "matched_members": overlap,
                "overlap_count": len(overlap),
                "full_roster": [
                    {
                        "species": m.get("species"),
                        "item": m.get("item"),
                        "ability": m.get("ability"),
                        "moves": [mv.get("name") if isinstance(mv, dict) else str(mv) for mv in m.get("moves", [])]
                    } for m in team_mons
                ]
            })

    # 按匹配宝可梦数量与锦标赛名次排序
    matched.sort(key=lambda x: x["overlap_count"], reverse=True)
    results = matched[:limit]

    return {
        "matched_count": len(matched),
        "returned_teams": results,
        "searched_pokemon": search_terms,
        "format": fmt
    }

def tool_query_speed_comparison(
    pokemon_list: List[str],
    conditions: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    【本地工具 4】对比多只宝可梦在常态/围巾/顺风/空间/麻痹下的精确 50 级速度线与先手顺序
    """
    cond = conditions or {}
    entries = []

    for name in pokemon_list:
        mon = _find_pokemon(name)
        if not mon:
            continue

        base_spe = mon.get("baseStats", {}).get("spe", 80)
        entries.append({
            "name": mon.get("name"),
            "base_spe": base_spe,
            "ev_spe": 252,
            "nature": "爽朗" if base_spe >= 90 else "固执",
            "item": cond.get(f"{name}_item", ""),
            "ability": mon.get("abilities", [{}])[0].get("name") if isinstance(mon.get("abilities", [{}])[0], dict) else "",
            "speed_stage": cond.get(f"{name}_stage", 0),
            "tailwind": cond.get("tailwind", False),
            "paralyzed": cond.get(f"{name}_paralyzed", False)
        })

    if not entries:
        return {"error": "未能在本地找到指定的宝可梦进行速度对比"}

    ranking = compare_speed_tiers(entries, cond)
    return {
        "environment": {
            "trick_room": cond.get("trick_room", False),
            "tailwind": cond.get("tailwind", False)
        },
        "speed_ladder": ranking
    }


# ==========================================================================
# OpenAI 标准 Tools Schema 声明
# ==========================================================================

OPENAI_TOOLS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "query_pokemon_meta",
            "description": "查询本地官方排位数据库中指定宝可梦的天梯使用率排名、推荐特性、主流道具、最高胜率招式、努力值分配及官方推荐队友/克制威胁列表。",
            "parameters": {
                "type": "object",
                "properties": {
                    "pokemon_name": {
                        "type": "string",
                        "description": "宝可梦中文名称，如 '烈咬陆鲨'、'振翼发'、'仆斩将军'、'炽焰咆哮虎'。"
                    },
                    "format": {
                        "type": "string",
                        "enum": ["double", "single"],
                        "description": "对战模式：'double'（双打）或 'single'（单打），默认 'double'。"
                    }
                },
                "required": ["pokemon_name"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_matchup_damage",
            "description": "调用本地 50 级精确伤害计算器，计算攻击方使用特定招式对防守方造成的伤害范围 (16级乱数)、百分比区间与确一 (OHKO) / 确二 (2HKO) 击杀几率。",
            "parameters": {
                "type": "object",
                "properties": {
                    "attacker": {
                        "type": "string",
                        "description": "攻击方宝可梦中文名称，如 '烈咬陆鲨'。"
                    },
                    "defender": {
                        "type": "string",
                        "description": "防守方宝可梦中文名称，如 '振翼发'。"
                    },
                    "move": {
                        "type": "string",
                        "description": "攻击方使用的招式中文名称，如 '地震'、'毒击'、'暗影球'。"
                    },
                    "attacker_item": {
                        "type": "string",
                        "description": "攻击方携带的道具 (可选，如 '讲究头带'、'生命宝珠'、'气势披带')。"
                    },
                    "defender_item": {
                        "type": "string",
                        "description": "防守方携带的道具 (可选，如 '突击背心'、'气势披带')。"
                    },
                    "format": {
                        "type": "string",
                        "enum": ["double", "single"],
                        "description": "对战模式，双打下分散群攻招式会自动按 0.75x 削减伤害。"
                    },
                    "weather": {
                        "type": "string",
                        "enum": ["none", "sun", "rain", "sand", "snow"],
                        "description": "天气环境 (可选，晴天火系1.5x/水系0.5x，雨天水系1.5x/火系0.5x)。"
                    }
                },
                "required": ["attacker", "defender", "move"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_tournament_teams",
            "description": "在本地 200+ 锦标赛冠亚军真实构筑库中检索包含指定宝可梦的冠军队伍，返回队友搭配、配招与实战体系。",
            "parameters": {
                "type": "object",
                "properties": {
                    "pokemon_names": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "要检索的宝可梦名称数组，如 ['炽焰咆哮虎', '振翼发']。"
                    },
                    "format": {
                        "type": "string",
                        "enum": ["double", "single"],
                        "description": "赛制模式：'double' 或 'single'。"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "返回最多几套冠军阵容 (默认 3)。"
                    }
                },
                "required": ["pokemon_names"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "query_speed_comparison",
            "description": "计算并对比一组宝可梦在 50 级标准实数下的先手速度阶梯，支持顺风 (2x)、戏法空间、讲究围巾 (1.5x) 或麻痹 (0.5x) 环境推演。",
            "parameters": {
                "type": "object",
                "properties": {
                    "pokemon_list": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "需要对比速度的宝可梦中文名称列表，如 ['多龙巴鲁托', '振翼发', '铁包袱', '烈咬陆鲨']。"
                    },
                    "conditions": {
                        "type": "object",
                        "properties": {
                            "tailwind": {"type": "boolean", "description": "是否处于顺风状态 (速度 2x)"},
                            "trick_room": {"type": "boolean", "description": "是否处于戏法空间 (低速先出手)"}
                        },
                        "description": "全局环境修正"
                    }
                },
                "required": ["pokemon_list"]
            }
        }
    }
]

def execute_local_tool(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """本地工具调用分发器 (100% 离线确定性安全执行)"""
    try:
        if name == "query_pokemon_meta":
            return tool_query_pokemon_meta(
                pokemon_name=arguments.get("pokemon_name", ""),
                format=arguments.get("format", "double")
            )
        elif name == "query_matchup_damage":
            return tool_query_matchup_damage(
                attacker=arguments.get("attacker", ""),
                defender=arguments.get("defender", ""),
                move=arguments.get("move", ""),
                attacker_item=arguments.get("attacker_item", ""),
                attacker_ability=arguments.get("attacker_ability", ""),
                defender_item=arguments.get("defender_item", ""),
                defender_ability=arguments.get("defender_ability", ""),
                format=arguments.get("format", "double"),
                weather=arguments.get("weather", "none"),
                terrain=arguments.get("terrain", "none")
            )
        elif name == "search_tournament_teams":
            return tool_search_tournament_teams(
                pokemon_names=arguments.get("pokemon_names", []),
                format=arguments.get("format", "double"),
                limit=arguments.get("limit", 4)
            )
        elif name == "query_speed_comparison":
            return tool_query_speed_comparison(
                pokemon_list=arguments.get("pokemon_list", []),
                conditions=arguments.get("conditions", {})
            )
        else:
            return {"error": f"未知工具名称: '{name}'"}
    except Exception as e:
        return {"error": f"工具 '{name}' 执行异常: {str(e)}"}
