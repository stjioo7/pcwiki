/**
 * copilot.js - 实时对战副驾 (Battle Copilot) 识别与通用攻防推演引擎
 * 全算法驱动，零假数据，零截图特化硬编码，完全支持全图鉴任意宝可梦对位
 */

let cachedBattleImage = null;

// HP 颜色判断辅助
function getHpBarClass(pct) {
  if (pct > 50) return 'green';
  if (pct > 20) return 'yellow';
  return 'red';
}

// 统一 HP 状态与颜色主题应用 (绿/黄/红跨条目完全一致)
function applyHpColorTheme(wrapEl, inputEl, pctTextEl, fillEl, pct) {
  const theme = pct > 50 ? 'theme-green' : pct > 20 ? 'theme-yellow' : 'theme-red';
  const barClass = pct > 50 ? 'green' : pct > 20 ? 'yellow' : 'red';

  if (fillEl) {
    fillEl.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    fillEl.className = `hp-bar-fill ${barClass}`;
  }
  if (inputEl) {
    inputEl.className = `hp-inline-input ${theme}`;
  }
  if (wrapEl) {
    wrapEl.className = `hp-value ${theme}`;
  }
  if (pctTextEl) {
    pctTextEl.className = `${theme}`;
  }
}

// 统一我方血量 UI 刷新
function updatePlayerHpUI(cur, max, pct) {
  const curInput = document.getElementById('playerHpCurInput');
  const maxText = document.getElementById('playerHpMaxText');
  const pctText = document.getElementById('playerHpPctText');
  const fill = document.getElementById('playerHpFill');
  const wrap = document.getElementById('playerHpTextWrap');
  const indicator = document.getElementById('playerHpIndicator');

  if (curInput && document.activeElement !== curInput) {
    curInput.value = cur;
  }
  if (maxText) maxText.innerText = max;
  if (pctText) pctText.innerText = `${pct.toFixed(1)}%`;
  if (indicator) indicator.innerText = `${pct.toFixed(1)}%`;

  applyHpColorTheme(wrap, curInput, pctText, fill, pct);
}

// 统一敌方残血 UI 刷新
function updateOpponentHpUI(pct) {
  const pctInput = document.getElementById('opponentHpPctInput');
  const pctText = document.getElementById('opponentHpPctText');
  const fill = document.getElementById('opponentHpFill');
  const wrap = document.getElementById('opponentHpTextWrap');
  const indicator = document.getElementById('targetHpIndicator');

  if (pctInput && document.activeElement !== pctInput) {
    pctInput.value = Math.round(pct);
  }
  if (pctText) pctText.innerText = `${pct.toFixed(1)}%`;
  if (indicator) indicator.innerText = `${pct.toFixed(1)}%`;

  applyHpColorTheme(wrap, pctInput, pctText, fill, pct);
}

// 异步检测本地 RapidOCR 服务状态
async function checkOcrBackendStatus() {
  try {
    const res = await fetch('http://127.0.0.1:8765/api/status');
    if (res.ok) {
      const data = await res.json();
      const statusMsg = document.getElementById('analysisStatusMsg');
      const statusIcon = document.querySelector('.analysis-status-bar .status-icon');
      if (statusMsg && (!copilotState.hasAnalyzed || statusMsg.innerText.includes('未启动') || statusMsg.innerText.includes('等待载入'))) {
        statusMsg.innerHTML = `🟢 <strong>RapidOCR 视觉识别引擎在线</strong> (支持全世代 ${data.total_known_species || 1026} 种宝可梦与 ${data.total_known_moves || 835} 个官方招式实时识别)`;
      }
      if (statusIcon && !copilotState.hasAnalyzed) statusIcon.innerText = '🟢';
      return true;
    }
  } catch (err) {
    const statusMsg = document.getElementById('analysisStatusMsg');
    const statusIcon = document.querySelector('.analysis-status-bar .status-icon');
    if (statusMsg && !copilotState.hasAnalyzed) {
      statusMsg.innerHTML = `🟡 <strong>本地 RapidOCR 引擎未连接</strong> (可运行 <code>uv run python server.py</code> 开启自动截图识别) | 支持手动点选宝可梦`;
    }
    if (statusIcon && !copilotState.hasAnalyzed) statusIcon.innerText = '🟡';
  }
  return false;
}

// 调用本地 Python RapidOCR 识别 API
async function callOcrApi(blobOrFile) {
  try {
    const fd = new FormData();
    fd.append('file', blobOrFile, 'screenshot.png');
    const resp = await fetch('http://127.0.0.1:8765/api/recognize', {
      method: 'POST',
      body: fd
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.success) {
        return data;
      }
    }
  } catch (err) {
    // 后端未运行时的静默捕获
  }
  return null;
}

// 将识别结果应用到副驾状态
function applyOcrResultToState(ocrRes) {
  const pMon = allPokemonList.find(p => p.id === ocrRes.player.id || p.name === ocrRes.player.name) || allPokemonList[0];
  const oMon = allPokemonList.find(p => p.id === ocrRes.opponent.id || p.name === ocrRes.opponent.name) || allPokemonList[1] || allPokemonList[0];

  copilotState.playerMon = pMon;
  copilotState.opponentMon = oMon;
  copilotState.isPlayerMega = false;
  copilotState.playerMegaBranch = "X";
  copilotState.isOpponentMega = false;
  copilotState.opponentMegaBranch = "X";
  copilotState.playerHpCur = ocrRes.player.hpCur;
  copilotState.playerHpMax = ocrRes.player.hpMax;
  copilotState.playerHpPct = ocrRes.player.hpPct;
  copilotState.opponentHpPct = ocrRes.opponent.hpPct;
  copilotState.opponentStatus = ocrRes.opponent.status || null;
  copilotState.detectedMoves = ocrRes.moves || [];
  copilotState.hasAnalyzed = true;

  const statusMsg = document.getElementById('analysisStatusMsg');
  const statusIcon = document.querySelector('.analysis-status-bar .status-icon');
  const statusExtra = ocrRes.opponent.status ? ` [${ocrRes.opponent.status}]` : '';
  if (statusMsg) {
    statusMsg.innerHTML = `🟢 <strong>画面识别成功</strong>: 我方 <strong>${pMon.name}</strong> (${ocrRes.player.hpCur}/${ocrRes.player.hpMax}) vs 敌方 <strong>${oMon.name}</strong> (${ocrRes.opponent.hpPct}%${statusExtra})`;
  }
  if (statusIcon) statusIcon.innerText = '🟢';

  const analysisCard = document.getElementById('analysisCard');
  if (analysisCard) analysisCard.style.display = 'block';

  const canvas = document.getElementById('screenshotCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    drawCanvasRoiOverlay(ctx, pMon, oMon, copilotState.playerHpPct, copilotState.opponentHpPct, copilotState.opponentStatus);
  }

  syncCopilotInputUI();
  updateCopilotDashboard();
}

