#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ci_sync.py - GitHub Actions 云端定时自动化同步与赛季感知入口

功能：
1. 跨平台（Linux / Windows / macOS）自动侦测当前官方生效赛季。
2. 毫秒级远端时间戳与环境指纹探针对比。
3. 若官方发布新数据或新赛季，自动启动无头浏览器拉取全量形态并编译产物。
4. 输出 GitHub Actions 变量 (data_updated=true/false)，驱动自动提交与静态分发。
"""

import os
import sys
import json
import re
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from scripts.sync_engine import check_for_updates, SYNC_META_FILE, ensure_meta_dir
from scripts.sync_pokechamdb import sync_season
from scripts.export_to_wiki import run_export
from scripts.fetch_meta_teams import fetch_latest_teams
import subprocess


def detect_active_season():
    """动态嗅探官方当前生效的主流排位赛季"""
    url = "https://pokechamdb.com/zh-Hans?format=double&view=pokemon"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=12) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        m = re.findall(r'season=([A-Za-z0-9_\-]+)', html)
        if m:
            from collections import Counter
            counts = Counter(m)
            top_season = counts.most_common(1)[0][0]
            print(f"[CI] 嗅探到官方当前活跃赛季: {top_season}")
            return top_season
    except Exception as e:
        print(f"[CI] 嗅探赛季异常: {e}，回退使用默认 M-5")
    return "M-5"


def set_github_output(name: str, value: str):
    """设置 GitHub Actions 步骤输出变量"""
    gh_output = os.getenv("GITHUB_OUTPUT")
    if gh_output:
        with open(gh_output, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")
    print(f"[CI Output] {name}={value}")


def main():
    force = "--force" in sys.argv or os.getenv("FORCE_SYNC") == "true"
    active_season = detect_active_season()
    fmt = "double"

    print("==================================================")
    print(f" 🚀 POKÉMON CHAMPIONS 云端自动化同步启动")
    print(f" 目标赛季: {active_season} | 赛制: {fmt} | 强制重刷: {force}")
    print("==================================================")

    # 1. 运行探针检查单体宝可梦排位数据
    probe = check_for_updates(season=active_season, fmt=fmt)
    print(f"[CI 探针] 远端时间戳: {probe.get('remote_timestamp')}")
    print(f"[CI 探针] 本地时间戳: {probe.get('local_timestamp')}")
    print(f"[CI 探针] 检测判定: {'需要更新' if probe.get('has_update') else '已是最新'}")

    has_rank_update = probe.get("has_update") or force

    # 如果有新数据或强制更新
    if has_rank_update:
        print("[CI] 正在执行双打排位抓取管线 (PokéCham DB)...")
        sync_season(
            season=active_season,
            fmt="double",
            lang="zh-Hans",
            headless=True,
            channel=None,
            resume=not force,
            base_dir=str(BASE_DIR)
        )
        print("[CI] 正在执行单打排位抓取管线 (PokéCham DB)...")
        sync_season(
            season=active_season,
            fmt="single",
            lang="zh-Hans",
            headless=True,
            channel=None,
            resume=not force,
            base_dir=str(BASE_DIR)
        )
        run_export(base_dir=BASE_DIR)
        ensure_meta_dir()
        meta = {
            "season": active_season,
            "format": fmt,
            "remote_timestamp": probe.get("remote_timestamp", "2026/09/01 02:57"),
            "last_sync_time": probe.get("last_sync_time") or "2026-09-05",
            "total_pokemon": probe.get("total_pokemon", 235),
            "total_forms": probe.get("total_forms", 314)
        }
        SYNC_META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # 2. 抓取 Limitless 官方最新完赛真实队伍 (单打 + 双打)
    print("\n[CI] 正在执行热门比赛队伍抓取管线 (Limitless VGC/X1)...")
    try:
        teams = fetch_latest_teams(max_tournaments=8, max_teams_per_tourn=4)
        print(f"[CI] 比赛队伍抓取完成，共载入 {len(teams)} 支队伍")
    except Exception as e:
        print(f"[CI] 队伍抓取出现异常 (非致命): {e}")

    # 3. 检查 data/ 目录是否有实际文件变动
    git_check = subprocess.run(
        ["git", "status", "--porcelain", "data/"],
        capture_output=True,
        text=True
    )
    has_git_changes = bool(git_check.stdout.strip())
    print(f"[CI Git Status] data/ 变动检测: {'有变动' if has_git_changes else '无变动'}")

    data_updated = has_rank_update or has_git_changes
    set_github_output("data_updated", "true" if data_updated else "false")
    set_github_output("season", active_season)

    if data_updated:
        print("[CI] ✅ 数据同步与编译全部完成！已标记 data_updated=true")
    else:
        print("[CI] ⚡ 所有数据均已是最新，标记 data_updated=false")

    return 0


if __name__ == "__main__":
    sys.exit(main())
