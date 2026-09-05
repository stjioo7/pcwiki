import io
import re
import json
import os
import uvicorn
from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

from scripts.sync_engine import check_for_updates, start_sync, get_progress, cancel_sync

app = FastAPI(title="Pokemon Champions OCR & Sync Engine", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ocr_engine = RapidOCR()

# 1. 载入 207 只完整的《宝可梦冠军》官方宝可梦数据库 (包含种族值、属性、学招表)
CHAMPIONS_DB = {}
POKEMON_LIST = []
try:
    with open("data/champions_data.json", "r", encoding="utf-8") as f:
        data = json.load(f)
        POKEMON_LIST = data.get("pokemon", [])
        for p in POKEMON_LIST:
            CHAMPIONS_DB[p["name"]] = p
            CHAMPIONS_DB[p["id"]] = p
except Exception as e:
    print("Warning loading champions_data.json:", e)

# 2. 载入官方全部 1026 只宝可梦中文译名
ALL_POKEMON_NAMES = {}
if os.path.exists("data/raw/monsname_syn.json"):
    try:
        with open("data/raw/monsname_syn.json", "r", encoding="utf-8") as f:
            nd = json.load(f)
            for item in nd.get("mSDataSet", []):
                idx = item.get("Index", 0)
                txt = item.get("OriginalText", "").strip()
                if txt and idx > 0:
                    ALL_POKEMON_NAMES[txt] = idx
    except Exception as e:
        print("Warning loading monsname_syn.json:", e)

# 3. 载入官方全部 835 招式中文名称
ALL_MOVE_NAMES = set()
if os.path.exists("data/raw/wazaname.json"):
    try:
        with open("data/raw/wazaname.json", "r", encoding="utf-8") as f:
            wd = json.load(f)
            for item in wd.get("mSDataSet", []):
                txt = item.get("OriginalText", "").strip()
                if txt:
                    ALL_MOVE_NAMES.add(txt)
    except Exception as e:
        print("Warning loading wazaname.json:", e)

IGNORE_PHRASES = [
    "识别", "ROI", "Canvas", "在场", "残血", "锁定", "切换", "对位",
    "#", "隐形岩", "扣除", "出场", "存活", "实机", "倒计时", "必备",
    "排位", "热门", "推荐", "COMMAND", "查看状态", "招式说明", "战斗",
    "有效果", "没有效果", "效果绝佳", "无效果", "伤害", "返回"
]

STATUS_KEYWORDS = {
    "睡眠": "睡眠 Zzz",
    "Zzz": "睡眠 Zzz",
    "zzz": "睡眠 Zzz",
    "麻痹": "麻痹 ⚡",
    "灼伤": "灼伤 🔥",
    "烧伤": "灼伤 🔥",
    "冻伤": "冻伤 ❄️",
    "冰冻": "冻伤 ❄️",
    "中毒": "中毒 ☠️",
    "剧毒": "剧毒 ☠️"
}

def calculate_std_hp_50(base_hp):
    return int((2 * base_hp + 31) // 2) + 60

@app.get("/api/status")
@app.get("/api/health")
def get_status():
    return {
        "status": "online",
        "engine": "RapidOCR ONNX (CPU)",
        "pokemon_count": len(POKEMON_LIST),
        "total_known_species": len(ALL_POKEMON_NAMES),
        "total_known_moves": len(ALL_MOVE_NAMES)
    }

@app.get("/api/sync/check")
def api_sync_check(season: str = "M-5", fmt: str = "double"):
    return check_for_updates(season=season, fmt=fmt)

@app.post("/api/sync/start")
def api_sync_start(force: bool = False, limit: int = 0, season: str = "M-5", fmt: str = "double"):
    return start_sync(season=season, fmt=fmt, force=force, limit=limit)

@app.get("/api/sync/progress")
def api_sync_progress():
    return get_progress()

@app.post("/api/sync/cancel")
def api_sync_cancel():
    return cancel_sync()

@app.post("/api/recognize")
async def recognize_screenshot(file: UploadFile = File(...)):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    width, height = image.size

    ocr_result, elapse = ocr_engine(image)

    raw_items = []
    if ocr_result:
        for item in ocr_result:
            box, text, score = item[0], item[1].strip(), float(item[2])
            cx = (box[0][0] + box[2][0]) / 2
            cy = (box[0][1] + box[2][1]) / 2
            raw_items.append({
                "text": text,
                "cx": cx,
                "cy": cy,
                "norm_x": cx / width,
                "norm_y": cy / height,
                "score": score
            })

    # 1. 扫描宝可梦候选 (在全量 1026 只宝可梦名字中匹配)
    pokemon_candidates = []
    for it in raw_items:
        t = it["text"]
        if any(ign in t for ign in IGNORE_PHRASES):
            continue

        # 先查 champions 库 (207 只)
        matched_mon = None
        for name, mon in CHAMPIONS_DB.items():
            if isinstance(name, str) and (name == t or (name in t and len(t) <= len(name) + 2)):
                matched_mon = mon
                break

        # 再查全世代名称库 (1026 只)
        if not matched_mon:
            for name, dex_id in ALL_POKEMON_NAMES.items():
                if name == t or (name in t and len(t) <= len(name) + 2):
                    if dex_id in CHAMPIONS_DB:
                        matched_mon = CHAMPIONS_DB[dex_id]
                    else:
                        matched_mon = {
                            "id": dex_id,
                            "name": name,
                            "baseStats": {"hp": 80, "atk": 80, "def": 80, "spa": 80, "spd": 80, "spe": 80},
                            "types": ["Normal"],
                            "learnset": []
                        }
                    break

        if matched_mon:
            pokemon_candidates.append({
                "mon": matched_mon,
                "cx": it["cx"],
                "cy": it["cy"],
                "norm_x": it["norm_x"],
                "norm_y": it["norm_y"],
                "text": t
            })

    # 2. 扫描 HP、状态与招式
    player_hp_cur = None
    player_hp_max = None
    player_hp_pct = None
    opponent_hp_pct = None
    opponent_status = None
    detected_moves = []

    for it in raw_items:
        t = it["text"]

        # 我方血量比值格式：131/173, 81 / 237, 240/240
        hp_m = re.search(r'(\d{2,3})\s*/\s*(\d{2,3})', t)
        if hp_m and "扣除" not in t:
            cur, mx = int(hp_m.group(1)), int(hp_m.group(2))
            if 0 < cur <= mx:
                player_hp_cur = cur
                player_hp_max = mx
                player_hp_pct = round((cur / mx) * 100, 1)

        # 敌方血量百分比格式：85%, 77%, 100%
        pct_m = re.search(r'(\d{1,3})\s*%', t)
        if pct_m and "HP" not in t and "超速" not in t:
            val = float(pct_m.group(1))
            if 1 <= val <= 100:
                opponent_hp_pct = val

        # 状态异常
        for kw, status_name in STATUS_KEYWORDS.items():
            if kw in t:
                opponent_status = status_name
                break

        # 招式提取：如果在 835 个官方招式列表中，或者符合战斗招式命名
        clean = re.sub(r'[\d/\s%+O]+', '', t)
        if 2 <= len(clean) <= 6 and clean in ALL_MOVE_NAMES:
            if clean not in detected_moves and clean not in [c["mon"]["name"] for c in pokemon_candidates]:
                detected_moves.append(clean)

    # 3. 区分敌我双方宝可梦
    # 规则：敌方在上方 (norm_y 偏小，通常 < 0.45)，我方在下方 (norm_y 偏大，通常 > 0.5)
    detected_player = None
    detected_opponent = None

    if pokemon_candidates:
        # 按 cy 升序排列
        pokemon_candidates.sort(key=lambda c: c["cy"])
        if len(pokemon_candidates) >= 2:
            detected_opponent = pokemon_candidates[0]["mon"]
            detected_player = pokemon_candidates[-1]["mon"]
        elif len(pokemon_candidates) == 1:
            c = pokemon_candidates[0]
            if c["norm_y"] < 0.5:
                detected_opponent = c["mon"]
            else:
                detected_player = c["mon"]

    # 兜底：若全图未找到宝可梦文字，默认使用数据库前两项
    if not detected_player:
        detected_player = POKEMON_LIST[0] if POKEMON_LIST else {"id": 1, "name": "妙蛙种子", "baseStats": {"hp": 45}}
    if not detected_opponent:
        detected_opponent = POKEMON_LIST[1] if len(POKEMON_LIST) > 1 else {"id": 4, "name": "小火龙", "baseStats": {"hp": 39}}

    # HP 动态计算兜底 (不再针对 134/212 写死硬编码)
    if player_hp_cur is None or player_hp_max is None:
        base_hp = detected_player.get("baseStats", {}).get("hp", 80)
        player_hp_max = calculate_std_hp_50(base_hp)
        player_hp_cur = player_hp_max
        player_hp_pct = 100.0

    if opponent_hp_pct is None:
        opponent_hp_pct = 100.0

    # 招式动态填充：若未识别到招式，直接读取该宝可梦自身的实际学招表，绝不写死！
    active_moves = []
    if detected_moves:
        active_moves = detected_moves[:4]
    elif detected_player.get("learnset"):
        active_moves = [m["name"] for m in detected_player["learnset"][:4]]

    return {
        "success": True,
        "player": {
            "id": detected_player["id"],
            "name": detected_player["name"],
            "hpCur": player_hp_cur,
            "hpMax": player_hp_max,
            "hpPct": player_hp_pct
        },
        "opponent": {
            "id": detected_opponent["id"],
            "name": detected_opponent["name"],
            "hpPct": opponent_hp_pct,
            "status": opponent_status
        },
        "moves": active_moves
    }

# 挂载静态资源服务，使得 http://127.0.0.1:8765/ 可直接完整访问前端 Wiki 与 Copilot
static_dir = os.path.dirname(os.path.abspath(__file__))
app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

if __name__ == "__main__":
    print("Starting General Pokemon Champions OCR & Sync Engine on http://127.0.0.1:8765 ...")
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