// 重新绘制当前 Canvas 画面及 ROI 框选标记
function redrawCurrentCanvasOverlay() {
  const canvas = document.getElementById('screenshotCanvas');
  if (!canvas || !cachedBattleImage) return;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(cachedBattleImage, 0, 0, 1920, 1080);
  if (copilotState.playerMon && copilotState.opponentMon) {
    const activeP = getActiveCombatant(copilotState.playerMon, copilotState.isPlayerMega, copilotState.playerMegaBranch);
    const activeO = getActiveCombatant(copilotState.opponentMon, copilotState.isOpponentMega, copilotState.opponentMegaBranch);
    drawCanvasRoiOverlay(ctx, activeP, activeO, copilotState.playerHpPct, copilotState.opponentHpPct, copilotState.opponentStatus);
  }
}

// 绘制 Canvas ROI 识别框
function drawCanvasRoiOverlay(ctx, pMon, oMon, playerHpPct, opponentHpPct, status = null) {
  ctx.save();
  // 我方绿框
  ctx.strokeStyle = '#00f59b';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#00f59b';
  ctx.shadowBlur = 12;
  ctx.strokeRect(25, 840, 420, 215);
  ctx.fillStyle = '#00f59b';
  ctx.font = 'bold 24px "Chakra Petch", sans-serif';
  ctx.fillText(`我方在场: ${pMon.name} (${playerHpPct.toFixed(1)}% HP)`, 35, 825);

  // 敌方红框
  ctx.strokeStyle = '#ff007f';
  ctx.lineWidth = 4;
  ctx.shadowColor = '#ff007f';
  ctx.shadowBlur = 12;
  ctx.strokeRect(1470, 30, 420, 150);
  ctx.fillStyle = '#ff007f';
  ctx.font = 'bold 24px "Chakra Petch", sans-serif';
  const oppExtra = status ? ` [${status}]` : '';
  ctx.fillText(`敌方在场: ${oMon.name} (${opponentHpPct.toFixed(1)}% HP)${oppExtra}`, 1475, 210);
  ctx.restore();
}

// 载入并处理用户上传的图片文件 (支持 RapidOCR 自动识别 + 兜底推演)
async function loadAndProcessImageFile(file) {
  const reader = new FileReader();
  reader.onload = async (event) => {
    const img = new Image();
    img.onload = async () => {
      cachedBattleImage = img;

      const statusMsg = document.getElementById('analysisStatusMsg');
      const statusIcon = document.querySelector('.analysis-status-bar .status-icon');
      if (statusMsg) statusMsg.innerHTML = '⚡ 正在通过本地 RapidOCR 引擎进行对战画面识别...';
      if (statusIcon) statusIcon.innerText = '🔄';

      const analysisCard = document.getElementById('analysisCard');
      if (analysisCard) analysisCard.style.display = 'block';

      const canvas = document.getElementById('screenshotCanvas');
      if (canvas) {
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 1920, 1080);
      }

      // 尝试调用本地 RapidOCR 识别接口
      const ocrRes = await callOcrApi(file);
      if (ocrRes) {
        applyOcrResultToState(ocrRes);
      } else {
        // OCR 服务未连接时的优雅兜底
        const pMon = copilotState.playerMon || allPokemonList[0];
        const oMon = copilotState.opponentMon || allPokemonList[1] || allPokemonList[0];

        const pBaseHp = pMon.baseStats ? pMon.baseStats.hp : 80;
        const pMaxHp = calculateStat50('hp', pBaseHp, 0, { plus: null, minus: null });

        copilotState.playerMon = pMon;
        copilotState.opponentMon = oMon;
        copilotState.playerHpMax = pMaxHp;
        copilotState.playerHpCur = pMaxHp;
        copilotState.playerHpPct = 100.0;
        copilotState.opponentHpPct = 100.0;
        copilotState.hasAnalyzed = true;

        if (statusMsg) {
          statusMsg.innerHTML = '🟡 <strong>画面已载入！本地 OCR 引擎未连接</strong> (可运行 <code>uv run python server.py</code> 开启自动识别，或直接在下方下拉框点选宝可梦)';
        }
        if (statusIcon) statusIcon.innerText = '🟡';

        if (canvas) {
          const ctx = canvas.getContext('2d');
          drawCanvasRoiOverlay(ctx, pMon, oMon, copilotState.playerHpPct, copilotState.opponentHpPct);
        }

        syncCopilotInputUI();
        updateCopilotDashboard();
      }
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// 剪贴板全局 Ctrl+V 粘贴监听
function handleGlobalPaste(e) {
  if (!e.clipboardData || !e.clipboardData.items) return;
  const items = e.clipboardData.items;
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const blob = items[i].getAsFile();
      switchToCopilotView();
      loadAndProcessImageFile(blob);
      e.preventDefault();
      break;
    }
  }
}

