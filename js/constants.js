/**
 * constants.js - 竞技图鉴与副驾全局常量与数据字典
 */
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/projectpokemon/champout@main';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/projectpokemon/champout/main';
const CACHE_KEY = 'PC_CHAMPOUT_DATA_V4';

// 官方属性代号对照表 (Type 0..17)
const TYPE_INDEX_MAP = [
  "Normal", "Fighting", "Flying", "Poison", "Ground", "Rock",
  "Bug", "Ghost", "Steel", "Fire", "Water", "Grass",
  "Electric", "Psychic", "Ice", "Dragon", "Dark", "Fairy"
];

const TYPE_TRANSLATION = {
  "Normal": "一般", "Fire": "火", "Water": "水", "Grass": "草",
  "Electric": "电", "Ice": "冰", "Fighting": "格斗", "Poison": "毒",
  "Ground": "地面", "Flying": "飞行", "Psychic": "超能力", "Bug": "虫",
  "Rock": "岩石", "Ghost": "幽灵", "Dragon": "龙", "Steel": "钢",
  "Dark": "恶", "Fairy": "妖精"
};

// 预设性格修正表
const NATURES = [
  { name: "认真 / 害羞 (无修正 Neutral)", plus: null, minus: null },
  { name: "固执 (Adamant: +物攻, -特攻)", plus: "atk", minus: "spa" },
  { name: "爽朗 (Jolly: +速度, -特攻)", plus: "spe", minus: "spa" },
  { name: "内敛 (Modest: +特攻, -物攻)", plus: "spa", minus: "atk" },
  { name: "胆小 (Timid: +速度, -物攻)", plus: "spe", minus: "atk" },
  { name: "淘气 (Impish: +物防, -特攻)", plus: "def", minus: "spa" },
  { name: "慎重 (Careful: +特防, -特攻)", plus: "spd", minus: "spa" },
  { name: "大胆 (Bold: +物防, -物攻)", plus: "def", minus: "atk" },
  { name: "温和 (Calm: +特防, -物攻)", plus: "spd", minus: "atk" },
  { name: "勇敢 (Brave: +物攻, -速度)", plus: "atk", minus: "spe" },
  { name: "冷静 (Quiet: +特攻, -速度)", plus: "spa", minus: "spe" }
];

// 高频对战竞技招式置顶清单 (用于排位秒选推演)
const HIGH_PRIORITY_MOVES = [
  "子弹拳", "近身战", "剑舞", "急速折返", "流星群", "神速", "暗影球",
  "月亮之力", "十万伏特", "喷射火焰", "水流喷射", "地震", "尖石攻击",
  "冲浪", "冷冻光束", "伏特替换", "欺诈", "击掌奇袭", "挑衅", "羽栖",
  "寄生种子", "蘑菇孢子", "水炮", "巨声", "守住", "过热", "强力鞭打",
  "精神强念", "吸取拳", "恶意追击", "冰冻拳", "雷电拳", "火焰拳", "暴风",
  "污泥炸弹", "终极吸取", "大地之力", "龙之波动", "能量球", "龙之舞"
];



// 全局响应式共享变量 (立即同步 207 只官方全量数据)
let allPokemonList = (typeof window !== 'undefined' && window.CHAMPIONS_DATA && window.CHAMPIONS_DATA.pokemon)
  ? window.CHAMPIONS_DATA.pokemon
  : [];
let filteredPokemonList = [];
let activeTypeFilter = 'all';
let viewMode = 'scroll';

let selectedPokemon = null;
let selectedDefender = null;
let isMegaFormActive = false;
let selectedNature = NATURES[1];
let currentVpAllocation = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const TOTAL_VP_BUDGET = 66;
const MAX_VP_PER_STAT = 32;

let isTailwindActive = false;
let isChoiceScarfActive = false;
let isShowAllLearnset = false;

// 对战副驾实时状态
let copilotState = {
  hasAnalyzed: false,
  playerMon: null,
  opponentMon: null,
  isPlayerMega: false,
  playerMegaBranch: "X",
  isOpponentMega: false,
  opponentMegaBranch: "X",
  playerHpCur: 131,
  playerHpMax: 173,
  playerHpPct: 75.7,
  opponentHpPct: 85.0,
  isTailwind: false,
  isScarf: false
};

// 全局通用立绘解析
function getPokemonSpriteUrl(mon) {
  if (!mon) return 'https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/items/poke-ball.png';
  if (mon.avatar) return mon.avatar;
  const id = mon.id || mon.dexNo || 1;
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
}

// 全局通用参战宝可梦形态解析 (若激活 Mega 则应用 Mega 种族、属性、特性与立绘)
function getActiveCombatant(baseMon, isMega, branchKey) {
  if (!baseMon) return null;
  if (!isMega || !baseMon.mega || !baseMon.mega.supported) {
    return baseMon;
  }

  const forms = baseMon.mega.forms || [];
  const bKey = (branchKey || 'X').toUpperCase();
  let form = forms.find(f => (f.formKey || '').toUpperCase() === bKey);
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

if (typeof window !== 'undefined') {
  window.getPokemonSpriteUrl = getPokemonSpriteUrl;
  window.getActiveCombatant = getActiveCombatant;
}

