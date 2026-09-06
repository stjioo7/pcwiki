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
  if (!pokemon) return {};
  if (pokemon.meta && pokemon.meta[fmt]) return pokemon.meta[fmt];
  if (pokemon.metaUsage && pokemon.metaUsage[fmt]) return pokemon.metaUsage[fmt];
  if (pokemon.metaUsage) return pokemon.metaUsage;
  return {};
}

function getPokemonMetaRank(pokemon, fmt = 'double') {
  const usage = getPokemonMetaUsage(pokemon, fmt);
  return (usage && typeof usage.rank === 'number') ? usage.rank : 999;
}

function fillSlotWithMetaRank1(pokemon, fmt = 'double') {
  if (!pokemon) return null;

  const usage = getPokemonMetaUsage(pokemon, fmt);
  
  // 1. 道具：选取当前赛制天梯最高使用率道具，兜底无道具
  const topItem = (usage.items && usage.items.length > 0)
    ? (typeof usage.items[0] === 'string' ? usage.items[0] : usage.items[0].name)
    : (fmt === 'double' ? '气势披带' : '吃剩的东西');

  // 2. 特性：选取当前赛制天梯最高使用率特性，兜底第一个特性
  let topAbility = '通常特性';
  if (usage.abilities && usage.abilities.length > 0) {
    topAbility = typeof usage.abilities[0] === 'string' ? usage.abilities[0] : (usage.abilities[0].name || '通常特性');
  } else if (pokemon.abilities && pokemon.abilities.length > 0) {
    topAbility = typeof pokemon.abilities[0] === 'string' ? pokemon.abilities[0] : (pokemon.abilities[0].name || '通常特性');
  }

  // 3. 性格：选取当前赛制天梯最高使用率性格，兜底固执/爽朗
  const topNature = (usage.natures && usage.natures.length > 0)
    ? (typeof usage.natures[0] === 'string' ? usage.natures[0] : usage.natures[0].name)
    : '固执';

  // 4. 招式：选取当前赛制天梯前 4 大热门招式 (优先 topMoves，其次 moves)
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
      if (lm.name && !moves.includes(lm.name)) {
        // 单打模式下不优先补充守住，优先补充高威力或强化招式
        if (fmt === 'single' && lm.name === '守住') continue;
        moves.push(lm.name);
      }
    }
  }
  // 兜底招式
  while (moves.length < 4) {
    const fallbackMove = (fmt === 'double') ? '守住' : '替身';
    if (!moves.includes(fallbackMove)) {
      moves.push(fallbackMove);
    } else {
      moves.push('电光一闪');
      break;
    }
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
  if (!moveName) return null;
  if (!MOVE_INFO_CACHE) {
    MOVE_INFO_CACHE = new Map();
    const list = (typeof window !== 'undefined' && window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon)
      || (typeof allPokemonList !== 'undefined' ? allPokemonList : []);
    list.forEach(p => {
      if (p.learnset) {
        p.learnset.forEach(m => {
          if (m.name && !MOVE_INFO_CACHE.has(m.name)) {
            MOVE_INFO_CACHE.set(m.name, m);
            MOVE_INFO_CACHE.set(m.name.toLowerCase(), m);
          }
        });
      }
    });
  }
  if (MOVE_INFO_CACHE.has(moveName)) return MOVE_INFO_CACHE.get(moveName);
  if (MOVE_INFO_CACHE.has(moveName.toLowerCase())) return MOVE_INFO_CACHE.get(moveName.toLowerCase());

  // 尝试通过中英招式字典转译查找
  const zhName = (typeof translateMoveToZh === 'function')
    ? translateMoveToZh(moveName)
    : (typeof CHAMPIONS_MOVES_ZH !== 'undefined' ? CHAMPIONS_MOVES_ZH[moveName] : null);
  if (zhName && MOVE_INFO_CACHE.has(zhName)) return MOVE_INFO_CACHE.get(zhName);

  return null;
}

function findPokemonByName(name) {
  if (!name) return null;
  const q = String(name).trim().toLowerCase();
  const list = (typeof window !== 'undefined' && window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon)
    || (typeof allPokemonList !== 'undefined' ? allPokemonList : []);
  return list.find(p => 
    (p.name && p.name.toLowerCase() === q) ||
    (p.enName && p.enName.toLowerCase() === q) ||
    (p.nameEn && p.nameEn.toLowerCase() === q) ||
    (p.slug && p.slug.toLowerCase() === q)
  ) || null;
}

function formatVariantZh(variantStr) {
  if (!variantStr) return '';
  let rawItem = '';
  if (variantStr.includes('item=')) {
    const match = variantStr.match(/item=([^|&]+)/);
    if (match) rawItem = decodeURIComponent(match[1]);
  } else if (!variantStr.includes('|') && !variantStr.includes(':')) {
    rawItem = decodeURIComponent(variantStr);
  }
  
  if (rawItem) {
    const itemZh = (typeof translateItemToZh === 'function') ? translateItemToZh(rawItem) : rawItem;
    return itemZh;
  }
  return '';
}

function aggregateThreatRoutes(routes) {
  if (!routes || routes.length === 0) return [];
  
  const moveMap = new Map();
  routes.forEach(r => {
    const move = r.move;
    const target = r.target_member || r.member;
    const moveType = r.move_type || (getMoveInfo(move) && getMoveInfo(move).type) || 'Normal';
    const variantItem = formatVariantZh(r.variant || r.opponentVariant);

    const key = `${move}__${moveType}`;
    if (!moveMap.has(key)) {
      moveMap.set(key, {
        move: move,
        move_type: moveType,
        targets: new Set(),
        variants: new Set()
      });
    }
    if (target) moveMap.get(key).targets.add(target);
    if (variantItem) moveMap.get(key).variants.add(variantItem);
  });

  return Array.from(moveMap.values()).map(item => ({
    move: item.move,
    move_type: item.move_type,
    targets: Array.from(item.targets),
    variants: Array.from(item.variants)
  }));
}

