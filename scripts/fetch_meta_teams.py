#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
scripts/fetch_meta_teams.py - 从 Limitless (play.limitlesstcg.com) 全量抓取真实排位与锦标赛队伍
特性：
1. 本地磁盘缓存 (cache/limitless/)，断点续传，零重复请求，防止 IP 限频；
2. 全量回溯 Limitless 所有历史已完赛 VGC 双打与 Singles/1v1 赛事；
3. 支持提取冠亚军、4强、8强、16强以及瑞士轮高胜率队伍；
4. 100% 自动对齐 Champions Dex 本地词典与三语标准化；
5. 自动输出 champions_teams.json 与 champions_teams.js。
"""

import argparse
import hashlib
import json
import os
import re
import ssl
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

BASE_URL = "https://play.limitlesstcg.com"
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
}
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

CACHE_DIR = Path("cache/limitless")


def http_get(url: str, timeout: int = 20, use_cache: bool = True) -> str:
    """带本地磁盘缓存的 HTTP GET 请求"""
    if use_cache:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        url_hash = hashlib.md5(url.encode('utf-8')).hexdigest()
        cache_file = CACHE_DIR / f"{url_hash}.html"
        if cache_file.exists() and cache_file.stat().st_size > 100:
            try:
                return cache_file.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                pass

    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, context=SSL_CTX, timeout=timeout) as resp:
        content = resp.read().decode('utf-8', errors='ignore')

    if use_cache and len(content) > 100:
        try:
            cache_file = CACHE_DIR / f"{hashlib.md5(url.encode('utf-8')).hexdigest()}.html"
            cache_file.write_text(content, encoding='utf-8')
        except Exception:
            pass

    return content


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


def translate_item(item_en: str, items_dict: dict, mon_en_to_zh: dict) -> str:
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


def parse_teamlist_html(html: str, mon_en_to_zh: dict, avatar_map: dict, types_map: dict, moves_dict: dict, items_dict: dict):
    """从 Limitless 队伍页面解析 6 只宝可梦"""
    parts = html.split('<div class="pkmn">')[1:]
    team_pokemon = []
    showdown_lines = []

    for block in parts:
        name_m = re.search(r'<span>(.*?)</span>', block)
        species_en = name_m.group(1).strip() if name_m else "Unknown"

        item_m = re.search(r'<div class="item">(.*?)</div>', block)
        item_en = item_m.group(1).strip() if item_m else ""

        ability_m = re.search(r'<div class="ability">(?:Ability:\s*)?(.*?)</div>', block)
        ability_en = ability_m.group(1).strip() if ability_m else ""

        nature_m = re.search(r'<div class="nature">(?:Nature:\s*)?(.*?)</div>', block)
        nature_en = nature_m.group(1).strip() if nature_m else ""

        attacks_m = re.search(r'<ul class="attacks">(.*?)</ul>', block, re.DOTALL)
        moves_raw = re.findall(r'<li>(.*?)</li>', attacks_m.group(1)) if attacks_m else []
        moves_clean = [m.strip() for m in moves_raw if m.strip() and "<a" not in m]

        # Showdown 格式文本
        sh_line = species_en
        if item_en:
            sh_line += f" @ {item_en}"
        showdown_lines.append(sh_line)
        if ability_en:
            showdown_lines.append(f"Ability: {ability_en}")
        if nature_en:
            showdown_lines.append(f"{nature_en} Nature")
        for m in moves_clean:
            showdown_lines.append(f"- {m}")
        showdown_lines.append("")

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


def get_placing_tag(placing: int) -> str:
    if placing == 1:
        return "🥇 冠军 (1st)"
    elif placing == 2:
        return "🥈 亚军 (2nd)"
    elif placing in (3, 4):
        return "🥉 四强 (Top 4)"
    elif placing <= 8:
        return "🏅 八强 (Top 8)"
    elif placing <= 16:
        return "🎖️ 十六强 (Top 16)"
    elif placing <= 32:
        return "🎗️ 三十二强 (Top 32)"
    else:
        return f"上位 (Rank {placing})"


def fetch_all_tournaments(games: list[str] = ["VGC"]) -> list[dict]:
    """抓取所有完赛锦标赛索引列表"""
    all_tournaments = {}
    for game in games:
        list_url = f"{BASE_URL}/tournaments/completed?game={game}"
        print(f"[-] 正在检索完赛赛事列表 ({game}): {list_url} ...")
        try:
            html = http_get(list_url, use_cache=False)
            tourn_matches = re.findall(r'<a[^>]*href=["\'](/tournament/([a-f0-9]+)/standings)["\'][^>]*>(.*?)</a>', html)
            for full_path, t_id, t_name_raw in tourn_matches:
                clean_name = re.sub(r'<[^>]+>', '', t_name_raw).strip()
                if t_id not in all_tournaments:
                    all_tournaments[t_id] = {
                        "id": t_id,
                        "game": game,
                        "name": clean_name or f"Tournament {t_id[:8]}",
                        "standings_url": f"{BASE_URL}/tournament/{t_id}/standings"
                    }
                elif clean_name and (all_tournaments[t_id]["name"].startswith("Tournament ") or not all_tournaments[t_id]["name"]):
                    all_tournaments[t_id]["name"] = clean_name
        except Exception as e:
            print(f"[!] 检索 {game} 赛事失败: {e}")

    return list(all_tournaments.values())


def fetch_meta_teams(
    max_tournaments: Optional[int] = 50,
    max_teams_per_tourn: int = 16,
    max_placing: int = 32,
    games: list[str] = ["VGC"]
) -> list[dict]:
    print("================================================================")
    print("=== 开始全量从 Limitless 抓取真实 Champions 排位/赛事队伍 ===")
    print("================================================================")

    tournaments = fetch_all_tournaments(games)
    print(f"[*] 成功发现已完赛比赛总数: {len(tournaments)} 场")

    if max_tournaments:
        tournaments = tournaments[:max_tournaments]
        print(f"[*] 当前批次计划抓取前: {len(tournaments)} 场比赛")

    mon_en_to_zh, avatar_map, types_map, moves_dict, items_dict = load_local_translation_catalogs()
    all_teams = []
    seen_fingerprints = set()

    for idx, tourn in enumerate(tournaments, start=1):
        t_name = tourn["name"]
        t_url = tourn["standings_url"]
        is_single = any(k in t_name.lower() for k in ["x1", "single", "1v1", "singles"])
        format_label = "single" if is_single else "double"
        format_cn = "单打 (Singles)" if is_single else "双打 (Doubles)"

        print(f"\n[{idx}/{len(tournaments)}] 抓取赛事: 《{t_name}》 [{format_cn}]")

        try:
            st_html = http_get(t_url, use_cache=True)
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

                record_m = re.search(r'(\d+\s*-\s*\d+\s*-\s*\d+)', r)
                record_str = record_m.group(1).replace(' ', '') if record_m else ""

                if placing > max_placing:
                    continue

                placing_tag = get_placing_tag(placing)
                tl_full_url = f"{BASE_URL}{tl_path}"

                tl_html = http_get(tl_full_url, use_cache=True)
                team_pokemon, showdown_text = parse_teamlist_html(
                    tl_html, mon_en_to_zh, avatar_map, types_map, moves_dict, items_dict
                )

                if len(team_pokemon) >= 4:
                    # 指纹去重 (基于 6 宝可梦 species + items 联合签名)
                    fp = tuple(sorted((m["enSpecies"], m["enItem"]) for m in team_pokemon))
                    if fp in seen_fingerprints:
                        continue
                    seen_fingerprints.add(fp)

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
                    print(f"   [{tourn_team_count}] {placing_tag} {player_id} ({record_str}) -> 6 Mons: {[p['species'] for p in team_pokemon]}")

                if tourn_team_count >= max_teams_per_tourn:
                    break

        except Exception as e:
            print(f"  [!] 抓取比赛 《{t_name}》 失败: {e}")

    print(f"\n================================================================")
    print(f"=== 全量抓取完成！共收集高水平真实队伍: {len(all_teams)} 支 ===")
    print(f"================================================================")

    out_dir = Path("data")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_json = out_dir / "champions_teams.json"
    out_js = out_dir / "champions_teams.js"

    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(all_teams, f, ensure_ascii=False, indent=2)

    with open(out_js, "w", encoding="utf-8") as f:
        f.write("window.CHAMPIONS_TEAMS = " + json.dumps(all_teams, ensure_ascii=False, indent=2) + ";\n")

    print(f"[OK] 已生成前端队伍数据: {out_json} ({out_json.stat().st_size / 1024:.2f} KB)")
    print(f"[OK] 已生成前端队伍脚本: {out_js} ({out_js.stat().st_size / 1024:.2f} KB)")
    return all_teams


# Backward compatibility alias for CI workflows
fetch_latest_teams = fetch_meta_teams


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="从 Limitless 全量抓取真实比赛队伍")
    parser.add_argument("--max-tournaments", type=int, default=50, help="最多抓取的完赛赛事数量 (默认: 50)")
    parser.add_argument("--max-teams", type=int, default=16, help="单场比赛最多抓取的队伍数量 (默认: 16)")
    parser.add_argument("--max-placing", type=int, default=32, help="最深抓取的名次 (默认: 32)")
    args = parser.parse_args()

    fetch_meta_teams(
        max_tournaments=args.max_tournaments,
        max_teams_per_tourn=args.max_teams,
        max_placing=args.max_placing
    )
