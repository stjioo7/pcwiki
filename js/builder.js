/**
 * builder.js - 智能配队与阵容全维度诊断引擎 (Smart Team Builder & Metagame Auditor)
 * 100% 纯客户端确定性算法驱动，基于官方排位真实共现率、18属性联防矩阵与天梯 Top 20 威胁推演
 */

const builderState = {
  format: 'double', // 'double' | 'single'
  slots: [null, null, null, null, null, null],
  activeSlotIndex: null, // 当前正在选择宝可梦的卡位索引 (0..5)
};

// 全局通用立绘解析 (带多级安全兜底)
function getPokemonSpriteUrl(mon) {
  if (!mon) return 'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/items/poke-ball.png';
  if (mon.avatar) return mon.avatar;
  const id = mon.id || mon.dexNo || 1;
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

// ==========================================================================
// 1. 卡位初始化与主流配置自动填充 (Meta Rank 1 Auto-fill)
// ==========================================================================
function getPokemonMetaUsage(pokemon, fmt = 'double') {
  if (!pokemon || !pokemon.metaUsage) return {};
  if (pokemon.metaUsage[fmt]) return pokemon.metaUsage[fmt];
  return pokemon.metaUsage;
}

function getPokemonMetaRank(pokemon, fmt = 'double') {
  const usage = getPokemonMetaUsage(pokemon, fmt);
  return (usage && typeof usage.rank === 'number') ? usage.rank : 999;
}

function fillSlotWithMetaRank1(pokemon, fmt = 'double') {
  if (!pokemon) return null;

  const usage = getPokemonMetaUsage(pokemon, fmt);
  
  // 1. 道具：选取天梯最高使用率道具，兜底无道具
  const topItem = (usage.items && usage.items.length > 0)
    ? (typeof usage.items[0] === 'string' ? usage.items[0] : usage.items[0].name)
    : '气势披带';

  // 2. 特性：选取天梯最高使用率特性，兜底第一个特性
  const topAbility = (usage.abilities && usage.abilities.length > 0)
    ? (typeof usage.abilities[0] === 'string' ? usage.abilities[0] : usage.abilities[0].name)
    : (pokemon.abilities && pokemon.abilities[0]) || '通常特性';

  // 3. 性格：选取天梯最高使用率性格，兜底爽朗
  const topNature = (usage.natures && usage.natures.length > 0)
    ? (typeof usage.natures[0] === 'string' ? usage.natures[0] : usage.natures[0].name)
    : '固执';

  // 4. 招式：选取天梯前 4 大热门招式 (优先 topMoves，其次 moves)
  const moves = [];
  const metaMoves = usage.topMoves || usage.moves || [];
  if (metaMoves.length > 0) {
    for (let i = 0; i < Math.min(4, metaMoves.length); i++) {
      const mName = typeof metaMoves[i] === 'string' ? metaMoves[i] : metaMoves[i].name;
      if (mName && !moves.includes(mName)) moves.push(mName);
    }
  }
  if (moves.length < 4 && pokemon.learnset) {
    for (const lm of pokemon.learnset) {
      if (moves.length >= 4) break;
      if (lm.name && !moves.includes(lm.name)) moves.push(lm.name);
    }
  }
  while (moves.length < 4) {
    moves.push('守住');
  }

  // 5. 努力值配置模板 (优先天梯 Rank 1 EV Spread，兜底极速极攻)
  let defaultEvs = { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 };
  if (usage.evSpreads && usage.evSpreads.length > 0) {
    const topEv = usage.evSpreads[0];
    defaultEvs = {
      hp: Math.min(252, (topEv.hp || 0) * 8),
      atk: Math.min(252, (topEv.atk || 0) * 8),
      def: Math.min(252, (topEv.def || 0) * 8),
      spa: Math.min(252, (topEv.spa || 0) * 8),
      spd: Math.min(252, (topEv.spd || 0) * 8),
      spe: Math.min(252, (topEv.spe || 0) * 8)
    };
  } else {
    const isSpecial = (pokemon.baseStats && pokemon.baseStats.spa > pokemon.baseStats.atk);
    defaultEvs = isSpecial
      ? { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 }
      : { hp: 4, atk: 252, def: 0, spa: 0, spd: 0, spe: 252 };
  }

  return {
    pokemon: pokemon,
    isMega: false,
    megaBranch: 'X',
    item: topItem,
    ability: topAbility,
    nature: topNature,
    moves: moves,
    evs: defaultEvs,
  };
}

// ==========================================================================
// 2. 智能搭档推荐算法 (Smart Partner Synergy Engine)
// ==========================================================================
let MOVE_INFO_CACHE = null;
function getMoveInfo(moveName) {
  if (!MOVE_INFO_CACHE) {
    MOVE_INFO_CACHE = new Map();
    const list = (window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon) || (typeof allPokemonList !== 'undefined' ? allPokemonList : []);
    list.forEach(p => {
      if (p.learnset) {
        p.learnset.forEach(m => {
          if (m.name && !MOVE_INFO_CACHE.has(m.name)) {
            MOVE_INFO_CACHE.set(m.name, m);
          }
        });
      }
    });
  }
  return MOVE_INFO_CACHE.get(moveName) || null;
}

function calculateSmartSuggestions(fmt = 'double', limit = 6) {
  const currentMembers = builderState.slots.filter(s => s && s.pokemon);
  if (currentMembers.length >= 6) return [];

  const existingIds = new Set(currentMembers.map(s => s.pokemon.id));
  const candidateScores = new Map();

  // 若当前队伍为空，直接推荐天梯排位前列的通用基石宝可梦
  if (currentMembers.length === 0) {
    const topMons = [...allPokemonList]
      .filter(p => p.metaUsage && getPokemonMetaRank(p, fmt) < 999)
      .sort((a, b) => getPokemonMetaRank(a, fmt) - getPokemonMetaRank(b, fmt))
      .slice(0, limit);

    return topMons.map(m => {
      const rank = getPokemonMetaRank(m, fmt);
      return {
        mon: m,
        score: 100 - rank * 2,
        reasons: [`当前${fmt === 'double' ? '双打' : '单打'}排位 Rank ${rank} 核心基石`]
      };
    });
  }

  // 1. 提取当前队伍已有成员的官方天梯真实搭档共现得分
  currentMembers.forEach(member => {
    const mon = member.pokemon;
    const usage = getPokemonMetaUsage(mon, fmt);
    const partners = usage.partners || [];

    partners.forEach((p, idx) => {
      const pName = typeof p === 'string' ? p : p.name;
      const pRank = typeof p === 'object' && p.rank ? p.rank : (idx + 1);
      const pPct = typeof p === 'object' && p.percent ? p.percent : Math.max(5, 35 - (pRank - 1) * 3);

      const targetMon = allPokemonList.find(x => x.name === pName);
      if (targetMon && !existingIds.has(targetMon.id)) {
        const cur = candidateScores.get(targetMon.id) || {
          mon: targetMon,
          cooccurrenceScore: 0,
          defenseBonus: 0,
          roleBonus: 0,
          reasons: []
        };
        cur.cooccurrenceScore += pPct;
        const synReason = `与 ${mon.name} 天梯搭档 Top ${pRank}`;
        if (!cur.reasons.includes(synReason)) {
          cur.reasons.push(synReason);
        }
        candidateScores.set(targetMon.id, cur);
      }
    });
  });

  // 2. 属性联防互补计算 (Defensive Gap Filling)
  const teamWeaknesses = calculateTeamWeaknesses(currentMembers);
  const severeWeakTypes = Object.keys(teamWeaknesses).filter(t => teamWeaknesses[t].weakCount >= 2);

  allPokemonList.forEach(cand => {
    if (existingIds.has(cand.id)) return;
    const candTypes = cand.types || ['Normal'];
    let defBonus = 0;
    const coveredTypes = [];

    severeWeakTypes.forEach(weakT => {
      const mult = getMoveTypeMultiplier(weakT, candTypes);
      if (mult === 0) {
        defBonus += 35;
        coveredTypes.push(`${TYPE_TRANSLATION[weakT] || weakT}(免疫)`);
      } else if (mult <= 0.5) {
        defBonus += 20;
        coveredTypes.push(`${TYPE_TRANSLATION[weakT] || weakT}(抵抗)`);
      }
    });

    if (defBonus > 0) {
      const cur = candidateScores.get(cand.id) || {
        mon: cand,
        cooccurrenceScore: 0,
        defenseBonus: 0,
        roleBonus: 0,
        reasons: []
      };
      cur.defenseBonus += defBonus;
      const defReason = `弥补全队防守盲点: ${coveredTypes.slice(0, 2).join(' / ')}`;
      if (!cur.reasons.includes(defReason) && cur.reasons.length < 3) {
        cur.reasons.push(defReason);
      }
      candidateScores.set(cand.id, cur);
    }
  });

  // 3. 战术职能与攻防平衡加权 (Tactical Roles)
  const hasSpeedControl = currentMembers.some(m => m.moves.some(mv => ['顺风', '戏法空间', '电网', '冰冻之风'].includes(mv)));
  const hasIntimidate = currentMembers.some(m => m.ability === '威吓');
  const hasSpecialAttacker = currentMembers.some(m => m.pokemon.baseStats && m.pokemon.baseStats.spa >= 110);
  const hasPhysicalAttacker = currentMembers.some(m => m.pokemon.baseStats && m.pokemon.baseStats.atk >= 110);

  allPokemonList.forEach(cand => {
    if (existingIds.has(cand.id)) return;
    let roleBonus = 0;
    const rReasons = [];

    if (!hasSpeedControl && cand.learnset && cand.learnset.some(l => l.name === '顺风' || l.name === '戏法空间')) {
      roleBonus += 25;
      rReasons.push('提供顺风/空间控速轴');
    }
    if (!hasIntimidate && cand.abilities && cand.abilities.includes('威吓')) {
      roleBonus += 20;
      rReasons.push('提供威吓防守轮转');
    }
    if (!hasSpecialAttacker && cand.baseStats && cand.baseStats.spa >= 120) {
      roleBonus += 15;
      rReasons.push('补足特攻输出端');
    }
    if (!hasPhysicalAttacker && cand.baseStats && cand.baseStats.atk >= 120) {
      roleBonus += 15;
      rReasons.push('补足物攻爆破端');
    }

    if (roleBonus > 0) {
      const cur = candidateScores.get(cand.id) || {
        mon: cand,
        cooccurrenceScore: 0,
        defenseBonus: 0,
        roleBonus: 0,
        reasons: []
      };
      cur.roleBonus += roleBonus;
      rReasons.forEach(r => {
        if (!cur.reasons.includes(r) && cur.reasons.length < 3) {
          cur.reasons.push(r);
        }
      });
      candidateScores.set(cand.id, cur);
    }
  });

  // 综合打分并排序
  const results = Array.from(candidateScores.values()).map(item => {
    const totalScore = item.cooccurrenceScore * 1.0 + item.defenseBonus * 1.2 + item.roleBonus * 0.8;
    return {
      mon: item.mon,
      score: totalScore,
      reasons: item.reasons.slice(0, 3)
    };
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ==========================================================================
// 3. 全队联防弱点计算辅助
// ==========================================================================
function calculateTeamWeaknesses(members) {
  const chart = (window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.typeChart) || {};
  const stats = {};

  Object.keys(TYPE_TRANSLATION).forEach(atkType => {
    stats[atkType] = {
      weakCount: 0,
      resistCount: 0,
      immuneCount: 0,
      details: []
    };
  });

  members.forEach(member => {
    if (!member || !member.pokemon) return;
    const activeMon = getActiveCombatant(member.pokemon, member.isMega, member.megaBranch);
    const types = activeMon.types || ['Normal'];

    Object.keys(TYPE_TRANSLATION).forEach(atkType => {
      const mult = getMoveTypeMultiplier(atkType, types);
      stats[atkType].details.push({ mon: activeMon.name, mult });
      if (mult >= 2.0) stats[atkType].weakCount++;
      else if (mult === 0) stats[atkType].immuneCount++;
      else if (mult <= 0.5) stats[atkType].resistCount++;
    });
  });

  return stats;
}

// ==========================================================================
// 4. 全维度阵容诊断与审计引擎 (Team Auditor)
// ==========================================================================
function runTeamAudit() {
  const members = builderState.slots.filter(s => s && s.pokemon);
  if (members.length === 0) {
    return {
      isEmpty: true,
      weaknessStats: {},
      threatResults: [],
      speedTiers: [],
      legalityIssues: []
    };
  }

  // 1. 18 属性防御盲点矩阵
  const weaknessStats = calculateTeamWeaknesses(members);

  // 2. 天梯 Top 20 威胁度对位审查
  const fmt = builderState.format;
  const top20Meta = [...allPokemonList]
    .filter(p => p.metaUsage && getPokemonMetaRank(p, fmt) < 999)
    .sort((a, b) => getPokemonMetaRank(a, fmt) - getPokemonMetaRank(b, fmt))
    .slice(0, 20);

  const threatResults = top20Meta.map(threat => {
    const threatRank = getPokemonMetaRank(threat, fmt);
    const threatTypes = threat.types || ['Normal'];
    let counterScore = 0;
    const counters = [];
    const vulnerableMembers = [];

    members.forEach(m => {
      const mMon = getActiveCombatant(m.pokemon, m.isMega, m.megaBranch);
      const mTypes = mMon.types || ['Normal'];

      // 评估我方招式对敌方克制
      let maxAtkMult = 1.0;
      m.moves.forEach(mvName => {
        const minfo = getMoveInfo(mvName);
        const atkType = (minfo && minfo.type) || mTypes[0];
        const mvMult = getMoveTypeMultiplier(atkType, threatTypes);
        if (mvMult > maxAtkMult) maxAtkMult = mvMult;
      });

      // 评估敌方对我的克制 (敌方所有属性攻击我方的最大克制倍数)
      let maxDefMult = 1.0;
      threatTypes.forEach(t => {
        const mult = getMoveTypeMultiplier(t, mTypes);
        if (mult > maxDefMult) maxDefMult = mult;
      });

      if (maxAtkMult >= 2.0 && maxDefMult <= 1.0) {
        counterScore += 2;
        counters.push(mMon.name);
      } else if (maxDefMult >= 2.0 && maxAtkMult <= 1.0) {
        counterScore -= 2;
        vulnerableMembers.push(mMon.name);
      }
    });

    let status = 'even'; // 'advantage' | 'even' | 'threat'
    if (counterScore >= 2) status = 'advantage';
    else if (counterScore <= -2 || vulnerableMembers.length >= 3) status = 'threat';

    return {
      threatMon: threat,
      rank: threatRank,
      status: status,
      counters: counters,
      vulnerableMembers: vulnerableMembers
    };
  });

  // 3. 队伍速度线阶梯 (Speed Tiers)
  const speedTiers = members.map(m => {
    const mon = getActiveCombatant(m.pokemon, m.isMega, m.megaBranch);
    const baseSpe = mon.baseStats ? mon.baseStats.spe : 80;
    const maxSpe = calculateStat50('spe', baseSpe, 32, { plus: 'spe', minus: null }); // 50级极速
    const neutralSpe = calculateStat50('spe', baseSpe, 32, { plus: null, minus: null }); // 50级满速
    const uninvestedSpe = calculateStat50('spe', baseSpe, 0, { plus: null, minus: null }); // 50级无速
    const tailwindSpe = maxSpe * 2;

    return {
      name: mon.name,
      baseSpe: baseSpe,
      maxSpe: maxSpe,
      neutralSpe: neutralSpe,
      uninvestedSpe: uninvestedSpe,
      tailwindSpe: tailwindSpe
    };
  }).sort((a, b) => b.maxSpe - a.maxSpe);

  // 4. 规则合规与合法性审计 (Legality Check)
  const legalityIssues = [];
  const itemMap = new Map();
  let megaCount = 0;

  members.forEach((m, idx) => {
    // 检查道具唯一性 (Item Clause)
    if (m.item) {
      if (itemMap.has(m.item)) {
        legalityIssues.push({
          level: 'error',
          msg: `【道具重复】位置 #${itemMap.get(m.item) + 1} (${members[itemMap.get(m.item)].pokemon.name}) 与 位置 #${idx + 1} (${m.pokemon.name}) 均携带了「${m.item}」，违背对战道具唯一规则 (Item Clause)。`
        });
      } else {
        itemMap.set(m.item, idx);
      }
    }

    // 检查 Mega 进化
    if (m.isMega) megaCount++;
  });

  if (megaCount > 1) {
    legalityIssues.push({
      level: 'warning',
      msg: `【超级进化提示】队伍中有 ${megaCount} 只宝可梦携带了超级进化石。单场对战仅能激活 1 次 Mega 进化，请根据战局灵活选出。`
    });
  }

  if (members.length < 6) {
    legalityIssues.push({
      level: 'info',
      msg: `【阵容未满】当前队伍共有 ${members.length} / 6 只宝可梦，可点击下方智能推荐搭档或使用“一键智能补全”。`
    });
  }

  return {
    isEmpty: false,
    memberCount: members.length,
    weaknessStats: weaknessStats,
    threatResults: threatResults,
    speedTiers: speedTiers,
    legalityIssues: legalityIssues
  };
}

// ==========================================================================
// 5. 导出 Showdown 格式队伍文本
// ==========================================================================
function exportTeamShowdownText() {
  const members = builderState.slots.filter(s => s && s.pokemon);
  if (members.length === 0) return '队伍为空，请先添加宝可梦。';

  let text = '';
  members.forEach(m => {
    const p = m.pokemon;
    const nameEn = p.nameEn || p.name;
    text += `${p.name} (${nameEn}) @ ${m.item}\n`;
    text += `Ability: ${m.ability}\n`;
    text += `Level: 50\n`;
    text += `${m.nature} Nature\n`;
    if (m.evs) {
      const evParts = [];
      if (m.evs.hp) evParts.push(`${m.evs.hp} HP`);
      if (m.evs.atk) evParts.push(`${m.evs.atk} Atk`);
      if (m.evs.def) evParts.push(`${m.evs.def} Def`);
      if (m.evs.spa) evParts.push(`${m.evs.spa} SpA`);
      if (m.evs.spd) evParts.push(`${m.evs.spd} SpD`);
      if (m.evs.spe) evParts.push(`${m.evs.spe} Spe`);
      if (evParts.length > 0) text += `EVs: ${evParts.join(' / ')}\n`;
    }
    (m.moves || []).forEach(mv => {
      text += `- ${mv}\n`;
    });
    text += '\n';
  });

  return text.trim();
}

// ==========================================================================
// 6. 前端 UI 渲染与交互控制器 (UI View Controller)
// ==========================================================================

function initTeamBuilder() {
  const builderView = document.getElementById('builderView');
  if (!builderView) return;

  // 绑定赛制切换
  const formatBtns = document.querySelectorAll('#builderFormatToggleGroup .mode-btn');
  formatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      formatBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      builderState.format = btn.dataset.builderFormat || 'double';
      renderBuilderView();
    });
  });

  // 绑定一键补全
  const autoBtn = document.getElementById('builderAutoCompleteBtn');
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      autoCompleteTeam();
    });
  }

  // 绑定清空阵容
  const clearBtn = document.getElementById('builderClearBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('确定要清空当前所有 6 个卡位的队伍配置吗？')) {
        builderState.slots = [null, null, null, null, null, null];
        renderBuilderView();
      }
    });
  }

  // 绑定导出文本
  const exportBtn = document.getElementById('builderExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const text = exportTeamShowdownText();
      navigator.clipboard.writeText(text).then(() => {
        alert('🎉 队伍 Showdown 配置文本已成功复制到剪贴板！');
      }).catch(() => {
        prompt('请手动复制队伍配置文本：', text);
      });
    });
  }

  // 初始化模态框选择器
  initPokemonPickerModal();

  // 初次渲染
  renderBuilderView();
}

