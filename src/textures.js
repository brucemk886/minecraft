import * as THREE from "three";

let textureAnisotropy = 1;

function canvasTexture(size, draw) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapNearestFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = Math.min(8, textureAnisotropy);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

function fill(ctx, size, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
}

function hash2(x, y, seed) {
  let n = x * 374761393 + y * 668265263 + seed * 1274126177;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

function scatter(ctx, size, colors, seed) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = hash2(x, y, seed);
      let idx = 0;
      if (n > 0.78) idx = colors.length - 1;
      else if (n > 0.45) idx = 1 % colors.length;
      else if (n > 0.22) idx = Math.min(2, colors.length - 1);
      px(ctx, x, y, colors[idx]);
    }
  }
}

export function createMaterials(maxAnisotropy = 1) {
  textureAnisotropy = Math.max(1, maxAnisotropy);
  const grassTop = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#3a7d1c", "#5d9c3b", "#2f6b14", "#6eae44"], 11);
  });
  const grassSide = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#866043", "#6b4b32", "#9a7350", "#5c3e28"], 3);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < s; x++) {
        px(ctx, x, y, ["#5d9c3b", "#3a7d1c", "#6eae44"][(x + y) % 3]);
      }
    }
  });
  const dirt = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#866043", "#6b4b32", "#9a7350", "#5c3e28"], 5);
  });
  const stone = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#7a7a7a", "#8f8f8f", "#6b6b6b", "#828282"], 9);
    px(ctx, 3, 5, "#5a5a5a");
    px(ctx, 11, 9, "#9c9c9c");
    px(ctx, 7, 2, "#5a5a5a");
  });
  const cobble = canvasTexture(16, (ctx) => {
    fill(ctx, 16, "#6b6b6b");
    const rocks = [
      [0, 0, 7, 5, "#8a8a8a"],
      [7, 0, 9, 6, "#7c7c7c"],
      [0, 5, 6, 6, "#5e5e5e"],
      [6, 6, 5, 5, "#909090"],
      [11, 6, 5, 4, "#6a6a6a"],
      [0, 11, 8, 5, "#7a7a7a"],
      [8, 10, 8, 6, "#555555"],
    ];
    for (const [x, y, w, h, c] of rocks) {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    }
    ctx.fillStyle = "#3f3f3f";
    ctx.fillRect(0, 5, 16, 1);
    ctx.fillRect(7, 0, 1, 16);
    ctx.fillRect(0, 10, 16, 1);
  });
  const plank = canvasTexture(16, (ctx) => {
    const bands = ["#c29d62", "#b89455", "#c9a56a", "#a67c45"];
    for (let y = 0; y < 16; y++) {
      ctx.fillStyle = bands[(y >> 2) % bands.length];
      ctx.fillRect(0, y, 16, 1);
    }
    ctx.fillStyle = "#6d4e24";
    ctx.fillRect(0, 3, 16, 1);
    ctx.fillRect(0, 7, 16, 1);
    ctx.fillRect(0, 11, 16, 1);
    ctx.fillRect(0, 15, 16, 1);
    ctx.fillRect(8, 0, 1, 4);
    ctx.fillRect(4, 8, 1, 4);
    ctx.fillRect(12, 12, 1, 4);
  });
  const logSide = canvasTexture(16, (ctx) => {
    for (let x = 0; x < 16; x++) {
      const c = x % 5 === 0 ? "#3d2814" : x % 3 === 0 ? "#6a4424" : "#5a381c";
      ctx.fillStyle = c;
      ctx.fillRect(x, 0, 1, 16);
    }
  });
  const logTop = canvasTexture(16, (ctx) => {
    fill(ctx, 16, "#b89455");
    ctx.strokeStyle = "#6d4e24";
    ctx.strokeRect(1, 1, 13, 13);
    ctx.strokeRect(4, 4, 7, 7);
    ctx.fillStyle = "#8a6a38";
    ctx.fillRect(7, 7, 2, 2);
  });
  const leaves = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#2f7d1e", "#3e9a28", "#246616", "#1d5412"], 21);
  });
  const gold = canvasTexture(16, (ctx) => {
    fill(ctx, 16, "#fcdb4a");
    ctx.fillStyle = "#ffe566";
    ctx.fillRect(2, 2, 12, 12);
    ctx.fillStyle = "#d4a017";
    ctx.strokeRect(1, 1, 13, 13);
    ctx.fillRect(0, 0, 2, 2);
    ctx.fillRect(14, 14, 2, 2);
  });
  const lamp = canvasTexture(16, (ctx) => {
    fill(ctx, 16, "#fff1a8");
    ctx.fillStyle = "#ffe066";
    ctx.fillRect(2, 2, 12, 12);
    ctx.fillStyle = "#fffbe6";
    ctx.fillRect(5, 5, 6, 6);
    ctx.fillStyle = "#e0b000";
    ctx.fillRect(7, 0, 2, 16);
    ctx.fillRect(0, 7, 16, 2);
  });
  const lava = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#d14c0a", "#ff6a12", "#a83200", "#ffc14a"], 8);
  });
  const water = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#2b5fd4", "#3b7cff", "#1e4cb0"], 4);
  });
  const sandstone = canvasTexture(16, (ctx) => {
    fill(ctx, 16, "#e8d59a");
    ctx.fillStyle = "#d4c07a";
    ctx.fillRect(0, 4, 16, 1);
    ctx.fillRect(0, 10, 16, 1);
    ctx.fillStyle = "#f3e6b0";
    ctx.fillRect(3, 1, 4, 2);
    ctx.fillRect(9, 12, 5, 2);
  });
  const bookshelf = canvasTexture(16, (ctx) => {
    fill(ctx, 16, "#6b4423");
    const books = ["#8b1e1e", "#1e4d8b", "#2d7a32", "#c4a035", "#6b3fa0", "#8b1e1e"];
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = books[(row + i) % books.length];
        ctx.fillRect(1 + i * 3, 1 + row * 5, 2, 4);
      }
    }
    ctx.fillStyle = "#3d2412";
    ctx.fillRect(0, 5, 16, 1);
    ctx.fillRect(0, 10, 16, 1);
  });
  const honey = canvasTexture(16, (ctx) => {
    fill(ctx, 16, "#e8a820");
    ctx.strokeStyle = "#b87a10";
    for (let y = 0; y < 16; y += 5) {
      for (let x = (y / 5) % 2 ? 2 : 0; x < 16; x += 6) {
        ctx.strokeRect(x, y, 5, 5);
      }
    }
  });
  const wool = (a, b) =>
    canvasTexture(16, (ctx, s) => {
      scatter(ctx, s, [a, b, a], 17);
    });
  const brick = canvasTexture(16, (ctx) => {
    fill(ctx, 16, "#9a5342");
    ctx.fillStyle = "#c9b8a6";
    for (let y = 0; y < 16; y += 4) {
      ctx.fillRect(0, y + 3, 16, 1);
      ctx.fillRect((y % 8 === 0 ? 0 : 8) + 7, y, 1, 4);
    }
  });
  const glass = canvasTexture(16, (ctx) => {
    ctx.fillStyle = "rgba(180, 220, 255, 0.22)";
    ctx.fillRect(0, 0, 16, 16);
    ctx.strokeStyle = "rgba(230, 245, 255, 0.85)";
    ctx.strokeRect(0.5, 0.5, 15, 15);
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(8, 16);
    ctx.moveTo(0, 8);
    ctx.lineTo(16, 8);
    ctx.stroke();
  });
  const quartz = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#ece6dc", "#e4ddd0", "#d8d0c4"], 6);
  });
  const spruce = canvasTexture(16, (ctx) => {
    const bands = ["#5c321b", "#6d3b20", "#482815", "#754226"];
    for (let y = 0; y < 16; y++) {
      ctx.fillStyle = bands[(y >> 2) % bands.length];
      ctx.fillRect(0, y, 16, 1);
    }
    ctx.fillStyle = "#2b170d";
    ctx.fillRect(0, 3, 16, 1);
    ctx.fillRect(0, 7, 16, 1);
    ctx.fillRect(0, 11, 16, 1);
    ctx.fillRect(0, 15, 16, 1);
    ctx.fillRect(6, 0, 1, 4);
    ctx.fillRect(11, 8, 1, 4);
  });
  const stoneBrick = canvasTexture(16, (ctx) => {
    fill(ctx, 16, "#777873");
    ctx.fillStyle = "#555852";
    for (let y = 0; y < 16; y += 4) {
      ctx.fillRect(0, y + 3, 16, 1);
      const seam = y % 8 === 0 ? 7 : 3;
      ctx.fillRect(seam, y, 1, 4);
      ctx.fillRect(seam + 8, y, 1, 4);
    }
    ctx.fillStyle = "#96978f";
    ctx.fillRect(1, 1, 5, 1);
    ctx.fillRect(9, 9, 4, 1);
  });
  const deepslate = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#303438", "#3c4145", "#25292c", "#4a4e50"], 31);
    ctx.fillStyle = "#1e2225";
    ctx.fillRect(2, 5, 6, 1);
    ctx.fillRect(9, 11, 5, 1);
  });
  const moss = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#4c8a28", "#6aab38", "#386f20", "#83c64a"], 41);
    ctx.fillStyle = "#a0d45d";
    ctx.fillRect(4, 3, 2, 2);
    ctx.fillRect(11, 9, 1, 3);
  });
  const magma = canvasTexture(16, (ctx, s) => {
    scatter(ctx, s, ["#3a1b13", "#5a2816", "#2b1714", "#ff7a16"], 51);
    ctx.fillStyle = "#ff9b21";
    ctx.fillRect(2, 7, 5, 1);
    ctx.fillRect(6, 4, 1, 4);
    ctx.fillRect(10, 11, 4, 1);
    ctx.fillRect(12, 8, 1, 4);
  });
  const flowerRed = canvasTexture(16, (ctx) => {
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = "#3d8b2e";
    ctx.fillRect(7, 7, 2, 9);
    ctx.fillStyle = "#d32f2f";
    ctx.fillRect(5, 2, 6, 6);
    ctx.fillStyle = "#ffeb3b";
    ctx.fillRect(7, 4, 2, 2);
  });
  const flowerYellow = canvasTexture(16, (ctx) => {
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = "#3d8b2e";
    ctx.fillRect(7, 7, 2, 9);
    ctx.fillStyle = "#f4c20d";
    ctx.fillRect(5, 2, 6, 6);
    ctx.fillStyle = "#fff59d";
    ctx.fillRect(7, 4, 2, 2);
  });

  const solid = (map, extras = {}) =>
    new THREE.MeshStandardMaterial({
      map,
      vertexColors: true,
      roughness: 0.86,
      metalness: 0.015,
      ...extras,
    });

  return {
    grass_top: solid(grassTop),
    grass_side: solid(grassSide),
    grass: solid(grassTop),
    dirt: solid(dirt),
    stone: solid(stone),
    cobble: solid(cobble),
    oak_plank: solid(plank),
    oak_log: solid(logSide),
    oak_log_top: solid(logTop),
    leaves: solid(leaves),
    gold: solid(gold, { roughness: 0.48, metalness: 0.28 }),
    lamp: new THREE.MeshStandardMaterial({
      map: lamp,
      emissive: 0xffb52e,
      emissiveMap: lamp,
      emissiveIntensity: 1.15,
      roughness: 0.45,
      vertexColors: true,
    }),
    lava: new THREE.MeshStandardMaterial({
      map: lava,
      emissive: 0xff3600,
      emissiveMap: lava,
      emissiveIntensity: 1.8,
      roughness: 0.72,
      vertexColors: true,
    }),
    water: new THREE.MeshPhysicalMaterial({
      map: water,
      color: 0x78a8ff,
      transparent: true,
      opacity: 0.68,
      roughness: 0.18,
      metalness: 0.08,
      clearcoat: 0.65,
      clearcoatRoughness: 0.2,
      depthWrite: false,
      vertexColors: true,
    }),
    sandstone: solid(sandstone),
    bookshelf: solid(bookshelf),
    honeycomb: solid(honey),
    wool_red: solid(wool("#b71c1c", "#c62828")),
    wool_white: solid(wool("#f5f5f5", "#e0e0e0")),
    brick: solid(brick),
    glass: new THREE.MeshPhysicalMaterial({
      map: glass,
      transparent: true,
      opacity: 0.36,
      roughness: 0.08,
      metalness: 0.02,
      clearcoat: 0.6,
      depthWrite: false,
      vertexColors: true,
    }),
    quartz: solid(quartz),
    spruce_plank: solid(spruce, { roughness: 0.9 }),
    stone_brick: solid(stoneBrick),
    deepslate: solid(deepslate, { roughness: 0.94 }),
    moss: solid(moss),
    magma: new THREE.MeshStandardMaterial({
      map: magma,
      emissive: 0xff4a00,
      emissiveMap: magma,
      emissiveIntensity: 1.65,
      roughness: 0.82,
      vertexColors: true,
    }),
    flower_red: new THREE.MeshStandardMaterial({
      map: flowerRed,
      transparent: true,
      alphaTest: 0.2,
      side: THREE.DoubleSide,
      roughness: 0.9,
    }),
    flower_yellow: new THREE.MeshStandardMaterial({
      map: flowerYellow,
      transparent: true,
      alphaTest: 0.2,
      side: THREE.DoubleSide,
      roughness: 0.9,
    }),
  };
}