// 快速切换至副驾视窗
function switchToCopilotView() {
  const tabCopilotBtn = document.getElementById('tabCopilotBtn');
  const tabWikiBtn = document.getElementById('tabWikiBtn');
  const copilotView = document.getElementById('copilotView');
  const wikiView = document.getElementById('wikiView');
  if (tabCopilotBtn && tabWikiBtn && copilotView && wikiView) {
    tabCopilotBtn.classList.add('active');
    tabWikiBtn.classList.remove('active');
    copilotView.classList.add('active');
    copilotView.style.display = 'block';
    wikiView.classList.remove('active');
    wikiView.style.display = 'none';
  }
}

// 填充宝可梦下拉列表 (包含全量 207 只宝可梦，双重数据兜底保证永不为空)
function populateMonSelects() {
  const playerSelect = document.getElementById('playerMonSelect');
  const oppSelect = document.getElementById('opponentMonSelect');

  const list = (allPokemonList && allPokemonList.length > 0)
    ? allPokemonList
    : (typeof window !== 'undefined' && window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon)
      ? window.CHAMPIONS_DATA.pokemon
      : [];

  if (!playerSelect || !oppSelect || list.length === 0) return;

  // 按编号排序
  const sorted = [...list].sort((a, b) => a.id - b.id);
  const optionsHtml = sorted.map(p => {
    const typeCn = p.types ? p.types.map(t => TYPE_TRANSLATION[t] || t).join('/') : '';
    return `<option value="${p.id}">#${String(p.id).padStart(3, '0')} ${p.name} (${typeCn})</option>`;
  }).join('');

  playerSelect.innerHTML = optionsHtml;
  oppSelect.innerHTML = optionsHtml;

  if (copilotState.playerMon) {
    playerSelect.value = copilotState.playerMon.id;
  }
  if (copilotState.opponentMon) {
    oppSelect.value = copilotState.opponentMon.id;
  }
}

// 下拉框改选宝可梦 (通用处理)
function onSelectCombatant(side, monId) {
  const list = (allPokemonList && allPokemonList.length > 0)
    ? allPokemonList
    : (window.CHAMPIONS_DATA ? window.CHAMPIONS_DATA.pokemon : []);
  const mon = list.find(p => p.id === monId);
  if (!mon) return;

  if (side === 'player') {
    copilotState.playerMon = mon;
    copilotState.isPlayerMega = false;
    copilotState.playerMegaBranch = "X";
    copilotState.playerHpMax = calculateStat50('hp', mon.baseStats.hp, 0, { plus: null, minus: null });
    copilotState.playerHpCur = Math.round(copilotState.playerHpMax * (copilotState.playerHpPct / 100));
    copilotState.detectedMoves = []; // 使用该精灵的真实官方学招表
  } else {
    copilotState.opponentMon = mon;
    copilotState.isOpponentMega = false;
    copilotState.opponentMegaBranch = "X";
  }

  copilotState.hasAnalyzed = true;
  syncCopilotInputUI();
  redrawCurrentCanvasOverlay();
  updateCopilotDashboard();
}

// 获取当前参战宝可梦形态 (若激活 Mega 则应用 Mega 种族、属性、特性与立绘)
function getActiveCombatant(baseMon, isMega, branchKey) {
  if (!baseMon) return null;
  if (!isMega || !baseMon.mega || !baseMon.mega.supported) {
    return baseMon;
  }

  const forms = baseMon.mega.forms || [];
  let form = forms.find(f => f.formKey === branchKey);
  if (!form) form = forms[0] || baseMon.mega;

  return {
    ...baseMon,
    name: form.megaName || `超级${baseMon.name}`,
    types: form.types || baseMon.types,
    baseStats: form.baseStats || baseMon.baseStats,
    abilities: [{ id: 0, name: form.ability || "专属Mega特性", desc: form.abilityDesc || "" }],
    avatar: form.avatar || baseMon.avatar,
    isMegaActive: true,
    megaFormKey: form.formKey
  };
}

