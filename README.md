# 《宝可梦冠军》实时对战副驾与竞技百科 (Pokémon Champions Copilot & Wiki)

[![Version](https://img.shields.io/badge/version-2.0.0-00e5ff.svg)](https://github.com/)
[![Architecture](https://img.shields.io/badge/architecture-Dual--Mode%20Hybrid-7c4dff.svg)](https://github.com/)
[![Data Source](https://img.shields.io/badge/data%20source-Pok%C3%A9Cham%20DB-ff007f.svg)](https://pokechamdb.com)

专为 2026 《宝可梦冠军》（Pokémon Champions）打造的官方竞技对战辅助工具与全量图鉴百科系统。

项目采用**双模态混合架构（Dual-Mode Architecture）**：既支持 100% 脱机运行的纯静态轻量前端，亦提供基于本地 Python 的 RapidOCR 视觉识别与官方数据实时同步增强引擎。

---

## 🌟 核心功能特性

### 1. 竞技图鉴百科 (Wiki Database)
- **全量官方物种与多形态支持**：完整覆盖当前天梯环境下全部 235 只对战宝可梦。
- **全分支形态平滑切换**：支持 79 种超级进化（包含喷火龙/超梦的双向 X/Y、烈咬陆鲨 Mega Z 等多分支形态）以及阿罗拉、洗翠、伽勒尔、帕底亚等地区形态。切换形态时自动热替换官方高清立绘、属性、特性与种族值。
- **动态 VP 努力值/能力值模拟器**：支持 50 级无努力、满努力、极速、极攻等模板快速分配与微调，动态计算极限实数值。
- **官方天梯竞技配点透视**：直观呈现招式携带率、主流道具排行、性格搭配、常见队友协同指数与努力值模板。
- **双向攻防克制矩阵**：实时根据多属性组合计算弱点（2x/4x）、抗性（0.5x/0.25x）与完全免疫属性。

### 2. 实时对战副驾 (Battle Copilot)
- **截图即时分析**：直接将游戏实机对战截图拖入界面，或在网页任意位置按 `Ctrl + V` 粘贴剪贴板画面。
- **OCR 自动化提取**：结合本地 RapidOCR 神经网络引擎，精准锁定双方在场宝可梦、剩余血量百分比与已确认招式。
- **斩杀线浮动预判**：纯前端执行标准宝可梦伤害计算公式（考虑属性克制、本系加成 STAB、能力升降阶级与 85%~100% 随机浮动区间），给出明确的“斩杀概率”与“残血收割提示”。
- **脱机手动兜底**：若未启动后端 OCR，亦可通过前端模糊搜索下拉框秒级手动选取对战双方，零门槛使用全部攻防分析。

### 3. 官方数据智能同步与多维变化检测 (Live Sync Engine)
- **毫秒级远端时间戳探针（Smart Probe）**：点击顶部同步按钮时，无需启动重型浏览器，后台探针毫秒级探测 PokéCham DB 官方发布的最新排位更新时间戳。
- **三级渐进式变化检测**：不仅能检测新增宝可梦，更能精准感知已有精灵的环境更替：
  1. *时间戳校验*：官方赛季或数据重算版本对比；
  2. *天梯排位指纹（Rank Shift Hash）*：物种排名浮动立即失配触发；
  3. *内容指纹（Content & Sets Hash）*：招式携带率微调、主流道具变更或努力值分布调整精确命中。
- **可视化高科技进度呈现**：提供实时百分比进度条（`X / N (YY%)`）、当前正在同步的物种名称与操作状态，支持安全取消。
- **零刷新热更新**：同步完成后前端自动重载静态母库，图鉴与副驾无缝接入最新数据，无需手动按 F5 刷新页面。

---

## 🏗️ 架构与运行方式

项目采用 **Jamstack 纯静态 + 自动化 CI 离线数据管道 + RapidOCR 视觉侧车** 架构：

```text
┌─────────────────────────────────────────────────────────────┐
│                 GitHub Pages 静态分发 (全球 CDN)             │
│   - index.html + js/ (teams.js, wiki.js, copilot.js, ...)   │
│   - 纯客户端 JavaScript 内存索引，零后端依赖，0 毫秒延迟     │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │ (可选本地视觉增强)
               ▼                              ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│ 云端 GitHub Actions 自动化 CI │ │ 本地 RapidOCR 识别服务      │
│ - 每日自动同步单双打排位数据 │ │ (server.py 监听 8765 端口) │
│ - 自动抓取 Limitless 完赛队伍│ │ - 实机截图 OCR 物种与血量  │
│ - 编译并推送静态 JS 母库     │ │ - 纯视觉侧车，零同步冗余   │
└──────────────────────────────┘ └────────────────────────────┘
```

---

## 📁 项目目录结构

```text
pokemon_champions_wiki/
├── index.html            # 单页面主入口（热门队伍、竞技百科、对战副驾）
├── server.py             # FastAPI 本地 RapidOCR 视觉识别引擎 (端口: 8765)
├── css/
│   └── style.css         # 赛博朋克深色电竞风格样式表
├── js/                   # 纯前端逻辑核心（零框架依赖，毫秒级响应）
│   ├── app.js            # 主程序引导与事件注册
│   ├── teams.js          # 🏆 热门排位队伍（Limitless 大赛完赛阵容渲染与检索）
│   ├── wiki.js           # 📖 竞技图鉴百科（全量形态切换、VP 加点器、单双打切换）
│   ├── copilot.js        # ⚡ 实时对战副驾（Canvas 战局预览与实时攻防推演）
│   ├── calc.js           # 标准宝可梦伤害计算公式与斩杀线浮动预判
│   └── constants.js      # 官方 18 属性克制字典与常量配置
├── data/                 # 竞技数据母库（静态资产）
│   ├── champions_data.js # 单双打排位大数据母库
│   ├── champions_teams.js# 锦标赛完赛队伍数据集
│   └── meta/             # 官方原始抓取缓存
├── scripts/              # 离线数据采集与编译管线 (CLI / CI)
│   ├── ci_sync.py        # 云端 CI 自动化入口与赛季嗅探探针
│   ├── sync_pokechamdb.py# PokéCham DB 官方天梯大数据采集器
│   ├── fetch_meta_teams.py# Limitless 锦标赛完赛队伍采集器
│   ├── sync_engine.py    # 智能探针与数据完整性校验
│   └── export_to_wiki.py # 数据清洗与静态 JS 编译器
├── pyproject.toml        # 依赖规范配置 (FastAPI, RapidOCR, Playwright)
└── README.md             # 项目说明文档
```

---

## 🚀 快速上手

### 方式一：纯前端直接使用（零后端依赖）
直接在浏览器中打开 `index.html`，或通过任何静态托管（GitHub Pages、VS Code Live Server 等）访问。
全部排位队伍检索、图鉴百科、单双打切换、VP 模拟器均立即可用，副驾支持手动点选宝可梦即时推演。

### 方式二：开启本地 RapidOCR 视觉识别（对战副驾自动截图识别）
如需在副驾面板直接按 `Ctrl + V` 粘贴游戏截图自动识别双方宝可梦与残血：
1. **安装环境依赖**：
   ```powershell
   uv pip install fastapi uvicorn rapidocr_onnxruntime pillow python-multipart
   ```
2. **启动本地识别引擎**：
   ```powershell
   uv run python server.py
   ```
   启动后打开 `http://127.0.0.1:8765/`，副驾即可自动调用本地神经网络进行毫秒级战局识别。

### 本地手动同步最新数据（CLI 离线管线）
若希望在本地立即拉取官方最新排位数据并重新编译：
```powershell
uv run python scripts/ci_sync.py
```

---

## ☁️ 云端全自动免运维同步 (GitHub Actions CI/CD)

项目原生内置了 **100% 免费** 的 GitHub Actions 自动化数据同步工作流（`.github/workflows/sync_data.yml`）：

1. **全自动定时同步**：
   - 每日北京时间凌晨 04:00 (`cron: '0 20 * * *'`)，云端容器自动唤醒；
   - 自动嗅探官方最新活跃赛季与数据更新时间戳；
   - 若官方产生更新，云端自动抓取单双打大数据与完赛队伍，重新编译并 push 回仓库；
   - GitHub Pages 实时刷新生效。

2. **随时手动触发**：
   - 在 GitHub 仓库页面点击 **Actions** -> **Automated Battle Data Sync** -> **Run workflow** 即可即刻执行。

---

## ⚖️ 免责声明 (Disclaimer)

- 本项目为宝可梦竞技爱好者制作的非商业性开源工具，旨在为玩家提供便捷的排位对战计算与图鉴查阅体验。
- 宝可梦（Pokémon）及相关名称、图像商标版权归任天堂（Nintendo）、Creatures 及 GAME FREAK 所有。
- 竞技排位与招式使用率数据源自 [PokéCham DB](https://pokechamdb.com)。
