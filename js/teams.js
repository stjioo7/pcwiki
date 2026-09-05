/**
 * teams.js - 热门排位实战队伍浏览、筛选与阵容详情展示
 */

let allTeamsList = [];
let filteredTeamsList = [];
let currentTeamFormat = 'all';
let currentTeamPlacing = 'all';
let currentTeamSearch = '';

function initTeams() {
  if (window.CHAMPIONS_TEAMS && Array.isArray(window.CHAMPIONS_TEAMS)) {
    allTeamsList = window.CHAMPIONS_TEAMS;
  } else {
    allTeamsList = [];
  }

  bindTeamControls();
  applyTeamFilters();
}

function bindTeamControls() {
  const searchInput = document.getElementById('teamSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentTeamSearch = e.target.value.trim().toLowerCase();
      applyTeamFilters();
    });
  }

  // 赛制筛选胶囊 (全部 / 双打 / 单打)
  const formatButtons = document.querySelectorAll('#teamFormatToggleGroup .mode-btn');
  formatButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      formatButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTeamFormat = btn.dataset.teamFormat || 'all';
      applyTeamFilters();
    });
  });

  // 名次筛选
  const placingSelect = document.getElementById('teamPlacingSelect');
  if (placingSelect) {
    placingSelect.addEventListener('change', (e) => {
      currentTeamPlacing = e.target.value;
      applyTeamFilters();
    });
  }
}

function applyTeamFilters() {
  const query = currentTeamSearch;
  const fmt = currentTeamFormat;
  const placing = currentTeamPlacing;

  filteredTeamsList = allTeamsList.filter(team => {
    // 1. 赛制筛选
    if (fmt !== 'all' && team.format !== fmt) {
      return false;
    }

    // 2. 名次筛选
    if (placing !== 'all') {
      const maxPlace = parseInt(placing, 10);
      if (team.placing > maxPlace) {
        return false;
      }
    }

    // 3. 搜索词筛选 (宝可梦名称、选手、赛事、道具、招式)
    if (query) {
      const matchTourn = (team.tournamentName || '').toLowerCase().includes(query);
      const matchPlayer = (team.player || '').toLowerCase().includes(query);
      const matchPokemon = (team.pokemon || []).some(p => {
        const matchName = (p.species || '').toLowerCase().includes(query) || 
                          (p.enSpecies || '').toLowerCase().includes(query) ||
                          (p.slug || '').toLowerCase().includes(query);
        const matchItem = (p.item || '').toLowerCase().includes(query) || 
                          (p.enItem || '').toLowerCase().includes(query);
        const matchAbility = (p.ability || '').toLowerCase().includes(query);
        const matchMoves = (p.moves || []).some(m => 
          (m.name || '').toLowerCase().includes(query) || 
          (m.enName || '').toLowerCase().includes(query)
        );
        return matchName || matchItem || matchAbility || matchMoves;
      });

      if (!matchTourn && !matchPlayer && !matchPokemon) {
        return false;
      }
    }

    return true;
  });

  // 更新计数
  const countEl = document.getElementById('teamMatchCount');
  if (countEl) {
    countEl.innerText = filteredTeamsList.length;
  }

  renderTeamsList(filteredTeamsList);
}

function renderTeamsList(teams) {
  const container = document.getElementById('teamsList');
  if (!container) return;

  if (teams.length === 0) {
    container.innerHTML = `
      <div class="team-empty-state">
        <div style="font-size: 3rem; margin-bottom: 0.5rem;">🔍</div>
        <div style="font-size: 1.1rem; color: #fff; font-weight: 600;">未找到符合条件的排位实战队伍</div>
        <p style="color: var(--text-dim); margin-top: 0.4rem; font-size: 0.85rem;">请尝试调整筛选条件或搜索其他宝可梦名称</p>
      </div>
    `;
    return;
  }

  container.innerHTML = teams.map(team => createTeamCardHtml(team)).join('');
}

