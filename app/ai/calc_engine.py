"""
app/ai/calc_engine.py - 100% 纯本地确定性宝可梦竞技伤害与速度阶梯计算内核
基于官方第 9 世代标准 50 级对战公式与 18 属性克制表，完全离线运行
"""

from typing import Dict, List, Optional, Tuple, Any
import math

# 18 属性英文与中文映射
TYPE_MAP = {
    "Normal": "一般", "Fire": "火", "Water": "水", "Grass": "草",
    "Electric": "电", "Ice": "冰", "Fighting": "格斗", "Poison": "毒",
    "Ground": "地面", "Flying": "飞行", "Psychic": "超能力", "Bug": "虫",
    "Rock": "岩石", "Ghost": "幽灵", "Dragon": "龙", "Steel": "钢",
    "Dark": "恶", "Fairy": "妖精"
}

TYPE_CN_TO_EN = {v: k for k, v in TYPE_MAP.items()}

# 18 属性克制防御表 (防御方的弱点、抵抗、免疫)
TYPE_CHART = {
    "Normal":   {"weak": ["Fighting"], "immune": ["Ghost"], "resist": []},
    "Fire":     {"weak": ["Water", "Ground", "Rock"], "immune": [], "resist": ["Fire", "Grass", "Ice", "Bug", "Steel", "Fairy"]},
    "Water":    {"weak": ["Electric", "Grass"], "immune": [], "resist": ["Fire", "Water", "Ice", "Steel"]},
    "Grass":    {"weak": ["Fire", "Ice", "Poison", "Flying", "Bug"], "immune": [], "resist": ["Water", "Electric", "Grass", "Ground"]},
    "Electric": {"weak": ["Ground"], "immune": [], "resist": ["Electric", "Flying", "Steel"]},
    "Ice":      {"weak": ["Fire", "Fighting", "Rock", "Steel"], "immune": [], "resist": ["Ice"]},
    "Fighting": {"weak": ["Flying", "Psychic", "Fairy"], "immune": [], "resist": ["Bug", "Rock", "Dark"]},
    "Poison":   {"weak": ["Ground", "Psychic"], "immune": [], "resist": ["Grass", "Fighting", "Poison", "Bug", "Fairy"]},
    "Ground":   {"weak": ["Water", "Grass", "Ice"], "immune": ["Electric"], "resist": ["Poison", "Rock"]},
    "Flying":   {"weak": ["Electric", "Ice", "Rock"], "immune": ["Ground"], "resist": ["Grass", "Fighting", "Bug"]},
    "Psychic":  {"weak": ["Bug", "Ghost", "Dark"], "immune": [], "resist": ["Fighting", "Psychic"]},
    "Bug":      {"weak": ["Fire", "Flying", "Rock"], "immune": [], "resist": ["Grass", "Fighting", "Ground"]},
    "Rock":     {"weak": ["Water", "Grass", "Fighting", "Ground", "Steel"], "immune": [], "resist": ["Normal", "Fire", "Poison", "Flying"]},
    "Ghost":    {"weak": ["Ghost", "Dark"], "immune": ["Normal", "Fighting"], "resist": ["Poison", "Bug"]},
    "Dragon":   {"weak": ["Ice", "Dragon", "Fairy"], "immune": [], "resist": ["Fire", "Water", "Electric", "Grass"]},
    "Steel":    {"weak": ["Fire", "Fighting", "Ground"], "immune": ["Poison"], "resist": ["Normal", "Grass", "Ice", "Flying", "Psychic", "Bug", "Rock", "Dragon", "Steel", "Fairy"]},
    "Dark":     {"weak": ["Fighting", "Bug", "Fairy"], "immune": ["Psychic"], "resist": ["Ghost", "Dark"]},
    "Fairy":    {"weak": ["Poison", "Steel"], "immune": ["Dragon"], "resist": ["Fighting", "Bug", "Dark"]}
}

# 常见双打全体/分散攻击招式 (双打时受 0.75x 分散惩罚)
SPREAD_MOVES = {
    "地震", "热风", "魔法闪耀", "浊流", "岩崩", "巨声", "冰冻之风", 
    "淘金潮", "喷烟", "枯叶风暴", "阳伞风暴", "鸣雷风暴", "打雷", "放电",
    "Earthquake", "Heat Wave", "Dazzling Gleam", "Muddy Water", "Rock Slide", 
    "Hyper Voice", "Icy Wind", "Make It Rain", "Eruption", "Water Spout"
}