// 一键智能补全队伍至 6 只
function autoCompleteTeam() {
  let emptyIndices = [];
  builderState.slots.forEach((s, idx) => {
    if (!s || !s.pokemon) emptyIndices.push(idx);
  });

  if (emptyIndices.length === 0) {
    alert('队伍已经满员（6/6）！如需重新搭配，可清空或移除特定卡位。');
    return;
  }

  emptyIndices.forEach(idx => {
    const suggestions = calculateSmartSuggestions(builderState.format, 10);
    if (suggestions.length > 0) {
      const chosen = suggestions[0].mon;
      builderState.slots[idx] = fillSlotWithMetaRank1(chosen, builderState.format);
    }
  });

  renderBuilderView();
}

// 渲染整个 Builder 页面
function renderBuilderView() {
  if (typeof document === 'undefined') return;
  renderBuilderSlots();
  renderSmartSuggestions();
  renderAuditDashboard();
}

// 渲染 6 个卡位
function renderBuilderSlots() {
  const grid = document.getElementById('builderSlotsGrid');
  if (!grid) return;

  grid.innerHTML = '';

  builderState.slots.forEach((slot, idx) => {
    const card = document.createElement('div');
    card.className = `builder-slot-card ${slot ? 'filled' : 'empty'}`;

    if (!slot || !slot.pokemon) {
      card.innerHTML = `
        <div class="empty-slot-content" onclick="openPokemonPicker(${idx})">
          <div class="slot-number">#${idx + 1}</div>
          <div class="add-icon">＋</div>
          <div class="add-title">添加宝可梦</div>
          <div class="add-hint">点击自选或下方智能推荐</div>
        </div>
      `;
    } else {
      const p = slot.pokemon;
      const activeMon = getActiveCombatant(p, slot.isMega, slot.megaBranch);
      const spriteUrl = getPokemonSpriteUrl(activeMon);
      const types = activeMon.types || ['Normal'];
      const typeBadges = types.map(t => `<span class="type-badge ${t.toLowerCase()}">${TYPE_TRANSLATION[t] || t}</span>`).join(' ');

      // 生成特性下拉选项
      const abilityOptions = (p.abilities || [slot.ability]).map(ab => 
        `<option value="${ab}" ${ab === slot.ability ? 'selected' : ''}>${ab}</option>`
      ).join('');

      // 生成性格下拉选项
      const natureOptions = NATURES.map(n => {
        const nName = n.name.split(' ')[0];
        return `<option value="${nName}" ${nName === slot.nature ? 'selected' : ''}>${n.name}</option>`;
      }).join('');

      // 生成 4 个招式下拉/选项
      const allLearnable = p.learnset ? p.learnset.map(l => l.name) : [];
      slot.moves.forEach(m => {
        if (m && !allLearnable.includes(m)) allLearnable.unshift(m);
      });

      const moveInputsHtml = slot.moves.map((mv, mIdx) => {
        const optionsHtml = allLearnable.map(lm => 
          `<option value="${lm}" ${lm === mv ? 'selected' : ''}>${lm}</option>`
        ).join('');
        return `
          <div class="slot-move-row">
            <span class="move-num">${mIdx + 1}</span>
            <select class="builder-select move-select" onchange="updateSlotMove(${idx}, ${mIdx}, this.value)">
              ${optionsHtml}
            </select>
          </div>
        `;
      }).join('');

      // Mega 切换按钮 (若该宝可梦支持 Mega)
      let megaToggleHtml = '';
      if (p.megaForms || p.megaBranches) {
        megaToggleHtml = `
          <button class="slot-mega-toggle-btn ${slot.isMega ? 'active' : ''}" onclick="toggleSlotMega(${idx})">
            ⚡ Mega
          </button>
        `;
      }

      card.innerHTML = `
        <div class="slot-card-header">
          <span class="slot-badge">#${idx + 1}</span>
          <div class="slot-card-actions">
            ${megaToggleHtml}
            <button class="slot-remove-btn" title="移除此卡位" onclick="removeSlot(${idx})">✕</button>
          </div>
        </div>

        <div class="slot-profile">
          <img class="slot-avatar" src="${spriteUrl}" alt="${activeMon.name}" onclick="openPokemonPicker(${idx})">
          <div class="slot-identity">
            <h4 class="slot-name" onclick="openPokemonPicker(${idx})">${activeMon.name}</h4>
            <span class="slot-name-en">${p.nameEn || ''}</span>
            <div class="slot-types">${typeBadges}</div>
          </div>
        </div>

        <div class="slot-form-grid">
          <!-- 道具与特性 -->
          <div class="slot-field-group">
            <label>道具</label>
            <input type="text" class="builder-input" value="${slot.item || ''}" placeholder="如: 气势披带" onchange="updateSlotField(${idx}, 'item', this.value)">
          </div>

          <div class="slot-field-group">
            <label>特性</label>
            <select class="builder-select" onchange="updateSlotField(${idx}, 'ability', this.value)">
              ${abilityOptions}
            </select>
          </div>

          <!-- 性格 -->
          <div class="slot-field-group full-width">
            <label>性格</label>
            <select class="builder-select" onchange="updateSlotField(${idx}, 'nature', this.value)">
              ${natureOptions}
            </select>
          </div>

          <!-- 4 招式 -->
          <div class="slot-moves-group full-width">
            <label>技能配置 (4 Moves)</label>
            <div class="moves-grid">
              ${moveInputsHtml}
            </div>
          </div>
        </div>
      `;
    }

    grid.appendChild(card);
  });
}

