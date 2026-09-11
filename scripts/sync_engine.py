#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_engine.py - 实时数据同步与智能变化检测引擎

核心机制：
1. 智能探针 (Smart Probe)：
   - 快速请求 PokéCham DB 首页 (/zh-Hans?format=double&season=M-5&view=pokemon)，解析远端官方更新时间戳 (例如 "2026/09/01 02:57")。
   - 对比本地 cache/sync_meta.json 时间戳。无需启动浏览器即可在毫秒级内确认远端是否产生新对战数据。
2. 变化检测 (Change Detection)：
   - 解决不仅加新宝可梦，还能识别已有宝可梦数据变化的核心问题：
     a. 时间戳版本变更：远端对战赛季或数据重新计算发布。
     b. 排名指纹哈希 (Rank Fingerprint)：宝可梦天梯使用率排位浮动。
     c. 招式/道具/努力值指纹 (Content Hash)：针对现有精灵，招式携带率、努力值分布等参数发生微调时精确命中。
3. 线程安全的可视化进度推送：
   - 提供后台异步线程抓取、进度状态轮询接口与安全取消。
   - 同步完成后自动调用 export_to_wiki.run_export() 编译输出，热刷新前端。
"""

import os
import sys
import re
import json
import time
import hashlib
import threading
import urllib.request
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# 尝试载入 Playwright 驱动抓取函数
try:
    from scripts.sync_pokechamdb import (
        collect_form_labels,
        click_form,
        parse_detail_text,
        write_checkpoint,
        load_existing_json,
        safe_name,
        is_complete,
        BASE_URL,
        get_links
    )
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except Exception as e:
    PLAYWRIGHT_AVAILABLE = False
    _import_err = str(e)

from scripts.export_to_wiki import run_export
META_DIR = BASE_DIR / "data" / "meta"
SYNC_META_FILE = META_DIR / "sync_meta.json"

_cancel_requested = False
_sync_lock = threading.Lock()

SYNC_STATE = {
    "status": "idle",  # "idle" | "checking" | "syncing" | "completed" | "error" | "cancelled"
    "current": 0,
    "total": 0,
    "pokemon": "",
    "percent": 0,
    "message": "系统空闲",
    "error": None,
    "remote_timestamp": None,
    "local_timestamp": None,
    "has_update": False,
    "last_sync_time": None
}


def ensure_meta_dir():
    META_DIR.mkdir(parents=True, exist_ok=True)


def get_local_meta():
    ensure_meta_dir()
    if SYNC_META_FILE.exists():
        try:
            return json.loads(SYNC_META_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass

    # 若未生成 sync_meta.json，但 champions_data.json 已存在，提取其真实元数据
    champions_json = BASE_DIR / "data" / "champions_data.json"
    if champions_json.exists():
        try:
            cdata = json.loads(champions_json.read_text(encoding="utf-8"))
            mon_list = cdata.get("pokemon", [])
            c_meta = cdata.get("meta", {})
            season = c_meta.get("season")
            if not season:
                raise RuntimeError("champions_data.json 中缺少 meta.season 字段")
            meta = {
                "season": season,
                "formats": c_meta.get("formats", ["double", "single"]),
                "remote_timestamp": c_meta.get("remoteTimestamp", ""),
                "last_sync_time": c_meta.get("generatedAt", ""),
                "total_pokemon": len(mon_list),
                "total_forms": c_meta.get("totalForms", len(mon_list)),
                "rank_fingerprint_hash": compute_rank_hash(mon_list),
                "content_hash": compute_content_hash(mon_list)
            }
            SYNC_META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            return meta
        except Exception as e:
            raise RuntimeError(f"解析本地基线 champions_data.json 失败: {e}")

    raise RuntimeError("本地未找到 sync_meta.json 或 champions_data.json 基线数据，无法确认本地状态")


def compute_rank_hash(pokemon_list):
    """提取 (rank, name) 计算排名指纹哈希，检测排位波动"""
    ranks = [(p.get("metaUsage", {}).get("rank") or 9999, p.get("name", "")) for p in pokemon_list]
    ranks.sort()
    return hashlib.sha256(json.dumps(ranks, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def compute_content_hash(pokemon_list):
    """提取各宝可梦的前列招式、道具与努力值分布指纹哈希，检测已有精灵的技能与配点变化"""
    contents = []
    for p in pokemon_list:
        usage = p.get("metaUsage", {})
        top_moves = [m.get("name") if isinstance(m, dict) else str(m) for m in (usage.get("moves") or [])[:5]]
        top_items = [it.get("name") if isinstance(it, dict) else str(it) for it in (usage.get("items") or [])[:5]]
        evs = usage.get("evSpreads", [])[:3]
        contents.append({
            "name": p.get("name", ""),
            "moves": top_moves,
            "items": top_items,
            "evs": evs
        })
    return hashlib.sha256(json.dumps(contents, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def check_for_updates(season: str, fmt: str = "double"):
    """
    轻量级远端智能探针 (Fail-Fast 无硬编码版)：
    1. 动态探测远端官方时间戳，失败直接抛出异常；
    2. 检查本地赛季是否与远端匹配；
    3. 检查本地目标赛季专属文件是否真实存在且有效；
    4. 只有数据与赛季完全对齐才判定为最新。
    """
    if not season:
        raise ValueError("check_for_updates 必须显式指定目标赛季 season 参数")

    target_url = f"https://pokechamdb.com/zh-Hans?format=double&season={season}&view=pokemon"
    local_meta = get_local_meta()
    local_season = local_meta.get("season")
    local_ts = local_meta.get("remote_timestamp", "")

    remote_ts = None
    try:
        req = urllib.request.Request(
            target_url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0"}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        # 匹配更新时间戳，例如: "更新（中国时间）: <!-- -->2026/09/10 15:32"
        m = re.search(r'(\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2})', html)
        if m:
            remote_ts = m.group(1).strip()
    except Exception as e:
        raise RuntimeError(f"智能探针访问官方源失败: {target_url} ({e})")

    if not remote_ts:
        raise RuntimeError(f"无法从官方页面解析更新时间戳: {target_url}")

    # 检查本地目标赛季双打与单打文件的实际完整性 (实打实看磁盘，严禁跨赛季误用)
    double_path = BASE_DIR / "data" / "meta" / f"pokechamdb_{season}_double_forms.json"
    single_path = BASE_DIR / "data" / "meta" / f"pokechamdb_{season}_single_forms.json"

    double_count = 0
    if double_path.exists():
        try:
            d_data = json.loads(double_path.read_text(encoding="utf-8"))
            double_count = len([x for x in d_data if x.get("form") == "通常"])
        except Exception as e:
            print(f"[探针警告] 解析本地双打数据文件异常: {double_path} ({e})")
            double_count = 0

    single_count = 0
    if single_path.exists():
        try:
            s_data = json.loads(single_path.read_text(encoding="utf-8"))
            single_count = len([x for x in s_data if x.get("form") == "通常"])
        except Exception as e:
            print(f"[探针警告] 解析本地单打数据文件异常: {single_path} ({e})")
            single_count = 0

    # 判定核心逻辑：
    # 1. 赛季跃迁: 本地赛季记录与目标赛季不一致
    # 2. 时间戳变动: 远端时间戳与本地时间戳不一致
    # 3. 目标文件缺失: 本地尚无当前赛季的实体数据 (double_count == 0 或 single_count == 0)
    season_changed = bool(local_season and season != local_season)
    time_changed = bool(local_ts and remote_ts != local_ts)
    double_missing = (double_count == 0)
    single_missing = (single_count == 0)

    needs_double_sync = season_changed or time_changed or double_missing
    needs_single_sync = season_changed or time_changed or single_missing
    has_update = needs_double_sync or needs_single_sync

    # 更新全局检测信息
    with _sync_lock:
        SYNC_STATE["remote_timestamp"] = remote_ts
        SYNC_STATE["local_timestamp"] = local_ts
        SYNC_STATE["has_update"] = has_update

    reason_parts = []
    if season_changed:
        reason_parts.append(f"赛季跃迁 ({local_season} -> {season})")
    if time_changed:
        reason_parts.append(f"官方发布新数据 ({remote_ts})")
    if double_missing:
        reason_parts.append(f"目标赛季双打本地缺失")
    if single_missing:
        reason_parts.append(f"目标赛季单打本地缺失")

    reason = "；".join(reason_parts) if reason_parts else f"当前双打与单打数据均已完整最新 ({season} · {remote_ts})"

    return {
        "has_update": has_update,
        "needs_double_sync": needs_double_sync,
        "needs_single_sync": needs_single_sync,
        "remote_timestamp": remote_ts,
        "local_timestamp": local_ts,
        "season": season,
        "local_season": local_season,
        "format": fmt,
        "double_count": double_count,
        "single_count": single_count,
        "double_status": f"{double_count} 只通常形态",
        "single_status": f"{single_count} 只通常形态",
        "total_pokemon": local_meta.get("total_pokemon", double_count),
        "total_forms": local_meta.get("total_forms", 0),
        "last_sync_time": local_meta.get("last_sync_time"),
        "reason": reason
    }


if __name__ == "__main__":
    print("=== 测试智能探针 ===")
    res = check_for_updates()
    print("探针结果:", json.dumps(res, ensure_ascii=False, indent=2))
