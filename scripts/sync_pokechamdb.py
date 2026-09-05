#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_pokechamdb.py - PokéCham DB 官方中文竞技与全形态数据同步管线

特性：
1. 原生 /zh-Hans 官方简体中文解析，无需外置多语言字典。
2. Playwright + 系统 Edge 驱动，支持通常/超级(Mega)/形态切换与独立六维数据抽取。
3. 原始快照缓存 (cache/raw_text/) 与解析彻底解耦，支持断点续跑 (--resume) 与只补缺失 (--only-missing)。
4. 规范化输出当前赛季全量环境与能力点 (SP/EV) 模板，供独立配队与 Wiki 前后端消费。
"""

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

BASE_URL = "https://pokechamdb.com"
CN_TYPES = {"一般", "火", "水", "草", "电", "冰", "格斗", "毒", "地面", "飞行", "超能力", "虫", "岩石", "幽灵", "龙", "恶", "钢", "妖精"}
REQUIRED_KEYS = ["moves", "items", "abilities", "natures", "partners"]
FORM_CANDIDATES = [
    "通常", "超级", "超级 X", "超级 Y", "超级Z", "超级 Z", "Mega", "Mega X", "Mega Y",
    "原始", "原始回归", "阿罗拉", "伽勒尔", "洗翠", "帕底亚",
    "雄性", "雌性", "普通", "变种", "形态"
]


def safe_name(s: str) -> str:
    s = s or "default"
    s = s.replace(" ", "_")
    s = re.sub(r"[^0-9A-Za-z\u4e00-\u9fff_\-]+", "", s)
    return s or "default"


def lines(text: str):
    return [x.strip() for x in text.splitlines() if x.strip()]


def find_line(ls, key):
    for i, x in enumerate(ls):
        if x == key or x.startswith(key):
            return i
    return -1


def cut(ls, start, ends):
    s = find_line(ls, start)
    if s < 0:
        return []
    e = len(ls)
    for i in range(s + 1, len(ls)):
        if any(ls[i] == end or ls[i].startswith(end) for end in ends):
            e = i
            break
    body = ls[s + 1:e]
    if body and body[0] in {"招式", "道具", "特性", "性格", "队友"}:
        body = body[1:]
    return body


def parse_rank(ls):
    if "▼" in ls:
        i = ls.index("▼")
        if i + 1 < len(ls) and ls[i + 1].isdigit():
            return int(ls[i + 1])
    for x in ls[:20]:
        if x.isdigit():
            return int(x)
    return None


def parse_no_name_types(ls, fallback_name):
    no = None
    name = fallback_name
    types = []
    for i, x in enumerate(ls):
        m = re.match(r"^No\.\s*(\d+)$", x)
        if m:
            no = int(m.group(1))
            if i + 1 < len(ls):
                name = ls[i + 1]
                j = i + 2
                while j < len(ls) and ls[j] in CN_TYPES:
                    types.append(ls[j])
                    j += 1
            break
    return no, name, types


def parse_base_stats(ls):
    keys = ["HP", "攻击", "防御", "特攻", "特防", "速度", "合计"]
    out = {}
    for i, x in enumerate(ls):
        if x in keys and i + 1 < len(ls):
            try:
                out[x] = int(ls[i + 1])
            except Exception:
                pass
    return out


def parse_name_percent_pairs(sec):
    rows = []
    i = 0
    while i < len(sec) - 1:
        name = sec[i]
        pct = sec[i + 1]
        m = re.match(r"^(\d+(?:\.\d+)?)%$", pct)
        if m:
            rows.append({"name": name, "usage": float(m.group(1))})
            i += 2
        else:
            i += 1
    return rows


def parse_partners(sec):
    rows = []
    i = 0
    while i < len(sec) - 1:
        name = sec[i]
        rank = sec[i + 1]
        m = re.match(r"^#(\d+)$", rank)
        if m:
            rows.append({"name": name, "rank": int(m.group(1))})
            i += 2
        else:
            i += 1
    return rows


def parse_ev_spreads(ls):
    rows = []
    start = find_line(ls, "能力点分布排名")
    if start < 0:
        start = find_line(ls, "能力点")
    if start < 0:
        return rows
    for x in ls[start + 1:]:
        if x in {"SUPPORT", "MOVE LIST"}:
            break
        parts = x.split("\t")
        if len(parts) == 8 and parts[0].isdigit():
            try:
                rows.append({
                    "rank": int(parts[0]),
                    "hp": int(parts[1]),
                    "atk": int(parts[2]),
                    "def": int(parts[3]),
                    "spa": int(parts[4]),
                    "spd": int(parts[5]),
                    "spe": int(parts[6]),
                    "usage": float(parts[7].replace("%", "")),
                })
            except Exception:
                pass
    return rows


def normalize_anchor(text, rank, slug):
    s = (text or "").strip()
    if rank:
        s = re.sub(rf"^\s*{rank}\s*", "", s)
    parts = [p for p in s.split() if not p.isdigit()]
    return parts[0] if parts else slug


def parse_detail_text(text, slug, url, anchor_text="", form="通常"):
    ls = lines(text)
    rank = parse_rank(ls)
    fallback = normalize_anchor(anchor_text, rank, slug)
    no, name, types = parse_no_name_types(ls, fallback)

    moves = parse_name_percent_pairs(cut(ls, "MOVES", ["ITEMS"]))
    items = parse_name_percent_pairs(cut(ls, "ITEMS", ["ABILITY"]))
    abilities = parse_name_percent_pairs(cut(ls, "ABILITY", ["NATURE"]))
    natures = parse_name_percent_pairs(cut(ls, "NATURE", ["PARTNER"]))
    partners = parse_partners(cut(ls, "PARTNER", ["深入探索", "能力点分布排名", "能力点", "SUPPORT", "MOVE LIST"]))

    data = {
        "record_id": f"{slug}__{safe_name(form)}",
        "slug": slug,
        "form": form,
        "url": url,
        "rank": rank,
        "no": no,
        "name": name,
        "types": types,
        "base_stats": parse_base_stats(ls),
        "moves": moves,
        "items": items,
        "abilities": abilities,
        "natures": natures,
        "partners": partners,
        "ev_spreads": parse_ev_spreads(ls),
        "warnings": [],
    }
    for k in REQUIRED_KEYS:
        if not data[k]:
            data["warnings"].append(f"empty_{k}")
    return data


def is_complete(record):
    if not record:
        return False
    if record.get("warnings"):
        return False
    return all(record.get(k) for k in REQUIRED_KEYS)


def get_links(page, lang, season, fmt):
    home = f"{BASE_URL}/{lang}?format={fmt}&season={season}&view=pokemon"
    print(f"正在读取主页导航: {home}")
    page.goto(home, wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    links = page.locator("a").evaluate_all("""
        els => els.map(a => ({text: a.innerText || '', href: a.getAttribute('href') || ''}))
                  .filter(x => x.href && x.href.includes('/pokemon/'))
    """)
    seen, out = set(), []
    for x in links:
        href = x.get("href") or ""
        if "/pokemon/" not in href:
            continue
        # Extract slug
        slug_part = href.split("/pokemon/", 1)[1].split("?", 1)[0].strip("/")
        if not slug_part or slug_part in seen:
            continue
        seen.add(slug_part)
        target_url = f"{BASE_URL}/{lang}/pokemon/{slug_part}?season={season}&format={fmt}"
        out.append({"slug": slug_part, "url": target_url, "anchor_text": x.get("text") or ""})
    return out


def collect_form_labels(page):
    labels = page.evaluate("""
    () => {
      const candidates = Array.from(document.querySelectorAll('button,a,[role="button"],[tabindex]'));
      return candidates.map(e => (e.innerText || e.textContent || '').trim())
        .filter(t => t && t.length <= 12);
    }
    """)
    found = []
    for label in labels:
        if label in FORM_CANDIDATES and label not in found:
            found.append(label)
    if not found:
        body = page.locator("body").inner_text()
        body_lines = set(lines(body))
        for label in FORM_CANDIDATES:
            if label in body_lines and label not in found:
                found.append(label)
    if not found:
        found = ["通常"]
    return found


def click_form(page, label):
    if label == "通常":
        pass
    selectors = [
        f'button:has-text("{label}")',
        f'a:has-text("{label}")',
        f'[role="button"]:has-text("{label}")',
        f'text="{label}"',
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if loc.count() > 0:
                loc.click(timeout=1200)
                page.wait_for_timeout(1000)
                return True
        except Exception:
            continue
    return label == "通常"


def load_existing_json(path: Path):
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return {x.get("record_id") or f"{x.get('slug')}__{safe_name(x.get('form','通常'))}": x for x in data if x.get("slug")}
    except Exception:
        return {}


def write_checkpoint(path: Path, records_by_id, ordered_ids):
    data = [records_by_id[rid] for rid in ordered_ids if rid in records_by_id]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def sync_season(season="M-5", fmt="double", lang="zh-Hans", limit=0, headless=True, channel="msedge", resume=True, only_missing=False, base_dir="."):
    root = Path(base_dir)
    out_dir = root / "data" / "meta"
    raw_dir = root / "cache" / "raw_text" / f"{season}_{fmt}"
    out_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)

    json_path = out_dir / f"pokechamdb_{season}_{fmt}_forms.json"
    checkpoint_path = out_dir / f"pokechamdb_{season}_{fmt}_forms.checkpoint.json"

    existing = load_existing_json(json_path) if resume else {}
    records = dict(existing)
    ordered_ids = list(records.keys())

    print(f"=== 启动 PokéCham DB 同步管线 ===")
    print(f"赛季: {season} | 赛制: {fmt} | 语言: {lang} | 上限: {'全量' if limit == 0 else limit}")
    print(f"输出路径: {json_path}")
    print(f"已有本地记录: {len(records)} 条")

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel=channel, headless=headless)
        except Exception:
            # 跨平台兼容：若系统未安装 Edge（如 GitHub Actions Linux），自动回退到原生 Chromium
            browser = p.chromium.launch(headless=headless)
        page = browser.new_page(locale="zh-CN")
        links = get_links(page, lang, season, fmt)
        if limit > 0:
            links = links[:limit]
        print(f"成功获取待同步宝可梦: {len(links)} 只")

        for i, item in enumerate(links, 1):
            slug = item["slug"]
            url = item["url"]
            print(f"[{i}/{len(links)}] {slug} 检测形态中...")
            try:
                page.goto(url, wait_until="domcontentloaded")
                page.wait_for_timeout(1000)
                form_labels = collect_form_labels(page)
                print(f"   发现形态 ({len(form_labels)}): {', '.join(form_labels)}")
            except Exception as e:
                print(f"   [警告] 打开 {slug} 页面失败: {e}")
                form_labels = ["通常"]

            for form in form_labels:
                record_id = f"{slug}__{safe_name(form)}"
                if record_id not in ordered_ids:
                    ordered_ids.append(record_id)
                txt_path = raw_dir / f"{record_id}.txt"

                if only_missing and is_complete(records.get(record_id)):
                    print(f"   - {form}: 跳过 (已有完整数据)")
                    continue

                if resume and txt_path.exists():
                    print(f"   - {form}: 从本地缓存读取快照")
                    text = txt_path.read_text(encoding="utf-8")
                else:
                    print(f"   - {form}: 浏览器抓取与形态切换")
                    try:
                        click_form(page, form)
                        text = page.locator("body").inner_text()
                        txt_path.write_text(text, encoding="utf-8")
                    except Exception as e:
                        print(f"   [错误] 抓取形态 {form} 异常: {e}")
                        continue

                parsed = parse_detail_text(text, slug, url, item.get("anchor_text", ""), form=form)
                records[record_id] = parsed
                write_checkpoint(checkpoint_path, records, ordered_ids)

        browser.close()

    final_data = [records[rid] for rid in ordered_ids if rid in records]
    json_path.write_text(json.dumps(final_data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"=== 同步完成 ===")
    print(f"有效数据总条目: {len(final_data)} (包含多形态)")
    print(f"最终输出: {json_path}")
    return final_data


def main():
    parser = argparse.ArgumentParser(description="PokéCham DB 实时数据同步器")
    parser.add_argument("--season", default="M-5", help="赛季名称 (例如 M-5, M-4)")
    parser.add_argument("--format", default="double", choices=["single", "double"], help="单打或双打赛制")
    parser.add_argument("--lang", default="zh-Hans", help="多语言路由 (默认 zh-Hans 简体中文)")
    parser.add_argument("--limit", type=int, default=0, help="限制抓取数量 (0 为抓取当前环境全量)")
    parser.add_argument("--channel", default="msedge", help="浏览器通道 (msedge 或 chrome)")
    parser.add_argument("--headless", default="true", choices=["true", "false"])
    parser.add_argument("--resume", action="store_true", default=True, help="开启断点续跑")
    parser.add_argument("--only-missing", action="store_true", help="仅补齐缺失项")
    parser.add_argument("--base-dir", default=".", help="工作目录根路径")
    args = parser.parse_args()

    sync_season(
        season=args.season,
        fmt=args.format,
        lang=args.lang,
        limit=args.limit,
        headless=(args.headless == "true"),
        channel=args.channel,
        resume=args.resume,
        only_missing=args.only_missing,
        base_dir=args.base_dir
    )


if __name__ == "__main__":
    main()
