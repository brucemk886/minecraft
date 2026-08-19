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
]);

export const MINECRAFT_TEMPLATE_STYLES = Object.freeze([
  "经典长廊",
  "急弯回廊",
  "高低阶梯",
  "开阔庭院",
  "双塔通道",
  "连续拱门",
  "峡谷折线",
  "密集障碍",
  "景观栈道",
  "极限起伏",
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
  const normalizedOffset = Math.floor(Number(offset) || 0);
  // 37 is coprime with 100, so every group of 100 visits every template once.
  const templateIndex = ((normalizedOffset + position * 37) % MINECRAFT_TEMPLATES.length + MINECRAFT_TEMPLATES.length)
    % MINECRAFT_TEMPLATES.length;
  return MINECRAFT_TEMPLATES[templateIndex];
}
