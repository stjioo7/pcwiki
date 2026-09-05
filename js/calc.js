/**
 * calc.js - 竞技标准 50 级属性实数、属性克制与伤害计算引擎
 */

function calculateStat50(statKey, base, points, nature) {
  const iv = 31;
  const level = 50;
  if (statKey === 'hp') {
    return Math.floor((2 * base + iv) / 2) + points + level + 10;
  } else {
    const raw = Math.floor((2 * base + iv) / 2) + points + 5;
    let natureMult = 1.0;
    if (nature && nature.plus === statKey) natureMult = 1.1;
    if (nature && nature.minus === statKey) natureMult = 0.9;
    return Math.floor(raw * natureMult);
  }
}

function calculateTypeMatchups(pokemonTypes) {
  const chart = (window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.typeChart) || {};
  const matchups = { 4: [], 2: [], 0.5: [], 0.25: [], 0: [] };

  Object.keys(TYPE_TRANSLATION).forEach(atkType => {
    let mult = 1.0;
    pokemonTypes.forEach(defType => {
      const defData = chart[defType];
      if (defData) {
        if (defData.weak && defData.weak.includes(atkType)) mult *= 2.0;
        if (defData.resist && defData.resist.includes(atkType)) mult *= 0.5;
        if (defData.immune && defData.immune.includes(atkType)) mult *= 0.0;
      }
    });

    if (mult === 4.0) matchups[4].push(atkType);
    else if (mult === 2.0) matchups[2].push(atkType);
    else if (mult === 0.5) matchups[0.5].push(atkType);
    else if (mult === 0.25) matchups[0.25].push(atkType);
    else if (mult === 0.0) matchups[0].push(atkType);
  });

  return matchups;
}

function getMoveTypeMultiplier(moveType, defTypes) {
  const chart = (window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.typeChart) || {};
  let mult = 1.0;
  defTypes.forEach(t => {
    const defData = chart[t];
    if (defData) {
      if (defData.weak && defData.weak.includes(moveType)) mult *= 2.0;
      if (defData.resist && defData.resist.includes(moveType)) mult *= 0.5;
      if (defData.immune && defData.immune.includes(moveType)) mult *= 0.0;
    }
  });
  return mult;
}

