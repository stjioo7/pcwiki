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

// 全局官方竞技道具字典 (按对战高频/类别权重排序，支持中文搜索匹配)
const CHAMPIONS_ALL_ITEMS = [
  // 1. 核心竞技道具 (Top Competitive Tier)
  "气势披带", "吃剩的东西", "生命宝珠", "突击背心", "讲究围巾", "讲究眼镜", "讲究头带", 
  "凹凸凸头盔", "进化奇石", "驱劲能量", "密探斗篷", "文柚果", "木子果", "弱点保险", 
  "广角镜", "达人带", "光之黏土", "白色香草", "心灵香草", "大根茎", "节拍器", "王者之证", 
  "黑色铁球", "附着针", "黑色污泥", "焦点镜", "对焦镜", "先制之爪", "光粉", "气势头带", 
  "博识眼镜", "力量头带", "贝壳之铃", "美丽空壳",

  // 2. 天气与场地岩石 (Weather Rocks)
  "沙沙岩石", "潮湿岩石", "炽热岩石", "冰冷岩石",

  // 3. 属性增伤道具 (Type Enhancers)
  "木炭", "神秘水滴", "磁铁", "奇迹种子", "不融冰", "黑带", "毒针", "柔软沙子", 
  "锐利鸟嘴", "弯曲的汤匙", "银粉", "硬石头", "咒术之符", "龙之牙", "黑色眼镜", 
  "金属膜", "丝绸围巾", "妖精之羽", "电气球", "心之水滴",

  // 4. 属性抗性减半果 (Type-Resist Berries)
  "巧可果", "千香果", "烛木果", "罗子果", "番荔果", "莲蒲果", "刺耳果", "腰木果", 
  "棱瓜果", "福禄果", "草蚕果", "佛柑果", "莓榴果", "通通果", "霹霹果", "洛玫果", 
  "灯浆果", "苹野果", "利木果", "柿仔果", "桃桃果", "樱子果", "零余果", "橙橙果",

  // 5. 全量超级进化石 (Mega Stones)
  "喷火龙进化石Ｘ", "喷火龙进化石Ｙ", "烈咬陆鲨进化石", "巨沼怪进化石", "巨金怪进化石", 
  "耿鬼进化石", "沙奈朵进化石", "班基拉斯进化石", "暴飞龙进化石", "暴鲤龙进化石", 
  "水箭龟进化石", "妙蛙花进化石", "路卡利欧进化石", "大嘴娃进化石", "袋兽进化石", 
  "摔角鹰人进化石", "蜥蜴王进化石", "火焰鸡进化石", "艾路雷朵进化石", "差不多娃娃进化石", 
  "大针蜂进化石", "大钢蛇进化石", "大食花进化石", "泥偶巨人进化石", "晶光花进化石", 
  "狠辣椒进化石", "七夕青鸟进化石", "暴雪王进化石", "化石翼龙进化石", "勾魂眼进化石", 
  "呆壳兽进化石", "喷火驼进化石", "大力鳄进化石", "大竺葵进化石", "姆克鹰进化石", 
  "宝石海星进化石", "巨牙鲨进化石", "巨钳螳螂进化石", "布里卡隆进化石", "快龙进化石", 
  "恰雷姆进化石", "毒藻龙进化石", "水晶灯火灵进化石", "波士可多拉进化石", "火炎狮进化石", 
  "炎武王进化石", "皮可西进化石", "盔甲鸟进化石", "老翁龙进化石", "胡地进化石", 
  "花叶蒂进化石", "蜈蚣王进化石", "诅咒娃娃进化石", "赫拉克罗斯进化石", "超能妙喵进化石", 
  "长耳兔进化石", "阿勃梭鲁进化石", "雪妖女进化石", "雷丘进化石Ｘ", "雷丘进化石Ｙ", 
  "雷电兽进化石", "风铃铃进化石", "麻麻鳗鱼王进化石", "黑鲁加进化石", "龙头地鼠进化石", 
  "龟足巨铠进化石", "乌贼王进化石", "冰鬼护进化石", "凯罗斯进化石", "列阵兵进化石", 
  "好胜毛蟹进化石", "妖火红狐进化石", "甲贺忍蛙进化石", "电龙进化石"
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