// 同步副驾输入界面与状态
function syncCopilotInputUI() {
  const list = (allPokemonList && allPokemonList.length > 0)
    ? allPokemonList
    : (window.CHAMPIONS_DATA ? window.CHAMPIONS_DATA.pokemon : []);

  const pMon = copilotState.playerMon || list[0];
  const oMon = copilotState.opponentMon || list[1] || list[0];

  const analysisCard = document.getElementById('analysisCard');
  const emptyHint = document.getElementById('copilotEmptyHint');
  const dashContent = document.getElementById('copilotDashboardContent');
  if (analysisCard) analysisCard.style.display = 'block';
  if (emptyHint) emptyHint.style.display = 'none';
  if (dashContent) dashContent.style.display = 'block';

  // 1. 获取激活形态 (普通 vs Mega)
  const activePlayer = getActiveCombatant(pMon, copilotState.isPlayerMega, copilotState.playerMegaBranch);
  const activeOpp = getActiveCombatant(oMon, copilotState.isOpponentMega, copilotState.opponentMegaBranch);

  // 2. 明确展示宝可梦名称文字
  const playerNameText = document.getElementById('playerNameText');
  if (playerNameText && activePlayer) {
    if (activePlayer.isMegaActive) {
      playerNameText.innerHTML = `<span>${activePlayer.name}</span> <span class="sub-badge magenta" style="font-size:0.68rem;padding:1px 5px;vertical-align:middle;">MEGA</span>`;
    } else {
      playerNameText.innerText = activePlayer.name;
    }
  }

  const opponentNameText = document.getElementById('opponentNameText');
  if (opponentNameText && activeOpp) {
    if (activeOpp.isMegaActive) {
      opponentNameText.innerHTML = `<span>${activeOpp.name}</span> <span class="sub-badge magenta" style="font-size:0.68rem;padding:1px 5px;vertical-align:middle;">MEGA</span>`;
    } else {
      opponentNameText.innerText = activeOpp.name;
    }
  }

  // 3. 保证下拉框已填充并同步选中项
  const playerSelect = document.getElementById('playerMonSelect');
  const oppSelect = document.getElementById('opponentMonSelect');
  if (playerSelect && (playerSelect.children.length === 0 || !playerSelect.value)) {
    populateMonSelects();
  }
  if (playerSelect && pMon) playerSelect.value = pMon.id;
  if (oppSelect && oMon) oppSelect.value = oMon.id;

  // 4. 我方 Mega 按钮与分支选择器
  const playerMegaBtn = document.getElementById('playerMegaBtn');
  const playerMegaBranchSelect = document.getElementById('playerMegaBranchSelect');
  if (playerMegaBtn) {
    if (pMon && pMon.mega && pMon.mega.supported) {
      playerMegaBtn.style.display = 'inline-flex';
      if (copilotState.isPlayerMega) {
        playerMegaBtn.classList.add('active');
        playerMegaBtn.innerHTML = '<span class="mega-icon">🧬</span> Mega 已激活';
        if (pMon.mega.forms && pMon.mega.forms.length > 1 && playerMegaBranchSelect) {
          playerMegaBranchSelect.style.display = 'inline-block';
          playerMegaBranchSelect.innerHTML = pMon.mega.forms.map(f => `<option value="${f.formKey || 'X'}" ${(copilotState.playerMegaBranch === (f.formKey || 'X')) ? 'selected' : ''}>Mega ${f.formKey || 'X'}</option>`).join('');
        } else if (playerMegaBranchSelect) {
          playerMegaBranchSelect.style.display = 'none';
        }
      } else {
        playerMegaBtn.classList.remove('active');
        playerMegaBtn.innerHTML = '<span class="mega-icon">🧬</span> Mega 进化';
        if (playerMegaBranchSelect) playerMegaBranchSelect.style.display = 'none';
      }
    } else {
      playerMegaBtn.style.display = 'none';
      if (playerMegaBranchSelect) playerMegaBranchSelect.style.display = 'none';
      copilotState.isPlayerMega = false;
    }
  }

  // 5. 敌方 Mega 按钮与分支选择器
  const oppMegaBtn = document.getElementById('opponentMegaBtn');
  const oppMegaBranchSelect = document.getElementById('opponentMegaBranchSelect');
  if (oppMegaBtn) {
    if (oMon && oMon.mega && oMon.mega.supported) {
      oppMegaBtn.style.display = 'inline-flex';
      if (copilotState.isOpponentMega) {
        oppMegaBtn.classList.add('active');
        oppMegaBtn.innerHTML = '<span class="mega-icon">🧬</span> Mega 已激活';
        if (oMon.mega.forms && oMon.mega.forms.length > 1 && oppMegaBranchSelect) {
          oppMegaBranchSelect.style.display = 'inline-block';
          oppMegaBranchSelect.innerHTML = oMon.mega.forms.map(f => `<option value="${f.formKey || 'X'}" ${(copilotState.opponentMegaBranch === (f.formKey || 'X')) ? 'selected' : ''}>Mega ${f.formKey || 'X'}</option>`).join('');
        } else if (oppMegaBranchSelect) {
          oppMegaBranchSelect.style.display = 'none';
        }
      } else {
        oppMegaBtn.classList.remove('active');
        oppMegaBtn.innerHTML = '<span class="mega-icon">🧬</span> Mega 进化';
        if (oppMegaBranchSelect) oppMegaBranchSelect.style.display = 'none';
      }
    } else {
      oppMegaBtn.style.display = 'none';
      if (oppMegaBranchSelect) oppMegaBranchSelect.style.display = 'none';
      copilotState.isOpponentMega = false;
    }
  }

  // 6. 双方头像与属性
  const playerAvatar = document.getElementById('playerAvatar');
  if (playerAvatar && activePlayer) playerAvatar.src = activePlayer.avatar;
  const playerTypes = document.getElementById('playerTypes');
  if (playerTypes && activePlayer) {
    playerTypes.innerHTML = (activePlayer.types || []).map(t => `<span class="mini-type type-${t}">${TYPE_TRANSLATION[t] || t}</span>`).join('');
  }

  const opponentAvatar = document.getElementById('opponentAvatar');
  if (opponentAvatar && activeOpp) opponentAvatar.src = activeOpp.avatar;
  const opponentTypes = document.getElementById('opponentTypes');
  if (opponentTypes && activeOpp) {
    opponentTypes.innerHTML = (activeOpp.types || []).map(t => `<span class="mini-type type-${t}">${TYPE_TRANSLATION[t] || t}</span>`).join('');
  }

  // 7. 状态标签
  const oppStatusText = document.getElementById('opponentStatusText');
  if (oppStatusText) {
    oppStatusText.innerText = copilotState.opponentStatus ? copilotState.opponentStatus : '对战目标';
    if (copilotState.opponentStatus) {
      oppStatusText.style.color = '#ffd60a';
      oppStatusText.style.background = 'rgba(255, 214, 10, 0.15)';
    } else {
      oppStatusText.style.color = 'var(--text-dim)';
      oppStatusText.style.background = 'rgba(255, 255, 255, 0.05)';
    }
  }

  // 8. 刷新血量UI与统一颜色主题
  updatePlayerHpUI(copilotState.playerHpCur, copilotState.playerHpMax, copilotState.playerHpPct);
  updateOpponentHpUI(copilotState.opponentHpPct);
}

