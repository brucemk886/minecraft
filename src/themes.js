const THEMES = ["village", "library", "canyon", "cave", "checker", "honey", "sunset"];

const SKY = {
  village: 0x65bfff,
  library: 0x26394a,
  canyon: 0x76c8ff,
  cave: 0x090b0f,
  checker: 0x68bcff,
  honey: 0x17110c,
  sunset: 0xf48a55,
};

const FOG = {
  village: { near: 34, far: 96 },
  library: { near: 18, far: 48 },
  canyon: { near: 30, far: 88 },
  cave: { near: 15, far: 44 },
  checker: { near: 34, far: 94 },
  honey: { near: 16, far: 44 },
  sunset: { near: 30, far: 86 },
};

export function themeSky(name) {
  return SKY[name] ?? 0x87c6f0;
}

export function themeFog(name) {
  return FOG[name] ?? { near: 8, far: 36 };
}

export function buildCourse(world, options) {
  const rng = mulberry32(hashSeed(options.seed || "reddit"));
  const selected =
    options.theme === "tour"
      ? Array.from({ length: 4 }, (_, round) =>
          THEMES.map((_, index) => THEMES[(index + round * 2) % THEMES.length]),
        ).flat()
      : [options.theme];
  const platforms = [];
  let x = 0;
  let y = 16;
  let z = 0;

  const perTheme = options.theme === "tour" ? 9 : 180;
  for (const theme of selected) {
    for (let i = 0; i < perTheme; i++) {
      const prevX = x;
      const prevY = y;
      const prevZ = z;
      const gapRoll = rng();
      const gap = gapRoll < 0.08 ? 1 : gapRoll < 0.74 ? 2 : 3;
      const lateralRoll = rng();
      const lateral = lateralRoll < 0.22 ? -1 : lateralRoll > 0.78 ? 1 : 0;
      x = clamp(x + lateral, -5, 5);
      const heightRoll = rng();
      const verticalPhase = i % (options.theme === "tour" ? 9 : 14);
      let heightDelta = 0;
      if (options.theme === "tour") {
        if (verticalPhase === 1 || verticalPhase === 3 || verticalPhase === 4) heightDelta = 1;
        if (verticalPhase === 6 || verticalPhase === 7 || verticalPhase === 8) heightDelta = -1;
      } else {
        if (verticalPhase === 2 || verticalPhase === 5) heightDelta = 1;
        if (verticalPhase === 9 || verticalPhase === 12) heightDelta = -1;
        if (heightDelta === 0 && heightRoll < 0.06) heightDelta = 1;
        if (heightDelta === 0 && heightRoll > 0.96) heightDelta = -1;
      }
      y = clamp(y + heightDelta, 13, 21);
      z += gap;
      const block = pickPathBlock(theme, rng);
      const shape = theme === "library" ? "full" : rng() < 0.18 ? "slab" : "full";
      world.set(x, y, z, block, shape);
      if (i % 9 === 0) {
        const padX = x === 5 ? x - 1 : x + 1;
        world.set(padX, y, z, block, shape);
      }
      platforms.push({
        x: x + 0.5,
        y: y + (shape === "slab" ? 0.5 : 1),
        z: z + 0.5,
        theme,
      });
      const span = Math.max(1, z - prevZ);
      for (let zz = prevZ + 1; zz <= z; zz++) {
        const t = (zz - prevZ) / span;
        const ix = Math.round(prevX + (x - prevX) * t);
        const iy = Math.round(prevY + (y - prevY) * t);
        decorateAround(world, theme, ix, iy, zz, rng, i);
      }
    }
  }
  return platforms;
}

function pickPathBlock(theme, rng) {
  const table = {
    village: ["moss", "oak_plank", "stone_brick", "cobble", "moss"],
    library: ["spruce_plank", "oak_plank", "oak_log", "bookshelf"],
    canyon: ["gold", "spruce_plank", "stone_brick", "sandstone"],
    cave: ["spruce_plank", "deepslate", "stone", "cobble"],
    checker: ["stone_brick", "cobble", "gold", "oak_plank"],
    honey: ["spruce_plank", "honeycomb", "deepslate"],
    sunset: ["sandstone", "spruce_plank", "gold", "quartz", "stone_brick"],
  };
  const list = table[theme] || ["stone"];
  return list[Math.floor(rng() * list.length)];
}

function decorateAround(world, theme, x, y, z, rng, index) {
  if (theme === "village") villageDecor(world, x, y, z, rng, index);
  if (theme === "library") libraryDecor(world, x, y, z, rng, index);
  if (theme === "canyon") canyonDecor(world, x, y, z, rng, index);
  if (theme === "cave") caveDecor(world, x, y, z, rng, index);
  if (theme === "checker") checkerDecor(world, x, y, z, rng, index);
  if (theme === "honey") honeyDecor(world, x, y, z, rng, index);
  if (theme === "sunset") sunsetDecor(world, x, y, z, rng, index);
}

