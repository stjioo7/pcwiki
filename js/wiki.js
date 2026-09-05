/**
 * wiki.js - 竞技图鉴浏览、无限流渲染、VP加点模拟器与招式详情
 */

const CHUNK_SIZE = 24;
const PAGE_SIZE = 24;
let currentRenderedCount = 0;
let currentPage = 1;
let scrollObserver = null;
let activeFormIndex = 0;

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

  // 融合对战截图验证补丁 (保障子弹拳等基础对位)
  if (window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon) {
    window.CHAMPIONS_DATA.pokemon.forEach(patchP => {
      const target = list.find(l => l.id === patchP.id);
      if (target) {
        if (patchP.mega && patchP.mega.supported) target.mega = patchP.mega;
        if (patchP.tags) target.tags = Array.from(new Set([...target.tags, ...patchP.tags]));
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

  card.innerHTML = `
    <div class="card-top">
      <span class="pokemon-id">#${String(p.id).padStart(3, '0')}</span>
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
// 详情 Modal 与 对战推演工作台 (Battle Workbench)
// ==========================================================================
function openDetailModal(p) {
  selectedPokemon = p;
  activeFormIndex = 0;
  isTailwindActive = false;
  isChoiceScarfActive = false;
  isShowAllLearnset = false;
  
  // 假想敌默认选择：若攻方为巨钳螳螂(#212)，假想敌默认对战路卡利欧(#448)，否则默认选另一只代表性怪
  if (p.id === 212) {
    selectedDefender = allPokemonList.find(x => x.id === 448) || allPokemonList[0];
    currentVpAllocation = { hp: 28, atk: 32, def: 6, spa: 0, spd: 0, spe: 0 };
  } else {
    selectedDefender = allPokemonList.find(x => x.id !== p.id) || p;
    currentVpAllocation = { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 };
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
  const def = selectedDefender || p;
  
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
    ? [{ name: activeMegaForm.ability, desc: activeMegaForm.abilityDesc || "超级进化专属增强特性", tag: "Mega 特性" }] 
    : (Array.isArray(p.abilities) ? p.abilities : []);

  const totalPointsUsed = Object.values(currentVpAllocation).reduce((s, v) => s + v, 0);
  const remainingPoints = TOTAL_VP_BUDGET - totalPointsUsed;
  const vpCost = totalPointsUsed * 5;

  const typePills = currentTypes.map(t => 
    `<span class="type-pill type-${t}">${TYPE_TRANSLATION[t] || t}</span>`
  ).join(' ');

  const matchups = calculateTypeMatchups(currentTypes);

  // 速度线判定计算
  const speedEval = evaluateSpeedTiers(currentStats, def);

  // 招式与伤害计算
  const attackerObj = {
    baseStats: currentStats,
    types: currentTypes,
    name: currentDisplayName
  };
  const movesToDisplay = getMovesToDisplay(p);

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
        </h2>
        <p style="color: var(--text-muted); margin-bottom: 0.5rem;">${p.enName}</p>
        <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.75rem;">
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

    <!-- 数值与特性面板 -->
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
          💡 <strong>《宝可梦冠军》训练体系</strong>：每只 66 点，单项上限 32 点，满两项后留 2 点余量给第三项。<br>
          巨钳螳螂分配 28 点 HP 时，50 级实数值精确达到 <strong>173</strong>，与对战截图完全吻合。
        </div>
      </div>

      <!-- 右侧：全量特性与弱点抗性 -->
      <div class="modal-box">
        <h4>特性与效果 (Abilities)</h4>
        <ul style="list-style: none; margin-bottom: 1.2rem; display: flex; flex-direction: column; gap: 0.6rem;">
          ${currentAbilityList.map(a => `
            <li style="background: rgba(255,255,255,0.06); padding: 0.6rem 0.8rem; border-radius: 6px; border-left: 3px solid var(--accent-cyan);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
                <strong style="color: var(--accent-cyan); font-size: 0.95rem;">✦ ${typeof a === 'string' ? a : a.name}</strong>
                ${a.tag ? `<span style="font-size: 0.72rem; color: var(--accent-yellow); background: rgba(255,214,10,0.12); padding: 0.1rem 0.45rem; border-radius: 4px;">${a.tag}</span>` : ''}
              </div>
              <p style="font-size: 0.8rem; color: var(--text-muted); margin: 0; line-height: 1.4;">${typeof a === 'string' ? '游戏内实装特性' : (a.desc || '对战中触发的官方特性效果。')}</p>
            </li>
          `).join('')}
        </ul>

        <h4>属性克制防御受击倍率</h4>
        <div class="matchups-group">
          ${renderMatchupRow('4x 极弱', matchups['4'], 'label-4x')}
          ${renderMatchupRow('2x 弱点', matchups['2'], 'label-2x')}
          ${renderMatchupRow('0.5x 抵抗', matchups['0.5'], 'label-05x')}
          ${renderMatchupRow('0.25x 极抗', matchups['0.25'], 'label-05x')}
          ${renderMatchupRow('0x 免疫', matchups['0'], 'label-0x')}
        </div>
      </div>
    </div>

    <!-- ==========================================================================
         下半部：对战推演与假想敌对峙工作台 (Battle Workbench)
         ========================================================================== -->
    <div class="workbench-container">
      <div class="workbench-title-bar">
        <h3>⚔️ 对战推演与假想敌对峙工作台</h3>
        <div class="defender-select-box">
          <label style="font-size: 0.85rem; color: var(--text-muted);">设定假想敌：</label>
          <select id="defenderSelect">
            ${allPokemonList.slice(0, 150).map(item => `
              <option value="${item.id}" ${item.id === def.id ? 'selected' : ''}>#${item.id} ${item.name} (${item.types.map(t=>TYPE_TRANSLATION[t]||t).join('/')})</option>
            `).join('')}
          </select>
        </div>
      </div>

      <!-- 双方对峙概要栏 -->
      <div class="versus-hero-box">
        <div class="versus-combatant">
          <img class="versus-thumb" src="${currentAvatar}" alt="${currentDisplayName}">
          <div class="versus-info">
            <h5>${currentDisplayName} (我方)</h5>
            <div class="versus-stats-preview">
              <span>HP: ${calculateStat50('hp', currentStats.hp, currentVpAllocation.hp, selectedNature)}</span>
              <span>物攻: ${calculateStat50('atk', currentStats.atk, currentVpAllocation.atk, selectedNature)}</span>
              <span>速度: ${speedEval.atkRealSpe}</span>
            </div>
          </div>
        </div>

        <div class="versus-badge">VS</div>

        <div class="versus-combatant">
          <img class="versus-thumb" src="${def.avatar}" alt="${def.name}">
          <div class="versus-info">
            <h5>${def.name} (假想敌)</h5>
            <div class="versus-stats-preview">
              <span>HP基准: ${calculateStat50('hp', def.baseStats.hp, 0, NATURES[0])}</span>
              <span>物防基准: ${calculateStat50('def', def.baseStats.def, 0, NATURES[0])}</span>
              <span>速度种族: ${def.baseStats.spe}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 1. 速度线先手判定仪表盘 -->
      <div class="speed-tier-panel">
        <div class="speed-tier-header">
          <h4 style="font-family: var(--font-display); color: var(--accent-cyan); font-size: 1.05rem;">
            ⚡ 速度线先手权对峙判定
          </h4>
          ${speedEval.statusBadge}
        </div>

        <div class="speed-comparison-grid">
          <div class="speed-card-tier">
            <div class="tier-name">假想敌：极限速度 (32点+性格)</div>
            <div class="tier-val">${speedEval.defMax}</div>
            <div class="tier-delta" style="color: ${speedEval.atkRealSpe >= speedEval.defMax ? 'var(--accent-green)' : 'var(--accent-red)'}">
              ${speedEval.atkRealSpe >= speedEval.defMax ? `我方领先 +${speedEval.atkRealSpe - speedEval.defMax} (先手)` : `我方落后 -${speedEval.defMax - speedEval.atkRealSpe} (后手)`}
            </div>
          </div>

          <div class="speed-card-tier">
            <div class="tier-name">假想敌：满速标准 (32点无修正)</div>
            <div class="tier-val">${speedEval.defMid}</div>
            <div class="tier-delta" style="color: ${speedEval.atkRealSpe >= speedEval.defMid ? 'var(--accent-green)' : 'var(--accent-red)'}">
              ${speedEval.atkRealSpe >= speedEval.defMid ? `我方领先 +${speedEval.atkRealSpe - speedEval.defMid} (先手)` : `我方落后 -${speedEval.defMid - speedEval.atkRealSpe} (后手)`}
            </div>
          </div>

          <div class="speed-card-tier">
            <div class="tier-name">假想敌：无速耐受 (0点无修正)</div>
            <div class="tier-val">${speedEval.defMin}</div>
            <div class="tier-delta" style="color: ${speedEval.atkRealSpe >= speedEval.defMin ? 'var(--accent-green)' : 'var(--accent-red)'}">
              ${speedEval.atkRealSpe >= speedEval.defMin ? `我方领先 +${speedEval.atkRealSpe - speedEval.defMin} (先手)` : `我方落后 -${speedEval.defMin - speedEval.atkRealSpe} (后手)`}
            </div>
          </div>
        </div>

        <div class="speed-modifiers-bar">
          <span>超速试算辅助：</span>
          <label style="display:flex; align-items:center; gap:0.4rem; cursor:pointer;">
            <input type="checkbox" id="scarfCheckbox" ${isChoiceScarfActive ? 'checked' : ''}>
            <span>讲究围巾 (1.5x)</span>
          </label>
          <label style="display:flex; align-items:center; gap:0.4rem; cursor:pointer;">
            <input type="checkbox" id="tailwindCheckbox" ${isTailwindActive ? 'checked' : ''}>
            <span>顺风状态 (2.0x)</span>
          </label>
          <span style="font-size:0.75rem; color:var(--text-dim); margin-left:auto;">
            当前我方速度计算实数：<strong>${speedEval.atkRealSpe}</strong>
          </span>
        </div>
      </div>

      <!-- 2. 竞技招式斩杀与伤害计算器 -->
      <div class="damage-calc-panel">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
          <h4 style="font-family: var(--font-display); color: var(--accent-magenta); font-size: 1.05rem;">
            🎯 招式打击与伤害斩杀线推演 (对 ${def.name})
          </h4>
          <span style="font-size:0.78rem; color:var(--text-dim);">含 85%~100% 浮动区间 & 本系 1.5x 修正</span>
        </div>

        <div class="moves-calc-grid">
          ${movesToDisplay.map(m => {
            const dmg = calculateDamage(attackerObj, def, m);
            const maxFill = Math.min(100, parseFloat(dmg.maxPct));
            return `
              <div class="move-damage-card">
                <div class="move-header">
                  <div class="move-name-box">
                    <strong>${m.name}</strong>
                    <span class="type-pill type-${m.type}">${TYPE_TRANSLATION[m.type]||m.type}</span>
                  </div>
                  <div class="move-meta-pills">
                    <span class="${m.category === '物理' ? 'pill-cat-phy' : (m.category === '特殊' ? 'pill-cat-spe' : 'pill-cat-sta')}">${m.category}</span>
                    <span style="font-size:0.75rem; color:var(--text-muted);">威力: ${m.power || '--'}</span>
                  </div>
                </div>

                <!-- 特性与本系倍率拆解胶囊 -->
                <div class="move-pills-row" style="margin: 0.3rem 0 0.5rem 0;">
                  ${dmg.breakdownBadges ? dmg.breakdownBadges.join('') : ''}
                </div>

                <div class="damage-bar-wrapper">
                  <div class="damage-track">
                    <div class="damage-fill ${parseFloat(dmg.minPct) >= 100 ? 'ohko' : ''}" style="width: ${maxFill}%;"></div>
                  </div>
                  <div class="damage-numbers-row">
                    <span class="damage-range-text">
                      ${m.power > 0 ? `${dmg.minDmg} ~ ${dmg.maxDmg} (${dmg.minPct}% ~ ${dmg.maxPct}%)` : '变化招式'}
                    </span>
                    <span class="kill-verdict-tag ${dmg.verdictClass}">${dmg.verdict}</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- 展开全量学招池按钮 -->
        ${(p.learnset && p.learnset.length > 4) ? `
          <button class="learnset-fold-btn" id="toggleAllMovesBtn">
            ${isShowAllLearnset ? '▲ 收起全量招式池' : `▼ 展开官方全量学招池 (共 ${p.learnset.length} 个技能，点击任意技能直接试算)`}
          </button>
        ` : ''}
      </div>
    </div>
  `;

  bindModalDynamicEvents(currentStats);
}

// 获取要展示的招式列表 (默认展示前 4 个热门技能，展开时全展示)
function getMovesToDisplay(p) {
  if (!p.learnset || p.learnset.length === 0) {
    return [
      { id: 1, name: "子弹拳", power: 40, type: "Steel", category: "物理", priority: 1 },
      { id: 2, name: "近身战", power: 120, type: "Fighting", category: "物理", priority: 0 },
      { id: 3, name: "急速折返", power: 70, type: "Bug", category: "物理", priority: 0 },
      { id: 4, name: "剑舞", power: 0, type: "Normal", category: "变化", priority: 0 }
    ];
  }
  return isShowAllLearnset ? p.learnset : p.learnset.slice(0, 4);
}

// 速度线判定计算器
function evaluateSpeedTiers(currentStats, defender) {
  const baseSpe = currentStats.spe;
  let atkRealSpe = calculateStat50('spe', baseSpe, currentVpAllocation.spe, selectedNature);

  if (isTailwindActive) atkRealSpe = Math.floor(atkRealSpe * 2.0);
  if (isChoiceScarfActive) atkRealSpe = Math.floor(atkRealSpe * 1.5);

  const defBaseSpe = defender.baseStats.spe;
  const defMin = calculateStat50('spe', defBaseSpe, 0, NATURES[0]);
  const defMid = calculateStat50('spe', defBaseSpe, 32, NATURES[0]);
  const defMax = calculateStat50('spe', defBaseSpe, 32, NATURES[2]);

  let statusBadge = '';
  if (atkRealSpe > defMax) {
    statusBadge = `<span class="speed-status-badge badge-ahead">🟢 绝对先手 (快 ${atkRealSpe - defMax} 点)</span>`;
  } else if (atkRealSpe === defMax) {
    statusBadge = `<span class="speed-status-badge badge-tie">🟡 同速拼速 (50% 猜拳)</span>`;
  } else {
    statusBadge = `<span class="speed-status-badge badge-behind">🔴 假想敌极速先手 (慢 ${defMax - atkRealSpe} 点)</span>`;
  }

  return {
    atkRealSpe,
    defMin,
    defMid,
    defMax,
    statusBadge
  };
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

  // 4. 围巾与顺风
  const scarfBox = document.getElementById('scarfCheckbox');
  if (scarfBox) {
    scarfBox.onchange = (e) => {
      isChoiceScarfActive = e.target.checked;
      renderModalContent();
    };
  }

  const tailwindBox = document.getElementById('tailwindCheckbox');
  if (tailwindBox) {
    tailwindBox.onchange = (e) => {
      isTailwindActive = e.target.checked;
      renderModalContent();
    };
  }

  // 5. 展开招式池
  const toggleMovesBtn = document.getElementById('toggleAllMovesBtn');
  if (toggleMovesBtn) {
    toggleMovesBtn.onclick = () => {
      isShowAllLearnset = !isShowAllLearnset;
      renderModalContent();
    };
  }
}