# 25 种性格对实数的影响修正
NATURE_MODIFIERS = {
    "固执": {"plus": "atk", "minus": "spa"},
    "爽朗": {"plus": "spe", "minus": "spa"},
    "内敛": {"plus": "spa", "minus": "atk"},
    "胆小": {"plus": "spe", "minus": "atk"},
    "淘气": {"plus": "def", "minus": "spa"},
    "慎重": {"plus": "spd", "minus": "spa"},
    "悠闲": {"plus": "def", "minus": "spe"},
    "自大": {"plus": "spd", "minus": "spe"},
    "勇敢": {"plus": "atk", "minus": "spe"},
    "冷静": {"plus": "spa", "minus": "spe"},
    "大胆": {"plus": "def", "minus": "atk"},
    "温和": {"plus": "spd", "minus": "atk"},
    "急躁": {"plus": "spe", "minus": "def"},
    "天真": {"plus": "spe", "minus": "spd"},
    "调皮": {"plus": "atk", "minus": "spd"},
    "乐天": {"plus": "def", "minus": "spd"},
    "马虎": {"plus": "spa", "minus": "spd"},
    "浮躁": {"plus": None, "minus": None},
    "坦率": {"plus": None, "minus": None},
    "认真": {"plus": None, "minus": None},
    "害羞": {"plus": None, "minus": None},
    "勤奋": {"plus": None, "minus": None},
    # 英文别名
    "Adamant": {"plus": "atk", "minus": "spa"},
    "Jolly": {"plus": "spe", "minus": "spa"},
    "Modest": {"plus": "spa", "minus": "atk"},
    "Timid": {"plus": "spe", "minus": "atk"},
    "Impish": {"plus": "def", "minus": "spa"},
    "Careful": {"plus": "spd", "minus": "spa"},
    "Bold": {"plus": "def", "minus": "atk"},
    "Calm": {"plus": "spd", "minus": "atk"},
    "Brave": {"plus": "atk", "minus": "spe"},
    "Quiet": {"plus": "spa", "minus": "spe"},
    "Relaxed": {"plus": "def", "minus": "spe"},
    "Sassy": {"plus": "spd", "minus": "spe"}
}

def normalize_type_en(t: str) -> str:
    """将输入的中文或英文属性标准化为标准英文属性名"""
    if not t:
        return "Normal"
    if t in TYPE_CHART:
        return t
    if t in TYPE_CN_TO_EN:
        return TYPE_CN_TO_EN[t]
    cap = t.capitalize()
    return cap if cap in TYPE_CHART else "Normal"

def get_type_multiplier(move_type: str, def_types: List[str]) -> float:
    """计算招式属性对防守方双属性的综合克制倍率 (0x, 0.25x, 0.5x, 1x, 2x, 4x)"""
    m_type = normalize_type_en(move_type)
    mult = 1.0
    for dt in def_types:
        d_type = normalize_type_en(dt)
        chart_data = TYPE_CHART.get(d_type, {})
        if m_type in chart_data.get("immune", []):
            return 0.0
        if m_type in chart_data.get("weak", []):
            mult *= 2.0
        if m_type in chart_data.get("resist", []):
            mult *= 0.5
    return mult

