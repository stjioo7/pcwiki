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

## 🏗️ 架构与运行模态

项目兼具“**开箱即用**”与“**本地增强**”双重优势：

```text
┌─────────────────────────────────────────────────────────────┐
│                   浏览器客户端 (纯前端)                      │
│   index.html + js/ (wiki.js, copilot.js, calc.js)           │
│   依赖: data/champions_data.js (本地离线全量母库)            │
└──────────────────────────────┬──────────────────────────────┘
                               │ (可选 REST API)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                本地 Python 增强服务 (server.py)             │
│   - RapidOCR ONNX Runtime: 实机对战截图文字定位与物种提取   │
│   - Sync Engine: PokéCham DB 爬虫管道与数据变化检测         │
└─────────────────────────────────────────────────────────────┘
```

| 运行模态 | 依赖要求 | 功能表现 | 部署方式 |
| :--- | :--- | :--- | :--- |
| **纯前端脱机模式** | **零依赖**，只需现代浏览器 | 图鉴浏览、形态切换、VP模拟器、对战伤害计算均 100% 正常工作 | 直接双击 `index.html`，或发布到 GitHub Pages / Vercel |
| **本地服务增强模式** | Python 3.10+ 环境 | 额外支持实机截图 OCR 自动锁定与天梯数据一键同步 | 终端运行 `uv run python server.py`，访问本地服务 |

---

## 📁 项目目录结构

```text
pokemon_champions_wiki/
├── index.html            # 单页面主入口（整合对战副驾与竞技百科）
├── css/
│   └── style.css         # 赛博朋克深色电竞风格样式表
├── js/                   # 纯前端逻辑核心（零框架依赖，毫秒级响应）
│   ├── app.js            # 主程序引导与事件总线注册
│   ├── wiki.js           # 百科渲染、全量筛选、VP 加点器与同步模态交互
│   ├── copilot.js        # 对战副驾控制面板、Canvas 绘制与战局联动
│   ├── calc.js           # 标准宝可梦对战伤害浮动与斩杀概率计算器
│   └── constants.js      # 官方 18 属性克制字典与常量配置
├── data/                 # 竞技数据母库
│   ├── champions_data.js # 静态挂载母库（供前端离线免跨域加载）
│   ├── champions_data.json
│   ├── meta/             # 原始物种形态与天梯排位元数据缓存
│   └── raw/              # 官方 1026 只宝可梦译名与 835 招式解包表
├── scripts/              # 生产级数据采集与编译管线
│   ├── sync_engine.py    # 智能探针、变化检测与异步线程进度引擎
│   ├── sync_pokechamdb.py# 基于 Playwright 的全量形态采集管道
│   └── export_to_wiki.py # 多形态聚合、属性映射与数据热替换编译程序
├── server.py             # FastAPI 本地 OCR 与同步服务端
├── pyproject.toml        # Python 依赖规范配置
└── README.md             # 项目说明文档
```

---

## 🚀 快速上手

### 方式一：纯前端直接使用（无需安装任何后端）
直接在资源管理器中双击打开 `index.html`，或通过任何简易 HTTP 服务器（如 VS Code Live Server）打开。全部图鉴百科、形态切换与伤害计算功能立即可用。

### 方式二：启动全功能本地服务（推荐）

1. **环境准备**（推荐使用 [uv](https://github.com/astral-sh/uv) 极速管理环境）：
   ```powershell
   # 安装依赖
   uv pip install fastapi uvicorn rapidocr_onnxruntime pillow playwright

   # 首次使用需安装 Playwright 浏览器驱动
   uv run playwright install chromium
   ```

2. **启动主服务**：
   ```powershell
   uv run python server.py
   ```
   服务启动后将监听 `http://127.0.0.1:8765`。

3. **使用体验**：
   - 打开浏览器访问 `http://127.0.0.1:8765/`；
   - **截图识别**：在副驾面板直接按 `Ctrl + V` 粘贴游戏对战截图，OCR 将自动识别在场精灵并计算斩杀线；
   - **一键同步**：点击顶部右上角胶囊按钮 **`[ 235 只宝可梦 · 🔄 同步数据 ]`**，系统将自动探测官方最新数据并直观呈现抓取进度。

---

## ☁️ 云端全自动免运维同步 (GitHub Actions CI/CD)

项目原生内置了 **100% 免费** 的 GitHub Actions 自动化数据同步工作流（`.github/workflows/sync_data.yml`）：

1. **全自动定时同步**：
   - 每日北京时间凌晨 04:00 (`cron: '0 20 * * *'`)，云端 Ubuntu 容器自动唤醒；
   - 自动嗅探官方最新活跃赛季（如从 `M-5` 到 `M-6`，或新规公布）；
   - 若官方产生更新，云端自动使用 Playwright 无头浏览器抓取并重新编译数据母库；
   - 自动 commit 并 push 回仓库，全球 CDN / GitHub Pages 实时生效。

2. **随时手动触发**：
   - 在 GitHub 仓库页面点击 **Actions** -> **Automated Battle Data Sync** -> **Run workflow**，即可在云端即刻触发抓取。

3. **使用者收益**：
   - 本地**彻底无需常驻 Python 进程**，无需配置 Playwright；
   - 赛季更替完全自适应，无需手动修改代码或升级文件，打开网页永远是最新赛季。

---

## ⚖️ 免责声明 (Disclaimer)

- 本项目为宝可梦竞技爱好者制作的非商业性开源工具，旨在为玩家提供便捷的排位对战计算与图鉴查阅体验。
- 宝可梦（Pokémon）及相关名称、图像商标版权归任天堂（Nintendo）、Creatures 及 GAME FREAK 所有。
- 竞技排位与招式使用率数据源自 [PokéCham DB](https://pokechamdb.com)。