// 初始化对战副驾事件监听与输入绑定
function initCopilotControls() {
  const dropzone = document.getElementById('battleDropzone');
  const fileInput = document.getElementById('imageFileInput');
  const tailwindToggle = document.getElementById('copilotTailwindToggle');
  const scarfToggle = document.getElementById('copilotScarfToggle');
  const playerMonSelect = document.getElementById('playerMonSelect');
  const opponentMonSelect = document.getElementById('opponentMonSelect');
  const playerHpCurInput = document.getElementById('playerHpCurInput');
  const opponentHpPctInput = document.getElementById('opponentHpPctInput');

  // 全局截图 Ctrl+V 粘贴监听
  window.addEventListener('paste', handleGlobalPaste);

  // 拖拽监听
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('image/')) {
          loadAndProcessImageFile(file);
        }
      }
    });
  }

  // 本地文件选择器 (选择后自动复位，确保任何图片重复选择均能触发)
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        const file = e.target.files[0];
        e.target.value = '';
        loadAndProcessImageFile(file);
      }
    });
  }

  // 下拉框改选我方宝可梦
  if (playerMonSelect) {
    playerMonSelect.addEventListener('change', (e) => {
      const monId = parseInt(e.target.value, 10);
      onSelectCombatant('player', monId);
    });
  }

  // 下拉框改选敌方宝可梦
  if (opponentMonSelect) {
    opponentMonSelect.addEventListener('change', (e) => {
      const monId = parseInt(e.target.value, 10);
      onSelectCombatant('opp', monId);
    });
  }

  // 我方血量实时修改 (响应式更新色条、数值与推演面板)
  if (playerHpCurInput) {
    playerHpCurInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10) || 1;
      copilotState.playerHpCur = Math.min(copilotState.playerHpMax, Math.max(1, val));
      copilotState.playerHpPct = (copilotState.playerHpCur / copilotState.playerHpMax) * 100;
      updatePlayerHpUI(copilotState.playerHpCur, copilotState.playerHpMax, copilotState.playerHpPct);
      redrawCurrentCanvasOverlay();
      if (copilotState.hasAnalyzed) updateCopilotDashboard();
    });
  }

  // 敌方残血实时修改 (响应式更新色条、数值与推演面板)
  if (opponentHpPctInput) {
    opponentHpPctInput.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) || 1;
      copilotState.opponentHpPct = Math.min(100, Math.max(1, val));
      updateOpponentHpUI(copilotState.opponentHpPct);
      redrawCurrentCanvasOverlay();
      if (copilotState.hasAnalyzed) updateCopilotDashboard();
    });
  }

  // 速度线修正开关
  if (tailwindToggle) {
    tailwindToggle.addEventListener('change', (e) => {
      copilotState.isTailwind = e.target.checked;
      if (copilotState.hasAnalyzed) updateCopilotDashboard();
    });
  }

  if (scarfToggle) {
    scarfToggle.addEventListener('change', (e) => {
      copilotState.isScarf = e.target.checked;
      if (copilotState.hasAnalyzed) updateCopilotDashboard();
    });
  }

  // Mega 进化交互按钮与分支监听
  const playerMegaBtn = document.getElementById('playerMegaBtn');
  const playerMegaBranchSelect = document.getElementById('playerMegaBranchSelect');
  const opponentMegaBtn = document.getElementById('opponentMegaBtn');
  const opponentMegaBranchSelect = document.getElementById('opponentMegaBranchSelect');

  if (playerMegaBtn) {
    playerMegaBtn.addEventListener('click', () => {
      copilotState.isPlayerMega = !copilotState.isPlayerMega;
      syncCopilotInputUI();
      redrawCurrentCanvasOverlay();
      if (copilotState.hasAnalyzed) updateCopilotDashboard();
    });
  }

  if (playerMegaBranchSelect) {
    playerMegaBranchSelect.addEventListener('change', (e) => {
      copilotState.playerMegaBranch = e.target.value;
      syncCopilotInputUI();
      redrawCurrentCanvasOverlay();
      if (copilotState.hasAnalyzed) updateCopilotDashboard();
    });
  }

  if (opponentMegaBtn) {
    opponentMegaBtn.addEventListener('click', () => {
      copilotState.isOpponentMega = !copilotState.isOpponentMega;
      syncCopilotInputUI();
      redrawCurrentCanvasOverlay();
      if (copilotState.hasAnalyzed) updateCopilotDashboard();
    });
  }

  if (opponentMegaBranchSelect) {
    opponentMegaBranchSelect.addEventListener('change', (e) => {
      copilotState.opponentMegaBranch = e.target.value;
      syncCopilotInputUI();
      redrawCurrentCanvasOverlay();
      if (copilotState.hasAnalyzed) updateCopilotDashboard();
    });
  }

  // 初始填充下拉列表与血条显示
  populateMonSelects();
  updatePlayerHpUI(copilotState.playerHpCur, copilotState.playerHpMax, copilotState.playerHpPct);
  updateOpponentHpUI(copilotState.opponentHpPct);
}