function villageDecor(world, x, y, z, rng, index) {
  const islandSection = Math.floor(index / 7) % 3 === 1;
  for (let dx = -8; dx <= 8; dx++) {
    if (dx === 0) continue;
    if (islandSection && Math.abs(dx) > 4) {
      world.set(x + dx, y - 5, z, "water");
      continue;
    }
    const surface = Math.abs(dx) === 1 ? "stone_brick" : rng() < 0.2 ? "moss" : "grass";
    world.set(x + dx, y - 1, z, surface);
    world.set(x + dx, y - 2, z, rng() < 0.18 ? "stone" : "dirt");
    if (Math.abs(dx) >= 2 && rng() < 0.12) {
      world.set(x + dx, y, z, rng() < 0.5 ? "flower_red" : "flower_yellow", "cross");
    }
  }

  if (index % 4 === 0) {
    world.set(x - 3, y, z, "oak_log", "fence");
    world.set(x + 3, y, z, "oak_log", "fence");
  }
  if (index % 5 === 0 && z % 2 === 0) lampPost(world, x + 3, y, z, 0xffe08a);
  if (index % 4 === 0) tree(world, x - 7, y, z);
  if (index % 6 === 2) tree(world, x + 7, y, z);
  if (index % 12 === 0) house(world, x + 7, y - 1, z - 1);
  if (index % 14 === 4) house(world, x - 11, y - 1, z + 1);
  if (index % 11 === 0) cloud(world, x + (rng() < 0.5 ? -14 : 12), y + 12, z + 5, rng);
}

function libraryDecor(world, x, y, z, rng, index) {
  for (let dx = -4; dx <= 4; dx++) {
    world.set(x + dx, y - 1, z, rng() < 0.18 ? "stone_brick" : "spruce_plank");
    world.set(x + dx, y + 4, z, rng() < 0.22 ? "oak_log" : "spruce_plank");
  }
  thickWall(world, x - 4, y, z, 2, 4, () => (rng() < 0.62 ? "bookshelf" : "spruce_plank"));
  thickWall(world, x + 3, y, z, 2, 4, () => (rng() < 0.62 ? "bookshelf" : "spruce_plank"));
  if (index % 3 === 0) {
    world.set(x - 3, y + 1, z, "glass");
    world.set(x + 3, y + 1, z, "glass");
  }
  if (index % 2 === 0) world.set(x - 2, y, z, "oak_log");
  if (index % 2 === 1) world.set(x + 2, y, z, "oak_log");
  if (index % 3 === 0 && z % 3 === 0) {
    world.set(x, y + 3, z, "lamp");
    world.addLight(x, y + 3, z, 0xffc56a, 2.2, 7);
  }
}

function canyonDecor(world, x, y, z, rng, index) {
  thickWall(world, x - 5, y - 2, z, 2, 10, () => (rng() < 0.15 ? "stone_brick" : "sandstone"));
  thickWall(world, x + 4, y - 2, z, 2, 10, () => (rng() < 0.12 ? "brick" : "sandstone"));
  for (let dx = -2; dx <= 2; dx++) {
    if (dx === 0) continue;
    world.set(x + dx, y - 1, z, rng() < 0.3 ? "spruce_plank" : "cobble");
  }
  if (index % 2 === 0) {
    world.set(x - 2, y, z, "oak_log", "fence");
    world.set(x + 2, y, z, "oak_log", "fence");
  }
  if (index % 4 === 0 && z % 3 === 0) {
    world.set(x + 2, y + 3, z, "lamp");
    world.addLight(x + 2, y + 3, z, 0xffe6a0, 2, 7);
  }
  if (index % 9 === 0) tower(world, x + 7, y - 1, z, "quartz");
}

function caveDecor(world, x, y, z, rng, index) {
  for (let dx = -5; dx <= 5; dx++) {
    if (dx !== 0) {
      const floorType = rng() < 0.13 ? "lava" : rng() < 0.24 ? "magma" : "deepslate";
      world.set(x + dx, y - 1, z, floorType);
    }
    const ceilingRoll = rng();
    world.set(x + dx, y + 5, z, ceilingRoll < 0.28 ? "cobble" : ceilingRoll < 0.52 ? "stone" : "deepslate");
  }
  thickWall(world, x - 5, y, z, 2, 5, () => {
    const roll = rng();
    return roll < 0.24 ? "cobble" : roll < 0.48 ? "stone" : "deepslate";
  });
  thickWall(world, x + 4, y, z, 2, 5, () => {
    const roll = rng();
    return roll < 0.28 ? "stone" : roll < 0.46 ? "cobble" : "deepslate";
  });
  if (index % 6 === 0 && z % 3 === 0) {
    world.set(x + 2, y, z, "oak_log", "fence");
    world.set(x + 2, y + 1, z, "lamp");
    world.addLight(x + 2, y + 1, z, 0xffd27a, 2, 6);
  }
}