function calculateDamage(attacker, defender, move, customAtk = null, customDef = null, customHp = null, attackerAbility = null, targetHpVal = null) {
  if (!move || move.category === "变化" || move.category === "Status" || move.power === 0) {
    return {
      isBuff: true,
      minDmg: 0,
      maxDmg: 0,
      minPct: "0.0",
      maxPct: "0.0",
      effectivePower: 0,
      stabMult: 1.0,
      typeEff: 1.0,
      breakdownBadges: ['<span class="multiplier-pill non-stab">变化招式</span>'],
      verdict: "变化招式 (无伤害)",
      verdictClass: "tag-chip"
    };
  }

  const level = 50;
  const isPhysical = (move.category === "物理" || move.category === "Physical");

  let realAtk = customAtk;
  if (realAtk === null) {
    const atkVP = isPhysical ? currentVpAllocation.atk : currentVpAllocation.spa;
    const baseAtk = isPhysical ? attacker.baseStats.atk : attacker.baseStats.spa;
    realAtk = calculateStat50(isPhysical ? 'atk' : 'spa', baseAtk, atkVP, selectedNature);
  }

  let realDef = customDef;
  if (realDef === null) {
    const defBase = isPhysical ? defender.baseStats.def : defender.baseStats.spd;
    realDef = calculateStat50(isPhysical ? 'def' : 'spd', defBase, 0, NATURES[0]);
  }

  let realHp = customHp;
  if (realHp === null) {
    realHp = calculateStat50('hp', defender.baseStats.hp, 0, NATURES[0]);
  }

  let effectivePower = move.power;
  let moveType = move.type;
  const breakdownBadges = [];
  
  let abilityName = attackerAbility;
  if (!abilityName && attacker.abilities && attacker.abilities.length > 0) {
    abilityName = attacker.abilities[0].name || attacker.abilities[0];
  }
  if (!abilityName && attacker.id === 212) abilityName = "技术高手";

  // 皮肤特性转化与威力增强 (飞行皮肤、妖精皮肤、冰冻皮肤)
  if (abilityName && abilityName.includes("皮肤") && moveType === "Normal") {
    if (abilityName.includes("飞行")) moveType = "Flying";
    else if (abilityName.includes("妖精")) moveType = "Fairy";
    else if (abilityName.includes("冰")) moveType = "Ice";
    effectivePower = Math.floor(effectivePower * 1.2);
    breakdownBadges.push(`<span class="multiplier-pill ability">⚡ ${abilityName} (转为${TYPE_TRANSLATION[moveType] || moveType}系 1.2x)</span>`);
  }

  // 大力士 / 瑜伽之力
  if (abilityName && (abilityName.includes("大力士") || abilityName.includes("瑜伽之力") || abilityName.includes("Huge Power")) && isPhysical) {
    realAtk = realAtk * 2;
    breakdownBadges.push(`<span class="multiplier-pill ability">💪 大力士物攻翻倍 2.0x</span>`);
  }

  // 硬爪 (接触类物理攻击)
  if (abilityName && (abilityName.includes("硬爪") || abilityName.includes("Tough Claws")) && isPhysical) {
    effectivePower = Math.floor(effectivePower * 1.33);
    breakdownBadges.push(`<span class="multiplier-pill ability">⚡ 硬爪接触加成 1.33x</span>`);
  }

  // 亲子爱
  if (abilityName && (abilityName.includes("亲子爱") || abilityName.includes("Parental Bond"))) {
    effectivePower = Math.floor(effectivePower * 1.25);
    breakdownBadges.push(`<span class="multiplier-pill ability">⚡ 亲子爱连续攻击 1.25x</span>`);
  }

  // 技术高手 (威力 <= 60)
  if (abilityName && (abilityName.includes("技术高手") || abilityName.includes("Technician"))) {
    if (move.power <= 60 && move.power > 0) {
      effectivePower = Math.floor(effectivePower * 1.5);
      breakdownBadges.push(`<span class="multiplier-pill ability">⚡ 技术高手 1.5x (威力 ${move.power}→${effectivePower})</span>`);
    }
  }

  const isStab = attacker.types && attacker.types.includes(moveType);
  let stabMult = 1.0;
  if (isStab) {
    if (abilityName && (abilityName.includes("适应力") || abilityName.includes("Adaptability"))) {
      stabMult = 2.0;
      breakdownBadges.push(`<span class="multiplier-pill stab">🎯 适应力本系 2.0x</span>`);
    } else {
      stabMult = 1.5;
      breakdownBadges.push(`<span class="multiplier-pill stab">🎯 本系 STAB 1.5x</span>`);
    }
  } else {
    breakdownBadges.push(`<span class="multiplier-pill non-stab">非本系 1.0x</span>`);
  }

  const typeEff = getMoveTypeMultiplier(moveType, defender.types);
  if (typeEff === 4.0) {
    breakdownBadges.push(`<span class="multiplier-pill eff-4x">💥💥 4.0x 致命克制</span>`);
  } else if (typeEff === 2.0) {
    breakdownBadges.push(`<span class="multiplier-pill eff-2x">💥 2.0x 效果绝佳</span>`);
  } else if (typeEff === 0.5) {
    breakdownBadges.push(`<span class="multiplier-pill resist-half">🛡️ 0.5x 抵抗</span>`);
  } else if (typeEff === 0.25) {
    breakdownBadges.push(`<span class="multiplier-pill resist-quarter">🛡️🛡️ 0.25x 双重抵抗</span>`);
  } else if (typeEff === 0.0) {
    breakdownBadges.push(`<span class="multiplier-pill immune">⛔ 0.0x 免疫无效</span>`);
  } else {
    breakdownBadges.push(`<span class="multiplier-pill non-stab">一倍 1.0x</span>`);
  }

  const baseDmg = Math.floor(Math.floor((2 * level / 5 + 2) * effectivePower * (realAtk / realDef)) / 50) + 2;
  const dmgAfterModifiers = Math.floor(Math.floor(baseDmg * stabMult) * typeEff);

  const minDmg = Math.floor(dmgAfterModifiers * 0.85);
  const maxDmg = Math.floor(dmgAfterModifiers * 1.00);

  const minPct = ((minDmg / realHp) * 100).toFixed(1);
  const maxPct = ((maxDmg / realHp) * 100).toFixed(1);

  const targetHp = targetHpVal !== null ? targetHpVal : realHp;

  let verdict = "普通磨血";
  let verdictClass = "tag-chip";

  if (typeEff === 0) {
    verdict = "无效 (0x 免疫)";
    verdictClass = "tag-chip";
  } else if (minDmg >= targetHp) {
    verdict = "确定击杀 (OHKO 100%+)";
    verdictClass = "tag-kill tag-ohko";
  } else if (maxDmg >= targetHp) {
    verdict = `高乱数击杀 (${maxPct}%)`;
    verdictClass = "tag-high-rng";
  } else if (maxDmg >= targetHp / 2) {
    verdict = "确二击杀 (2HKO)";
    verdictClass = "tag-2hko";
  } else {
    verdict = `🔪 补刀不足 (${minPct}%~${maxPct}%)`;
    verdictClass = "tag-chip";
  }

  return {
    isBuff: false,
    minDmg,
    maxDmg,
    minPct,
    maxPct,
    effectivePower,
    stabMult,
    typeEff,
    breakdownBadges,
    verdict,
    verdictClass
  };
}

function calculateAllMovesMatchup(attacker, defender, nature, vpAlloc) {
  if (!attacker.learnset || attacker.learnset.length === 0) return [];

  const moves = attacker.learnset.filter(m => m.power > 0);
  const isPriorityMap = {};
  HIGH_PRIORITY_MOVES.forEach(n => isPriorityMap[n] = true);

  const results = moves.map(m => {
    const isPhysical = m.category === "物理";
    const atkVP = isPhysical ? vpAlloc.atk : vpAlloc.spa;
    const baseAtk = isPhysical ? attacker.baseStats.atk : attacker.baseStats.spa;
    const realAtk = calculateStat50(isPhysical ? 'atk' : 'spa', baseAtk, atkVP, nature);

    const defBase = isPhysical ? defender.baseStats.def : defender.baseStats.spd;
    const realDef = calculateStat50(isPhysical ? 'def' : 'spd', defBase, 0, NATURES[0]);
    const realHp = calculateStat50('hp', defender.baseStats.hp, 0, NATURES[0]);

    const dmg = calculateDamage(attacker, defender, m, realAtk, realDef, realHp);
    const isHighPriority = !!isPriorityMap[m.name];

    return {
      move: m,
      damage: dmg,
      isHighPriority
    };
  });

  results.sort((a, b) => {
    if (a.isHighPriority && !b.isHighPriority) return -1;
    if (!a.isHighPriority && b.isHighPriority) return 1;
    return b.damage.maxDmg - a.damage.maxDmg;
  });

  return results;
}
