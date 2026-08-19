export const MINECRAFT_BASE_THEMES = Object.freeze([
  { id: "village", name: "村庄花园" },
  { id: "library", name: "高层图书馆" },
  { id: "lava", name: "熔岩峡谷" },
  { id: "lush", name: "繁茂洞穴" },
  { id: "checker", name: "红白花园" },
  { id: "honey", name: "蜂巢矿洞" },
  { id: "cherry", name: "樱花高塔" },
  { id: "ice", name: "冰晶宫殿" },
  { id: "nether", name: "下界熔炉" },
  { id: "crystal", name: "紫晶花园" },
  { id: "desert", name: "沙漠神殿" },
  { id: "bamboo", name: "竹林寺院" },
  { id: "ocean", name: "海晶神殿" },
  { id: "mushroom", name: "蘑菇乐园" },
  { id: "copper", name: "铜艺工厂" },
  { id: "redstone", name: "红石机械城" },
  { id: "quartz", name: "白石圣殿" },
  { id: "castle", name: "石砖王城" },
  { id: "melon", name: "西瓜农庄" },
  { id: "coral", name: "珊瑚水庭" },
  { id: "rainbow", name: "彩虹玻璃城" },
  { id: "swamp", name: "红树林水寨" },
  { id: "birch", name: "白桦林庄园" },
  { id: "azalea", name: "杜鹃花庭院" },
  { id: "obsidian", name: "黑曜石要塞" },
  { id: "gold", name: "黄金宫殿" },
  { id: "emerald", name: "翡翠神殿" },
  { id: "factory", name: "蒸汽工厂" },
  { id: "arcade", name: "霓虹游戏厅" },
  { id: "savanna", name: "热带草原城" },
  { id: "alpine", name: "高山木屋" },
  { id: "jungle", name: "丛林神庙" },
  { id: "coast", name: "海岸堡垒" },
  { id: "oasis", name: "绿洲城邦" },
  { id: "candy", name: "糖果工坊" },
  { id: "clockwork", name: "钟表机械城" },
  { id: "marble", name: "大理石浴场" },
  { id: "vineyard", name: "葡萄庄园" },
  { id: "pumpkin", name: "南瓜嘉年华" },
  { id: "aquarium", name: "水族长廊" },
  { id: "railway", name: "蒸汽铁路" },
  { id: "harbor", name: "海港船坞" },
  { id: "cathedral", name: "彩窗教堂" },
  { id: "dojo", name: "武道庭院" },
  { id: "oriental", name: "东方宫殿" },
  { id: "mesa", name: "彩陶峡谷" },
  { id: "quarry", name: "石料矿场" },
  { id: "greenhouse", name: "玻璃温室" },
  { id: "carnival", name: "嘉年华乐园" },
  { id: "laboratory", name: "晶能实验室" },
  { id: "music", name: "音乐殿堂" },
  { id: "bakery", name: "烘焙工坊" },
  { id: "volcano", name: "火山神殿" },
  { id: "lagoon", name: "热带泻湖" },
  { id: "autumn", name: "秋叶庄园" },
  { id: "winter", name: "冬日村镇" },
  { id: "dragon", name: "龙纹圣殿" },
  { id: "maze", name: "花园迷宫" },
  { id: "observatory", name: "星象大厅" },
  { id: "stadium", name: "竞技场" },
]);

export const MINECRAFT_TEMPLATE_STYLES = Object.freeze([
  "经典长廊",
  "急弯回廊",
  "高低阶梯",
  "开阔庭院",
  "连续拱门",
]);

export const MINECRAFT_TEMPLATES = Object.freeze(
  MINECRAFT_BASE_THEMES.flatMap((theme, themeIndex) =>
    MINECRAFT_TEMPLATE_STYLES.map((style, styleIndex) => {
      const variant = styleIndex + 1;
      const number = themeIndex * MINECRAFT_TEMPLATE_STYLES.length + variant;
      return Object.freeze({
        id: `${theme.id}-v${String(variant).padStart(2, "0")}`,
        baseTheme: theme.id,
        baseName: theme.name,
        style,
        variant,
        number,
        name: `${String(number).padStart(3, "0")} ${theme.name} · ${style}`,
      });
    }),
  ),
);

const TEMPLATE_BY_ID = new Map(MINECRAFT_TEMPLATES.map((template) => [template.id, template]));

export function minecraftTemplateById(value) {
  return TEMPLATE_BY_ID.get(String(value || "").trim().toLowerCase()) || null;
}

export function minecraftBaseTheme(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return minecraftTemplateById(normalized)?.baseTheme
    || MINECRAFT_BASE_THEMES.find((theme) => theme.id === normalized)?.id
    || "village";
}

export function minecraftTemplateForBatchIndex(index, offset = 0) {
  const position = Math.max(0, Math.floor(Number(index) || 1) - 1);
  const normalizedOffset = ((Math.floor(Number(offset) || 0) % MINECRAFT_TEMPLATES.length)
    + MINECRAFT_TEMPLATES.length) % MINECRAFT_TEMPLATES.length;
  const themeCount = MINECRAFT_BASE_THEMES.length;
  const styleCount = MINECRAFT_TEMPLATE_STYLES.length;
  const sequencePosition = (position + normalizedOffset) % MINECRAFT_TEMPLATES.length;
  const round = Math.floor(sequencePosition / themeCount);
  const withinRound = sequencePosition % themeCount;
  // 17 is coprime with 60. Each 60-video round covers every theme once,
  // and five rounds cover all 300 theme/route combinations without repeats.
  const themeIndex = (withinRound * 17) % themeCount;
  const variantIndex = (round + themeIndex) % styleCount;
  const templateIndex = themeIndex * styleCount + variantIndex;
  return MINECRAFT_TEMPLATES[templateIndex];
}

export function minecraftDailyTemplateOffset(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const dayNumber = Math.floor(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000);
  // Alternate complementary 150-template halves. Consecutive days have zero
  // template overlap, while every two-day window covers all 300 templates.
  return (((dayNumber % 2) + 2) % 2) * 150;
}