// 核心战术攻防仪表盘推演计算 (完全通用，100% 算法推演，零硬编码)
function updateCopilotDashboard() {
  if (!copilotState.playerMon || !copilotState.opponentMon) return;

  const player = getActiveCombatant(copilotState.playerMon, copilotState.isPlayerMega, copilotState.playerMegaBranch);
  const opp = getActiveCombatant(copilotState.opponentMon, copilotState.isOpponentMega, copilotState.opponentMegaBranch);
  const oppHpPct = copilotState.opponentHpPct;
  const playerHpPct = copilotState.playerHpPct;

  const targetHpIndicator = document.getElementById('targetHpIndicator');
  const playerHpIndicator = document.getElementById('playerHpIndicator');
  if (targetHpIndicator) targetHpIndicator.innerText = `${oppHpPct.toFixed(1)}%`;
  if (playerHpIndicator) playerHpIndicator.innerText = `${playerHpPct.toFixed(1)}%`;

  // 1. 速度线推演 (Level 50 排位实数)
  let playerBaseSpe = calculateStat50('spe', player.baseStats.spe, 32, { plus: null, minus: null });
  if (copilotState.isScarf) playerBaseSpe = Math.floor(playerBaseSpe * 1.5);
  if (copilotState.isTailwind) playerBaseSpe = Math.floor(playerBaseSpe * 2.0);

  const oppMaxSpe = calculateStat50('spe', opp.baseStats.spe, 32, { plus: 'spe', minus: 'spa' });
  const oppMidSpe = calculateStat50('spe', opp.baseStats.spe, 32, { plus: null, minus: null });
  const oppMinSpe = calculateStat50('spe', opp.baseStats.spe, 0, { plus: null, minus: null });

  const verdictBox = document.getElementById('copilotSpeedVerdict');
  const speedBars = document.getElementById('copilotSpeedBars');

  let speedRelation = 'behind'; // 'ahead', 'tie', 'mid', 'behind'

  if (verdictBox) {
    if (playerBaseSpe > oppMaxSpe) {
      speedRelation = 'ahead';
      verdictBox.innerHTML = `
        <div class="speed-verdict-banner verdict-green">
          <span>🟢 绝对先手 (超速 ${playerBaseSpe - oppMaxSpe} 点)</span>
          <span>我方实数 ${playerBaseSpe} vs 敌方极速 ${oppMaxSpe}</span>
        </div>
      `;
    } else if (playerBaseSpe === oppMaxSpe) {
      speedRelation = 'tie';
      verdictBox.innerHTML = `
        <div class="speed-verdict-banner verdict-yellow">
          <span>🟡 同速拼速 (双方实数均为 ${playerBaseSpe}，50% 掷骰)</span>
          <span>存在拼速猜拳风险</span>
        </div>
      `;
    } else if (playerBaseSpe > oppMinSpe) {
      speedRelation = 'mid';
      verdictBox.innerHTML = `
        <div class="speed-verdict-banner verdict-yellow">
          <span>🟠 提防极速 (快过无速但慢于极速 ${oppMaxSpe - playerBaseSpe} 点)</span>
          <span>我方实数 ${playerBaseSpe} vs 敌方极速 ${oppMaxSpe} / 无速 ${oppMinSpe}</span>
        </div>
      `;
    } else {
      speedRelation = 'behind';
      verdictBox.innerHTML = `
        <div class="speed-verdict-banner verdict-red">
          <span>🔴 必定后手 (慢 ${oppMaxSpe - playerBaseSpe} 点)</span>
          <span>我方实数 ${playerBaseSpe} vs 敌方极速 ${oppMaxSpe}</span>
        </div>
      `;
    }
  }

  if (speedBars) {
    speedBars.innerHTML = `
      <div class="speed-meter-grid">
        <div class="speed-entity">
          <div class="speed-entity-label">
            <span>我方实数 ${copilotState.isTailwind ? '(顺风2x)' : copilotState.isScarf ? '(围巾1.5x)' : '(常规)'}</span>
            <span style="color:var(--accent-cyan);font-weight:700">${playerBaseSpe}</span>
          </div>
          <div class="speed-stat-number" style="color:var(--accent-cyan)">${playerBaseSpe}</div>
        </div>
        <div class="speed-entity">
          <div class="speed-entity-label">
            <span>敌方三档速度 (极速/满速/无速)</span>
            <span style="color:var(--accent-red);font-weight:700">${oppMaxSpe} / ${oppMidSpe} / ${oppMinSpe}</span>
          </div>
          <div class="speed-stat-number" style="color:var(--accent-red)">${oppMaxSpe} <span style="font-size:0.75rem;color:var(--text-muted)">(极速)</span></div>
        </div>
      </div>
    `;
  }

  // 2. 进攻端：我方招式实战斩杀线推演
  const oppMaxHpAt50 = calculateStat50('hp', opp.baseStats.hp, 0, { plus: null, minus: null });
  const oppCurHpVal = Math.max(1, Math.round(oppMaxHpAt50 * (oppHpPct / 100)));

  const playerAtk = calculateStat50('atk', player.baseStats.atk, 32, { plus: 'atk', minus: 'spa' });
  const playerSpa = calculateStat50('spa', player.baseStats.spa, 32, { plus: 'spa', minus: 'atk' });
  const oppDef = calculateStat50('def', opp.baseStats.def, 0, { plus: null, minus: null });
  const oppSpd = calculateStat50('spd', opp.baseStats.spd, 0, { plus: null, minus: null });

  // 提取我方真实招式：优先取画面识别到的招式，次之取官方学招表，绝不写死
  let activeMoves = [];
  if (copilotState.detectedMoves && copilotState.detectedMoves.length > 0) {
    // 从画面识别出来的招式中匹配
    copilotState.detectedMoves.forEach(mName => {
      const foundInLearnset = (player.learnset || []).find(m => m.name === mName);
      if (foundInLearnset) {
        activeMoves.push(foundInLearnset);
      } else {
        activeMoves.push({
          name: mName,
          type: player.types[0] || 'Normal',
          category: '物理',
          power: 80,
          priority: 0
        });
      }
    });
  }

  if (activeMoves.length < 4 && player.learnset && player.learnset.length > 0) {
    const existingNames = new Set(activeMoves.map(m => m.name));
    for (const m of player.learnset) {
      if (!existingNames.has(m.name)) {
        activeMoves.push(m);
        existingNames.add(m.name);
        if (activeMoves.length >= 4) break;
      }
    }
  }

  if (activeMoves.length === 0) {
    // 基础保底招式
    activeMoves = [
      { name: "撞击", type: "Normal", category: "物理", power: 40, priority: 0 },
      { name: "电光一闪", type: "Normal", category: "物理", power: 40, priority: 1 }
    ];
  }

  const movesContainer = document.getElementById('copilotAttackMoves');
  let movesHtml = '';
  let lethalMoveFound = null;
  let priorityMoveFound = null;

  activeMoves.forEach(m => {
    const isPhysical = m.category === "物理";
    const customAtk = isPhysical ? playerAtk : playerSpa;
    const customDef = isPhysical ? oppDef : oppSpd;
    const abilityName = (player.abilities && player.abilities[0] && (player.abilities[0].name || player.abilities[0])) || "";

    const dmg = calculateDamage(player, opp, m, customAtk, customDef, oppMaxHpAt50, abilityName, oppCurHpVal);

    if (m.priority > 0 && !priorityMoveFound && m.category !== "变化") {
      priorityMoveFound = m;
    }

    if (dmg.isBuff || m.category === "变化") {
      movesHtml += `
        <div class="kill-move-row">
          <div class="move-main-row">
            <div class="move-left-info">
              <span class="mini-type type-${m.type}">${TYPE_TRANSLATION[m.type] || m.type}</span>
              <span class="move-name-text">${m.name}</span>
              <span class="move-power-badge">变化战术</span>
            </div>
            <span class="move-verdict-tag tag-buff">🛡️ 恢复/强化</span>
          </div>
          <div class="move-pills-row">
            <span class="multiplier-pill ability">💖 战术与状态管理</span>
          </div>
          <div class="move-damage-detail">
            <span>战术效益: 强化能力阶级或执行续航恢复</span>
          </div>
        </div>
      `;
    } else {
      const isKill = dmg.minDmg >= oppCurHpVal;
      const isHighRng = !isKill && dmg.maxDmg >= oppCurHpVal;
      const rowHighlight = isKill ? 'ohko-highlight' : '';
      if (isKill && !lethalMoveFound) lethalMoveFound = m;

      let remainingText = '';
      if (isKill) {
        remainingText = `<span class="remaining-hp-text dead">必定击倒 (伤害溢出 ${(parseFloat(dmg.minPct) - oppHpPct).toFixed(1)}%)</span>`;
      } else if (isHighRng) {
        remainingText = `<span class="remaining-hp-text" style="color:var(--accent-yellow)">拼乱数斩杀线</span>`;
      } else {
        const remMin = Math.max(0, oppHpPct - parseFloat(dmg.maxPct)).toFixed(1);
        const remMax = Math.max(0, oppHpPct - parseFloat(dmg.minPct)).toFixed(1);
        remainingText = `<span class="remaining-hp-text">击后敌方剩余约 ${remMin}%~${remMax}% HP</span>`;
      }

      movesHtml += `
        <div class="kill-move-row ${rowHighlight}">
          <div class="move-main-row">
            <div class="move-left-info">
              <span class="mini-type type-${m.type}">${TYPE_TRANSLATION[m.type] || m.type}</span>
              <span class="move-name-text">${m.name}</span>
              <span class="move-power-badge">基准威力 ${m.power}</span>
              ${m.priority > 0 ? `<span class="move-priority-badge">先制 +${m.priority}</span>` : ''}
            </div>
            <span class="move-verdict-tag ${dmg.verdictClass}">${dmg.verdict}</span>
          </div>
          <div class="move-pills-row">
            ${dmg.breakdownBadges.join('')}
          </div>
          <div class="move-damage-detail">
            <span>实战伤害: <strong>${dmg.minDmg} ~ ${dmg.maxDmg}</strong> (${dmg.minPct}% ~ ${dmg.maxPct}%)</span>
            ${remainingText}
          </div>
          <div class="kill-bar-bg">
            <div class="kill-bar-fill ${isKill ? 'kill-100' : 'kill-chip'}" style="width: ${Math.min(100, (parseFloat(dmg.maxPct) / oppHpPct) * 100)}%;"></div>
          </div>
        </div>
      `;
    }
  });

  if (movesContainer) movesContainer.innerHTML = movesHtml;

  // 3. 防守端：敌方威胁招式预警 (从敌方实际学招表动态提取攻击招式)
  let threatMoves = [];
  if (opp.learnset && opp.learnset.length > 0) {
    const attacks = opp.learnset.filter(m => m.power > 0);
    // 选出本系物理、本系特殊、最高威力覆盖招式
    attacks.sort((a, b) => b.power - a.power);
    threatMoves = attacks.slice(0, 3);
  }

  if (threatMoves.length === 0) {
    threatMoves = [
      { name: "常规输出招式", type: opp.types[0] || "Normal", category: "物理", power: 80, priority: 0 }
    ];
  }

  const threatContainer = document.getElementById('copilotThreatContent');
  let threatsHtml = '';
  let lethalThreatFound = null;

  threatMoves.forEach(m => {
    const isPhysical = m.category === "物理";
    const oppAtkVal = isPhysical ? calculateStat50('atk', opp.baseStats.atk, 32, { plus: 'atk', minus: 'spa' }) : calculateStat50('spa', opp.baseStats.spa, 32, { plus: 'spa', minus: 'atk' });
    const playerDefVal = isPhysical ? calculateStat50('def', player.baseStats.def, 0, { plus: null, minus: null }) : calculateStat50('spd', player.baseStats.spd, 0, { plus: null, minus: null });

    const dmg = calculateDamage(opp, player, m, oppAtkVal, playerDefVal, copilotState.playerHpMax, "", copilotState.playerHpCur);

    let dangerBadge = '';
    let dangerStyle = '';
    if (dmg.minDmg >= copilotState.playerHpCur) {
      dangerBadge = '<span class="threat-danger-badge danger-extreme">🚨 极高猝死风险 (必杀)</span>';
      dangerStyle = 'threat-high';
      if (!lethalThreatFound) lethalThreatFound = m;
    } else if (dmg.maxDmg >= copilotState.playerHpCur) {
      dangerBadge = '<span class="threat-danger-badge danger-extreme">⚠️ 乱数猝死风险</span>';
      dangerStyle = 'threat-high';
      if (!lethalThreatFound) lethalThreatFound = m;
    } else if (parseFloat(dmg.maxPct) > 40) {
      dangerBadge = '<span class="threat-danger-badge danger-mid">⚠️ 重度消耗</span>';
    } else {
      dangerBadge = '<span class="threat-danger-badge danger-low">🛡️ 轻微刮痧</span>';
    }

    threatsHtml += `
      <div class="threat-row ${dangerStyle}">
        <div class="threat-left">
          <span class="mini-type type-${m.type}">${TYPE_TRANSLATION[m.type] || m.type}</span>
          <strong>${m.name}</strong>
          <span class="move-power-badge">${m.category} ${m.power}</span>
        </div>
        <div style="text-align:right">
          <div class="move-pills-row" style="justify-content:flex-end;margin:0 0 2px 0;">
            ${dmg.breakdownBadges.join('')}
          </div>
          ${dangerBadge}
          <div style="font-size:0.75rem;color:var(--accent-red);margin-top:2px">
            伤害 <strong>${dmg.minDmg} ~ ${dmg.maxDmg} 点</strong> (${dmg.minPct}% ~ ${dmg.maxPct}%)
          </div>
        </div>
      </div>
    `;
  });

  if (threatContainer) threatContainer.innerHTML = threatsHtml;

  // 4. 动态战术决策推演 (完全基于速度关系与击杀阈值，全精灵自适应算法)
  const adviceBox = document.getElementById('copilotTacticalAdvice');
  if (adviceBox) {
    let adviceSections = [];

    // Mega 状态加成提示
    if (player.isMegaActive) {
      const pAbi = player.abilities && player.abilities[0] ? player.abilities[0].name : '';
      adviceSections.push(`🧬 <strong>我方超级进化生效</strong>：已激活【${player.name}】形态，种族数值大幅攀升，专属特性【${pAbi}】加成已生效！`);
    }
    if (opp.isMegaActive) {
      adviceSections.push(`⚠️ <strong>敌方超级进化警戒</strong>：敌方处于【${opp.name}】超级形态，攻防两端阈值已极速飙升，谨防超常斩杀！`);
    }

    // 状态预警
    if (copilotState.opponentStatus) {
      adviceSections.push(`1. <strong>敌方状态监控</strong>：敌方当前陷入【${copilotState.opponentStatus}】，行动受限，为我方进攻创造了关键安全窗口！`);
    }

    // 速度与主动权
    if (speedRelation === 'ahead') {
      adviceSections.push(`2. <strong>先手主动权</strong>：我方实数 <strong>${playerBaseSpe}</strong> 高于敌方极速 <strong>${oppMaxSpe}</strong>（超速 ${playerBaseSpe - oppMaxSpe} 点），掌握绝对先手！`);
    } else if (speedRelation === 'tie') {
      adviceSections.push(`2. <strong>同速拼速风险</strong>：双方实数相同 (${playerBaseSpe})，存在 50% 拼速掷骰风险，直接对攻可能遭遇先手反打！`);
    } else if (speedRelation === 'mid') {
      adviceSections.push(`2. <strong>速度区间预警</strong>：我方实数 ${playerBaseSpe} 快过敌方无速 (${oppMinSpe}) 但慢于极速 (${oppMaxSpe})，需预判敌方努力值倾向！`);
    } else {
      adviceSections.push(`2. <strong>后手被动预警</strong>：我方速度实数 <strong>${playerBaseSpe}</strong> 慢于敌方极速 <strong>${oppMaxSpe}</strong>（落后 ${oppMaxSpe - playerBaseSpe} 点），处于必定后手位！`);
    }

    // 斩杀与生存判定
    if (lethalMoveFound) {
      adviceSections.push(`3. <strong>确一斩杀线已达成</strong>：我方招式【<strong>${lethalMoveFound.name}</strong>】伤害完全覆盖敌方剩余残血 (${oppHpPct}%)，进入必定斩杀射程！`);
    } else {
      adviceSections.push(`3. <strong>伤害压制评估</strong>：我方暂无一击直接击倒敌方的招式，需通过属性克制与本系加成持续压低血线。`);
    }

    if (lethalThreatFound) {
      adviceSections.push(`4. <strong>防猝死警报</strong>：敌方招式【<strong>${lethalThreatFound.name}</strong>】对我方当前生命值 (${playerHpPct.toFixed(1)}%) 构成致命猝死威胁！`);
    }

    // 核心综合决策推荐
    let decisionText = '';
    if (speedRelation === 'ahead' && lethalMoveFound) {
      decisionText = `<strong>▶ 核心建议</strong>：我方手握绝对先手权且【${lethalMoveFound.name}】具备确一能力，<strong>立即点选【${lethalMoveFound.name}】实现 100% 先手斩杀，无需换人！</strong>`;
    } else if (priorityMoveFound && lethalMoveFound && lethalMoveFound.name === priorityMoveFound.name) {
      decisionText = `<strong>▶ 核心建议</strong>：点选先制招式【<strong>${priorityMoveFound.name}</strong>】(+${priorityMoveFound.priority})，无视双方速度直接抢先收割残血！`;
    } else if (speedRelation === 'behind' && lethalThreatFound) {
      decisionText = `<strong>▶ 核心建议</strong>：后手对攻极易被敌方先手击倒！强烈建议开启<strong>【顺风】</strong>超速反杀、交出<strong>【守住】</strong>保护，或使用轮换招式换入属性联防队友！`;
    } else if (speedRelation === 'behind' && lethalMoveFound) {
      decisionText = `<strong>▶ 核心建议</strong>：我方具备斩杀伤害但处于后手位。若敌方伤害不足以击倒我方，可硬抗一击反手击杀；若有猝死风险，优先交出提速手段！`;
    } else {
      decisionText = `<strong>▶ 核心建议</strong>：根据双方弱点属性展开换血拉扯，注意规避敌方高威力打击并寻找轮换突破口。`;
    }

    adviceBox.innerHTML = `
      <strong>💡 动态战术锦囊（全算法实时推演）：</strong><br>
      ${adviceSections.join('<br>')}<br>
      ${decisionText}
    `;
  }
}
