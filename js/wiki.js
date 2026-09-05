/**
 * wiki.js - 竞技图鉴浏览、无限流渲染、VP加点模拟器与招式详情
 */

const CHUNK_SIZE = 24;
const PAGE_SIZE = 24;
let currentRenderedCount = 0;
let currentPage = 1;
let scrollObserver = null;
let activeFormIndex = 0;
let currentFormat = localStorage.getItem('pc_format') || 'double';

function setFormat(fmt) {
  currentFormat = fmt;
  localStorage.setItem('pc_format', fmt);
  const fmtDblBtn = document.getElementById('formatDoubleBtn');
  const fmtSglBtn = document.getElementById('formatSingleBtn');
  if (fmtDblBtn) fmtDblBtn.classList.toggle('active', fmt === 'double');
  if (fmtSglBtn) fmtSglBtn.classList.toggle('active', fmt === 'single');
  applyFilters();
}

function initTypeFilterBadges() {
  const container = document.getElementById('typeFilters');
  Object.keys(TYPE_TRANSLATION).forEach(typeEn => {
    const btn = document.createElement('button');
    btn.className = `type-badge type-${typeEn}`;
    btn.dataset.type = typeEn;
    btn.innerText = TYPE_TRANSLATION[typeEn];
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-badge').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTypeFilter = typeEn;
      applyFilters();
    });
    container.appendChild(btn);
  });

  const allBtn = container.querySelector('[data-type="all"]');
  allBtn.addEventListener('click', () => {
    document.querySelectorAll('.type-badge').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    activeTypeFilter = 'all';
    applyFilters();
  });
}