// 渲染智能搭档推荐池
function renderSmartSuggestions() {
  const panel = document.getElementById('builderSuggestionsPanel');
  if (!panel) return;

  const members = builderState.slots.filter(s => s && s.pokemon);
  if (members.length >= 6) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';

  const suggestions = calculateSmartSuggestions(builderState.format, 6);
  const container = document.getElementById('suggestionsList');
  if (!container) return;

  container.innerHTML = '';

  if (suggestions.length === 0) {
    container.innerHTML = '<div class="no-suggestions">暂无更多推荐搭档</div>';
    return;
  }

  suggestions.forEach(item => {
    const mon = item.mon;
    const spriteUrl = getPokemonSpriteUrl(mon);
    const types = mon.types || ['Normal'];
    const typeBadges = types.map(t => `<span class="type-badge ${t.toLowerCase()}">${TYPE_TRANSLATION[t] || t}</span>`).join(' ');
    const reasonsHtml = item.reasons.map(r => `<span class="suggestion-chip">💡 ${r}</span>`).join('');

    const itemCard = document.createElement('div');
    itemCard.className = 'suggestion-item-card';
    itemCard.innerHTML = `
      <img class="sug-avatar" src="${spriteUrl}" alt="${mon.name}">
      <div class="sug-info">
        <div class="sug-title">
          <strong>${mon.name}</strong>
          <span class="sug-types">${typeBadges}</span>
        </div>
        <div class="sug-reasons">${reasonsHtml}</div>
      </div>
      <button class="sug-add-btn" onclick="addSuggestedPokemon(${mon.id})">＋ 加入阵容</button>
    `;
    container.appendChild(itemCard);
  });
}