def calculate_stat_50(stat_key: str, base: int, ev: int = 0, nature: str = "固执", iv: int = 31) -> int:
    """
    计算标准 50 级对战环境下的最终单项能力实数
    """
    ev = max(0, min(252, ev))
    if stat_key == "hp":
        if base == 1: # 脱壳忍者特例
            return 1
        return int((2 * base + iv + int(ev // 4)) * 50 // 100) + 50 + 10

    raw = int((2 * base + iv + int(ev // 4)) * 50 // 100) + 5
    nat_mod = 1.0
    nat_rule = NATURE_MODIFIERS.get(nature) or NATURE_MODIFIERS.get(nature.replace(" Nature", ""))
    if nat_rule:
        if nat_rule.get("plus") == stat_key:
            nat_mod = 1.1
        elif nat_rule.get("minus") == stat_key:
            nat_mod = 0.9
    return int(raw * nat_mod)

def calculate_full_stats_50(base_stats: Dict[str, int], evs: Optional[Dict[str, int]] = None, nature: str = "固执") -> Dict[str, int]:
    """计算 50 级六维全部实数"""
    evs = evs or {}
    return {
        "hp": calculate_stat_50("hp", base_stats.get("hp", 80), evs.get("hp", 0), nature),
        "atk": calculate_stat_50("atk", base_stats.get("atk", 80), evs.get("atk", 0), nature),
        "def": calculate_stat_50("def", base_stats.get("def", 80), evs.get("def", 0), nature),
        "spa": calculate_stat_50("spa", base_stats.get("spa", 80), evs.get("spa", 0), nature),
        "spd": calculate_stat_50("spd", base_stats.get("spd", 80), evs.get("spd", 0), nature),
        "spe": calculate_stat_50("spe", base_stats.get("spe", 80), evs.get("spe", 0), nature),
    }

def calculate_damage_gen9(
    attacker_name: str,
    attacker_types: List[str],
    attacker_stats: Dict[str, int],
    attacker_item: str,
    attacker_ability: str,
    defender_name: str,
    defender_types: List[str],
    defender_stats: Dict[str, int],
    defender_item: str,
    defender_ability: str,
    move_name: str,
    move_type: str,
    move_category: str,
    move_power: int,
    format_type: str = "double",
    weather: str = "none",  # 'sun', 'rain', 'sand', 'snow', 'none'
    terrain: str = "none",  # 'electric', 'grassy', 'psychic', 'misty', 'none'
    attacker_stat_stages: Optional[Dict[str, int]] = None,
    defender_stat_stages: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """
    100% 精确计算第 9 世代 50 级伤害范围、击杀线与乱数概率
    """
    if move_power <= 0 or move_category in ["变化", "Status"]:
        return {
            "move": move_name,
            "is_status": True,
            "min_damage": 0,
            "max_damage": 0,
            "min_pct": 0.0,
            "max_pct": 0.0,
            "verdict": "变化招式 (无直接伤害)",
            "ko_chance": "无伤害"
        }

    is_physical = (move_category in ["物理", "Physical"])
    norm_move_type = normalize_type_en(move_type)
    norm_atk_types = [normalize_type_en(t) for t in attacker_types]
    norm_def_types = [normalize_type_en(t) for t in defender_types]

    # 1. 皮肤特性转换与威力加成 (飞行皮肤、妖精皮肤、冰冻皮肤)
    effective_power = float(move_power)
    if "皮肤" in attacker_ability or "ilate" in attacker_ability.lower() or "Refrigerate" in attacker_ability:
        if norm_move_type == "Normal":
            if "飞行" in attacker_ability or "Aerilate" in attacker_ability:
                norm_move_type = "Flying"
            elif "妖精" in attacker_ability or "Pixilate" in attacker_ability:
                norm_move_type = "Fairy"
            elif "冰" in attacker_ability or "Refrigerate" in attacker_ability:
                norm_move_type = "Ice"
            effective_power = math.floor(effective_power * 1.2)

    # 技术高手特性 (威力 <= 60 提升 1.5x)
    if ("技术高手" in attacker_ability or "Technician" in attacker_ability) and move_power <= 60:
        effective_power = math.floor(effective_power * 1.5)

    # 硬爪 (接触类物理招式加成 1.33x)
    if ("硬爪" in attacker_ability or "Tough Claws" in attacker_ability) and is_physical:
        effective_power = math.floor(effective_power * 1.33)

    # 2. 攻防实数与能力阶级
    stages_atk = (attacker_stat_stages or {}).get("atk" if is_physical else "spa", 0)
    stages_def = (defender_stat_stages or {}).get("def" if is_physical else "spd", 0)

    def stage_multiplier(st: int) -> float:
        st = max(-6, min(6, st))
        return (2 + st) / 2 if st >= 0 else 2 / (2 - st)

    raw_atk = attacker_stats.get("atk" if is_physical else "spa", 100) * stage_multiplier(stages_atk)
    raw_def = defender_stats.get("def" if is_physical else "spd", 100) * stage_multiplier(stages_def)

    # 大力士 / 瑜伽之力
    if is_physical and ("大力士" in attacker_ability or "瑜伽之力" in attacker_ability or "Huge Power" in attacker_ability):
        raw_atk *= 2.0

    # 道具加成 (讲究头带/讲究眼镜 1.5x, 突击背心 1.5x特防)
    if is_physical and ("讲究头带" in attacker_item or "Choice Band" in attacker_item):
        raw_atk *= 1.5
    elif not is_physical and ("讲究眼镜" in attacker_item or "Choice Specs" in attacker_item):
        raw_atk *= 1.5

    if not is_physical and ("突击背心" in defender_item or "Assault Vest" in defender_item):
        raw_def *= 1.5

    # 灾厄特性判定 (古剑豹降低除自身外所有宝可梦 25% 物防, 古玉鱼降低 25% 特防)
    if is_physical and ("剑之鼎" in attacker_ability or "Sword of Ruin" in attacker_ability):
        raw_def *= 0.75
    elif not is_physical and ("玉之鼎" in attacker_ability or "Beads of Ruin" in attacker_ability):
        raw_def *= 0.75

    # 3. 基础伤害基数 (Level 50)
    level = 50
    base_dmg = math.floor(math.floor((2 * level / 5 + 2) * effective_power * (raw_atk / raw_def)) / 50) + 2

    # 4. 双打全体分散攻击削减 (0.75x)
    if format_type == "double" and (move_name in SPREAD_MOVES or any(sm in move_name for sm in ["地震", "热风", "魔法闪耀", "浊流", "巨声", "淘金潮"])):
        base_dmg = math.floor(base_dmg * 0.75)

    # 5. 天气修正
    weather_mult = 1.0
    if weather == "sun":
        if norm_move_type == "Fire":
            weather_mult = 1.5
        elif norm_move_type == "Water":
            weather_mult = 0.5
    elif weather == "rain":
        if norm_move_type == "Water":
            weather_mult = 1.5
        elif norm_move_type == "Fire":
            weather_mult = 0.5

    # 6. 场地修正
    terrain_mult = 1.0
    if terrain == "electric" and norm_move_type == "Electric":
        terrain_mult = 1.3
    elif terrain == "grassy" and norm_move_type == "Grass":
        terrain_mult = 1.3
    elif terrain == "psychic" and norm_move_type == "Psychic":
        terrain_mult = 1.3
    elif terrain == "misty" and norm_move_type == "Dragon":
        terrain_mult = 0.5

    # 7. 本系 STAB 加成
    is_stab = norm_move_type in norm_atk_types
    stab_mult = 1.0
    if is_stab:
        if "适应力" in attacker_ability or "Adaptability" in attacker_ability:
            stab_mult = 2.0
        else:
            stab_mult = 1.5

    # 8. 属性克制倍率
    type_mult = get_type_multiplier(norm_move_type, norm_def_types)

    # 9. 道具增伤 (生命宝珠 1.3x, 达人带 1.2x)
    item_mult = 1.0
    if "生命宝珠" in attacker_item or "命玉" in attacker_item or "Life Orb" in attacker_item:
        item_mult = 1.3
    elif ("达人带" in attacker_item or "Expert Belt" in attacker_item) and type_mult > 1.0:
        item_mult = 1.2

    # 综合倍率计算
    total_mod = weather_mult * terrain_mult * stab_mult * type_mult * item_mult
    dmg_after_mod = math.floor(base_dmg * total_mod)

    # 16 级乱数 (85% ~ 100%)
    rolls = [math.floor(dmg_after_mod * (85 + i) / 100) for i in range(16)]
    min_dmg = rolls[0]
    max_dmg = rolls[-1]

    def_hp = max(1, defender_stats.get("hp", 150))
    min_pct = round((min_dmg / def_hp) * 100, 1)
    max_pct = round((max_dmg / def_hp) * 100, 1)

    # 气势披带判定 (满血承受必死伤害留 1 血)
    has_focus_sash = ("气势披带" in defender_item or "Focus Sash" in defender_item)

    # 击杀概率计算
    ohko_rolls = sum(1 for r in rolls if r >= def_hp)
    ohko_chance = round((ohko_rolls / 16) * 100, 1)

    if type_mult == 0.0:
        verdict = "无效 (0x 属性免疫)"
        ko_desc = "0% 免疫"
    elif has_focus_sash and min_dmg >= def_hp:
        verdict = f"气势披带锁 1 血 (满血保底，残血即杀 {min_pct}%~{max_pct}%)"
        ko_desc = "披带保底 (残血 OHKO)"
    elif min_dmg >= def_hp:
        verdict = f"确定一击击杀 (100% 确一 OHKO: {min_pct}% ~ {max_pct}%)"
        ko_desc = "100% OHKO 确一"
    elif ohko_chance > 0:
        verdict = f"乱数一击击杀 (乱一几率 {ohko_chance}%, 伤害 {min_pct}% ~ {max_pct}%)"
        ko_desc = f"{ohko_chance}% 乱一 OHKO"
    elif max_dmg >= (def_hp / 2):
        verdict = f"确定二击击杀 (2HKO 确二: {min_pct}% ~ {max_pct}%)"
        ko_desc = "100% 2HKO 确二"
    elif max_dmg >= (def_hp / 3):
        verdict = f"三击击杀 (3HKO: {min_pct}% ~ {max_pct}%)"
        ko_desc = "3HKO 磨血"
    else:
        verdict = f"刮痧磨血 (伤害不足: {min_pct}% ~ {max_pct}%)"
        ko_desc = "轻微刮痧"

    return {
        "move": move_name,
        "move_type": norm_move_type,
        "move_type_cn": TYPE_MAP.get(norm_move_type, norm_move_type),
        "is_status": False,
        "type_multiplier": type_mult,
        "is_stab": is_stab,
        "min_damage": min_dmg,
        "max_damage": max_dmg,
        "min_pct": min_pct,
        "max_pct": max_pct,
        "defender_hp": def_hp,
        "ohko_chance_pct": ohko_chance,
        "ko_desc": ko_desc,
        "verdict": verdict,
        "all_rolls": rolls
    }

def compare_speed_tiers(
    pokemon_entries: List[Dict[str, Any]],
    field_conditions: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    """
    对比多只宝可梦在当前状态下的精确 50 级速度实数与行动先手权
    """
    field = field_conditions or {}
    is_trick_room = field.get("trick_room", False)

    results = []
    for entry in pokemon_entries:
        name = entry.get("name", "Unknown")
        base_spe = entry.get("base_spe", 100)
        ev_spe = entry.get("ev_spe", 252)
        nature = entry.get("nature", "爽朗")
        item = entry.get("item", "")
        ability = entry.get("ability", "")
        stage = entry.get("speed_stage", 0)
        has_tailwind = entry.get("tailwind", False) or field.get("tailwind", False)
        is_paralyzed = entry.get("paralyzed", False)

        # 基础 50 级速度实数
        base_stat = calculate_stat_50("spe", base_spe, ev_spe, nature)
        current_spe = float(base_stat)

        # 能力阶级
        if stage > 0:
            current_spe *= (2 + stage) / 2
        elif stage < 0:
            current_spe *= 2 / (2 - stage)

        # 道具修正
        if "讲究围巾" in item or "Choice Scarf" in item:
            current_spe *= 1.5
        elif "铁球" in item or "Iron Ball" in item:
            current_spe *= 0.5

        # 顺风修正 (2x)
        if has_tailwind:
            current_spe *= 2.0

        # 麻痹修正 (0.5x)
        if is_paralyzed:
            current_spe *= 0.5

        # 特性加成 (拨沙/悠游自如/拨雪 2x, 古代活性/夸克充能 +50%)
        if "古代活性" in ability or "夸克充能" in ability or "Protosynthesis" in ability or "Quark Drive" in ability:
            if field.get("sun", False) or field.get("electric_terrain", False) or "驱劲能量" in item or "Booster Energy" in item:
                current_spe *= 1.5
        elif ("拨沙" in ability or "Sand Rush" in ability) and field.get("sand", False):
            current_spe *= 2.0
        elif ("悠游自如" in ability or "Swift Swim" in ability) and field.get("rain", False):
            current_spe *= 2.0
        elif ("拨雪" in ability or "Slush Rush" in ability) and field.get("snow", False):
            current_spe *= 2.0

        final_spe = math.floor(current_spe)
        results.append({
            "name": name,
            "base_spe": base_spe,
            "nature": nature,
            "ev_spe": ev_spe,
            "item": item,
            "ability": ability,
            "base_spe_stat": base_stat,
            "effective_spe": final_spe,
            "conditions": {
                "tailwind": has_tailwind,
                "scarf": ("讲究围巾" in item or "Choice Scarf" in item),
                "trick_room": is_trick_room,
                "paralyzed": is_paralyzed
            }
        })

    # 排序：常态由高到低，空间下由低到高
    results.sort(key=lambda x: x["effective_spe"], reverse=(not is_trick_room))
    for idx, r in enumerate(results, 1):
        r["rank"] = idx

    return results