// 绑定交互事件
function bindControls() {
  // 顶部主导航 Tab 切换 (实时副驾 vs 竞技图鉴百科)
  const tabCopilotBtn = document.getElementById('tabCopilotBtn');
  const tabWikiBtn = document.getElementById('tabWikiBtn');
  const copilotView = document.getElementById('copilotView');
  const wikiView = document.getElementById('wikiView');

  if (tabCopilotBtn && tabWikiBtn && copilotView && wikiView) {
    tabCopilotBtn.addEventListener('click', () => {
      tabCopilotBtn.classList.add('active');
      tabWikiBtn.classList.remove('active');
      copilotView.classList.add('active');
      copilotView.style.display = 'block';
      wikiView.classList.remove('active');
      wikiView.style.display = 'none';
    });

    tabWikiBtn.addEventListener('click', () => {
      tabWikiBtn.classList.add('active');
      tabCopilotBtn.classList.remove('active');
      wikiView.classList.add('active');
      wikiView.style.display = 'block';
      copilotView.classList.remove('active');
      copilotView.style.display = 'none';
      if (currentRenderedCount === 0 && filteredPokemonList.length > 0) {
        renderNextChunk();
      }
    });
  }

  // 初始化对战副驾监听
  initCopilotControls();

  document.getElementById('searchInput').addEventListener('input', applyFilters);
  document.getElementById('megaOnlyFilter').addEventListener('change', applyFilters);
  document.getElementById('sortSelect').addEventListener('change', applyFilters);

  // 赛制切换按钮 (双打 / 单打)
  const fmtDblBtn = document.getElementById('formatDoubleBtn');
  const fmtSglBtn = document.getElementById('formatSingleBtn');
  if (fmtDblBtn && fmtSglBtn) {
    fmtDblBtn.classList.toggle('active', currentFormat === 'double');
    fmtSglBtn.classList.toggle('active', currentFormat === 'single');
    fmtDblBtn.addEventListener('click', () => setFormat('double'));
    fmtSglBtn.addEventListener('click', () => setFormat('single'));
  }

  // 模式切换
  const scrollBtn = document.getElementById('modeScrollBtn');
  const pageBtn = document.getElementById('modePageBtn');

  scrollBtn.addEventListener('click', () => {
    viewMode = 'scroll';
    scrollBtn.classList.add('active');
    pageBtn.classList.remove('active');
    document.getElementById('paginationBar').style.display = 'none';
    document.getElementById('scrollSentinel').style.display = 'block';
    applyFilters();
  });

  pageBtn.addEventListener('click', () => {
    viewMode = 'page';
    pageBtn.classList.add('active');
    scrollBtn.classList.remove('active');
    document.getElementById('paginationBar').style.display = 'flex';
    document.getElementById('scrollSentinel').style.display = 'none';
    currentPage = 1;
    applyFilters();
  });

  // 分页按钮
  document.getElementById('prevPageBtn').addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderPage();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  document.getElementById('nextPageBtn').addEventListener('click', () => {
    const totalPages = Math.ceil(filteredPokemonList.length / PAGE_SIZE);
    if (currentPage < totalPages) {
      currentPage++;
      renderPage();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  });

  // Modal 关闭
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  const modal = document.getElementById('detailModal');
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // 初始化官方数据实时同步控件
  initSyncControls();
}

// ==========================================================================
// 官方对战数据实时同步控制器 (Live Sync Engine Frontend)
// ==========================================================================
let syncPollInterval = null;
let syncCurrentState = 'idle';

function initSyncControls() {
  const syncBtn = document.getElementById('headerSyncBtn');
  const syncModal = document.getElementById('syncModal');
  const closeBtn = document.getElementById('syncModalCloseBtn');
  const cancelBtn = document.getElementById('syncCancelBtn');
  const forceBtn = document.getElementById('syncForceBtn');

  if (!syncBtn || !syncModal) return;

  const getApiBase = () => {
    if (window.location.protocol === 'file:') return 'http://127.0.0.1:8765';
    if (window.location.port === '8765') return '';
    return 'http://127.0.0.1:8765';
  };

  const openSyncModal = () => {
    syncModal.classList.add('open');
    document.getElementById('syncStepCheck').style.display = 'block';
    document.getElementById('syncStepProgress').style.display = 'none';
    document.getElementById('syncStepResult').style.display = 'none';
    if (forceBtn) forceBtn.style.display = 'none';
    cancelBtn.innerText = '关闭';
    syncBtn.classList.remove('syncing');
    checkRemoteSync();
  };

  const closeSyncModal = () => {
    if (syncCurrentState === 'syncing') {
      if (confirm('同步任务正在后台运行，确定要关闭窗口吗？（任务将在后台继续执行）')) {
        syncModal.classList.remove('open');
      }
      return;
    }
    syncModal.classList.remove('open');
    if (syncPollInterval) {
      clearInterval(syncPollInterval);
      syncPollInterval = null;
    }
  };

  syncBtn.addEventListener('click', openSyncModal);
  if (closeBtn) closeBtn.addEventListener('click', closeSyncModal);
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      if (syncCurrentState === 'syncing') {
        fetch(`${getApiBase()}/api/sync/cancel`, { method: 'POST' }).catch(() => {});
        syncCurrentState = 'cancelled';
        cancelBtn.innerText = '关闭';
      } else {
        closeSyncModal();
      }
    });
  }

  if (forceBtn) {
    forceBtn.addEventListener('click', () => {
      triggerSync(true);
    });
  }

  syncModal.addEventListener('click', (e) => {
    if (e.target === syncModal && syncCurrentState !== 'syncing') {
      closeSyncModal();
    }
  });

  async function checkRemoteSync() {
    const checkText = document.getElementById('syncCheckText');
    if (checkText) checkText.innerText = '正在连接 PokéCham DB 官方数据源探针，检测最新版本...';

    try {
      const resp = await fetch(`${getApiBase()}/api/sync/check?season=M-5&format=double`, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const info = await resp.json();

      document.getElementById('syncStepCheck').style.display = 'none';
      document.getElementById('syncStepResult').style.display = 'block';
      const resultIcon = document.getElementById('syncResultIcon');
      const resultTitle = document.getElementById('syncResultTitle');
      const resultDesc = document.getElementById('syncResultDesc');

      if (info.has_update) {
        if (resultIcon) resultIcon.innerText = '🔔';
        if (resultTitle) resultTitle.innerText = '发现官方新数据';
        if (resultDesc) {
          resultDesc.innerHTML = `检测到官方发布了新的天梯与物种数据！<br>远端更新时间：<strong>${info.remote_timestamp}</strong><br>本地版本时间：<strong>${info.local_timestamp || '未同步'}</strong><br><br>即将自动开启后台数据同步...`;
        }
        setTimeout(() => {
          triggerSync(false);
        }, 1200);
      } else {
        if (resultIcon) resultIcon.innerText = '✅';
        if (resultTitle) resultTitle.innerText = '数据已是最新';
        if (resultDesc) {
          resultDesc.innerHTML = `官方发布时间：<strong>${info.remote_timestamp}</strong><br>本地对战数据完全吻合（共 <strong>${info.total_pokemon || 235}</strong> 只宝可梦、<strong>${info.total_forms || 314}</strong> 个形态）。<br><span style="color:var(--text-dim);font-size:0.8rem;display:inline-block;margin-top:0.5rem;">无需重复抓取。如需强制重拉全部官方快照，可点击下方按钮。</span>`;
        }
        if (forceBtn) forceBtn.style.display = 'inline-block';
        cancelBtn.innerText = '知道了';
      }
    } catch (err) {
      console.warn('Sync check failed:', err);
      document.getElementById('syncStepCheck').style.display = 'none';
      document.getElementById('syncStepResult').style.display = 'block';
      const resultIcon = document.getElementById('syncResultIcon');
      const resultTitle = document.getElementById('syncResultTitle');
      const resultDesc = document.getElementById('syncResultDesc');
      if (resultIcon) resultIcon.innerText = '⚠️';
      if (resultTitle) resultTitle.innerText = '未能连接后端服务';
      if (resultDesc) {
        resultDesc.innerHTML = `实时同步需要本地 Python 后台运行支持。<br>请在终端运行：<br><code style="background:rgba(0,0,0,0.5);padding:0.2rem 0.6rem;border-radius:4px;color:#00e5ff;">python server.py</code><br>服务就绪后再次点击即可自动探测。`;
      }
      cancelBtn.innerText = '关闭';
    }
  }

  async function triggerSync(force = false) {
    syncCurrentState = 'syncing';
    document.getElementById('syncStepCheck').style.display = 'none';
    document.getElementById('syncStepResult').style.display = 'none';
    document.getElementById('syncStepProgress').style.display = 'block';
    if (forceBtn) forceBtn.style.display = 'none';
    cancelBtn.innerText = '取消同步';
    syncBtn.classList.add('syncing');

    document.getElementById('syncProgressBar').style.width = '2%';
    document.getElementById('syncCounter').innerText = '0% (准备中)';
    document.getElementById('syncCurrentPokemon').innerText = '正在启动官方数据流...';
    document.getElementById('syncDetailMsg').innerText = '启动 Chromium 引擎分析形态切换...';

    try {
      const resp = await fetch(`${getApiBase()}/api/sync/start?force=${force}&season=M-5&format=double`, {
        method: 'POST'
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (e) {
      console.error('Trigger sync error:', e);
    }

    if (syncPollInterval) clearInterval(syncPollInterval);
    syncPollInterval = setInterval(pollSyncProgress, 600);
  }

  async function pollSyncProgress() {
    try {
      const resp = await fetch(`${getApiBase()}/api/sync/progress`, { cache: 'no-store' });
      if (!resp.ok) return;
      const state = await resp.json();

      if (state.status === 'syncing') {
        const cur = state.current || 0;
        const tot = state.total || 0;
        const pct = state.percent || 0;
        document.getElementById('syncProgressBar').style.width = `${pct}%`;
        document.getElementById('syncCounter').innerText = tot > 0 ? `${cur} / ${tot} (${pct}%)` : `${pct}%`;
        if (state.pokemon) {
          document.getElementById('syncCurrentPokemon').innerText = state.pokemon;
        }
        if (state.message) {
          document.getElementById('syncDetailMsg').innerText = state.message;
        }
      } else if (state.status === 'completed') {
        clearInterval(syncPollInterval);
        syncPollInterval = null;
        syncCurrentState = 'completed';
        syncBtn.classList.remove('syncing');

        document.getElementById('syncProgressBar').style.width = '100%';
        document.getElementById('syncCounter').innerText = '100%';
        document.getElementById('syncStepProgress').style.display = 'none';
        document.getElementById('syncStepResult').style.display = 'block';

        const resultIcon = document.getElementById('syncResultIcon');
        const resultTitle = document.getElementById('syncResultTitle');
        const resultDesc = document.getElementById('syncResultDesc');
        if (resultIcon) resultIcon.innerText = '🎉';
        if (resultTitle) resultTitle.innerText = '同步完成！';
        if (resultDesc) {
          resultDesc.innerHTML = `${state.message || '官方最新竞技数据已成功抓取并编译！'}<br>百科图鉴与实时副驾已无缝热刷新。`;
        }
        cancelBtn.innerText = '完成';

        // 动态热重载前端数据，无需用户手动按 F5 刷新！
        try {
          const freshResp = await fetch(`data/champions_data.json?t=${Date.now()}`);
          if (freshResp.ok) {
            const freshJson = await freshResp.json();
            window.CHAMPIONS_DATA = freshJson;
            allPokemonList = freshJson.pokemon || [];
            onDataLoaded();
            const badge = document.getElementById('totalCountBadge');
            if (badge) badge.innerText = `${allPokemonList.length} 只宝可梦`;
          }
        } catch (reloadErr) {
          console.warn('Hot reloading local champions_data.json failed:', reloadErr);
        }
      } else if (state.status === 'error') {
        clearInterval(syncPollInterval);
        syncPollInterval = null;
        syncCurrentState = 'error';
        syncBtn.classList.remove('syncing');

        document.getElementById('syncStepProgress').style.display = 'none';
        document.getElementById('syncStepResult').style.display = 'block';
        const resultIcon = document.getElementById('syncResultIcon');
        const resultTitle = document.getElementById('syncResultTitle');
        const resultDesc = document.getElementById('syncResultDesc');
        if (resultIcon) resultIcon.innerText = '❌';
        if (resultTitle) resultTitle.innerText = '同步遇到错误';
        if (resultDesc) {
          resultDesc.innerHTML = `${state.message || state.error || '抓取或编译过程异常'}`;
        }
        cancelBtn.innerText = '关闭';
      } else if (state.status === 'cancelled') {
        clearInterval(syncPollInterval);
        syncPollInterval = null;
        syncCurrentState = 'cancelled';
        syncBtn.classList.remove('syncing');

        document.getElementById('syncStepProgress').style.display = 'none';
        document.getElementById('syncStepResult').style.display = 'block';
        const resultIcon = document.getElementById('syncResultIcon');
        const resultTitle = document.getElementById('syncResultTitle');
        const resultDesc = document.getElementById('syncResultDesc');
        if (resultIcon) resultIcon.innerText = '⏹️';
        if (resultTitle) resultTitle.innerText = '已取消';
        if (resultDesc) {
          resultDesc.innerText = '同步已被用户终止。';
        }
        cancelBtn.innerText = '关闭';
      }
    } catch (e) {
      console.warn('Error polling sync progress:', e);
    }
  }
}

// 建立触底无限加载监听器
function initInfiniteScrollObserver() {
  const sentinel = document.getElementById('scrollSentinel');
  scrollObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && viewMode === 'scroll') {
      if (currentRenderedCount < filteredPokemonList.length) {
        renderNextChunk();
      }
    }
  }, { rootMargin: '200px' });

  scrollObserver.observe(sentinel);
}