// 渲染全维度诊断仪表盘
function renderAuditDashboard() {
  const dashboard = document.getElementById('builderAuditDashboard');
  if (!dashboard) return;

  const audit = runTeamAudit();
  if (audit.isEmpty) {
    dashboard.innerHTML = `
      <div class="empty-audit-hint">
        <div class="hint-icon">📊</div>
        <h3>阵容诊断面板就绪</h3>
        <p>请在上方卡位添加至少 1 只宝可梦，系统将自动展开【18 属性防御热力图】、【天梯 Top 20 威胁度对位审查】与【规则合规审计】。</p>
      </div>
    `;
    return;
  }

  // 1. 合规与提示信息 (Legality Alerts)
  let legalityHtml = '';
  if (audit.legalityIssues.length > 0) {
    const alerts = audit.legalityIssues.map(issue => `
      <div class="audit-alert-item ${issue.level}">
        <span class="alert-icon">${issue.level === 'error' ? '🚫' : issue.level === 'warning' ? '⚠️' : 'ℹ️'}</span>
        <span class="alert-text">${issue.msg}</span>
      </div>
    `).join('');
    legalityHtml = `<div class="audit-alerts-wrap">${alerts}</div>`;
  }

  // 2. 18 属性防御盲点热力表格 (Defense Heatmap)
  const stats = audit.weaknessStats;
  let heatmapRowsHtml = Object.keys(TYPE_TRANSLATION).map(atkType => {
    const data = stats[atkType];
    const weakCount = data.weakCount;
    const resistCount = data.resistCount;
    const immuneCount = data.immuneCount;

    let rowClass = 'normal';
    let statusBadge = '<span class="status-badge normal">正常</span>';
    if (weakCount >= 3 && immuneCount === 0) {
      rowClass = 'danger';
      statusBadge = `<span class="status-badge danger">🔴 严重弱点 (${weakCount}只弱)</span>`;
    } else if (weakCount >= 2 && immuneCount === 0 && resistCount <= 1) {
      rowClass = 'warning';
      statusBadge = `<span class="status-badge warning">🟡 弱点偏多 (${weakCount}只弱)</span>`;
    } else if (immuneCount > 0 || resistCount >= 3) {
      rowClass = 'safe';
      statusBadge = `<span class="status-badge safe">🟢 联防稳固 (${resistCount}抗/${immuneCount}免)</span>`;
    }

    return `
      <tr class="heatmap-row ${rowClass}">
        <td class="type-cell">
          <span class="type-badge ${atkType.toLowerCase()}">${TYPE_TRANSLATION[atkType] || atkType}</span>
        </td>
        <td class="num-cell weak">${weakCount > 0 ? `${weakCount} 只` : '-'}</td>
        <td class="num-cell resist">${resistCount > 0 ? `${resistCount} 只` : '-'}</td>
        <td class="num-cell immune">${immuneCount > 0 ? `${immuneCount} 只` : '-'}</td>
        <td class="status-cell">${statusBadge}</td>
      </tr>
    `;
  }).join('');

  // 3. 天梯 Top 20 威胁度对位卡片 (Threat Audit)
  const threatCardsHtml = audit.threatResults.map(item => {
    const tMon = item.threatMon;
    const spriteUrl = getPokemonSpriteUrl(tMon);
    const badgeClass = item.status === 'advantage' ? 'adv' : item.status === 'threat' ? 'danger' : 'even';
    const badgeText = item.status === 'advantage' ? '🟢 我方优势' : item.status === 'threat' ? '🔴 威胁盲点' : '🟡 均势对抗';
    const detailText = item.status === 'advantage'
      ? `克制手: ${item.counters.join(', ')}`
      : item.status === 'threat'
      ? `受制成员: ${item.vulnerableMembers.join(', ')}`
      : '攻防互有往来';

    return `
      <div class="threat-card ${badgeClass}">
        <div class="threat-header">
          <span class="threat-rank">Rank ${item.rank}</span>
          <span class="threat-status-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="threat-body">
          <img class="threat-avatar" src="${spriteUrl}" alt="${tMon.name}">
          <div class="threat-details">
            <strong>${tMon.name}</strong>
            <span class="threat-note">${detailText}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 4. 队伍速度线阶梯 (Speed Tiers)
  const speedRowsHtml = audit.speedTiers.map((s, sIdx) => `
    <div class="speed-tier-row">
      <span class="speed-rank">#${sIdx + 1}</span>
      <strong class="speed-name">${s.name}</strong>
      <div class="speed-bars">
        <span class="speed-val max" title="50级 极速 (252+ Spe)">极速: ${s.maxSpe}</span>
        <span class="speed-val neutral" title="50级 满速 (252 Spe)">满速: ${s.neutralSpe}</span>
        <span class="speed-val uninvested" title="50级 无速 (0 Spe)">无速: ${s.uninvestedSpe}</span>
        <span class="speed-val tailwind" title="顺风翻倍速度">顺风: ${s.tailwindSpe}</span>
      </div>
    </div>
  `).join('');

  dashboard.innerHTML = `
    ${legalityHtml}

    <div class="audit-grid-layout">
      <!-- 栏目 1: 18 属性防御热力图 -->
      <div class="audit-panel-box">
        <div class="panel-box-header">
          <h3><span class="icon">🛡️</span> 18 属性联防盲点热力图</h3>
          <span class="sub-hint">实时分析 6 只队伍的弱点与抗性覆盖度</span>
        </div>
        <div class="table-responsive">
          <table class="defense-heatmap-table">
            <thead>
              <tr>
                <th>攻击属性</th>
                <th>弱点 (2x/4x)</th>
                <th>抵抗 (0.5x/0.25x)</th>
                <th>免疫 (0x)</th>
                <th>防守评级</th>
              </tr>
            </thead>
            <tbody>
              ${heatmapRowsHtml}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 栏目 2: 天梯 Top 20 威胁度对位与速度线 -->
      <div class="audit-col-right">
        <!-- 天梯前20威胁 -->
        <div class="audit-panel-box">
          <div class="panel-box-header">
            <h3><span class="icon">🎯</span> 当前官方排位 Top 20 威胁度对位审查</h3>
            <span class="sub-hint">基于天梯热门核心推演胜势与灭队盲点</span>
          </div>
          <div class="threat-cards-grid">
            ${threatCardsHtml}
          </div>
        </div>

        <!-- 速度线阶梯 -->
        <div class="audit-panel-box">
          <div class="panel-box-header">
            <h3><span class="icon">⚡</span> 队伍 50 级速度线阶梯 (Speed Tiers)</h3>
            <span class="sub-hint">含极速、满速、无速与顺风提速实数值</span>
          </div>
          <div class="speed-tiers-container">
            ${speedRowsHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ==========================================================================
// 7. 槽位修改与模态框事件
// ==========================================================================

function updateSlotField(slotIndex, field, value) {
  if (builderState.slots[slotIndex]) {
    builderState.slots[slotIndex][field] = value;
    renderAuditDashboard();
  }
}

function updateSlotMove(slotIndex, moveIndex, moveName) {
  if (builderState.slots[slotIndex] && builderState.slots[slotIndex].moves) {
    builderState.slots[slotIndex].moves[moveIndex] = moveName;
    renderAuditDashboard();
  }
}

function toggleSlotMega(slotIndex) {
  if (builderState.slots[slotIndex]) {
    builderState.slots[slotIndex].isMega = !builderState.slots[slotIndex].isMega;
    renderBuilderSlots();
    renderAuditDashboard();
  }
}

function removeSlot(slotIndex) {
  builderState.slots[slotIndex] = null;
  renderBuilderView();
}

function addSuggestedPokemon(pokemonId) {
  const mon = allPokemonList.find(p => p.id === pokemonId);
  if (!mon) return;

  const emptyIdx = builderState.slots.findIndex(s => !s || !s.pokemon);
  if (emptyIdx !== -1) {
    builderState.slots[emptyIdx] = fillSlotWithMetaRank1(mon, builderState.format);
    renderBuilderView();
  }
}

// ==========================================================================
// 8. 宝可梦点选模态框 (Pokemon Picker Modal)
// ==========================================================================
function initPokemonPickerModal() {
  const modal = document.getElementById('builderPickerModal');
  const closeBtn = document.getElementById('builderPickerCloseBtn');
  const searchInput = document.getElementById('builderPickerSearchInput');

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('open');
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderPokemonPickerGrid(searchInput.value.trim());
    });
  }
}

function openPokemonPicker(slotIndex) {
  builderState.activeSlotIndex = slotIndex;
  const modal = document.getElementById('builderPickerModal');
  const searchInput = document.getElementById('builderPickerSearchInput');
  if (modal) {
    modal.classList.add('open');
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
    }
    renderPokemonPickerGrid('');
  }
}

