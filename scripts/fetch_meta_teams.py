#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/fetch_meta_teams.py - 从 Limitless (play.limitlesstcg.com) 抓取真实排位与锦标赛队伍
完全直连原始源站，不依赖任何第三方仓库现成数据。
支持：双打 (Doubles) 与 单打 (Singles) 上位队伍（冠亚军、4强、8强）。
"""

import urllib.request
import re
import json
import time
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = "https://play.limitlesstcg.com"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
}

def http_get(url, timeout=15):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', errors='ignore')

def load_local_translation_catalogs():
    """加载本地词典 (champions_data, moves_dict, items_dict) 进行 100% 本地化转换"""
    mon_en_to_zh = {}
    avatar_map = {}
    types_map = {}
    
    # 1. 宝可梦物种与立绘
    p_data_path = Path("data/champions_data.json")
    if p_data_path.exists():
        try:
            with open(p_data_path, encoding='utf-8') as f:
                cd = json.load(f)
                for p in cd.get('pokemon', []):
                    slug = p.get('slug', '').lower()
                    en_name = p.get('enName', '').lower()
                    zh_name = p.get('name', '')
                    avatar = p.get('avatar', '')
                    types = p.get('types', ['Normal'])
                    if en_name:
                        mon_en_to_zh[en_name] = zh_name
                    if slug:
                        mon_en_to_zh[slug] = zh_name
                        avatar_map[slug] = avatar
                        types_map[slug] = types
        except Exception as e:
            print(f"Warning loading champions_data: {e}")

    # 2. 招式词典
    moves_dict = {}
    m_path = Path("data/raw/moves_dict.json")
    if m_path.exists():
        try:
            with open(m_path, encoding='utf-8') as f:
                moves_dict = json.load(f)
        except Exception as e:
            print(f"Warning loading moves_dict: {e}")

    # 3. 道具词典
    items_dict = {}
    i_path = Path("data/raw/items_dict.json")
    if i_path.exists():
        try:
            with open(i_path, encoding='utf-8') as f:
                items_dict = json.load(f)
        except Exception as e:
            print(f"Warning loading items_dict: {e}")

    return mon_en_to_zh, avatar_map, types_map, moves_dict, items_dict

def translate_item(item_en, items_dict, mon_en_to_zh):
    if not item_en:
        return ""
    clean = item_en.lower().strip()
    # 检查 Mega 进化石
    if clean.endswith("ite"):
        base_mon = clean[:-3]
        zh_mon = mon_en_to_zh.get(base_mon, base_mon.capitalize())
        return f"{zh_mon}进化石"
    if clean.endswith("ite x"):
        base_mon = clean[:-5]
        zh_mon = mon_en_to_zh.get(base_mon, base_mon.capitalize())
        return f"{zh_mon}进化石 X"
    if clean.endswith("ite y"):
        base_mon = clean[:-5]
        zh_mon = mon_en_to_zh.get(base_mon, base_mon.capitalize())
        return f"{zh_mon}进化石 Y"
    
    return items_dict.get(clean, item_en)

def parse_teamlist_html(html, mon_en_to_zh, avatar_map, types_map, moves_dict, items_dict):
    """从 Limitless 队伍页面解析 6 只宝可梦"""
    parts = html.split('<div class="pkmn">')[1:]
    
    team_pokemon = []
    showdown_lines = []

    for block in parts:
        # Name
        name_m = re.search(r'<span>(.*?)</span>', block)
        species_en = name_m.group(1).strip() if name_m else "Unknown"
        
        # Details: item, ability, nature
        item_m = re.search(r'<div class="item">(.*?)</div>', block)
        item_en = item_m.group(1).strip() if item_m else ""

        ability_m = re.search(r'<div class="ability">(?:Ability:\s*)?(.*?)</div>', block)
        ability_en = ability_m.group(1).strip() if ability_m else ""

        nature_m = re.search(r'<div class="nature">(?:Nature:\s*)?(.*?)</div>', block)
        nature_en = nature_m.group(1).strip() if nature_m else ""

        # Moves - strictly inside <ul class="attacks">
        attacks_m = re.search(r'<ul class="attacks">(.*?)</ul>', block, re.DOTALL)
        moves_raw = re.findall(r'<li>(.*?)</li>', attacks_m.group(1)) if attacks_m else []
        moves_clean = [m.strip() for m in moves_raw if m.strip() and "<a" not in m]

        # Build Showdown block
        sh_line = species_en
        if item_en:
            sh_line += f" @ {item_en}"
        showdown_lines.append(sh_line)
        if ability_en:
            showdown_lines.append(f"Ability: {ability_en}")
        if nature_en:
            showdown_lines.append(f"{nature_en}")
        for m in moves_clean:
            showdown_lines.append(f"- {m}")
        showdown_lines.append("")

        # Chinese mapping
        slug = re.sub(r'[^a-z0-9]+', '-', species_en.lower()).strip('-')
        zh_name = mon_en_to_zh.get(species_en.lower(), mon_en_to_zh.get(slug, species_en))
        avatar = avatar_map.get(slug, f"https://r2.limitlesstcg.net/pokemon/gen9/{slug}.png")
        types = types_map.get(slug, ["Normal"])
        zh_item = translate_item(item_en, items_dict, mon_en_to_zh)

        processed_moves = []
        for m in moves_clean:
            m_info = moves_dict.get(m.lower(), {})
            processed_moves.append({
                "name": m_info.get("name", m),
                "enName": m,
                "type": m_info.get("type", "Normal"),
                "category": m_info.get("category", "Physical"),
                "power": m_info.get("power", "")
            })

        team_pokemon.append({
            "species": zh_name,
            "enSpecies": species_en,
            "slug": slug,
            "avatar": avatar,
            "types": types,
            "item": zh_item,
            "enItem": item_en,
            "ability": ability_en,
            "nature": nature_en,
            "moves": processed_moves
        })

    return team_pokemon, "\n".join(showdown_lines).strip()

def fetch_latest_teams(max_tournaments=8, max_teams_per_tourn=4):
    print("=== 开始从 Limitless VGC/X1 原始源站抓取真实上位队伍 ===")
    list_url = f"{BASE_URL}/tournaments/completed?game=VGC"
    print(f"正在访问完赛赛事索引: {list_url}")
    
    html = http_get(list_url)
    tourn_matches = re.findall(r'<a[^>]*href=["\'](/tournament/([a-f0-9]+)/standings)["\'][^>]*>(.*?)</a>', html)
    
    tournaments_dict = {}
    for full_path, t_id, t_name_raw in tourn_matches:
        clean_name = re.sub(r'<[^>]+>', '', t_name_raw).strip()
        if t_id not in tournaments_dict:
            tournaments_dict[t_id] = {
                "id": t_id,
                "name": clean_name or f"Tournament {t_id[:8]}",
                "standings_url": f"{BASE_URL}/tournament/{t_id}/standings"
            }
        elif clean_name and (tournaments_dict[t_id]["name"].startswith("Tournament ") or not tournaments_dict[t_id]["name"]):
            tournaments_dict[t_id]["name"] = clean_name

    tournaments = list(tournaments_dict.values())
    print(f"成功获取已完赛比赛: {len(tournaments)} 场，开始抓取前 {max_tournaments} 场上位队伍")
    mon_en_to_zh, avatar_map, types_map, moves_dict, items_dict = load_local_translation_catalogs()
    all_teams = []

    for idx, tourn in enumerate(tournaments[:max_tournaments]):
        t_name = tourn["name"]
        t_url = tourn["standings_url"]
        
        # 判断单双打
        is_single = ("x1" in t_name.lower()) or ("single" in t_name.lower()) or ("1v1" in t_name.lower())
        format_label = "single" if is_single else "double"
        format_cn = "单打 (Singles)" if is_single else "双打 (Doubles)"
        
        print(f"\n[{idx+1}/{max_tournaments}] 正在抓取: 《{t_name}》 模式: {format_cn}")
        
        try:
            st_html = http_get(t_url)
            rows = re.findall(r'<tr[^>]*>.*?</tr>', st_html, re.DOTALL)
            tourn_team_count = 0
            for r in rows[1:]:
                tl_m = re.search(r'href=["\'](/tournament/[^/]+/player/([^/]+)/teamlist)["\']', r)
                if not tl_m:
                    continue
                
                tl_path = tl_m.group(1)
                player_id = tl_m.group(2)
                
                text_cols = re.sub(r'<[^>]+>', ' ', r).split()
                placing = int(text_cols[0]) if text_cols and text_cols[0].isdigit() else (tourn_team_count + 1)
                
                # 提取战绩 (如 4-0-0)
                record_m = re.search(r'(\d+\s*-\s*\d+\s*-\s*\d+)', r)
                record_str = record_m.group(1).replace(' ', '') if record_m else ""

                if placing > 8:
                    continue
                
                placing_tag = "🥇 冠军 (1st)" if placing == 1 else (
                    "🥈 亚军 (2nd)" if placing == 2 else (
                        "🥉 四强 (Top 4)" if placing in (3, 4) else "🏅 八强 (Top 8)"
                    )
                )

                tl_full_url = f"{BASE_URL}{tl_path}"
                print(f"    -> 抓取 {placing_tag} 选手 [{player_id}] 战绩: {record_str} 队伍...")
                
                tl_html = http_get(tl_full_url)
                team_pokemon, showdown_text = parse_teamlist_html(
                    tl_html, mon_en_to_zh, avatar_map, types_map, moves_dict, items_dict
                )
                
                if len(team_pokemon) >= 4:
                    all_teams.append({
                        "id": f"limitless-{tourn['id'][:8]}-{player_id}",
                        "source": "Limitless VGC",
                        "tournamentName": t_name,
                        "tournamentUrl": t_url,
                        "format": format_label,
                        "formatCn": format_cn,
                        "placing": placing,
                        "placingTag": placing_tag,
                        "record": record_str,
                        "player": player_id,
                        "showdown": showdown_text,
                        "pokemon": team_pokemon,
                        "fetchedAt": time.strftime("%Y-%m-%d %H:%M:%S")
                    })
                    tourn_team_count += 1
                
                time.sleep(0.3)
                if tourn_team_count >= max_teams_per_tourn:
                    break
        except Exception as e:
            print(f"  抓取比赛 {t_name} 失败: {e}")

    print(f"\n=== 抓取完成！共收集真实比赛队伍: {len(all_teams)} 支 ===")
    
    out_dir = Path("data")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / "champions_teams.json"
    out_js = out_dir / "champions_teams.js"
    
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(all_teams, f, ensure_ascii=False, indent=2)
        
    with open(out_js, "w", encoding="utf-8") as f:
        f.write("window.CHAMPIONS_TEAMS = " + json.dumps(all_teams, ensure_ascii=False, indent=2) + ";\n")
        
    print(f"已生成数据文件: {out_json} ({out_json.stat().st_size / 1024:.2f} KB)")
    print(f"已生成前端脚本: {out_js} ({out_js.stat().st_size / 1024:.2f} KB)")
    return all_teams

if __name__ == "__main__":
    fetch_latest_teams(max_tournaments=6, max_teams_per_tourn=4)