// ==========================================================================
// 实时加载官方母库数据 (优先直读已编译的全量 207 只官方宝可梦与 Mega 进化数据)
// ==========================================================================
async function loadDatabase() {
  const statusEl = document.getElementById('sourceStatus');
  const countBadge = document.getElementById('totalCountBadge');
  const loadingIndicator = document.getElementById('loadingIndicator');

  // 1. 优先直读已编译的官方 207 只母库 (包含全量官方学招表与 72 个 Mega 进化数据，零网络延迟)
  if (window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon && window.CHAMPIONS_DATA.pokemon.length > 0) {
    allPokemonList = window.CHAMPIONS_DATA.pokemon;
    if (statusEl) {
      statusEl.innerHTML = `<span class="status-dot connected"></span> 官方数据库就绪 (已装载)`;
    }
    if (countBadge) {
      countBadge.innerText = `${allPokemonList.length} 只宝可梦`;
    }
    if (loadingIndicator) loadingIndicator.style.display = 'none';
    onDataLoaded();
    return;
  }

  // 2. 检查本地存储缓存
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      allPokemonList = JSON.parse(cached);
      updateStatusConnected(allPokemonList.length, true);
      if (loadingIndicator) loadingIndicator.style.display = 'none';
      onDataLoaded();
      return;
    } catch (e) {
      console.warn("缓存数据解析异常", e);
    }
  }

  // 3. 兜底回退
  fallbackToLocalOffline();
}

// 解析招式名称与威力
function buildWazaMap(wazaData, wazaNameData) {
  const nameMap = {};
  if (wazaNameData && wazaNameData.mSDataSet) {
    wazaNameData.mSDataSet.forEach(item => {
      if (item.LabelName && item.OriginalText) {
        nameMap[item.LabelName] = item.OriginalText;
      }
    });
  }

  const map = {};
  if (Array.isArray(wazaData)) {
    wazaData.forEach(entry => {
      const id = parseInt(entry.id, 10);
      const name = nameMap[entry.ms_lbl] || `招式 #${id}`;
      const power = parseInt(entry.power, 10) || 0;
      const accuracy = parseInt(entry.accuracy, 10) || 100;
      const type = TYPE_INDEX_MAP[parseInt(entry.type, 10)] || "Normal";
      const cat = entry.category === "0" ? "物理" : (entry.category === "1" ? "特殊" : "变化");
      const priority = parseInt(entry.priority, 10) || 0;

      map[id] = {
        id: id,
        name: name,
        power: power,
        accuracy: accuracy,
        type: type,
        category: cat,
        priority: priority
      };
    });
  }
  return map;
}

// 解析学招表 (物种 rawId -> [招式ID])
function buildLearnsetMap(wazaLearnData) {
  const map = {};
  if (Array.isArray(wazaLearnData)) {
    wazaLearnData.forEach(entry => {
      if (entry.id && entry.waza) {
        const moveIds = entry.waza.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        map[entry.id] = moveIds;
      }
    });
  }
  return map;
}

function buildAbilityMap(tokuseiData, tokuseiInfoData) {
  const map = {};

  if (tokuseiData && tokuseiData.mSDataSet) {
    tokuseiData.mSDataSet.forEach(item => {
      if (item.LabelName && item.OriginalText) {
        const match = item.LabelName.match(/TOKUSEI_(\d+)/);
        if (match) {
          const id = parseInt(match[1], 10);
          map[id] = {
            id: id,
            name: item.OriginalText,
            desc: "游戏内实装战斗特性。"
          };
        }
      }
    });
  }

  if (tokuseiInfoData && tokuseiInfoData.mSDataSet) {
    tokuseiInfoData.mSDataSet.forEach(item => {
      if (item.LabelName && item.OriginalText) {
        const match = item.LabelName.match(/TOKUSEIINFO_SYN_(\d+)/);
        if (match) {
          const id = parseInt(match[1], 10);
          if (map[id]) {
            map[id].desc = item.OriginalText.replace(/[\n\r]+/g, ' ');
          }
        }
      }
    });
  }

  return map;
}

async function fetchFromCdnInBackground() {
  try {
    const [
      personalRes, nameRes, tokuseiRes, tokuseiInfoRes,
      wazaRes, wazaLearnRes, wazaNameRes
    ] = await Promise.all([
      fetch(`${CDN_BASE}/masterdata/personal.json`),
      fetch(`${CDN_BASE}/rom-txt/sch/monsname_syn.json`),
      fetch(`${CDN_BASE}/rom-txt/sch/tokusei.json`),
      fetch(`${CDN_BASE}/rom-txt/sch/tokuseiinfo_syn.json`),
      fetch(`${CDN_BASE}/masterdata/waza.json`),
      fetch(`${CDN_BASE}/masterdata/waza_learn.json`),
      fetch(`${CDN_BASE}/rom-txt/sch/wazaname.json`)
    ]);

    if (personalRes.ok && nameRes.ok) {
      const personalData = await personalRes.json();
      const nameData = await nameRes.json();
      const tokuseiData = tokuseiRes.ok ? await tokuseiRes.json() : null;
      const tokuseiInfoData = tokuseiInfoRes.ok ? await tokuseiInfoRes.json() : null;
      const wazaData = wazaRes.ok ? await wazaRes.json() : null;
      const wazaLearnData = wazaLearnRes.ok ? await wazaLearnRes.json() : null;
      const wazaNameData = wazaNameRes.ok ? await wazaNameRes.json() : null;

      const nameMap = {};
      nameData.mSDataSet.forEach(item => {
        if (item.LabelName && item.OriginalText) nameMap[item.LabelName] = item.OriginalText;
      });
      const abilityMap = buildAbilityMap(tokuseiData, tokuseiInfoData);
      const wazaMap = buildWazaMap(wazaData, wazaNameData);
      const learnsetMap = buildLearnsetMap(wazaLearnData);

      const freshList = parseChampoutData(personalData, nameMap, abilityMap, wazaMap, learnsetMap);
      if (freshList.length > 0) {
        allPokemonList = freshList;
        localStorage.setItem(CACHE_KEY, JSON.stringify(freshList));
        updateStatusConnected(allPokemonList.length, false);
      }
    }
  } catch (e) {}
}

function fallbackToLocalOffline() {
  const statusEl = document.getElementById('sourceStatus');
  const countBadge = document.getElementById('totalCountBadge');
  const loadingIndicator = document.getElementById('loadingIndicator');

  if (window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon) {
    allPokemonList = window.CHAMPIONS_DATA.pokemon;
  }
  if (statusEl) {
    statusEl.innerHTML = `<span class="status-dot connected"></span> 官方数据库就绪 (已装载)`;
  }
  if (countBadge) {
    countBadge.innerText = `${allPokemonList.length} 只宝可梦`;
  }
  if (loadingIndicator) loadingIndicator.style.display = 'none';
  onDataLoaded();
}

function updateStatusConnected(count, fromCache) {
  const statusEl = document.getElementById('sourceStatus');
  if (statusEl) {
    statusEl.innerHTML = `<span class="status-dot connected"></span> 官方数据库就绪`;
  }
  const countBadge = document.getElementById('totalCountBadge');
  if (countBadge) {
    countBadge.innerText = `${count} 只宝可梦`;
  }
}