function renderPokemonPickerGrid(query = '') {
  const container = document.getElementById('builderPickerGrid');
  if (!container) return;

  container.innerHTML = '';
  const fmt = builderState.format;

  let list = [...allPokemonList];
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(p => 
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.nameEn && p.nameEn.toLowerCase().includes(q)) ||
      (p.id && String(p.id).includes(q))
    );
  }

  // 按天梯排名排序
  list.sort((a, b) => {
    const rankA = getPokemonMetaRank(a, fmt);
    const rankB = getPokemonMetaRank(b, fmt);
    return rankA - rankB;
  });

  list.slice(0, 60).forEach(mon => {
    const spriteUrl = getPokemonSpriteUrl(mon);
    const types = mon.types || ['Normal'];
    const rank = getPokemonMetaRank(mon, fmt);
    const rankDisplay = rank < 999 ? `Rank ${rank}` : 'Unranked';

    const item = document.createElement('div');
    item.className = 'picker-mon-item';
    item.innerHTML = `
      <img src="${spriteUrl}" alt="${mon.name}">
      <div class="picker-mon-name">${mon.name}</div>
      <div class="picker-mon-meta">${rankDisplay} · ${types.map(t => TYPE_TRANSLATION[t] || t).join('/')}</div>
    `;
    item.addEventListener('click', () => {
      if (builderState.activeSlotIndex !== null) {
        builderState.slots[builderState.activeSlotIndex] = fillSlotWithMetaRank1(mon, builderState.format);
        const modal = document.getElementById('builderPickerModal');
        if (modal) modal.classList.remove('open');
        renderBuilderView();
      }
    });
    container.appendChild(item);
  });
}

// Global & Node export bindings
if (typeof window !== 'undefined') {
  window.builderState = builderState;
  window.fillSlotWithMetaRank1 = fillSlotWithMetaRank1;
  window.calculateSmartSuggestions = calculateSmartSuggestions;
  window.autoCompleteTeam = autoCompleteTeam;
  window.runTeamAudit = runTeamAudit;
  window.exportTeamShowdownText = exportTeamShowdownText;
  window.initTeamBuilder = initTeamBuilder;
  window.renderBuilderView = renderBuilderView;
  window.openPokemonPicker = openPokemonPicker;
  window.removeSlot = removeSlot;
  window.toggleSlotMega = toggleSlotMega;
  window.updateSlotField = updateSlotField;
  window.updateSlotMove = updateSlotMove;
  window.addSuggestedPokemon = addSuggestedPokemon;
  window.getPokemonSpriteUrl = getPokemonSpriteUrl;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    builderState,
    fillSlotWithMetaRank1,
    calculateSmartSuggestions,
    autoCompleteTeam,
    runTeamAudit,
    exportTeamShowdownText,
    getPokemonSpriteUrl
  };
}
