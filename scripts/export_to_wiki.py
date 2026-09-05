#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
export_to_wiki.py - 将 M-5 全量数据热替换接入现有 Wiki 前后端

功能：
1. 自动备份原有的 champions_data.json 和 champions_data.js。
2. 读取 data/meta/pokechamdb_M-5_double_forms.json（314个形态记录）。
3. 聚合通常形态与超级进化 (Mega/Mega X/Y/Z) 形态，映射官方中英属性与招式威力参数。
4. 生成 100% 兼容前端 wiki.js, copilot.js, teams.js 的 champions_data.json / .js。
"""

import json
import shutil
from pathlib import Path

TYPE_CN_TO_EN = {
    "一般": "Normal", "火": "Fire", "水": "Water", "草": "Grass",
    "电": "Electric", "冰": "Ice", "格斗": "Fighting", "毒": "Poison",
    "地面": "Ground", "飞行": "Flying", "超能力": "Psychic", "虫": "Bug",
    "岩石": "Rock", "幽灵": "Ghost", "龙": "Dragon", "钢": "Steel",
    "恶": "Dark", "妖精": "Fairy"
}

TYPE_NAMES = [
    'Normal', 'Fighting', 'Flying', 'Poison', 'Ground', 'Rock',
    'Bug', 'Ghost', 'Steel', 'Fire', 'Water', 'Grass',
    'Electric', 'Psychic', 'Ice', 'Dragon', 'Dark', 'Fairy'
]

MEGA_AVATAR_MAP = {
    ("venusaur", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10033.png",
    ("charizard", "超级 X"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10034.png",
    ("charizard", "超级 Y"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10035.png",
    ("blastoise", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10036.png",
    ("beedrill", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10090.png",
    ("pidgeot", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10077.png",
    ("alakazam", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10037.png",
    ("slowbro", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10071.png",
    ("gengar", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10038.png",
    ("kangaskhan", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10039.png",
    ("pinsir", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10040.png",
    ("gyarados", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10041.png",
    ("aerodactyl", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10042.png",
    ("mewtwo", "超级 X"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10043.png",
    ("mewtwo", "超级 Y"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10044.png",
    ("ampharos", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10045.png",
    ("steelix", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10072.png",
    ("scizor", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10046.png",
    ("heracross", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10047.png",
    ("houndoom", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10048.png",
    ("tyranitar", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10049.png",
    ("sceptile", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10065.png",
    ("blaziken", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10050.png",
    ("swampert", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10064.png",
    ("gardevoir", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10051.png",
    ("sableye", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10066.png",
    ("mawile", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10052.png",
    ("aggron", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10053.png",
    ("medicham", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10054.png",
    ("manectric", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10055.png",
    ("sharpedo", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10070.png",
    ("camerupt", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10087.png",
    ("altaria", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10067.png",
    ("banette", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10056.png",
    ("absol", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10057.png",
    ("absol", "超级 Z"): "https://zukan.pokemon.co.jp/zukan-api/up/images/index/absol_z.png",
    ("glalie", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10074.png",
    ("metagross", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10076.png",
    ("lopunny", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10088.png",
    ("garchomp", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10058.png",
    ("garchomp", "超级 Z"): "https://zukan.pokemon.co.jp/zukan-api/up/images/index/4f6bd54dafaef1dd0e132ba15e575744d32466cd.png",
    ("lucario", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10059.png",
    ("lucario", "超级 Z"): "https://zukan.pokemon.co.jp/zukan-api/up/images/index/9910f2b09a49b21d30d06226f653b099.png",
    ("abomasnow", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10060.png",
    ("gallade", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10068.png",
    ("audino", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10069.png",
    ("froslass", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10285.png",
    ("staraptor", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10308.png",
    ("delphox", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10293.png",
    ("greninja", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10294.png",
    ("chesnaught", "超级"): "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/10292.png",
    ("dragonite", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/dragonite-mega.png",
    ("raichu", "超级 X"): "https://play.pokemonshowdown.com/sprites/gen5/raichu-megax.png",
    ("raichu", "超级 Y"): "https://play.pokemonshowdown.com/sprites/gen5/raichu-megay.png",
    ("scovillain", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/scovillain-mega.png",
    ("glimmora", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/glimmora-mega.png",
    ("excadrill", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/excadrill-mega.png",
    ("chandelure", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/chandelure-mega.png",
    ("scrafty", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/scrafty-mega.png",
    ("clefable", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/clefable-mega.png",
    ("malamar", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/malamar-mega.png",
    ("meganium", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/meganium-mega.png",
    ("feraligatr", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/feraligatr-mega.png",
    ("emboar", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/emboar-mega.png",
    ("pyroar", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/pyroar-mega.png",
    ("eelektross", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/eelektross-mega.png",
    ("drampa", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/drampa-mega.png",
    ("starmie", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/starmie-mega.png",
    ("golurk", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/golurk-mega.png",
    ("hawlucha", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/hawlucha-mega.png",
    ("crabominable", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/crabominable-mega.png",
    ("dragalge", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/dragalge-mega.png",
    ("skarmory", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/skarmory-mega.png",
    ("scolipede", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/scolipede-mega.png",
    ("chimecho", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/chimecho-mega.png",
    ("victreebel", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/victreebel-mega.png",
    ("falinks", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/falinks-mega.png",
    ("barbaracle", "超级"): "https://play.pokemonshowdown.com/sprites/gen5/barbaracle-mega.png"
}

def resolve_mega_avatar(slug, form, dex_no):
    if (slug, form) in MEGA_AVATAR_MAP:
        return MEGA_AVATAR_MAP[(slug, form)]
    clean_f = "megaz" if "Z" in form else ("megay" if "Y" in form else ("megax" if "X" in form else "mega"))
    return f"https://play.pokemonshowdown.com/sprites/gen5/{slug}-{clean_f}.png"

SPECIAL_FORM_AVATAR_MAP = {
    # 地区形态 (Regional Forms - 100% 经 PokeAPI 官方 API 对齐校验)
    "raichu-alola": 10100,
    "ninetales-alola": 10104,
    "arcanine-hisui": 10230,
    "slowbro-galar": 10165,
    "slowking-galar": 10172,
    "typhlosion-hisui": 10233,
    "samurott-hisui": 10236,
    "zoroark-hisui": 10239,
    "stunfisk-galar": 10180,
    "goodra-hisui": 10242,
    "avalugg-hisui": 10243,
    "decidueye-hisui": 10244,
    "tauros-paldea-combat": 10250,
    "tauros-paldea-blaze": 10251,
    "tauros-paldea-aqua": 10252,
    
    # 洛托姆各形态 (Rotom)
    "rotom-heat": 10008,
    "rotom-wash": 10009,
    "rotom-frost": 10010,
    "rotom-fan": 10011,
    "rotom-mow": 10012,
    
    # 鬃岩狼人形态 (Lycanroc)
    "lycanroc-midnight": 10126,
    "lycanroc-dusk": 10152,
    
    # 超能妙喵 (Meowstic-F)
    "meowstic-female": 10025,
    
    # 幽尾玄鱼 (Basculegion-F)
    "basculegion-female": 10248,
    
    # 南瓜怪人 (Gourgeist)
    "gourgeist-small": 10030,
    "gourgeist-large": 10031,
    "gourgeist-super": 10032
}

def resolve_pokemon_avatar(slug, dex_no):
    if slug in SPECIAL_FORM_AVATAR_MAP:
        form_id = SPECIAL_FORM_AVATAR_MAP[slug]
        return f"https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/{form_id}.png"
    return f"https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon/other/official-artwork/{dex_no}.png"

def load_waza_catalog():
    waza_names = {}
    waza_map = {}
    try:
        w_names_p = Path("data/raw/wazaname.json")
        if w_names_p.exists():
            wd = json.loads(w_names_p.read_text(encoding="utf-8"))
            for item in wd.get("mSDataSet", []):
                lbl = item.get("LabelName")
                txt = item.get("OriginalText")
                if lbl and txt:
                    waza_names[lbl] = txt

        w_p = Path("data/raw/waza.json")
        if w_p.exists():
            w_list = json.loads(w_p.read_text(encoding="utf-8"))
            for w in w_list:
                wid = int(w["id"])
                w_lbl = w.get("ms_lbl", "")
                w_name = waza_names.get(w_lbl, "")
                w_power = int(w.get("power", 0) or 0)
                w_acc = int(w.get("accuracy", 100) or 100)
                t_idx = int(w.get("type", 0) or 0)
                w_type = TYPE_NAMES[t_idx] if t_idx < len(TYPE_NAMES) else "Normal"
                raw_cat = str(w.get("category", "0"))
                w_cat = "物理" if raw_cat == "0" else ("特殊" if raw_cat == "1" else "变化")
                w_prio = int(w.get("priority", 0) or 0)
                if w_name:
                    waza_map[w_name] = {
                        "id": wid,
                        "name": w_name,
                        "power": w_power,
                        "accuracy": w_acc,
                        "type": w_type,
                        "category": w_cat,
                        "priority": w_prio
                    }
    except Exception as e:
        print(f"Warning loading waza raw catalog: {e}")
    return waza_map


def format_meta_usage(record, waza_map, default_type, abilities_desc):
    if not record:
        return None
    abilities_list = []
    for ab in record.get("abilities", []):
        ab_name = ab.get("name", "")
        usage = ab.get("usage", 0.0)
        desc = abilities_desc.get(ab_name, "对战中触发的官方特性效果。")
        abilities_list.append({
            "name": ab_name,
            "desc": desc,
            "usage": usage,
            "usageText": f"{usage}%"
        })
    return {
        "rank": record.get("rank"),
        "items": record.get("items", []),
        "abilities": abilities_list,
        "natures": record.get("natures", []),
        "partners": record.get("partners", []),
        "evSpreads": record.get("ev_spreads", []),
        "topMoves": [
            {
                "name": m.get("name", ""),
                "usage": m.get("usage", 0.0),
                "type": waza_map.get(m.get("name", ""), {}).get("type", default_type),
                "category": waza_map.get(m.get("name", ""), {}).get("category", "物理"),
                "power": waza_map.get(m.get("name", ""), {}).get("power", "--"),
                "accuracy": waza_map.get(m.get("name", ""), {}).get("accuracy", 100)
            }
            for m in record.get("moves", [])[:12]
        ]
    }


def run_export(base_dir=None):
    if base_dir is None:
        base_dir = Path(__file__).resolve().parent.parent
    else:
        base_dir = Path(base_dir)
    meta_src = base_dir / "data" / "meta" / "pokechamdb_M-5_double_forms.json"
    single_src = base_dir / "data" / "meta" / "pokechamdb_M-5_single_forms.json"
    old_json = base_dir / "data" / "champions_data.json"
    old_js = base_dir / "data" / "champions_data.js"

    if not meta_src.exists():
        print(f"错误: 未找到 M-5 源数据文件: {meta_src}")
        return False

    print("=== 正在准备备份原文件 ===")
    if old_json.exists():
        shutil.copy(old_json, base_dir / "data" / "champions_data.backup.json")
        print("已备份: data/champions_data.backup.json")
    if old_js.exists():
        shutil.copy(old_js, base_dir / "data" / "champions_data.backup.js")
        print("已备份: data/champions_data.backup.js")

    # 读取旧 typeChart
    type_chart = {}
    if old_json.exists():
        try:
            old_data = json.loads(old_json.read_text(encoding="utf-8"))
            type_chart = old_data.get("typeChart", {})
        except Exception:
            pass

    # 读取 M-5 新数据 (双打为主基底，单打深度聚合)
    m5_records = json.loads(meta_src.read_text(encoding="utf-8"))
    print(f"成功读取 M-5 双打原始记录: {len(m5_records)} 条")

    single_by_slug = {}
    if single_src.exists():
        try:
            s_recs = json.loads(single_src.read_text(encoding="utf-8"))
            for sr in s_recs:
                if sr.get("form") == "通常":
                    single_by_slug[sr["slug"]] = sr
            print(f"成功读取 M-5 单打原始记录: {len(single_by_slug)} 只")
        except Exception as e:
            print(f"Warning loading single meta data: {e}")

    waza_map = load_waza_catalog()
    print(f"已装载官方招式数值字典: {len(waza_map)} 个")

    abilities_desc = {}
    ab_desc_path = base_dir / "data" / "raw" / "abilities_desc.json"
    if ab_desc_path.exists():
        try:
            abilities_desc = json.loads(ab_desc_path.read_text(encoding="utf-8"))
            print(f"已装载官方特性效果说明字典: {len(abilities_desc)} 个")
        except Exception as e:
            print(f"Warning loading abilities_desc: {e}")

    # 按物种分组
    by_slug = {}
    for r in m5_records:
        slug = r["slug"]
        if slug not in by_slug:
            by_slug[slug] = []
        by_slug[slug].append(r)

    print(f"聚合独立物种数: {len(by_slug)} 只")

    pokemon_list = []
    for slug, records in by_slug.items():
        # 基础形态通常是 '通常'
        base_record = next((r for r in records if r.get("form") == "通常"), records[0])
        dex_no = base_record.get("no") or 0
        chinese_name = base_record.get("name") or slug
        en_name = slug.replace("-", " ").title()

        # 属性转换
        types_cn = base_record.get("types", ["一般"])
        types_en = [TYPE_CN_TO_EN.get(t, "Normal") for t in types_cn]

        # 六维
        raw_stats = base_record.get("base_stats", {})
        stats = {
            "hp": raw_stats.get("HP", 80),
            "atk": raw_stats.get("攻击", 80),
            "def": raw_stats.get("防御", 80),
            "spa": raw_stats.get("特攻", 80),
            "spd": raw_stats.get("特防", 80),
            "spe": raw_stats.get("速度", 80)
        }

        # 特性列表 (包含官方效果说明 + 天梯使用率)
        abilities = []
        for ab in base_record.get("abilities", []):
            ab_name = ab.get("name", "")
            usage = ab.get("usage", 0.0)
            effect_desc = abilities_desc.get(ab_name, "对战中触发的官方特性效果。")
            abilities.append({
                "id": 0,
                "name": ab_name,
                "desc": effect_desc,
                "usage": usage,
                "usageText": f"{usage}%"
            })

        # 配招池与学招表
        learnset = []
        for m in base_record.get("moves", []):
            m_name = m.get("name", "")
            usage = m.get("usage", 0.0)
            catalog_info = waza_map.get(m_name, {})
            learnset.append({
                "id": catalog_info.get("id", 0),
                "name": m_name,
                "power": catalog_info.get("power", 0),
                "accuracy": catalog_info.get("accuracy", 100),
                "type": catalog_info.get("type", types_en[0] if types_en else "Normal"),
                "category": catalog_info.get("category", "物理"),
                "priority": catalog_info.get("priority", 0),
                "usage": usage,
                "tag": f"{usage}%"
            })

        # Mega 形态聚合
        mega_records = [r for r in records if "超级" in r.get("form", "") or "Mega" in r.get("form", "")]
        has_mega = len(mega_records) > 0
        mega_data = {"supported": False}

        if has_mega:
            primary_mega = mega_records[0]
            mega_stats_raw = primary_mega.get("base_stats", {})
            mega_stats = {
                "hp": mega_stats_raw.get("HP", stats["hp"]),
                "atk": mega_stats_raw.get("攻击", stats["atk"]),
                "def": mega_stats_raw.get("防御", stats["def"]),
                "spa": mega_stats_raw.get("特攻", stats["spa"]),
                "spd": mega_stats_raw.get("特防", stats["spd"]),
                "spe": mega_stats_raw.get("速度", stats["spe"])
            }
            mega_types_cn = primary_mega.get("types", types_cn)
            mega_forms_list = []
            for mr in mega_records:
                form_label = mr.get("form", "超级")
                form_key = "Z" if "Z" in form_label else ("Y" if "Y" in form_label else ("X" if "X" in form_label else ""))
                m_raw = mr.get("base_stats", {})
                m_st = {
                    "hp": m_raw.get("HP", stats["hp"]),
                    "atk": m_raw.get("攻击", stats["atk"]),
                    "def": m_raw.get("防御", stats["def"]),
                    "spa": m_raw.get("特攻", stats["spa"]),
                    "spd": m_raw.get("特防", stats["spd"]),
                    "spe": m_raw.get("速度", stats["spe"])
                }
                m_t_cn = mr.get("types", types_cn)
                m_t_en = [TYPE_CN_TO_EN.get(t, "Normal") for t in m_t_cn]
                m_ab = mr.get("abilities", [{}])[0].get("name", "超级特性") if mr.get("abilities") else "超级特性"
                mega_avatar = resolve_mega_avatar(slug, form_label, dex_no)
                stone_name = f"{chinese_name}进化石" + (f" {form_key}" if form_key else "")
                
                mega_forms_list.append({
                    "formKey": form_key,
                    "formLabel": f"超级进化 {form_key}".strip(),
                    "megaName": mr.get("name", f"超级{chinese_name}{form_key}"),
                    "megaStone": stone_name,
                    "types": m_t_en,
                    "avatar": mega_avatar,
                    "baseStats": m_st,
                    "ability": m_ab,
                    "abilityDesc": "超级进化专属增强特性"
                })

            primary_mega = mega_forms_list[0]
            mega_data = {
                "supported": True,
                "megaName": primary_mega["megaName"],
                "megaStone": primary_mega["megaStone"],
                "types": primary_mega["types"],
                "avatar": primary_mega["avatar"],
                "baseStats": primary_mega["baseStats"],
                "ability": primary_mega["ability"],
                "abilityDesc": primary_mega["abilityDesc"],
                "forms": mega_forms_list
            }

        # 格式化单打与双打专属大数据
        def_t = types_en[0] if types_en else "Normal"
        double_usage = format_meta_usage(base_record, waza_map, def_t, abilities_desc)
        single_rec = single_by_slug.get(slug)
        single_usage = format_meta_usage(single_rec, waza_map, def_t, abilities_desc)

        # 标签
        tags = []
        if double_usage and double_usage.get("rank"):
            tags.append(f"双打 #{double_usage['rank']}")
        if single_usage and single_usage.get("rank"):
            tags.append(f"单打 #{single_usage['rank']}")
        if has_mega:
            tags.append("Mega进化")

        pokemon_obj = {
            "id": dex_no,
            "formId": 0,
            "rawId": dex_no * 1000,
            "slug": slug,
            "name": chinese_name,
            "enName": en_name,
            "types": types_en,
            "avatar": resolve_pokemon_avatar(slug, dex_no),
            "baseStats": stats,
            "abilities": abilities,
            "learnset": learnset,
            "isMega": False,
            "formKey": "",
            "tags": tags,
            "mega": mega_data,
            "meta": {
                "double": double_usage,
                "single": single_usage
            },
            "metaUsage": double_usage
        }
        pokemon_list.append(pokemon_obj)

    # 默认按照双打天梯 rank 升序排列
    pokemon_list.sort(key=lambda x: (x.get("metaUsage", {}).get("rank") or 9999, x.get("id", 0)))

    # 组装输出
    final_output = {
        "meta": {
            "version": "2.0.0-M5-Live",
            "season": "M-5",
            "formats": ["double", "single"],
            "total": len(pokemon_list),
            "totalForms": len(m5_records),
            "totalSingles": len(single_by_slug),
            "generatedAt": "2026-09-05"
        },
        "typeChart": type_chart,
        "pokemon": pokemon_list
    }

    # 写入 JSON
    old_json.write_text(json.dumps(final_output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"成功更新后端 JSON: {old_json} (包含 {len(pokemon_list)} 只宝可梦)")

    # 写入 JS (前端 window.CHAMPIONS_DATA)
    js_content = "window.CHAMPIONS_DATA = " + json.dumps(final_output, ensure_ascii=False, indent=2) + ";\n"
    old_js.write_text(js_content, encoding="utf-8")
    print(f"成功更新前端 JS: {old_js} (可供 index.html 即开即用)")
    return True


def main():
    return run_export()


if __name__ == "__main__":
    main()