// 解析 champout 底层结构并挂载全量特性与学招表
function parseChampoutData(personalArray, nameMap, abilityMap, wazaMap = {}, learnsetMap = {}) {
  const list = [];
  const megaMap = {};

  personalArray.forEach(entry => {
    if (entry.is_valid !== "1") return;
    const dexNo = parseInt(entry.no, 10);
    if (isNaN(dexNo) || dexNo <= 0) return;

    const formNo = parseInt(entry.fo, 10);
    const rawName = nameMap[entry.ms_name_lbl] || `宝可梦 #${dexNo}`;

    const type1 = TYPE_INDEX_MAP[parseInt(entry.type1, 10)] || "Normal";
    const type2 = entry.type2 !== "0" && entry.type2 !== entry.type1 
                  ? (TYPE_INDEX_MAP[parseInt(entry.type2, 10)] || null) 
                  : null;
    const types = type2 ? [type1, type2] : [type1];

    const stats = {
      hp: parseInt(entry.hp, 10) || 1,
      atk: parseInt(entry.atk, 10) || 1,
      def: parseInt(entry.def, 10) || 1,
      spa: parseInt(entry.spatk, 10) || 1,
      spd: parseInt(entry.spdef, 10) || 1,
      spe: parseInt(entry.agi, 10) || 1
    };

    // 装配特性
    const abilities = [];
    const t0 = parseInt(entry.toku0, 10);
    const t1 = parseInt(entry.toku1, 10);
    const t2 = parseInt(entry.toku2, 10);

    if (t0 && abilityMap[t0]) abilities.push({ name: abilityMap[t0].name, desc: abilityMap[t0].desc, tag: '第一特性' });
    if (t1 && t1 !== t0 && abilityMap[t1]) abilities.push({ name: abilityMap[t1].name, desc: abilityMap[t1].desc, tag: '第二特性' });
    if (t2 && t2 !== t0 && t2 !== t1 && abilityMap[t2]) abilities.push({ name: abilityMap[t2].name, desc: abilityMap[t2].desc, tag: '隐藏特性 (梦特)' });
    if (abilities.length === 0) abilities.push({ name: "通常特性", desc: "战斗中发挥效果的标准特性", tag: "特性" });

    // 装配学招表
    const rawId = entry.id;
    const moveIds = learnsetMap[rawId] || [];
    const learnset = [];
    moveIds.forEach(mId => {
      if (wazaMap[mId]) learnset.push(wazaMap[mId]);
    });

    // 招式智能排序：高频竞技招式排在最前面，随后按威力倒序
    learnset.sort((a, b) => {
      const aHot = HIGH_PRIORITY_MOVES.includes(a.name) ? 1 : 0;
      const bHot = HIGH_PRIORITY_MOVES.includes(b.name) ? 1 : 0;
      if (aHot !== bHot) return bHot - aHot;
      return b.power - a.power;
    });

    const avatar = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dexNo}.png`;
    const isMega = (formNo === 1 && (entry.ff === "51" || entry.ffge === "0"));

    const itemObj = {
      id: dexNo,
      formId: formNo,
      rawId: entry.id,
      name: rawName,
      enName: `Species #${dexNo}`,
      types: types,
      avatar: avatar,
      baseStats: stats,
      abilities: abilities,
      learnset: learnset,
      isMega: isMega,
      tags: isMega ? ["超级进化 (Mega)"] : []
    };

    if (isMega) {
      if (!megaMap[dexNo]) megaMap[dexNo] = [];
      megaMap[dexNo].push(itemObj);
    } else if (formNo === 0) {
      list.push(itemObj);
    }
  });

  // 关联 Mega 形态
  list.forEach(p => {
    if (megaMap[p.id] && megaMap[p.id].length > 0) {
      const megaForm = megaMap[p.id][0];
      p.mega = {
        supported: true,
        megaName: `超级${p.name}`,
        megaStone: `专属进化石`,
        types: megaForm.types,
        avatar: megaForm.avatar,
        baseStats: megaForm.baseStats,
        ability: megaForm.abilities[0] ? megaForm.abilities[0].name : "超级进化强化特性",
        abilityDesc: megaForm.abilities[0] ? megaForm.abilities[0].desc : "超级进化后获得的专属增强特性"
      };
      p.tags.push("Mega进化");
    } else {
      p.mega = { supported: false };
    }
  });

  // 融合对战截图验证补丁 (保障子弹拳等基础对位与排位大数据)
  if (window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon) {
    window.CHAMPIONS_DATA.pokemon.forEach(patchP => {
      const target = list.find(l => l.id === patchP.id);
      if (target) {
        if (patchP.mega && patchP.mega.supported) target.mega = patchP.mega;
        if (patchP.tags) target.tags = Array.from(new Set([...target.tags, ...patchP.tags]));
        if (patchP.metaUsage) target.metaUsage = patchP.metaUsage;
        if (patchP.abilities && patchP.abilities.length > 0) target.abilities = patchP.abilities;
        if ((!target.learnset || target.learnset.length === 0) && patchP.commonMoves) {
          target.learnset = patchP.commonMoves.map((m, idx) => ({
            id: 9000 + idx,
            name: m.name,
            power: m.power || 40,
            accuracy: 100,
            type: m.type,
            category: m.category || "物理",
            priority: m.name === "子弹拳" ? 1 : 0
          }));
        }
      }
    });
  }

  return list;
}

function onDataLoaded() {
  document.getElementById('loadingIndicator').style.display = 'none';
  document.getElementById('gridSection').style.display = 'block';
  applyFilters();
  if (typeof populateMonSelects === 'function') {
    populateMonSelects();
  }
}

// ==========================================================================
// 筛选、搜索与渲染
// ==========================================================================
function applyFilters() {
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const megaOnly = document.getElementById('megaOnlyFilter').checked;
  const sortMode = document.getElementById('sortSelect').value;

  let filtered = allPokemonList.filter(p => {
    const matchQuery = p.name.toLowerCase().includes(query) ||
                       p.enName.toLowerCase().includes(query) ||
                       String(p.id).includes(query) ||
                       (p.abilities && p.abilities.some(a => a.name.toLowerCase().includes(query))) ||
                       (p.learnset && p.learnset.some(m => m.name.toLowerCase().includes(query)));
    const matchType = (activeTypeFilter === 'all') || p.types.includes(activeTypeFilter);
    const matchMega = !megaOnly || (p.mega && p.mega.supported);
    return matchQuery && matchType && matchMega;
  });

  // 排序
  filtered.sort((a, b) => {
    if (sortMode === 'rank_asc') {
      const getRank = (p) => {
        if (p.meta && p.meta[currentFormat] && p.meta[currentFormat].rank) {
          return p.meta[currentFormat].rank;
        }
        if (currentFormat === 'double' && p.metaUsage && p.metaUsage.rank) {
          return p.metaUsage.rank;
        }
        return 999999;
      };
      const rankA = getRank(a);
      const rankB = getRank(b);
      if (rankA !== rankB) return rankA - rankB;
      return a.id - b.id;
    }
    const bstA = Object.values(a.baseStats).reduce((sum, v) => sum + v, 0);
    const bstB = Object.values(b.baseStats).reduce((sum, v) => sum + v, 0);
    if (sortMode === 'id') return a.id - b.id;
    if (sortMode === 'bst_desc') return bstB - bstA;
    if (sortMode === 'spe_desc') return b.baseStats.spe - a.baseStats.spe;
    if (sortMode === 'atk_desc') return b.baseStats.atk - a.baseStats.atk;
    if (sortMode === 'spa_desc') return b.baseStats.spa - a.baseStats.spa;
    if (sortMode === 'hp_desc') return b.baseStats.hp - a.baseStats.hp;
    return 0;
  });

  filteredPokemonList = filtered;
  document.getElementById('matchCount').innerText = filteredPokemonList.length;

  if (viewMode === 'scroll') {
    currentRenderedCount = 0;
    document.getElementById('pokemonGrid').innerHTML = '';
    renderNextChunk();
  } else {
    currentPage = 1;
    renderPage();
  }
}