function checkerDecor(world, x, y, z, rng, index) {
  for (let h = 0; h < 7; h++) {
    const a = ((z + h) & 1) === 0 ? "wool_red" : "wool_white";
    const b = a === "wool_red" ? "wool_white" : "wool_red";
    world.set(x - 5, y + h, z, a);
    world.set(x - 6, y + h, z, b);
    world.set(x + 5, y + h, z, b);
    world.set(x + 6, y + h, z, a);
  }
  for (let dx = -4; dx <= 4; dx++) {
    if (dx === 0) continue;
    world.set(x + dx, y - 1, z, "grass");
    if ((dx + z) % 5 === 0) world.set(x + dx, y, z, "flower_red", "cross");
  }
  if (index % 4 === 0) lampPost(world, x + 3, y, z, 0xffe08a);
  if (index % 7 === 0) house(world, x - 9, y - 1, z);
}

function honeyDecor(world, x, y, z, rng, index) {
  for (let dx = -4; dx <= 4; dx++) {
    if (dx !== 0) world.set(x + dx, y - 1, z, rng() < 0.38 ? "honeycomb" : "deepslate");
    world.set(x + dx, y + 5, z, rng() < 0.38 ? "honeycomb" : "deepslate");
  }
  thickWall(world, x - 5, y, z, 2, 5, () => (rng() < 0.45 ? "honeycomb" : "deepslate"));
  thickWall(world, x + 4, y, z, 2, 5, () => (rng() < 0.45 ? "honeycomb" : "deepslate"));
  if (index % 5 === 0 && z % 3 === 0) {
    world.set(x + 2, y, z, "oak_log", "fence");
    world.set(x + 2, y + 1, z, "lamp");
    world.addLight(x + 2, y + 1, z, 0xffe08a, 2.2, 6);
  }
  if (rng() < 0.18) world.addBee(x + 1, y + 2, z + 1);
}

function sunsetDecor(world, x, y, z, rng, index) {
  thickWall(world, x - 6, y, z, 2, 7, () => {
    if (rng() < 0.16) return "leaves";
    if (rng() < 0.2) return "quartz";
    return "sandstone";
  });
  thickWall(world, x + 5, y, z, 2, 7, () => (rng() < 0.22 ? "spruce_plank" : "sandstone"));
  for (let dx = -4; dx <= 4; dx++) {
    if (dx === 0) continue;
    world.set(x + dx, y - 1, z, rng() < 0.3 ? "spruce_plank" : "sandstone");
  }
  if (index % 2 === 0) world.set(x - 6, y + 2, z, "glass");
  if (index % 3 === 0) {
    world.set(x + 3, y + 2, z, "lamp");
    world.addLight(x + 3, y + 2, z, 0xffb14a, 2.3, 7);
  }
  if (index % 8 === 0) tower(world, x + 8, y - 1, z, "sandstone");
  if (index % 10 === 2) tree(world, x - 8, y, z);
}

function thickWall(world, x, y, z, depth, height, typeFn) {
  for (let dx = 0; dx < depth; dx++) {
    for (let dy = 0; dy < height; dy++) {
      world.set(x + dx, y + dy, z, typeFn());
    }
  }
}

function lampPost(world, x, y, z, color) {
  world.set(x, y, z, "oak_log", "fence");
  world.set(x, y + 1, z, "lamp");
  world.addLight(x, y + 1, z, color, 2.1, 7);
}

function tree(world, x, y, z) {
  world.set(x, y, z, "oak_log");
  world.set(x, y + 1, z, "oak_log");
  world.set(x, y + 2, z, "oak_log");
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      world.set(x + dx, y + 3, z + dz, "leaves");
      world.set(x + dx, y + 4, z + dz, "leaves");
    }
  }
}

function house(world, x, y, z) {
  for (let dx = 0; dx < 5; dx++) {
    for (let dz = 0; dz < 4; dz++) {
      for (let dy = 0; dy < 5; dy++) {
        const wall = dx === 0 || dx === 4 || dz === 0 || dz === 3 || dy === 0 || dy === 4;
        if (!wall) continue;
        if (dy === 2 && (dx === 2 || dz === 1)) world.set(x + dx, y + dy, z + dz, "glass");
        else if (dy === 0) world.set(x + dx, y + dy, z + dz, "oak_plank");
        else world.set(x + dx, y + dy, z + dz, dx === 0 || dx === 4 ? "oak_log" : "oak_plank");
      }
    }
  }
}

function cloud(world, x, y, z, rng) {
  const width = 5 + Math.floor(rng() * 4);
  for (let dx = 0; dx < width; dx++) {
    world.set(x + dx, y, z, "quartz", "slab");
    if (dx > 1 && dx < width - 1) world.set(x + dx, y, z + 1, "quartz", "slab");
  }
  world.set(x + Math.floor(width / 2), y + 1, z, "quartz", "slab");
}

function tower(world, x, y, z, type) {
  for (let h = 0; h < 12; h++) {
    world.set(x, y + h, z, type);
    world.set(x + 1, y + h, z, type);
    world.set(x, y + h, z + 1, type);
    if (h % 3 === 0) world.set(x + 1, y + h, z + 1, "glass");
  }
  world.set(x, y + 12, z, "lamp");
}

export function hashSeed(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