function createTeamCardHtml(team) {
  const isChampion = team.placing === 1;
  const isRunnerUp = team.placing === 2;
  const placeBadgeClass = isChampion ? 'place-champion' : (isRunnerUp ? 'place-runnerup' : 'place-top');
  
  const formatBadgeHtml = team.format === 'double'
    ? `<span class="team-format-pill pill-double">⚔️ 双打 (Doubles)</span>`
    : `<span class="team-format-pill pill-single">🎯 单打 (Singles)</span>`;

  const pokemonListHtml = (team.pokemon || []).map(p => {
    const typePills = (p.types || []).map(t => 
      `<span class="type-pill type-${t}">${TYPE_TRANSLATION[t] || t}</span>`
    ).join(' ');

    const movesHtml = (p.moves || []).map(m => {
      const catClass = m.category === 'Physical' || m.category === '物理' 
        ? 'pill-cat-phy' 
        : (m.category === 'Special' || m.category === '特殊' ? 'pill-cat-spe' : 'pill-cat-sta');
      const catCn = m.category === 'Physical' || m.category === '物理' 
        ? '物理' 
        : (m.category === 'Special' || m.category === '特殊' ? '特殊' : '变化');
      const powerText = (m.power && m.power !== '—' && m.power !== '--') ? ` · ${m.power}` : '';

      return `
        <div class="team-mon-move-item">
          <span class="type-pill type-${m.type || 'Normal'} mini">${TYPE_TRANSLATION[m.type] || m.type || '一般'}</span>
          <span class="move-name-text">${m.name || m.enName}</span>
          <span class="${catClass} mini">${catCn}${powerText}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="team-member-card">
        <div class="team-member-header">
          <img class="team-member-avatar" src="${p.avatar}" alt="${p.species || p.enSpecies}" loading="lazy" onerror="this.src='https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/items/poke-ball.png'">
          <div class="team-member-meta">
            <div class="team-member-name">${p.species || p.enSpecies}</div>
            <div class="team-member-enname">${p.enSpecies || ''}</div>
            <div class="team-member-types">${typePills}</div>
          </div>
        </div>

        <div class="team-member-build">
          <div class="build-field">
            <span class="build-field-label">🎒 携带道具</span>
            <span class="build-field-val item-val">${p.item || p.enItem || '未携带道具'}</span>
          </div>
          <div class="build-field">
            <span class="build-field-label">✦ 战斗特性</span>
            <span class="build-field-val">${p.ability || '通常特性'}</span>
          </div>
          ${p.nature ? `
            <div class="build-field">
              <span class="build-field-label">🧠 实战性格</span>
              <span class="build-field-val">${p.nature.replace('Nature', '性格').trim()}</span>
            </div>
          ` : ''}
        </div>

        <div class="team-member-moves">
          <div class="moves-title">⚔️ 携带招式 (4 Moves)</div>
          <div class="moves-list-wrap">
            ${movesHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="team-card ${isChampion ? 'team-card-champion' : ''}">
      <div class="team-card-header">
        <div class="team-meta-left">
          <div class="team-placing-badge ${placeBadgeClass}">
            ${team.placingTag || `第 ${team.placing} 名`}
          </div>
          ${formatBadgeHtml}
          <div class="team-player-box">
            <span class="player-icon">👤</span>
            <span class="player-name">${team.player || '匿名选手'}</span>
          </div>
          ${team.record ? `<span class="team-record-badge">📊 战绩: ${team.record}</span>` : ''}
        </div>
        <div class="team-meta-right">
          <a class="team-tourn-link" href="${team.tournamentUrl}" target="_blank" rel="noopener noreferrer" title="查看官方完赛记录">
            🏆 ${team.tournamentName} ↗
          </a>
        </div>
      </div>

      <div class="team-roster-grid">
        ${pokemonListHtml}
      </div>
    </div>
  `;
}