function renderNextChunk() {
  const grid = document.getElementById('pokemonGrid');
  const nextSlice = filteredPokemonList.slice(currentRenderedCount, currentRenderedCount + CHUNK_SIZE);

  if (currentRenderedCount === 0 && nextSlice.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 4rem; color: var(--text-dim);">未找到符合条件的宝可梦</div>`;
    document.getElementById('renderStatusText').innerText = `已渲染 0 / 0 只`;
    return;
  }

  nextSlice.forEach(p => {
    grid.appendChild(createPokemonCardElement(p));
  });

  currentRenderedCount += nextSlice.length;
  document.getElementById('renderStatusText').innerText = `已流式加载 ${currentRenderedCount} / ${filteredPokemonList.length} 只 (向下滚动继续)`;

  const sentinel = document.getElementById('scrollSentinel');
  if (currentRenderedCount >= filteredPokemonList.length) {
    sentinel.innerHTML = `<span class="loading-more-text">✓ 已加载当前筛选下的全部 ${filteredPokemonList.length} 只宝可梦</span>`;
  } else {
    sentinel.innerHTML = `<span class="loading-more-text">⚡ 向下滚动自动加载更多... (${currentRenderedCount}/${filteredPokemonList.length})</span>`;
  }
}

function renderPage() {
  const grid = document.getElementById('pokemonGrid');
  grid.innerHTML = '';

  const totalPages = Math.ceil(filteredPokemonList.length / PAGE_SIZE) || 1;
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageSlice = filteredPokemonList.slice(start, start + PAGE_SIZE);

  if (pageSlice.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 4rem; color: var(--text-dim);">未找到符合条件的宝可梦</div>`;
  } else {
    pageSlice.forEach(p => {
      grid.appendChild(createPokemonCardElement(p));
    });
  }

  document.getElementById('pageInfo').innerText = `第 ${currentPage} / ${totalPages} 页 (共 ${filteredPokemonList.length} 只)`;
  document.getElementById('prevPageBtn').disabled = (currentPage <= 1);
  document.getElementById('nextPageBtn').disabled = (currentPage >= totalPages);
  document.getElementById('renderStatusText').innerText = `当前第 ${currentPage} 页 (展示 ${pageSlice.length} 只)`;
}

function createPokemonCardElement(p) {
  const bst = Object.values(p.baseStats).reduce((sum, v) => sum + v, 0);
  const card = document.createElement('div');
  card.className = 'pokemon-card';
  card.onclick = () => openDetailModal(p);

  const typeBadgesHtml = p.types.map(t => 
    `<span class="type-pill type-${t}">${TYPE_TRANSLATION[t] || t}</span>`
  ).join('');

  const tagsHtml = (p.tags || []).map(t => 
    `<span class="card-tag-item">${t}</span>`
  ).join('');

  const abilityPreview = p.abilities && p.abilities[0] ? p.abilities[0].name : '';
  const moveCount = (p.learnset && p.learnset.length) || 0;
  const currentMeta = (p.meta && p.meta[currentFormat]) ? p.meta[currentFormat] : (currentFormat === 'double' ? p.metaUsage : null);
  const currentRank = currentMeta ? currentMeta.rank : null;
  const rankBadgeHtml = currentRank
    ? `<span class="card-rank-badge">🔥 ${currentFormat === 'single' ? '单打' : '双打'} Rank #${currentRank}</span>`
    : '';

  card.innerHTML = `
    <div class="card-top">
      <span class="pokemon-id">#${String(p.id).padStart(3, '0')}</span>
      ${rankBadgeHtml}
      ${p.mega && p.mega.supported ? `<span class="card-mega-badge">${p.mega.forms && p.mega.forms.length > 1 ? 'MEGA 多分支' : 'MEGA SUPPORT'}</span>` : ''}
    </div>
    <div class="card-center">
      <img class="pokemon-thumb" src="${p.avatar}" alt="${p.name}" loading="lazy" onerror="this.src='https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/items/poke-ball.png'">
      <div class="pokemon-info">
        <div class="pokemon-name">${p.name}</div>
        <div class="pokemon-enname">${p.enName}</div>
        <div class="pokemon-types">${typeBadgesHtml}</div>
        ${abilityPreview ? `<div style="font-size: 0.75rem; color: var(--accent-cyan); margin-top: 0.3rem;">特性: ${abilityPreview}</div>` : ''}
      </div>
    </div>
    <div class="card-stats">
      <div class="stat-row-mini">
        <span class="stat-name-mini">总种族</span>
        <div class="stat-bar-bg"><div class="stat-bar-fill" style="width: ${(bst / 700) * 100}%; background: var(--accent-magenta);"></div></div>
        <span class="stat-val-mini">${bst}</span>
      </div>
      <div class="stat-row-mini">
        <span class="stat-name-mini">速度</span>
        <div class="stat-bar-bg"><div class="stat-bar-fill" style="width: ${(p.baseStats.spe / 180) * 100}%; background: var(--accent-cyan);"></div></div>
        <span class="stat-val-mini">${p.baseStats.spe}</span>
      </div>
      <div class="stat-row-mini">
        <span class="stat-name-mini">物攻</span>
        <div class="stat-bar-bg"><div class="stat-bar-fill" style="width: ${(p.baseStats.atk / 180) * 100}%; background: var(--accent-yellow);"></div></div>
        <span class="stat-val-mini">${p.baseStats.atk}</span>
      </div>
    </div>
    <div class="card-tags">
      ${tagsHtml}
      <span class="card-tag-item" style="color: var(--accent-cyan);">可用招式: ${moveCount}</span>
    </div>
  `;

  return card;
}

// ==========================================================================
// 详情 Modal 与 官方排位实战大数据 (Metagame Dashboard)
// ==========================================================================
function openDetailModal(p) {
  if (!p) return;
  selectedPokemon = p;
  activeFormIndex = 0;
  isShowAllLearnset = false;
  
  // 默认根据官方天梯上位实战数据预选性格与努力值加点
  const activeMeta = (p.meta && p.meta[currentFormat]) ? p.meta[currentFormat] : (currentFormat === 'double' ? p.metaUsage : null);
  if (activeMeta && activeMeta.evSpreads && activeMeta.evSpreads.length > 0) {
    const topEv = activeMeta.evSpreads[0];
    currentVpAllocation = {
      hp: topEv.hp || 0,
      atk: topEv.atk || 0,
      def: topEv.def || 0,
      spa: topEv.spa || 0,
      spd: topEv.spd || 0,
      spe: topEv.spe || 0
    };
  } else if (p.id === 212) {
    currentVpAllocation = { hp: 28, atk: 32, def: 6, spa: 0, spd: 0, spe: 0 };
  } else {
    currentVpAllocation = { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 };
  }

  if (activeMeta && activeMeta.natures && activeMeta.natures.length > 0) {
    const topNat = activeMeta.natures[0].name;
    const foundNat = NATURES.find(n => n.name.startsWith(topNat) || n.name.includes(topNat));
    if (foundNat) selectedNature = foundNat;
  }
  
  renderModalContent();
  document.getElementById('detailModal').classList.add('open');
}

function closeModal() {
  document.getElementById('detailModal').classList.remove('open');
}

