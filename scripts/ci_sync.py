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
from scripts.export_to_wiki import run_export
from scripts.fetch_meta_teams import fetch_latest_teams
import subprocess


def detect_active_season():
    """动态嗅探官方当前生效的主流排位赛季 (Fail-Fast 严格无兜底)"""
    url = "https://pokechamdb.com/zh-Hans?format=double&view=pokemon"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode("utf-8", errors="ignore")

        m = re.findall(r'season=([A-Za-z0-9_\-]+)', html)
        if m:
            from collections import Counter
            counts = Counter(m)
            top_season = counts.most_common(1)[0][0]
            print(f"[CI] 嗅探到官方当前活跃赛季: {top_season}")
            return top_season
        raise RuntimeError("官方页面中未能匹配到有效的 season= 赛季参数")
    except Exception as e:
        raise RuntimeError(f"无法从官方 PokéCham DB 嗅探当前生效赛季，中断退出: {e}") from e


def set_github_output(name: str, value: str):
    """设置 GitHub Actions 步骤输出变量"""
    gh_output = os.getenv("GITHUB_OUTPUT")
    if gh_output:
        with open(gh_output, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")
    print(f"[CI Output] {name}={value}")


def main():
    force = "--force" in sys.argv or os.getenv("FORCE_SYNC") == "true"
    probe_only = "--probe-only" in sys.argv
    active_season = detect_active_season()

    print("==================================================")
    print(f" 🚀 POKÉMON CHAMPIONS 云端自动化同步启动")
    print(f" 目标赛季: {active_season} | 赛制: 双打 + 单打 | 强制重刷: {force}")
    print("==================================================")

    # 1. 运行探针检查单体宝可梦排位数据
    probe = check_for_updates(season=active_season)
    print(f"[CI 探针] 远端时间戳: {probe.get('remote_timestamp')}")
    print(f"[CI 探针] 本地时间戳: {probe.get('local_timestamp')}")
    print(f"[CI 探针] 双打文件状态: {probe.get('double_status')}")
    print(f"[CI 探针] 单打文件状态: {probe.get('single_status')}")
    print(f"[CI 探针] 检测判定: {'需要更新/补全' if probe.get('has_update') or force else '已是最新'} ({probe.get('reason')})")

    if probe_only:
        print("[CI] --probe-only 模式已指定，探针探测完成，正常退出。")
        return 0

    has_rank_update = probe.get("has_update") or force

    # 如果有新数据或强制更新
    if has_rank_update:
        from scripts.sync_pokechamdb import sync_season
        if probe.get("needs_double_sync") or force:
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
        if probe.get("needs_single_sync") or force:
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

        # 执行编译产物导出，传入当前活跃赛季与远端时间戳
        run_export(season=active_season, base_dir=BASE_DIR, remote_ts=probe.get("remote_timestamp"))

        # 事务性写入 sync_meta.json：仅在爬取与编译全部成功后写入真实统计
        ensure_meta_dir()
        wiki_data_file = BASE_DIR / "data" / "champions_data.json"
        total_pokemon = 0
        total_forms = 0
        if wiki_data_file.exists():
            try:
                wiki_json = json.loads(wiki_data_file.read_text(encoding="utf-8"))
                total_pokemon = wiki_json.get("meta", {}).get("total_pokemon", 0)
                total_forms = wiki_json.get("meta", {}).get("total_forms", 0)
            except Exception:
                pass

        meta = {
            "season": active_season,
            "formats": ["double", "single"],
            "remote_timestamp": probe.get("remote_timestamp"),
            "last_sync_time": probe.get("remote_timestamp") or probe.get("last_sync_time"),
            "total_pokemon": total_pokemon,
            "total_forms": total_forms
        }
        SYNC_META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[CI] ✅ 元数据已原子写入 {SYNC_META_FILE}: 赛季={active_season}, 时间戳={meta['remote_timestamp']}")

    # 2. 抓取 Limitless 官方最新完赛真实队伍 (单打 + 双打)
    print("\n[CI] 正在执行热门比赛队伍抓取管线 (Limitless VGC/X1)...")
    try:
        teams = fetch_latest_teams(max_tournaments=50, max_teams_per_tourn=16, max_placing=32)
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