function calculateSmartSuggestions(fmt = 'double', limit = 6) {
  const currentMembers = builderState.slots.filter(s => s && s.pokemon);
  if (currentMembers.length >= 6) return [];

  const existingIds = new Set(currentMembers.map(s => s.pokemon.id));
  const candidateScores = new Map();

  // 若当前队伍为空，直接推荐天梯排位前列的通用基石宝可梦
  if (currentMembers.length === 0) {
    const topMons = [...allPokemonList]
      .filter(p => getPokemonMetaRank(p, fmt) < 999)
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

  // 3. 战术职能与攻防平衡加权 (Tactical Roles - 单打与双打专属职能模型)
  const hasSpecialAttacker = currentMembers.some(m => m.pokemon.baseStats && m.pokemon.baseStats.spa >= 110);
  const hasPhysicalAttacker = currentMembers.some(m => m.pokemon.baseStats && m.pokemon.baseStats.atk >= 110);

  if (fmt === 'double') {
    // 双打核心职能：控速 (顺风/空间) + 轮转干扰 (威吓/击掌奇袭/看我嘛) + 物特平衡
    const hasSpeedControl = currentMembers.some(m => m.moves.some(mv => ['顺风', '戏法空间', '电网', '冰冻之风'].includes(mv)));
    const hasIntimidateOrFakeOut = currentMembers.some(m => m.ability === '威吓' || m.moves.includes('击掌奇袭'));
    const hasRedirection = currentMembers.some(m => m.moves.some(mv => ['看我嘛', '愤怒粉', '广域防守'].includes(mv)));

    allPokemonList.forEach(cand => {
      if (existingIds.has(cand.id)) return;
      let roleBonus = 0;
      const rReasons = [];

      if (!hasSpeedControl && cand.learnset && cand.learnset.some(l => ['顺风', '戏法空间', '电网', '冰冻之风'].includes(l.name))) {
        roleBonus += 25;
        rReasons.push('提供顺风/空间控速轴');
      }
      if (!hasIntimidateOrFakeOut && (cand.abilities && cand.abilities.includes('威吓') || (cand.learnset && cand.learnset.some(l => l.name === '击掌奇袭')))) {
        roleBonus += 20;
        rReasons.push('提供威吓/击掌防守轮转');
      }
      if (!hasRedirection && cand.learnset && cand.learnset.some(l => ['看我嘛', '愤怒粉', '广域防守'].includes(l.name))) {
        roleBonus += 15;
        rReasons.push('提供掩护/广防保护');
      }
      if (!hasSpecialAttacker && cand.baseStats && cand.baseStats.spa >= 115) {
        roleBonus += 15;
        rReasons.push('补足特攻输出端');
      }
      if (!hasPhysicalAttacker && cand.baseStats && cand.baseStats.atk >= 115) {
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
  } else {
    // 单打核心职能：出钉撒钉 + 游击折返 (VoltTurn) + 强化推队 (Setup Sweeper) + 盾牌联防 + 物特平衡
    const hasHazard = currentMembers.some(m => m.moves.some(mv => ['隐形岩', '撒菱', '毒菱', '黏黏网'].includes(mv)));
    const hasPivot = currentMembers.some(m => m.moves.some(mv => ['急速折返', '伏特替换', '快速折返', '抛下狠话'].includes(mv)));
    const hasSetupSweeper = currentMembers.some(m => m.moves.some(mv => ['剑舞', '龙之舞', '诡计', '冥想', '破壳', '蝶舞'].includes(mv)));
    const hasWall = currentMembers.some(m => {
      const bs = m.pokemon.baseStats || {};
      return ((bs.hp || 0) + (bs.def || 0) >= 210) || ((bs.hp || 0) + (bs.spd || 0) >= 210);
    });

    allPokemonList.forEach(cand => {
      if (existingIds.has(cand.id)) return;
      let roleBonus = 0;
      const rReasons = [];

      if (!hasHazard && cand.learnset && cand.learnset.some(l => ['隐形岩', '撒菱', '毒菱', '黏黏网'].includes(l.name))) {
        roleBonus += 25;
        rReasons.push('提供撒钉破气披/工兵');
      }
      if (!hasPivot && cand.learnset && cand.learnset.some(l => ['急速折返', '伏特替换', '快速折返', '抛下狠话'].includes(l.name))) {
        roleBonus += 20;
        rReasons.push('提供游击折返中转');
      }
      if (!hasSetupSweeper && cand.learnset && cand.learnset.some(l => ['剑舞', '龙之舞', '诡计', '冥想', '破壳', '蝶舞'].includes(l.name))) {
        roleBonus += 20;
        rReasons.push('提供强化终结手段');
      }
      if (!hasWall && cand.baseStats) {
        const bs = cand.baseStats;
        if (((bs.hp || 0) + (bs.def || 0) >= 210) || ((bs.hp || 0) + (bs.spd || 0) >= 210)) {
          roleBonus += 15;
          rReasons.push('提供高耐久盾牌联防');
        }
      }
      if (!hasSpecialAttacker && cand.baseStats && cand.baseStats.spa >= 115) {
        roleBonus += 15;
        rReasons.push('补足特攻输出端');
      }
      if (!hasPhysicalAttacker && cand.baseStats && cand.baseStats.atk >= 115) {
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
  }

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
    .filter(p => getPokemonMetaRank(p, fmt) < 999)
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

  if (megaCount === 2) {
    legalityIssues.push({
      level: 'info',
      msg: `【双 Mega 选出轴提示】队伍登记了 2 只超级进化宝可梦。在 6选3/6选4 实战选出阶段请根据对手阵容二选一出战，切忌单场同时选出导致道具栏浪费。`
    });
  } else if (megaCount >= 3) {
    legalityIssues.push({
      level: 'warning',
      msg: `【超级进化数量过多】队伍中有 ${megaCount} 只宝可梦携带了超级进化石。过多进化石会严重压缩生命宝珠、气势披带等通用道具空间，建议调整为至多 2 个 Mega 备选。`
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
  checkBuilderBackendHealth();
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
  checkBuilderBackendHealth();
}

// ==========================================================================
// 6. 前端 UI 渲染与交互控制器 (UI View Controller)
// ==========================================================================

const wizardState = {
  anchor: '',
  posture: 'balance', // 'offense' | 'balance' | 'defense'
  megaPreference: 'auto', // 'auto' | 'multi' | 'single' | 'none'
  tactics: [], // ['tailwind', 'trick_room', 'sun', 'rain', 'snow', 'setup', 'volturn']
  avoid: [],
  apiUrl: 'http://127.0.0.1:8000/api/builder',
  backendOnline: null, // null | true | false
  isRunning: false,
  elapsedSeconds: 0,
  lastBuildDuration: null,
  lastRationale: '',
  lastSlateResult: null,
};

function updateWizardAvoid(avoidStr) {
  wizardState.avoid = avoidStr.split(/[,，\s]+/).filter(Boolean);
}

function setWizardMegaPreference(pref) {
  wizardState.megaPreference = pref;
  renderBuilderWizard();
}

// 异步探测本地 FastAPI 服务健康状态
async function checkBuilderBackendHealth() {
  try {
    const res = await fetch('http://127.0.0.1:8000/api/health', { method: 'GET', cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      wizardState.backendOnline = (data.status === 'ok');
    } else {
      wizardState.backendOnline = false;
    }
  } catch (e) {
    wizardState.backendOnline = false;
  }
  const badge = document.getElementById('wizardBackendStatusPill');
  if (badge) {
    if (wizardState.backendOnline === true) {
      badge.className = 'backend-status-pill online';
      badge.innerHTML = '<span class="status-dot"></span> 🟢 AI 引擎在线 (:8000)';
      badge.title = '本地 UEP 9 门禁 FastAPI 建队引擎运行正常';
    } else {
      badge.className = 'backend-status-pill offline';
      badge.innerHTML = '<span class="status-dot"></span> 🔴 引擎未连接 (点击重试)';
      badge.title = '请确认已在 pokemon_champion_builder 目录下双击运行 start_api.bat！';
    }
  }
}

function selectWizardAnchor(name) {
  wizardState.anchor = name;
  renderBuilderWizard();
}

function updateWizardAnchor(name) {
  wizardState.anchor = name.trim();
}

function setWizardPosture(posture) {
  wizardState.posture = posture;
  renderBuilderWizard();
}

function toggleWizardTactic(tacticId) {
  const idx = wizardState.tactics.indexOf(tacticId);
  if (idx > -1) {
    wizardState.tactics.splice(idx, 1);
  } else {
    wizardState.tactics.push(tacticId);
  }
  renderBuilderWizard();
}

function renderBuilderView() {
  if (typeof document === 'undefined') return;
  renderBuilderWizard();
  renderBuilderSlots();
  renderAuditDashboard();
}

// 渲染 AI 智能组队向导 (Builder Wizard)
function renderBuilderWizard() {
  const container = document.getElementById('builderWizardSection');
  if (!container) return;

  const allMons = (window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon) || (typeof allPokemonList !== 'undefined' ? allPokemonList : []);

  // 1. 获取当前队伍卡位中已有宝可梦物种 (按顺序排重)
  const currentSlotMons = [];
  const seenSlotMons = new Set();
  builderState.slots.forEach(s => {
    if (s && s.pokemon && s.pokemon.name && !seenSlotMons.has(s.pokemon.name)) {
      seenSlotMons.add(s.pokemon.name);
      currentSlotMons.push(s.pokemon.name);
    }
  });

  let teamPillsHtml = '';
  if (currentSlotMons.length > 0) {
    const pills = currentSlotMons.map(p => `
      <span class="quick-pill team-source ${wizardState.anchor === p ? 'active' : ''}" onclick="selectWizardAnchor('${p}')" title="从当前卡位物种选为核心">
        👥 ${p}
      </span>
    `).join('');
    teamPillsHtml = `
      <div style="margin-top:0.35rem; display:flex; flex-wrap:wrap; gap:0.35rem; align-items:center;">
        <span style="font-size:0.72rem; color:#ffd54f; font-weight:600;">已填卡位:</span>
        ${pills}
      </div>
    `;
  }

  // 2. 全量 235 宝可梦本地数据自动匹配 datalist
  const datalistOptionsHtml = allMons.map(p => {
    const types = (p.types || ['Normal']).map(t => TYPE_TRANSLATION[t] || t).join('/');
    return `<option value="${p.name}">${p.name} · ${types} (${p.nameEn || ''})</option>`;
  }).join('');

  // 3. 战术机制标签 (使用 button type=button 杜绝双击取消)
  const tacticOptions = [
    { id: 'tailwind', label: '🌪️ 顺风提速' },
    { id: 'trick_room', label: '⏳ 戏法空间' },
    { id: 'sun', label: '☀️ 晴天控场' },
    { id: 'rain', label: '🌧️ 雨天强攻' },
    { id: 'snow', label: '❄️ 雪天防御' },
    { id: 'setup', label: '⚔️ 强化推队' },
    { id: 'volturn', label: '🔄 游击轮转' }
  ];

  const tacticChipsHtml = tacticOptions.map(t => {
    const active = wizardState.tactics.includes(t.id);
    return `
      <button type="button" class="tactic-chip ${active ? 'active' : ''}" onclick="toggleWizardTactic('${t.id}')">
        <span>${active ? '✓ ' : ''}${t.label}</span>
      </button>
    `;
  }).join('');

  // 4. 后端在线状态徽标
  let statusBadgeHtml = `
    <span class="backend-status-pill ${wizardState.backendOnline === true ? 'online' : wizardState.backendOnline === false ? 'offline' : ''}" id="wizardBackendStatusPill" onclick="checkBuilderBackendHealth()" style="cursor:pointer;" title="点击刷新连接状态">
      <span class="status-dot"></span> ${wizardState.backendOnline === true ? '🟢 AI 引擎在线 (:8000)' : wizardState.backendOnline === false ? '🔴 引擎未连接 (点击重测)' : '🟡 检测引擎中...'}
    </span>
  `;

  // 5. 组队任务执行状态与计时展示 (去除伪造门禁列表，展示真实计时)
  let statusBannerHtml = '';
  if (wizardState.isRunning) {
    statusBannerHtml = `
      <div class="wizard-running-banner" id="wizardRunningBanner">
        <div class="running-banner-top">
          <div class="running-pulse-indicator">
            <span class="running-spinner-circle"></span>
          </div>
          <div class="running-banner-content">
            <div class="running-banner-title">
              <span>⚡ AI 智能建队流水线推理中...</span>
              <span class="running-timer-pill">已耗时: <strong id="wizardElapsedSec">${wizardState.elapsedSeconds || 0}</strong> 秒</span>
            </div>
            <div class="running-banner-desc">
              正在执行：官方排位骨架检索 ➔ 大模型战术组装 ➔ Top-30 热门伤害对抗压测 ➔ 合规性终审。大模型推理与伤害对抗通常需 30~60 秒，请稍候...
            </div>
          </div>
        </div>
        <div class="running-progress-track">
          <div class="running-progress-indeterminate"></div>
        </div>
      </div>
    `;
  } else if (wizardState.lastBuildDuration !== null) {
    statusBannerHtml = `
      <div class="wizard-complete-banner">
        <span class="complete-icon">✅</span>
        <span>AI 智能组队已完成并自动上阵 (本次耗时: <strong>${wizardState.lastBuildDuration}</strong> 秒)。下方已同步更新【6 卡位详细配置】与【实战对战思路 (Battle Playbook)】。</span>
      </div>
    `;
  }

  container.innerHTML = `
    <div class="wizard-form-card">
      <div class="wizard-header-row">
        <div class="wizard-header-title">
          <span>🧙‍♂️ AI 智能从零组队向导 (Builder Wizard)</span>
          <span class="wizard-header-badge">大模型战术组装 & 对抗压测</span>
        </div>
        <div class="wizard-header-actions" style="display:flex; align-items:center; gap:0.75rem;">
          ${statusBadgeHtml}
        </div>
      </div>

      <div class="wizard-form-grid">
        <!-- 核心宝可梦 Anchor (支持输入自动匹配本地 235 数据 + 已填卡位直选) -->
        <div class="wizard-field">
          <label class="wizard-label">🎯 战术核心物种 (Anchor · 选填)</label>
          <input type="text" id="wizardAnchorInput" class="wizard-input" list="wizardAnchorDatalist" value="${wizardState.anchor}" placeholder="可选：留空则由 AI 自动从当前环境优选核心，或输入指定宝可梦..." oninput="updateWizardAnchor(this.value)" autocomplete="off">
          <datalist id="wizardAnchorDatalist">
            ${datalistOptionsHtml}
          </datalist>
          
          ${teamPillsHtml}
        </div>

        <!-- 战术风格 Posture -->
        <div class="wizard-field">
          <label class="wizard-label">🛡️ 队伍构筑风格 (Posture)</label>
          <div class="posture-buttons">
            <button type="button" class="posture-btn ${wizardState.posture === 'offense' ? 'active' : ''}" onclick="setWizardPosture('offense')">⚔️ 强攻队 (Offense)</button>
            <button type="button" class="posture-btn ${wizardState.posture === 'balance' ? 'active' : ''}" onclick="setWizardPosture('balance')">⚖️ 平衡队 (Balance)</button>
            <button type="button" class="posture-btn ${wizardState.posture === 'defense' ? 'active' : ''}" onclick="setWizardPosture('defense')">🛡️ 受控队 (Bulky/Stall)</button>
          </div>
        </div>

        <!-- Mega 偏好 Mega Preference -->
        <div class="wizard-field" style="grid-column: 1 / -1;">
          <label class="wizard-label">🌟 Mega 进化位配置偏好 (Mega Preference)</label>
          <div class="mega-pref-buttons">
            <button type="button" class="mega-pref-btn ${wizardState.megaPreference === 'auto' ? 'active' : ''}" onclick="setWizardMegaPreference('auto')">
              🌟 自动推荐 (双Mega主流预览轴)
            </button>
            <button type="button" class="mega-pref-btn ${wizardState.megaPreference === 'multi' ? 'active' : ''}" onclick="setWizardMegaPreference('multi')">
              ⚔️ 允许双Mega (二选一预览分支)
            </button>
            <button type="button" class="mega-pref-btn ${wizardState.megaPreference === 'single' ? 'active' : ''}" onclick="setWizardMegaPreference('single')">
              🛡️ 仅单Mega (传统单核路线)
            </button>
            <button type="button" class="mega-pref-btn ${wizardState.megaPreference === 'none' ? 'active' : ''}" onclick="setWizardMegaPreference('none')">
              🚫 不使用Mega (纯常规阵容)
            </button>
          </div>
        </div>

        <!-- 战术标签 Tactics (点击即切换) -->
        <div class="wizard-field" style="grid-column: 1 / -1;">
          <label class="wizard-label">🏷️ 战术机制与控场标签 (Tactical Mechanisms · 可选)</label>
          <div class="tactics-chips-grid">
            ${tacticChipsHtml}
          </div>
        </div>
      </div>

      <div class="wizard-footer-actions">
        <span style="font-size:0.78rem; color:#78909c; margin-right:auto;">
          💡 提示：点击生成后，系统将自动经由全套流水线输出完整 6 只宝可梦并自动上阵。
        </span>
        <button type="button" class="btn-wizard-run" id="btnRunWizard" onclick="startBuilderWizardJob()" ${wizardState.isRunning ? 'disabled' : ''}>
          ${wizardState.isRunning ? '<span class="spinner-inline">⏳</span> 正在组装与压测中...' : '🚀 启动 AI 一键智能组队'}
        </button>
      </div>

      ${statusBannerHtml}
    </div>
  `;
}


// 映射后端返回的英文宝可梦对象至前端中文卡位模型
function mapEngineMemberToSlot(member, allMons) {
  let spName = member.species || '';
  let isMega = spName.startsWith('Mega ') || (member.item && (member.item.includes('ite') || member.item.includes('进化石')));
  let baseName = spName.replace(/^Mega\s+/, '').replace(/\s+[XYZ]$/, '');
  let branch = 'X';
  if (spName.endsWith(' Y') || (member.item && member.item.includes('Y'))) branch = 'Y';
  if (spName.endsWith(' Z') || (member.item && member.item.includes('Z'))) branch = 'Z';

  // 在全量宝可梦中查找匹配
  let matchedMon = allMons.find(p => 
    (p.nameEn && p.nameEn.toLowerCase() === baseName.toLowerCase()) ||
    (p.name && p.name === baseName) ||
    (p.slug && p.slug.toLowerCase() === baseName.toLowerCase())
  );

  if (!matchedMon) {
    matchedMon = {
      id: 999,
      name: baseName,
      nameEn: baseName,
      types: ['Normal'],
      baseStats: { hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 },
      abilities: [{ name: member.ability }],
      learnset: (member.moves || []).map(m => ({ name: m }))
    };
  }

  // 特性名称汉化匹配 (优先调用全量翻译函数 translateAbilityToZh)
  let abilityName = typeof translateAbilityToZh === 'function' ? translateAbilityToZh(member.ability) : (member.ability || '通常特性');
  if (matchedMon.abilities) {
    const abMatch = matchedMon.abilities.find(a => 
      (a.enName && a.enName.toLowerCase() === (member.ability || '').toLowerCase()) || 
      (typeof a === 'string' && a === member.ability) ||
      (a.name && a.name === member.ability) ||
      (a.name && a.name === abilityName)
    );
    if (abMatch) abilityName = typeof abMatch === 'string' ? abMatch : (abMatch.name || abilityName);
  }

  // 道具名称汉化对照 (调用全量翻译函数 translateItemToZh)
  let itemName = typeof translateItemToZh === 'function' ? translateItemToZh(member.item) : (member.item || '');

  // 招式名称汉化匹配 (调用全量翻译函数 translateMoveToZh)
  let moves = (member.moves || []).map(m => {
    let zhMove = typeof translateMoveToZh === 'function' ? translateMoveToZh(m) : m;
    if (matchedMon.learnset) {
      const lmMatch = matchedMon.learnset.find(l => 
        (l.enName && l.enName.toLowerCase() === (m || '').toLowerCase()) || 
        l.name === m || 
        l.name === zhMove
      );
      if (lmMatch && lmMatch.name) return lmMatch.name;
    }
    return zhMove;
  });

  // 性格名称汉化匹配
  const NATURE_MAP = {
    'Jolly': '爽朗', 'Adamant': '固执', 'Modest': '内敛', 'Timid': '胆小',
    'Bold': '大胆', 'Calm': '温和', 'Impish': '淘气', 'Careful': '慎重',
    'Brave': '勇敢', 'Quiet': '冷静', 'Relaxed': '悠闲', 'Sassy': '自大'
  };
  let natureName = NATURE_MAP[member.nature] || member.nature || '固执';

  // 将 SP 努力值转换为 EV (SP * 8, 最大 252)
  let sp = member.spread || {};
  let evs = {
    hp: Math.min(252, (sp.hp || 0) * 8),
    atk: Math.min(252, (sp.atk || 0) * 8),
    def: Math.min(252, (sp.def || 0) * 8),
    spa: Math.min(252, (sp.spa || 0) * 8),
    spd: Math.min(252, (sp.spd || 0) * 8),
    spe: Math.min(252, (sp.spe || 0) * 8),
  };

  return {
    pokemon: matchedMon,
    isMega: isMega,
    megaBranch: branch,
    item: itemName,
    ability: abilityName,
    nature: natureName,
    moves: moves,
    evs: evs,
    sp: sp
  };
}

// 异步运行 AI 智能组队流水线 (FastAPI Runner with Live Elapsed Timer)
async function startBuilderWizardJob() {
  if (wizardState.isRunning) return;

  const anchorName = wizardState.anchor ? wizardState.anchor.trim() : '';
  wizardState.isRunning = true;
  wizardState.elapsedSeconds = 0;
  renderBuilderWizard();

  // 启动真实秒表计时器 (非伪造进度，每秒如实递增)
  const timerId = setInterval(() => {
    wizardState.elapsedSeconds++;
    const secEl = document.getElementById('wizardElapsedSec');
    if (secEl) {
      secEl.textContent = wizardState.elapsedSeconds;
    }
  }, 1000);

  const payload = {
    format: builderState.format,
    anchor: anchorName || undefined,
    posture: wizardState.posture || 'balance',
    mega_preference: wizardState.megaPreference || 'auto',
    wants: wizardState.tactics && wizardState.tactics.length > 0 ? wizardState.tactics : [],
    avoid: wizardState.avoid && wizardState.avoid.length > 0 ? wizardState.avoid : [],
    lang: 'zh',
  };

  const endpoint = wizardState.apiUrl || 'http://127.0.0.1:8000/api/builder';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({ detail: '无法连接到本地 AI 建队服务，请确认 start_api.bat 是否已启动。' }));
      const detailMsg = typeof errData.detail === 'object' ? JSON.stringify(errData.detail) : (errData.detail || errData.error || `HTTP ${response.status} 接口异常`);
      throw new Error(detailMsg);
    }

    const data = await response.json();
    if (!data.ok || !data.result) {
      throw new Error(data.error || 'AI 建队流水线未返回有效阵容');
    }

    const result = data.result;
    const teamMembers = (result.team && result.team.pokemon) || [];
    const allMons = (window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon) || (typeof allPokemonList !== 'undefined' ? allPokemonList : []);

    // 填充 6 个卡位
    for (let i = 0; i < 6; i++) {
      if (i < teamMembers.length) {
        builderState.slots[i] = mapEngineMemberToSlot(teamMembers[i], allMons);
      } else {
        builderState.slots[i] = null;
      }
    }

    // 战术分析与确定性伤害对抗压力测试数据沉淀 (Slate Top-30 Matchup Threats)
    wizardState.lastRationale = result.rationale || '';

    if (result.matchupThreats && result.matchupThreats.opponents && result.matchupThreats.opponents.length > 0) {
      const opps = result.matchupThreats.opponents;
      const first = opps[0];
      const worstOpp = first.opponent;
      const firstMon = findPokemonByName(worstOpp);
      const worstRank = first.usageRank || (first.routes && first.routes[0] && first.routes[0].usageRank) || (firstMon ? getPokemonMetaRank(firstMon, builderState.format) : null);
      const worstGrade = first.grade || (first.affectedMemberCount >= 3 ? 'G3' : first.affectedMemberCount === 2 ? 'G2' : 'G1');
      const worstAffMembers = first.affectedMembers || (first.routes ? [...new Set(first.routes.map(r => r.member))] : []);
      
      const worstRouteMap = new Map();
      (first.routes || []).forEach(r => {
        const mvInfo = getMoveInfo(r.move);
        const moveType = (mvInfo && mvInfo.type) || 'Normal';
        const key = `${r.member}__${r.move}`;
        const itemZh = formatVariantZh(r.opponentVariant);
        if (!worstRouteMap.has(key)) {
          worstRouteMap.set(key, {
            target_member: r.member,
            move: r.move,
            move_type: moveType,
            variants: new Set(),
            damage_pct: '100% 确定性极值斩杀',
            verdict: '极高猝死风险'
          });
        }
        if (itemZh) worstRouteMap.get(key).variants.add(itemZh);
      });

      const worstRoutes = Array.from(worstRouteMap.values()).map(r => {
        const varList = Array.from(r.variants);
        const itemNote = varList.length > 0 ? `常用携带: ${varList.slice(0, 3).join(' / ')}` : '极高猝死风险';
        return {
          target_member: r.target_member,
          move: r.move,
          move_type: r.move_type,
          variant: '',
          damage_pct: r.damage_pct,
          verdict: itemNote
        };
      });

      const highThreats = opps.slice(1).map(opp => {
        const oppMon = findPokemonByName(opp.opponent);
        const oppRank = opp.usageRank || (opp.routes && opp.routes[0] && opp.routes[0].usageRank) || (oppMon ? getPokemonMetaRank(oppMon, builderState.format) : null);
        const oppAffMembers = opp.affectedMembers || (opp.routes ? [...new Set(opp.routes.map(r => r.member))] : []);
        const routes = (opp.routes || []).map(r => {
          const mvInfo = getMoveInfo(r.move);
          return {
            target_member: r.member,
            move: r.move,
            move_type: (mvInfo && mvInfo.type) || 'Normal',
            variant: r.opponentVariant || ''
          };
        });
        return {
          opponent: opp.opponent,
          rank: (oppRank && oppRank < 999) ? oppRank : '-',
          grade: opp.grade || (opp.affectedMemberCount >= 3 ? 'G3' : opp.affectedMemberCount === 2 ? 'G2' : 'G1'),
          affected_count: opp.affectedMemberCount || oppAffMembers.length,
          affected_members: oppAffMembers,
          routes: routes
        };
      });

      wizardState.lastSlateResult = {
        scope: result.matchupThreats.scope || { topK: 30, teamSize: 6 },
        worst_threat: {
          opponent: worstOpp,
          rank: (worstRank && worstRank < 999) ? worstRank : '-',
          grade: worstGrade,
          affected_count: first.affectedMemberCount || worstAffMembers.length,
          affected_members: worstAffMembers,
          threat_routes: worstRoutes
        },
        high_threats: highThreats
      };
    } else if (result.worstMatchup || (result.threats && result.threats.length > 0)) {
      const threatsList = result.threats || (result.worstMatchup ? [result.worstMatchup] : []);
      const threatsByOpp = new Map();
      threatsList.forEach(t => {
        if (!threatsByOpp.has(t.opponent)) threatsByOpp.set(t.opponent, []);
        threatsByOpp.get(t.opponent).push(t);
      });

      const allOppRows = Array.from(threatsByOpp.entries()).map(([opp, thrList]) => {
        const aff = [...new Set(thrList.map(t => t.member))];
        const oMon = findPokemonByName(opp);
        const r = oMon ? getPokemonMetaRank(oMon, builderState.format) : null;
        return {
          opponent: opp,
          rank: (r && r < 999) ? r : '-',
          grade: aff.length >= 3 ? 'G3' : aff.length === 2 ? 'G2' : 'G1',
          affected_count: aff.length,
          affected_members: aff,
          routes: thrList.map(t => {
            const minfo = getMoveInfo(t.move);
            return {
              target_member: t.member,
              move: t.move,
              move_type: (minfo && minfo.type) || 'Normal'
            };
          })
        };
      });

      const firstRow = allOppRows[0];
      if (firstRow) {
        wizardState.lastSlateResult = {
          scope: { topK: 30, teamSize: 6 },
          worst_threat: {
            opponent: firstRow.opponent,
            rank: firstRow.rank,
            grade: firstRow.grade,
            affected_count: firstRow.affected_count,
            affected_members: firstRow.affected_members,
            threat_routes: firstRow.routes.map(r => ({
              target_member: r.target_member,
              move: r.move,
              move_type: r.move_type,
              damage_pct: '100% 确定性极值斩杀',
              verdict: '极高猝死风险'
            }))
          },
          high_threats: allOppRows.slice(1)
        };
      } else {
        wizardState.lastSlateResult = null;
      }
    } else {
      wizardState.lastSlateResult = null;
    }

    renderBuilderView();
  } catch (err) {
    alert(`【AI 智能建队执行提示】\n${err.message || '未知错误'}\n\n请确保已在 pokemon_champion_builder 目录下运行 start_api.bat 启动本地后端！`);
  } finally {
    if (timerId) clearInterval(timerId);
    wizardState.lastBuildDuration = wizardState.elapsedSeconds;
    wizardState.isRunning = false;
    renderBuilderWizard();
  }
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

      // 生成特性下拉选项 (兼容对象与字符串，优先载入 Mega 专属特性)
      let rawAbilities = (p.abilities && p.abilities.length > 0) ? [...p.abilities] : [];
      if (slot.isMega && activeMon.abilities) {
        activeMon.abilities.forEach(mab => {
          const mabName = typeof mab === 'string' ? mab : mab.name;
          if (!rawAbilities.some(a => (typeof a === 'string' ? a : a.name) === mabName)) {
            rawAbilities.unshift({ name: mabName, usageText: 'Mega专属' });
          }
        });
      }
      if (rawAbilities.length === 0) rawAbilities = [slot.ability];

      const megaAbilityName = slot.isMega && activeMon.abilities && activeMon.abilities[0] ? (typeof activeMon.abilities[0] === 'string' ? activeMon.abilities[0] : activeMon.abilities[0].name) : null;
      const currentAbility = megaAbilityName || slot.ability || (typeof rawAbilities[0] === 'string' ? rawAbilities[0] : rawAbilities[0].name);
      if (slot.isMega && megaAbilityName && slot.ability !== megaAbilityName) {
        slot.ability = megaAbilityName;
      }

      const abilityOptions = rawAbilities.map(ab => {
        const abName = typeof ab === 'string' ? ab : (ab.name || '通常特性');
        const abUsage = (typeof ab === 'object' && (ab.usage || ab.usageText)) ? ` (${ab.usage ? ab.usage + '%' : ab.usageText})` : '';
        return `<option value="${abName}" ${abName === currentAbility ? 'selected' : ''}>${abName}${abUsage}</option>`;
      }).join('');

      // 生成性格下拉选项
      const natureOptions = NATURES.map(n => {
        const nName = n.name.split(' ')[0];
        return `<option value="${nName}" ${nName === slot.nature ? 'selected' : ''}>${n.name}</option>`;
      }).join('');

      // 生成 4 个招式下拉/选项 (保证全量汉化)
      const allLearnable = p.learnset ? p.learnset.map(l => (typeof translateMoveToZh === 'function' ? translateMoveToZh(l.name) : l.name)) : [];
      slot.moves.forEach(m => {
        let zhM = typeof translateMoveToZh === 'function' ? translateMoveToZh(m) : m;
        if (zhM && !allLearnable.includes(zhM)) allLearnable.unshift(zhM);
      });

      const moveInputsHtml = slot.moves.map((mv, mIdx) => {
        let currentZhMove = typeof translateMoveToZh === 'function' ? translateMoveToZh(mv) : mv;
        const optionsHtml = allLearnable.map(lm => 
          `<option value="${lm}" ${lm === currentZhMove ? 'selected' : ''}>${lm}</option>`
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

      // 计算 SP 和 EV 分配值
      const sp = slot.sp || {};
      const evs = slot.evs || {
        hp: Math.min(252, (sp.hp || 0) * 8),
        atk: Math.min(252, (sp.atk || 0) * 8),
        def: Math.min(252, (sp.def || 0) * 8),
        spa: Math.min(252, (sp.spa || 0) * 8),
        spd: Math.min(252, (sp.spd || 0) * 8),
        spe: Math.min(252, (sp.spe || 0) * 8),
      };
      const totalSp = (sp.hp || 0) + (sp.atk || 0) + (sp.def || 0) + (sp.spa || 0) + (sp.spd || 0) + (sp.spe || 0);

      const evDistributionHtml = `
        <div class="slot-evs-group full-width">
          <div class="slot-evs-header">
            <label>⚡ 努力值 (EV / SP 分配)</label>
            <span class="evs-total-tag">已分配: ${totalSp}/66 SP</span>
          </div>
          <div class="slot-evs-bars">
            <div class="ev-bar-item ${(evs.hp || sp.hp) ? 'active' : ''}">
              <span class="ev-label">HP</span>
              <span class="ev-val">${evs.hp || 0}</span>
              <span class="sp-sub">${sp.hp || 0}sp</span>
            </div>
            <div class="ev-bar-item ${(evs.atk || sp.atk) ? 'active' : ''}">
              <span class="ev-label">物攻</span>
              <span class="ev-val">${evs.atk || 0}</span>
              <span class="sp-sub">${sp.atk || 0}sp</span>
            </div>
            <div class="ev-bar-item ${(evs.def || sp.def) ? 'active' : ''}">
              <span class="ev-label">物防</span>
              <span class="ev-val">${evs.def || 0}</span>
              <span class="sp-sub">${sp.def || 0}sp</span>
            </div>
            <div class="ev-bar-item ${(evs.spa || sp.spa) ? 'active' : ''}">
              <span class="ev-label">特攻</span>
              <span class="ev-val">${evs.spa || 0}</span>
              <span class="sp-sub">${sp.spa || 0}sp</span>
            </div>
            <div class="ev-bar-item ${(evs.spd || sp.spd) ? 'active' : ''}">
              <span class="ev-label">特防</span>
              <span class="ev-val">${evs.spd || 0}</span>
              <span class="sp-sub">${sp.spd || 0}sp</span>
            </div>
            <div class="ev-bar-item ${(evs.spe || sp.spe) ? 'active' : ''}">
              <span class="ev-label">速度</span>
              <span class="ev-val">${evs.spe || 0}</span>
              <span class="sp-sub">${sp.spe || 0}sp</span>
            </div>
          </div>
        </div>
      `;

      // Mega 切换按钮 (若该宝可梦支持 Mega)
      let megaToggleHtml = '';
      if ((p.mega && p.mega.supported) || p.megaForms || p.megaBranches) {
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
          <img class="slot-avatar" src="${spriteUrl}" alt="${activeMon.name}" onerror="this.onerror=null; this.src='https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id || 1}.png';" onclick="openPokemonPicker(${idx})">
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

          <!-- EV / SP 努力值分配 -->
          ${evDistributionHtml}
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
        <p>请在上方卡位添加至少 1 只宝可梦，或使用「AI 智能组队向导」一键生成，系统将自动展开【战术机制说明】、【Top-30 伤害压力测试】与【18 属性防御热力图】。</p>
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

  // 2. 战术机制与核心战术思路 (AI Tactical Rationale & Battle Playbook)
  let rationaleHtml = '';
  const currentMembers = builderState.slots.filter(s => s && s.pokemon);
  const fmtText = builderState.format === 'double' ? '双打 (VGC Doubles)' : '单打 (Singles)';

  // 提取队伍中的实际战术角色与核心轴 (100% 真实动态提取，拒绝虚假死板模板)
  const speedControlMons = currentMembers.filter(m => (m.moves || []).some(mv => ['顺风', '戏法空间', '电网', '冰冻之风', '极光幕', 'Tailwind', 'Trick Room', 'Electroweb', 'Icy Wind', 'Aurora Veil'].includes(mv))).map(m => m.pokemon.name);
  const fakeOutMons = currentMembers.filter(m => (m.moves || []).some(mv => ['击掌奇袭', 'Fake Out'].includes(mv))).map(m => m.pokemon.name);
  const intimidateMons = currentMembers.filter(m => m.ability === '威吓' || m.ability === 'Intimidate').map(m => m.pokemon.name);
  const pivotMoveMons = currentMembers.filter(m => (m.moves || []).some(mv => ['急速折返', '伏特替换', '抛下狠话', 'U-turn', 'Volt Switch', 'Parting Shot'].includes(mv))).map(m => m.pokemon.name);
  const megaMons = currentMembers.filter(m => m.isMega || (m.item && (m.item.includes('进化石') || m.item.toLowerCase().includes('ite')))).map(m => m.pokemon.name);
  const priorityFinishers = currentMembers.filter(m => (m.moves || []).some(mv => ['突袭', '神速', '音速拳', '影子偷袭', '水先锋', '电光一闪', 'Sucker Punch', 'Extreme Speed', 'Mach Punch', 'Shadow Sneak', 'Aqua Jet', 'Quick Attack'].includes(mv))).map(m => m.pokemon.name);
  const sweepers = currentMembers.filter(m => (m.moves || []).some(mv => ['剑舞', '龙之舞', '诡计', '冥想', '蝶舞', '破壳', 'Swords Dance', 'Dragon Dance', 'Nasty Plot', 'Calm Mind', 'Quiver Dance', 'Shell Smash'].includes(mv)) || (m.pokemon.baseStats && (m.pokemon.baseStats.atk >= 120 || m.pokemon.baseStats.spa >= 120))).map(m => m.pokemon.name);

  let playbookHtml = '';
  if (currentMembers.length >= 2) {
    let openingItems = [];
    if (speedControlMons.length > 0) {
      openingItems.push(`• <strong>控速核心</strong>: 【${speedControlMons.join(' / ')}】先手开启顺风/空间或范围削速，抢占全场先手权。`);
    }
    if (fakeOutMons.length > 0) {
      openingItems.push(`• <strong>首回合压制</strong>: 【${fakeOutMons.join(' / ')}】利用【击掌奇袭】封锁对手首发关键威胁或破除气势披带。`);
    }
    if (intimidateMons.length > 0) {
      openingItems.push(`• <strong>物攻压制</strong>: 【${intimidateMons.join(' / ')}】登场触发【威吓】降低敌方全体物攻，为全队创造安全输出空间。`);
    }
    if (pivotMoveMons.length > 0) {
      openingItems.push(`• <strong>游击轮转</strong>: 【${pivotMoveMons.join(' / ')}】携带急速折返/伏特替换，对局中灵活下场保留对位主动权。`);
    }
    if (openingItems.length === 0) {
      openingItems.push(`• <strong>选出博弈</strong>: 面对快攻队伍优先选出耐久联防支点，面对受控队伍优先选出主力爆发位突破防线。`);
    }

    let megaAndLateItems = [];
    if (megaMons.length === 1) {
      megaAndLateItems.push(`• <strong>超级进化核心</strong>: 队伍以【${megaMons[0]}】为单一 Mega 爆发位，把握对局关键轮次开启超级进化撕裂对手联防。`);
    } else if (megaMons.length === 2) {
      megaAndLateItems.push(`• <strong>双 Mega 选出决策</strong>: 队伍构筑了【${megaMons.join(' / ')}】双 Mega 备选轴。根据对手属性盲点<strong>二选一选出</strong>，切忌单场同选导致道具栏浪费。`);
    } else if (megaMons.length >= 3) {
      megaAndLateItems.push(`• <strong>超级进化提示</strong>: 队伍中有 ${megaMons.length} 只携带进化石（【${megaMons.join('、')}】），单场仅能激活 1 次，请按对手弱点选出。`);
    } else {
      megaAndLateItems.push(`• <strong>常规道具爆发</strong>: 队伍全员依靠生命宝珠/气势披带/讲究类道具打出即时高额伤害与快速突破。`);
    }

    if (priorityFinishers.length > 0) {
      megaAndLateItems.push(`• <strong>残局先制收割</strong>: 保护主力先制手【${priorityFinishers.slice(0, 2).join(' / ')}】血线，在中局完成对换后利用先制招式收割残局。`);
    } else if (sweepers.length > 0) {
      megaAndLateItems.push(`• <strong>主力强化清场</strong>: 掩护【${sweepers.slice(0, 2).join(' / ')}】完成强化或健康进场，锁定胜局。`);
    }

    playbookHtml = `
      <div class="battle-playbook-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:1rem; margin-top:1.1rem;">
        <div class="playbook-card" style="background:rgba(0, 229, 255, 0.05); border:1px solid rgba(0, 229, 255, 0.2); border-radius:10px; padding:1rem;">
          <h4 style="color:#00e5ff; font-size:0.95rem; margin-bottom:0.5rem; display:flex; align-items:center; gap:0.4rem;">
            <span>🚀</span> 实战首发选出与控场节奏
          </h4>
          <div style="font-size:0.85rem; line-height:1.65; color:#cfd8dc;">
            ${openingItems.join('<br>')}
          </div>
        </div>

        <div class="playbook-card" style="background:rgba(255, 183, 3, 0.05); border:1px solid rgba(255, 183, 3, 0.2); border-radius:10px; padding:1rem;">
          <h4 style="color:#ffb703; font-size:0.95rem; margin-bottom:0.5rem; display:flex; align-items:center; gap:0.4rem;">
            <span>⚡</span> Mega 进化时机与残局终结
          </h4>
          <div style="font-size:0.85rem; line-height:1.65; color:#cfd8dc;">
            ${megaAndLateItems.join('<br>')}
          </div>
        </div>
      </div>
    `;
  }

  let formattedRationale = '';
  if (wizardState.lastRationale) {
    let localizedText = typeof localizeRationaleText === 'function' 
      ? localizeRationaleText(wizardState.lastRationale) 
      : wizardState.lastRationale;

    formattedRationale = localizedText
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>')
      .replace(/【(.*?)】/g, '<strong style="color:#00e5ff; font-weight:700;">【$1】</strong>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color:#ffb703;">$1</strong>');
  } else if (currentMembers.length > 0) {
    formattedRationale = `当前为基于 ${fmtText} 天梯排位环境优选出的实战战术体系，依靠属性联防与攻防轮转建立对局节奏优势。`;
  }

  rationaleHtml = `
    <div class="rationale-panel-box full-width" style="margin-bottom:1.5rem; background:linear-gradient(145deg, rgba(16, 24, 48, 0.85) 0%, rgba(10, 16, 32, 0.95) 100%); border:1px solid rgba(0, 229, 255, 0.25); border-radius:14px; padding:1.25rem; box-shadow:0 6px 20px rgba(0,0,0,0.35);">
      <div class="panel-box-header" style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:0.75rem; margin-bottom:0.85rem;">
        <h3 style="font-size:1.1rem; color:#fff; display:flex; align-items:center; gap:0.5rem;"><span class="icon">📋</span> 战术配队思路 & 实战对战思路 (Tactical Strategy & Battle Playbook)</h3>
        <span class="sub-badge" style="background:rgba(0,229,255,0.15); color:#00e5ff; font-size:0.75rem; padding:0.2rem 0.5rem; border-radius:4px;">9 门禁实战推演</span>
      </div>
      
      <div style="font-size:0.92rem; line-height:1.75; color:#d6e2ec; padding:0.25rem 0;">
        <div style="font-weight:700; color:#00e5ff; margin-bottom:0.3rem;">🎯 配队构筑逻辑与核心协同:</div>
        <div>${formattedRationale}</div>
      </div>

      ${playbookHtml}
    </div>
  `;

  // 3. Slate Top-30 伤害对抗压力测试结果 (Worst Threat Banner & High Threats List)
  let slateHtml = '';
  
  // 判断是否有 AI 智能建队回传的 50 级确定性伤害实测数据，或降级为纯客户端实时联防推演
  let slateData = wizardState.lastSlateResult;
  let isBatteryGrounded = !!(slateData && slateData.worst_threat);

  if (!isBatteryGrounded && currentMembers.length >= 2) {
    // 纯客户端实时 Top-20 联防压力测算兜底
    const threatMons = (audit.threatResults || []).filter(t => t.status === 'threat');
    if (threatMons.length > 0) {
      threatMons.sort((a, b) => b.vulnerableMembers.length - a.vulnerableMembers.length || a.rank - b.rank);
      const topT = threatMons[0];
      const otherT = threatMons.slice(1);

      const topMonObj = topT.threatMon;
      const topTypes = topMonObj.types || ['Normal'];
      const topPrimaryType = topTypes[0];

      const synRoutes = topT.vulnerableMembers.map(mName => {
        return {
          target_member: mName,
          move: (topMonObj.learnset && topMonObj.learnset[0] && topMonObj.learnset[0].name) || `${TYPE_TRANSLATION[topPrimaryType] || topPrimaryType}系主力招式`,
          move_type: topPrimaryType,
          variant: '',
          damage_pct: '200%~400% 属性克制压制',
          verdict: '属性弱点突破'
        };
      });

      slateData = {
        scope: { topK: 20, teamSize: currentMembers.length },
        worst_threat: {
          opponent: topMonObj.name,
          rank: topT.rank,
          grade: topT.vulnerableMembers.length >= 3 ? 'G3' : topT.vulnerableMembers.length === 2 ? 'G2' : 'G1',
          affected_count: topT.vulnerableMembers.length,
          affected_members: topT.vulnerableMembers,
          threat_routes: synRoutes
        },
        high_threats: otherT.map(ot => {
          const otTypes = ot.threatMon.types || ['Normal'];
          return {
            opponent: ot.threatMon.name,
            rank: ot.rank,
            grade: ot.vulnerableMembers.length >= 3 ? 'G3' : ot.vulnerableMembers.length === 2 ? 'G2' : 'G1',
            affected_count: ot.vulnerableMembers.length,
            affected_members: ot.vulnerableMembers,
            routes: ot.vulnerableMembers.map(mName => ({
              target_member: mName,
              move: (ot.threatMon.learnset && ot.threatMon.learnset[0] && ot.threatMon.learnset[0].name) || `${TYPE_TRANSLATION[otTypes[0]] || otTypes[0]}系技能`,
              move_type: otTypes[0],
              variant: ''
            }))
          };
        })
      };
    }
  }

  if (slateData && slateData.worst_threat) {
    const wt = slateData.worst_threat;
    const opponentZh = typeof translatePokemonToZh === 'function' ? translatePokemonToZh(wt.opponent) : wt.opponent;
    const affectedZh = (wt.affected_members || []).map(m => (typeof translatePokemonToZh === 'function' ? translatePokemonToZh(m) : m)).join('、');
    const wtRankDisplay = (wt.rank && wt.rank !== '-') ? `Rank ${wt.rank}` : 'Top 30';

    const routesHtml = (wt.threat_routes || []).map(r => {
      const targetZh = typeof translatePokemonToZh === 'function' ? translatePokemonToZh(r.target_member) : r.target_member;
      const moveZh = typeof translateMoveToZh === 'function' ? translateMoveToZh(r.move) : r.move;
      const typeZh = TYPE_TRANSLATION[r.move_type] || r.move_type;
      return `
        <div class="threat-route-pill">
          💥 <strong>${targetZh}</strong> 遭受对手 <strong>${moveZh}</strong> (<span class="type-badge ${r.move_type ? r.move_type.toLowerCase() : 'normal'} mini">${typeZh}</span>) ➜ <span style="color:#ff0055; font-weight:700;">${r.damage_pct}</span> (${r.verdict})
        </div>
      `;
    }).join('');

    let highThreatsListHtml = '';
    if (slateData.high_threats && slateData.high_threats.length > 0) {
      const cardsHtml = slateData.high_threats.slice(0, 8).map(ht => {
        const htMon = findPokemonByName(ht.opponent);
        const htSprite = getPokemonSpriteUrl(htMon);
        const htOppZh = typeof translatePokemonToZh === 'function' ? translatePokemonToZh(ht.opponent) : ht.opponent;
        const htAffZh = (ht.affected_members || []).map(m => (typeof translatePokemonToZh === 'function' ? translatePokemonToZh(m) : m)).join('、');
        const htRankBadge = (ht.rank && ht.rank !== '-') ? `Rank ${ht.rank}` : 'Top 30';

        const aggregated = aggregateThreatRoutes(ht.routes);
        const routesRowsHtml = aggregated.map(a => {
          const mvZh = typeof translateMoveToZh === 'function' ? translateMoveToZh(a.move) : a.move;
          const typeZh = TYPE_TRANSLATION[a.move_type] || a.move_type;
          const typeLower = (a.move_type ? a.move_type.toLowerCase() : 'normal');
          const targetsZh = a.targets.map(t => (typeof translatePokemonToZh === 'function' ? translatePokemonToZh(t) : t)).join('、');
          const itemsZh = a.variants.length > 0 ? `<span class="route-item-hint">(${a.variants.slice(0, 2).join(' / ')})</span>` : '';
          return `
            <div class="high-threat-route-row">
              <span class="route-move-badge">
                <strong>【${mvZh}】</strong><span class="type-badge ${typeLower} mini">${typeZh}</span>${itemsZh}
              </span>
              <span class="route-target-text">➜ 确一: <strong>${targetsZh}</strong></span>
            </div>
          `;
        }).join('');

        return `
          <div class="high-threat-item-card">
            <div class="high-threat-header">
              <div class="high-threat-identity">
                <img class="high-threat-avatar" src="${htSprite}" alt="${htOppZh}">
                <div>
                  <span class="high-threat-name">${htOppZh}</span>
                  <span class="high-threat-rank">${htRankBadge}</span>
                </div>
              </div>
              <span class="high-threat-grade">${ht.grade} 级威胁</span>
            </div>
            <div class="high-threat-affected">
              ⚠️ 压制全队 (${ht.affected_count}只): <strong>${htAffZh}</strong>
            </div>
            ${routesRowsHtml ? `<div class="high-threat-routes-list">${routesRowsHtml}</div>` : ''}
          </div>
        `;
      }).join('');

      highThreatsListHtml = `
        <div class="high-threats-grid">
          ${cardsHtml}
        </div>
      `;
    } else {
      highThreatsListHtml = `
        <div style="background:rgba(6, 214, 160, 0.08); border:1px solid rgba(6, 214, 160, 0.25); border-radius:8px; padding:0.75rem 1rem; color:#06d6a0; font-size:0.85rem; display:flex; align-items:center; gap:0.5rem; margin-top:0.4rem;">
          <span>🛡️</span> <strong>联防覆盖优秀：</strong>在 Top-30 天梯对抗压力测试中，除上述最大天敌外未检出其他成规模群体确一盲点。
        </div>
      `;
    }

    const badgeText = isBatteryGrounded ? '50 级确定性伤害实测 (Battery Grounded)' : '实时联防推演 (Realtime Dynamic)';
    const badgeBg = isBatteryGrounded ? 'background:rgba(255,0,85,0.15); color:#ff3366;' : 'background:rgba(0,229,255,0.15); color:#00e5ff;';

    slateHtml = `
      <div class="audit-panel-box full-width" style="margin-bottom:1.5rem;">
        <div class="panel-box-header">
          <h3><span class="icon">🔥</span> Slate Top-30 确定性伤害对抗压力测试 (Stress Testing)</h3>
          <span class="sub-badge" style="${badgeBg} font-size:0.75rem; padding:0.2rem 0.5rem; border-radius:4px;">${badgeText}</span>
        </div>
        <div style="font-size:0.82rem; color:#90a4ae; margin-bottom:0.85rem;">
          基于 50 级精确物特伤害计算与官方排位高频配置库，推演全队对抗天梯热门的极端受击与确一灭队路线。
        </div>
        
        <div class="worst-threat-banner">
          <div class="worst-threat-header">
            <div>
              <strong style="font-size:1.05rem; color:#fff;">⚠️ 最大天敌检出: ${opponentZh} (天梯 ${wtRankDisplay})</strong>
              <div style="font-size:0.82rem; color:#ffb4a2; margin-top:0.25rem;">
                受制成员 (${wt.affected_count}只): <strong>${affectedZh}</strong>
              </div>
            </div>
            <span class="threat-grade-badge">${wt.grade} 级威胁</span>
          </div>
          <div class="threat-routes-list">
            ${routesHtml}
          </div>
        </div>

        <div style="margin-top:1.1rem;">
          <div style="font-size:0.88rem; font-weight:700; color:#b0bec5; margin-bottom:0.4rem; display:flex; align-items:center; gap:0.4rem;">
            <span>⚔️</span> 高威胁对手对抗清单 (High Threat Battery List):
          </div>
          ${highThreatsListHtml}
        </div>
      </div>
    `;
  }

  // 4. 18 属性防御盲点热力表格 (Defense Heatmap)
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

  // 5. 天梯 Top 20 威胁度对位卡片 (Threat Audit)
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

  // 6. 队伍速度线阶梯 (Speed Tiers)
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
    ${rationaleHtml}
    ${slateHtml}

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
            <h3><span class="icon">🎯</span> 当前官方${builderState.format === 'double' ? '双打 (VGC)' : '单打 (Singles)'}排位 Top 20 威胁对位审查</h3>
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
  const slot = builderState.slots[slotIndex];
  if (!slot) return;

  slot[field] = value;

  if (field === 'item') {
    const isMega = value.includes('进化石');
    slot.isMega = isMega;
    if (isMega) {
      if (value.includes('Y') || value.includes('Ｙ')) {
        slot.megaBranch = 'Y';
      } else if (value.includes('X') || value.includes('Ｘ')) {
        slot.megaBranch = 'X';
      } else if (value.includes('Z') || value.includes('Ｚ')) {
        slot.megaBranch = 'Z';
      }
      const activeMon = getActiveCombatant(slot.pokemon, slot.isMega, slot.megaBranch);
      if (activeMon && activeMon.abilities && activeMon.abilities[0]) {
        slot.ability = typeof activeMon.abilities[0] === 'string' ? activeMon.abilities[0] : activeMon.abilities[0].name;
      }
    }
    renderBuilderSlots();
  }
  renderAuditDashboard();
}

function updateSlotMove(slotIndex, moveIndex, moveName) {
  if (builderState.slots[slotIndex] && builderState.slots[slotIndex].moves) {
    builderState.slots[slotIndex].moves[moveIndex] = moveName;
    renderAuditDashboard();
  }
}

function toggleSlotMega(slotIndex) {
  const slot = builderState.slots[slotIndex];
  if (!slot || !slot.pokemon) return;

  slot.isMega = !slot.isMega;
  const activeMon = getActiveCombatant(slot.pokemon, slot.isMega, slot.megaBranch);
  
  if (slot.isMega) {
    if (activeMon && activeMon.abilities && activeMon.abilities[0]) {
      slot.ability = typeof activeMon.abilities[0] === 'string' ? activeMon.abilities[0] : activeMon.abilities[0].name;
    }
    const pMega = slot.pokemon.mega;
    if (pMega && pMega.forms) {
      const form = pMega.forms.find(f => f.formKey === slot.megaBranch) || pMega.forms[0];
      if (form && form.megaStone) slot.item = form.megaStone;
    }
  } else {
    if (slot.pokemon.abilities && slot.pokemon.abilities[0]) {
      slot.ability = typeof slot.pokemon.abilities[0] === 'string' ? slot.pokemon.abilities[0] : slot.pokemon.abilities[0].name;
    }
    if (slot.item && slot.item.includes('进化石')) {
      slot.item = '气势披带';
    }
  }

  renderBuilderSlots();
  renderAuditDashboard();
}

function removeSlot(slotIndex) {
  builderState.slots[slotIndex] = null;
  renderBuilderView();
  checkBuilderBackendHealth();
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
    const typeBadgesHtml = types.map(t => `<span class="type-badge ${t.toLowerCase()} mini">${TYPE_TRANSLATION[t] || t}</span>`).join(' ');
    item.innerHTML = `
      <img src="${spriteUrl}" alt="${mon.name}">
      <div class="picker-mon-name">${mon.name}</div>
      <div class="picker-mon-meta">${rankDisplay} · ${typeBadgesHtml}</div>
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
  window.wizardState = wizardState;
  window.fillSlotWithMetaRank1 = fillSlotWithMetaRank1;
  window.calculateSmartSuggestions = calculateSmartSuggestions;
  window.autoCompleteTeam = autoCompleteTeam;
  window.runTeamAudit = runTeamAudit;
  window.exportTeamShowdownText = exportTeamShowdownText;
  window.initTeamBuilder = initTeamBuilder;
  window.renderBuilderView = renderBuilderView;
  window.renderBuilderWizard = renderBuilderWizard;
  window.renderAuditDashboard = renderAuditDashboard;
  window.startBuilderWizardJob = startBuilderWizardJob;
  window.selectWizardAnchor = selectWizardAnchor;
  window.updateWizardAnchor = updateWizardAnchor;
  window.setWizardPosture = setWizardPosture;
  window.toggleWizardTactic = toggleWizardTactic;
  window.updateWizardAvoid = updateWizardAvoid;
  window.checkBuilderBackendHealth = checkBuilderBackendHealth;
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
    wizardState,
    fillSlotWithMetaRank1,
    calculateSmartSuggestions,
    autoCompleteTeam,
    runTeamAudit,
    exportTeamShowdownText,
    getPokemonSpriteUrl,
    renderBuilderWizard,
    startBuilderWizardJob
  };
}