function renderModalContent() {
  if (!selectedPokemon) return;
  const p = selectedPokemon;
  
  const hasMega = p.mega && p.mega.supported;
  const megaForms = hasMega && Array.isArray(p.mega.forms) && p.mega.forms.length > 0 
    ? p.mega.forms 
    : (hasMega ? [p.mega] : []);
    
  const isMega = activeFormIndex > 0 && megaForms.length > 0;
  const activeMegaForm = isMega ? (megaForms[activeFormIndex - 1] || megaForms[0]) : null;

  const currentStats = isMega ? activeMegaForm.baseStats : p.baseStats;
  const currentTypes = isMega ? activeMegaForm.types : p.types;
  const currentAvatar = isMega ? activeMegaForm.avatar : p.avatar;
  const currentDisplayName = isMega ? activeMegaForm.megaName : p.name;

  const currentAbilityList = isMega 
    ? [{ name: activeMegaForm.ability, desc: activeMegaForm.abilityDesc || "超级进化专属增强特性", tag: "Mega 特性", usageText: "100%" }] 
    : (Array.isArray(p.abilities) ? p.abilities : []);

  const totalPointsUsed = Object.values(currentVpAllocation).reduce((s, v) => s + v, 0);
  const remainingPoints = TOTAL_VP_BUDGET - totalPointsUsed;
  const vpCost = totalPointsUsed * 5;

  const typePills = currentTypes.map(t => 
    `<span class="type-pill type-${t}">${TYPE_TRANSLATION[t] || t}</span>`
  ).join(' ');

  const matchups = calculateTypeMatchups(currentTypes);
  const formatKey = currentFormat || 'double';
  const meta = (p.meta && p.meta[formatKey]) ? p.meta[formatKey] : (formatKey === 'double' ? p.metaUsage : null);
  const rank = meta ? meta.rank : null;

  const modalBody = document.getElementById('modalBody');
  modalBody.innerHTML = `
    <!-- 头部 Hero 区 -->
    <div class="modal-header-hero">
      <div class="modal-hero-avatar-box">
        <img class="modal-hero-avatar" src="${currentAvatar}" alt="${currentDisplayName}" onerror="this.src='https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/items/poke-ball.png'">
      </div>
      <div class="modal-hero-text">
        <h2>
          ${currentDisplayName}
          <span style="font-size: 1rem; color: var(--text-dim); font-weight: 400;">#${String(p.id).padStart(3, '0')}</span>
          ${rank ? `<span class="modal-rank-badge">🔥 ${formatKey === 'single' ? '单打' : '双打'} Rank #${rank}</span>` : ''}
        </h2>
        <p style="color: var(--text-muted); margin-bottom: 0.5rem;">${p.enName}</p>
        <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem; flex-wrap: wrap;">
          ${typePills}
        </div>
        ${megaForms.length > 0 ? `
          <div class="mega-branch-selector">
            <button class="mega-branch-btn ${activeFormIndex === 0 ? 'active' : ''}" data-form-idx="0">
              通常形态
            </button>
            ${megaForms.map((mf, idx) => `
              <button class="mega-branch-btn ${activeFormIndex === (idx + 1) ? 'active' : ''}" data-form-idx="${idx + 1}">
                ⚡ ${mf.formLabel || mf.megaName}
              </button>
            `).join('')}
          </div>
        ` : ''}
      </div>
    </div>

    <!-- 第一部分：基础属性面板与克制倍率 -->
    <div class="modal-grid-sections">
      <!-- 左侧：VP点数调配模拟器与50级实数 -->
      <div class="modal-box">
        <h4>
          <span>50级实战面板 & 基础点数调配</span>
          <span style="font-size: 0.8rem; color: var(--accent-cyan);">全 31 IV (固定完美6V)</span>
        </h4>
        
        <div class="vp-budget-header">
          <span>可用基础点数 (单项上限 32 点)</span>
          <span class="vp-budget-val" id="vpBudget">${remainingPoints} / 66 点 (消耗 ${vpCost} VP)</span>
        </div>

        <div class="vp-sliders-container">
          ${renderVpSliderRow('hp', '生命 HP', currentStats.hp, currentVpAllocation.hp)}
          ${renderVpSliderRow('atk', '物攻 Atk', currentStats.atk, currentVpAllocation.atk)}
          ${renderVpSliderRow('def', '物防 Def', currentStats.def, currentVpAllocation.def)}
          ${renderVpSliderRow('spa', '特攻 SpA', currentStats.spa, currentVpAllocation.spa)}
          ${renderVpSliderRow('spd', '特防 SpD', currentStats.spd, currentVpAllocation.spd)}
          ${renderVpSliderRow('spe', '速度 Spe', currentStats.spe, currentVpAllocation.spe)}
        </div>

        <div class="nature-select-bar">
          <label for="natureSelect">性格加成修正：</label>
          <select id="natureSelect">
            ${NATURES.map((n, i) => `
              <option value="${i}" ${selectedNature.name === n.name ? 'selected' : ''}>${n.name}</option>
            `).join('')}
          </select>
        </div>

        <div style="margin-top: 1rem; font-size: 0.78rem; color: var(--text-dim); background: rgba(0,0,0,0.25); padding: 0.6rem; border-radius: 6px; line-height: 1.5;">
          💡 <strong>点数调配说明</strong>：每只 66 点自由点数，单项上限 32 点，满两项后留 2 点给第三项。<br>
          点击下方排位大数据的【应用方案】按钮可一键导入上位选手实战加点方案。
        </div>
      </div>

      <!-- 右侧：属性克制防御受击倍率 -->
      <div class="modal-box">
        <h4>属性克制防御受击倍率</h4>
        <div class="matchups-group">
          ${renderMatchupRow('4x 极弱', matchups['4'], 'label-4x')}
          ${renderMatchupRow('2x 弱点', matchups['2'], 'label-2x')}
          ${renderMatchupRow('0.5x 抵抗', matchups['0.5'], 'label-05x')}
          ${renderMatchupRow('0.25x 极抗', matchups['0.25'], 'label-05x')}
          ${renderMatchupRow('0x 免疫', matchups['0'], 'label-0x')}
        </div>

        <h4 style="margin-top: 1.5rem;">基础种族值 (BST: ${Object.values(currentStats).reduce((a,b)=>a+b,0)})</h4>
        <div class="bst-breakdown-list">
          <div class="stat-row-mini"><span class="stat-name-mini">HP</span><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${(currentStats.hp/255)*100}%; background:var(--accent-green);"></div></div><span class="stat-val-mini">${currentStats.hp}</span></div>
          <div class="stat-row-mini"><span class="stat-name-mini">物攻</span><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${(currentStats.atk/255)*100}%; background:var(--accent-yellow);"></div></div><span class="stat-val-mini">${currentStats.atk}</span></div>
          <div class="stat-row-mini"><span class="stat-name-mini">物防</span><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${(currentStats.def/255)*100}%; background:var(--accent-orange);"></div></div><span class="stat-val-mini">${currentStats.def}</span></div>
          <div class="stat-row-mini"><span class="stat-name-mini">特攻</span><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${(currentStats.spa/255)*100}%; background:var(--accent-cyan);"></div></div><span class="stat-val-mini">${currentStats.spa}</span></div>
          <div class="stat-row-mini"><span class="stat-name-mini">特防</span><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${(currentStats.spd/255)*100}%; background:var(--accent-purple);"></div></div><span class="stat-val-mini">${currentStats.spd}</span></div>
          <div class="stat-row-mini"><span class="stat-name-mini">速度</span><div class="stat-bar-bg"><div class="stat-bar-fill" style="width:${(currentStats.spe/255)*100}%; background:var(--accent-magenta);"></div></div><span class="stat-val-mini">${currentStats.spe}</span></div>
        </div>
      </div>
    </div>

    <!-- 第二部分：官方天梯排位实战大数据 (网格卡片一屏流) -->
    <div class="metagame-dashboard">
      <div class="metagame-header">
        <div class="metagame-title-group">
          <h3>🔥 官方天梯排位实战大数据</h3>
          ${rank ? `<span class="meta-rank-tag">${formatKey === 'single' ? '单打' : '双打'} Rank #${rank}</span>` : '<span class="meta-rank-tag meta-unranked">暂无天梯上位排名</span>'}
          <div class="modal-format-tabs">
            <button class="modal-fmt-btn ${formatKey === 'double' ? 'active' : ''}" id="modalTabDoubleBtn">⚔️ 双打数据</button>
            <button class="modal-fmt-btn ${formatKey === 'single' ? 'active' : ''}" id="modalTabSingleBtn">🎯 单打数据</button>
          </div>
        </div>
        <span class="metagame-subtitle">数据源于官方排位赛上位对局样本统计（当前查看：${formatKey === 'single' ? '单打' : '双打'}赛制）</span>
      </div>

      <div class="metagame-cards-grid">
        <!-- 卡片 1：特性效果与排位选用 -->
        <div class="metagame-card">
          <div class="meta-card-header">
            <h4>✦ 特性效果与排位选用</h4>
            <span class="meta-card-sub">含官方战斗效果说明与使用率</span>
          </div>
          <div class="meta-card-body">
            <div class="meta-abilities-list">
              ${(() => {
                const metaAbMap = {};
                if (meta && meta.abilities) {
                  meta.abilities.forEach(ab => {
                    metaAbMap[ab.name] = ab;
                  });
                }
                return currentAbilityList.map(a => {
                  const aName = typeof a === 'string' ? a : a.name;
                  const matchedMetaAb = metaAbMap[aName];
                  const usageNum = matchedMetaAb && typeof matchedMetaAb.usage === 'number'
                    ? matchedMetaAb.usage
                    : (typeof a.usage === 'number' ? a.usage : (a.usageText ? parseFloat(a.usageText) : null));
                  const descText = (matchedMetaAb && matchedMetaAb.desc)
                    ? matchedMetaAb.desc
                    : (typeof a === 'string' ? '游戏内实装特性' : (a.desc || '官方原版战斗触发特性效果。'));
                  return `
                    <div class="meta-ability-box">
                      <div class="meta-ability-top">
                        <div class="meta-ability-title">
                          <strong>✦ ${aName}</strong>
                          ${a.tag ? `<span class="meta-ability-badge">${a.tag}</span>` : ''}
                        </div>
                        ${usageNum !== null ? `<span class="meta-pct-badge">${usageNum.toFixed(1)}%</span>` : ''}
                      </div>
                      ${usageNum !== null ? `
                        <div class="meta-progress-track">
                          <div class="meta-progress-fill ability-fill" style="width: ${Math.min(100, usageNum)}%;"></div>
                        </div>
                      ` : ''}
                      <p class="meta-ability-desc">${descText}</p>
                    </div>
                  `;
                }).join('');
              })()}
            </div>
          </div>
        </div>

        <!-- 卡片 2：常用携带道具榜 -->
        <div class="metagame-card">
          <div class="meta-card-header">
            <h4>🎒 常用携带道具榜 (Top Items)</h4>
            <span class="meta-card-sub">上位对局道具百分比</span>
          </div>
          <div class="meta-card-body">
            ${(meta && meta.items && meta.items.length > 0) ? `
              <div class="meta-items-list">
                ${meta.items.slice(0, 7).map((it, idx) => `
                  <div class="meta-data-row">
                    <div class="meta-row-header">
                      <span class="meta-rank-num">#${idx + 1}</span>
                      <span class="meta-item-name">${it.name}</span>
                      <span class="meta-item-pct">${it.usage.toFixed(1)}%</span>
                    </div>
                    <div class="meta-progress-track">
                      <div class="meta-progress-fill item-fill" style="width: ${Math.min(100, it.usage)}%;"></div>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="meta-empty-state">暂无该宝可梦的天梯道具携带率统计样本</div>
            `}
          </div>
        </div>

        <!-- 卡片 3：主流竞技招式携带率 -->
        <div class="metagame-card meta-card-wide">
          <div class="meta-card-header">
            <h4>⚔️ 实战主流招式携带率 (Top Moves)</h4>
            <span class="meta-card-sub">官方排位高频出招配置</span>
          </div>
          <div class="meta-card-body">
            ${(meta && meta.topMoves && meta.topMoves.length > 0) ? `
              <div class="meta-moves-grid">
                ${meta.topMoves.slice(0, 8).map((mv, idx) => `
                  <div class="meta-move-box">
                    <div class="meta-move-top">
                      <div class="meta-move-left">
                        <span class="meta-rank-num">#${idx + 1}</span>
                        <strong class="meta-move-name">${mv.name}</strong>
                        <span class="type-pill type-${mv.type}">${TYPE_TRANSLATION[mv.type] || mv.type}</span>
                        <span class="${mv.category === '物理' ? 'pill-cat-phy' : (mv.category === '特殊' ? 'pill-cat-spe' : 'pill-cat-sta')}">${mv.category}</span>
                      </div>
                      <div class="meta-move-right">
                        <span class="meta-move-power">威力: ${mv.power > 0 ? mv.power : '--'}</span>
                        <span class="meta-move-pct">${mv.usage.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div class="meta-progress-track">
                      <div class="meta-progress-fill move-fill" style="width: ${Math.min(100, mv.usage)}%;"></div>
                    </div>
                  </div>
                `).join('')}
              </div>
            ` : `
              <div class="meta-empty-state">暂无该宝可梦的排位招式携带率统计样本</div>
            `}

            <!-- 官方全量学招池展开按钮 -->
            ${(p.learnset && p.learnset.length > 0) ? `
              <div class="learnset-fold-wrapper" style="margin-top: 1rem;">
                <button class="learnset-fold-btn" id="toggleAllMovesBtn">
                  ${isShowAllLearnset ? '▲ 收起全量学招池' : `▼ 展开官方全量学招池 (共 ${p.learnset.length} 个招式)`}
                </button>
                ${isShowAllLearnset ? `
                  <div class="all-learnset-table-box">
                    <table class="learnset-table">
                      <thead>
                        <tr>
                          <th>招式名称</th>
                          <th>属性</th>
                          <th>分类</th>
                          <th>威力</th>
                          <th>命中</th>
                          <th>优先度</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${p.learnset.map(m => `
                          <tr>
                            <td><strong>${m.name}</strong></td>
                            <td><span class="type-pill type-${m.type}">${TYPE_TRANSLATION[m.type] || m.type}</span></td>
                            <td><span class="${m.category === '物理' ? 'pill-cat-phy' : (m.category === '特殊' ? 'pill-cat-spe' : 'pill-cat-sta')}">${m.category}</span></td>
                            <td>${m.power || '--'}</td>
                            <td>${m.accuracy ? `${m.accuracy}%` : '--'}</td>
                            <td>${m.priority > 0 ? `+${m.priority}` : (m.priority < 0 ? m.priority : '0')}</td>
                          </tr>
                        `).join('')}
                      </tbody>
                    </table>
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- 卡片 4：性格分布与上位努力值加点 -->
        <div class="metagame-card">
          <div class="meta-card-header">
            <h4>🧠 常用性格与上位努力值加点</h4>
            <span class="meta-card-sub">点击可一键应用至模拟器</span>
          </div>
          <div class="meta-card-body">
            ${meta ? `
              <!-- 性格分布 -->
              <div class="meta-sub-group">
                <div class="meta-sub-label">实战常用性格分布</div>
                <div class="meta-nature-chips">
                  ${(meta.natures || []).slice(0, 6).map(nat => `
                    <div class="meta-nature-chip">
                      <span class="nature-name">${nat.name}</span>
                      <span class="nature-pct">${nat.usage.toFixed(1)}%</span>
                    </div>
                  `).join('')}
                </div>
              </div>

              <!-- 上位努力值方案 -->
              <div class="meta-sub-group" style="margin-top: 1rem;">
                <div class="meta-sub-label">上位选手实战加点 (66点体系)</div>
                <div class="meta-ev-schemes">
                  ${(meta.evSpreads || []).slice(0, 5).map(ev => {
                    const parts = [];
                    if (ev.hp) parts.push(`HP ${ev.hp}`);
                    if (ev.atk) parts.push(`物攻 ${ev.atk}`);
                    if (ev.def) parts.push(`物防 ${ev.def}`);
                    if (ev.spa) parts.push(`特攻 ${ev.spa}`);
                    if (ev.spd) parts.push(`特防 ${ev.spd}`);
                    if (ev.spe) parts.push(`速度 ${ev.spe}`);
                    const spreadText = parts.length > 0 ? parts.join(' / ') : '均 0';
                    return `
                      <div class="meta-ev-item" data-ev-hp="${ev.hp||0}" data-ev-atk="${ev.atk||0}" data-ev-def="${ev.def||0}" data-ev-spa="${ev.spa||0}" data-ev-spd="${ev.spd||0}" data-ev-spe="${ev.spe||0}">
                        <div class="meta-ev-text-wrap">
                          <span class="meta-rank-num">#${ev.rank}</span>
                          <span class="meta-ev-desc">${spreadText}</span>
                          <span class="meta-ev-usage">${ev.usage.toFixed(1)}%</span>
                        </div>
                        <button class="btn-apply-ev" title="将此努力值直接填入上方VP模拟器">应用方案</button>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            ` : `
              <div class="meta-empty-state">暂无该宝可梦的性格与努力值实战样本</div>
            `}
          </div>
        </div>

        <!-- 卡片 5：核心战术搭档队友 -->
        <div class="metagame-card meta-card-wide">
          <div class="meta-card-header">
            <h4>🤝 核心战术搭档队友 (Top Partners)</h4>
            <span class="meta-card-sub">点击队友头像可直接快速跳转详情</span>
          </div>
          <div class="meta-card-body">
            ${(meta && meta.partners && meta.partners.length > 0) ? `
              <div class="meta-partners-grid">
                ${meta.partners.slice(0, 8).map(pt => {
                  const partnerMon = allPokemonList.find(x => x.name === pt.name || (pt.name && x.name.includes(pt.name)));
                  const avatar = partnerMon ? partnerMon.avatar : 'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/items/poke-ball.png';
                  const dexId = partnerMon ? `#${String(partnerMon.id).padStart(3, '0')}` : '';
                  const partnerId = partnerMon ? partnerMon.id : '';
                  return `
                    <div class="partner-chip-card" data-partner-id="${partnerId}">
                      <div class="partner-chip-avatar-wrap">
                        <img class="partner-chip-avatar" src="${avatar}" alt="${pt.name}" loading="lazy" onerror="this.src='https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/items/poke-ball.png'">
                        <span class="partner-rank-badge">#${pt.rank}</span>
                      </div>
                      <div class="partner-chip-info">
                        <div class="partner-chip-name">${pt.name}</div>
                        <div class="partner-chip-id">${dexId}</div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            ` : `
              <div class="meta-empty-state">暂无该宝可梦的天梯搭档统计样本</div>
            `}
          </div>
        </div>
      </div>
    </div>
  `;

  bindModalDynamicEvents(currentStats);
}

function renderMatchupRow(multiplier, types, labelClass) {
  if (!types || types.length === 0) return '';
  const typeBadges = types.map(t => `<span class="type-pill type-${t}">${TYPE_TRANSLATION[t] || t}</span>`).join(' ');
  return `
    <div class="matchup-row">
      <span class="matchup-label ${labelClass}">${multiplier}</span>
      <div class="matchup-types-list">${typeBadges}</div>
    </div>
  `;
}

function renderVpSliderRow(key, label, baseVal, currentVal) {
  const realVal = calculateStat50(key, baseVal, currentVal, selectedNature);
  return `
    <div class="vp-row" data-stat="${key}">
      <span>${label}</span>
      <input type="range" class="vp-slider" min="0" max="${MAX_VP_PER_STAT}" value="${currentVal}" data-stat="${key}">
      <span class="vp-val-label" id="vpVal_${key}">${currentVal}</span>
      <span class="stat-50-real" id="statReal_${key}">${realVal}</span>
    </div>
  `;
}

function bindModalDynamicEvents(currentStats) {
  // 0. 弹窗内单双打赛制切换
  const mTabDbl = document.getElementById('modalTabDoubleBtn');
  const mTabSgl = document.getElementById('modalTabSingleBtn');
  if (mTabDbl) {
    mTabDbl.onclick = () => {
      setFormat('double');
      renderModalContent();
    };
  }
  if (mTabSgl) {
    mTabSgl.onclick = () => {
      setFormat('single');
      renderModalContent();
    };
  }

  // 1. Mega 形态 / 多分支切换按钮组
  document.querySelectorAll('.mega-branch-btn').forEach(btn => {
    btn.onclick = (e) => {
      const formIdx = parseInt(e.currentTarget.dataset.formIdx, 10) || 0;
      activeFormIndex = formIdx;
      renderModalContent();
    };
  });

  const megaBtn = document.getElementById('megaToggleBtn');
  if (megaBtn) {
    megaBtn.onclick = () => {
      activeFormIndex = activeFormIndex === 0 ? 1 : 0;
      renderModalContent();
    };
  }

  // 2. 性格下拉选单
  const natureSelect = document.getElementById('natureSelect');
  if (natureSelect) {
    natureSelect.onchange = (e) => {
      const idx = parseInt(e.target.value, 10);
      if (NATURES[idx]) {
        selectedNature = NATURES[idx];
        renderModalContent();
      }
    };
  }

  // 3. VP 滑块监听
  document.querySelectorAll('.vp-slider').forEach(slider => {
    slider.oninput = (e) => {
      const statKey = e.target.dataset.stat;
      const newVal = parseInt(e.target.value, 10) || 0;
      
      let otherTotal = 0;
      Object.keys(currentVpAllocation).forEach(k => {
        if (k !== statKey) otherTotal += currentVpAllocation[k];
      });

      let allowedVal = newVal;
      if (otherTotal + allowedVal > TOTAL_VP_BUDGET) {
        allowedVal = Math.max(0, TOTAL_VP_BUDGET - otherTotal);
        e.target.value = allowedVal;
      }

      currentVpAllocation[statKey] = allowedVal;
      renderModalContent();
    };
  });

  // 4. 展开/收起全量招式池
  const toggleMovesBtn = document.getElementById('toggleAllMovesBtn');
  if (toggleMovesBtn) {
    toggleMovesBtn.onclick = () => {
      isShowAllLearnset = !isShowAllLearnset;
      renderModalContent();
    };
  }

  // 5. 点击努力值加点方案一键应用
  document.querySelectorAll('.btn-apply-ev').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const parent = btn.closest('.meta-ev-item');
      if (!parent) return;
      currentVpAllocation = {
        hp: parseInt(parent.dataset.evHp, 10) || 0,
        atk: parseInt(parent.dataset.evAtk, 10) || 0,
        def: parseInt(parent.dataset.evDef, 10) || 0,
        spa: parseInt(parent.dataset.evSpa, 10) || 0,
        spd: parseInt(parent.dataset.evSpd, 10) || 0,
        spe: parseInt(parent.dataset.evSpe, 10) || 0
      };
      renderModalContent();
    };
  });

  // 6. 点击搭档卡片一键跳转至该宝可梦详情
  document.querySelectorAll('.partner-chip-card').forEach(card => {
    card.onclick = () => {
      const partnerId = parseInt(card.dataset.partnerId, 10);
      if (!partnerId) return;
      const targetMon = allPokemonList.find(x => x.id === partnerId);
      if (targetMon) {
        openDetailModal(targetMon);
      }
    };
  });
}
