import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const FACES = [
  { dir: "px", n: [1, 0, 0], light: 0.78, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { dir: "nx", n: [-1, 0, 0], light: 0.78, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { dir: "py", n: [0, 1, 0], light: 1.0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { dir: "ny", n: [0, -1, 0], light: 0.58, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { dir: "pz", n: [0, 0, 1], light: 0.88, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { dir: "nz", n: [0, 0, -1], light: 0.88, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

export class VoxelWorld {
  constructor() {
    this.voxels = new Map();
    this.lights = [];
    this.bees = [];
    this.beeMeshes = [];
    this.group = new THREE.Group();
    this.animatedMaps = [];
  }

  key(x, y, z) {
    return `${x},${y},${z}`;
  }

  set(x, y, z, type, shape = "full") {
    this.voxels.set(this.key(x | 0, y | 0, z | 0), { type, shape });
  }

  get(x, y, z) {
    return this.voxels.get(this.key(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  solidAt(x, y, z) {
    const cell = this.get(x, y, z);
    return !!(cell && cell.shape !== "cross" && cell.type !== "water" && cell.type !== "lava");
  }

  opaqueAt(x, y, z) {
    const cell = this.get(x, y, z);
    return !!(
      cell &&
      cell.shape === "full" &&
      cell.type !== "water" &&
      cell.type !== "lava" &&
      cell.type !== "glass"
    );
  }

  addLight(x, y, z, color = 0xffd27a, intensity = 2.4, distance = 10) {
    if (this.lights.length >= 240) return;
    this.lights.push({ x, y, z, color, intensity, distance });
  }

  addBee(x, y, z) {
    this.bees.push({ x, y, z });
  }

  build(materials) {
    const buckets = new Map();
    const extras = [];

    for (const [key, voxel] of this.voxels) {
      const [x, y, z] = key.split(",").map(Number);
      if (voxel.shape === "cross" || voxel.shape === "fence") {
        extras.push({ x, y, z, ...voxel });
        continue;
      }
      const h = voxel.shape === "slab" ? 0.5 : 1;
      for (const face of FACES) {
        const [nx, ny, nz] = face.n;
        if (this.opaqueAt(x + nx, y + ny, z + nz) && voxel.shape === "full") continue;
        const matName = faceMaterial(voxel.type, face.dir);
        if (!buckets.has(matName)) {
          buckets.set(matName, { positions: [], normals: [], uvs: [], colors: [] });
        }
        pushFace(buckets.get(matName), x, y, z, h, face, this);
      }
    }

    for (const [matName, data] of buckets) {
      const material = materials[matName];
      if (!material || data.positions.length === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(data.normals, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(data.uvs, 2));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(data.colors, 3));
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = matName !== "water" && matName !== "glass";
      mesh.receiveShadow = matName !== "water";
      this.group.add(mesh);
    }

    for (const item of extras) {
      const material = materials[item.type];
      if (!material) continue;
      const geo = item.shape === "fence" ? fenceGeometry() : crossGeometry();
      if (material.vertexColors && !geo.getAttribute("color")) {
        const colors = new Float32Array(geo.getAttribute("position").count * 3);
        colors.fill(1);
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      }
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(item.x + 0.5, item.y + 0.5, item.z + 0.5);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    const lightStride = Math.max(1, Math.ceil(this.lights.length / 20));
    const selectedLights = this.lights.filter((_, index) => index % lightStride === 0).slice(0, 20);
    for (const light of selectedLights) {
      const point = new THREE.PointLight(light.color, light.intensity * 8.5, light.distance, 2);
      point.position.set(light.x + 0.5, light.y + 0.5, light.z + 0.5);
      this.group.add(point);
    }

    this.beeMeshes = [];
    for (const bee of this.bees) {
      const mesh = makeBee();
      mesh.position.set(bee.x + 0.5, bee.y + 0.8, bee.z + 0.5);
      mesh.userData.origin = mesh.position.clone();
      this.group.add(mesh);
      this.beeMeshes.push(mesh);
    }

    for (const name of ["water", "lava"]) {
      const map = materials[name]?.map;
      if (map && !this.animatedMaps.includes(map)) this.animatedMaps.push(map);
    }

    return this.group;
  }

  tick(time) {
    if (this.animatedMaps[0]) this.animatedMaps[0].offset.set(Math.sin(time * 0.08) * 0.035, time * 0.018);
    if (this.animatedMaps[1]) this.animatedMaps[1].offset.set(time * 0.025, Math.sin(time * 0.11) * 0.03);
    for (let i = 0; i < this.beeMeshes.length; i++) {
      const bee = this.beeMeshes[i];
      const o = bee.userData.origin;
      bee.position.x = o.x + Math.sin(time * 1.4 + i) * 1.2;
      bee.position.y = o.y + Math.sin(time * 2.2 + i * 0.7) * 0.35;
      bee.position.z = o.z + Math.cos(time * 1.1 + i) * 1.1;
      bee.rotation.y = time * 1.5 + i;
    }
  }
}

function faceMaterial(type, dir) {
  if (type === "grass") {
    if (dir === "py") return "grass_top";
    if (dir === "ny") return "dirt";
    return "grass_side";
  }
  if (type === "oak_log") {
    if (dir === "py" || dir === "ny") return "oak_log_top";
    return "oak_log";
  }
  return type;
}

function pushFace(bucket, x, y, z, h, face, world) {
  const [nx, ny, nz] = face.n;
  const uv = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
  ];
  const aos = face.corners.map(([cx, cy, cz]) => cornerAO(world, x, y, z, nx, ny, nz, cx, cy, cz));
  const idx = [0, 1, 2, 0, 2, 3];
  for (const i of idx) {
    const [cx, cy, cz] = face.corners[i];
    bucket.positions.push(x + cx, y + cy * h, z + cz);
    bucket.normals.push(nx, ny, nz);
    bucket.uvs.push(uv[i][0], uv[i][1]);
    const shade = face.light * aos[i];
    bucket.colors.push(shade, shade, shade);
  }
}

function cornerAO(world, x, y, z, nx, ny, nz, cx, cy, cz) {
  let s1 = false;
  let s2 = false;
  let c = false;
  if (nx !== 0) {
    const ox = x + (nx > 0 ? 1 : -1);
    s1 = world.opaqueAt(ox, y + (cy ? 1 : -1), z);
    s2 = world.opaqueAt(ox, y, z + (cz ? 1 : -1));
    c = world.opaqueAt(ox, y + (cy ? 1 : -1), z + (cz ? 1 : -1));
  } else if (ny !== 0) {
    const oy = y + (ny > 0 ? 1 : -1);
    s1 = world.opaqueAt(x + (cx ? 1 : -1), oy, z);
    s2 = world.opaqueAt(x, oy, z + (cz ? 1 : -1));
    c = world.opaqueAt(x + (cx ? 1 : -1), oy, z + (cz ? 1 : -1));
  } else {
    const oz = z + (nz > 0 ? 1 : -1);
    s1 = world.opaqueAt(x + (cx ? 1 : -1), y, oz);
    s2 = world.opaqueAt(x, y + (cy ? 1 : -1), oz);
    c = world.opaqueAt(x + (cx ? 1 : -1), y + (cy ? 1 : -1), oz);
  }
  if (s1 && s2) return 0.62;
  return 1 - (Number(s1) + Number(s2) + Number(c)) * 0.12;
}

function crossGeometry() {
  const a = new THREE.PlaneGeometry(1, 1);
  const b = new THREE.PlaneGeometry(1, 1);
  b.rotateY(Math.PI / 2);
  const merged = mergeGeometries([a, b]);
  a.dispose();
  b.dispose();
  return merged;
}

function fenceGeometry() {
  const pieces = [new THREE.BoxGeometry(0.18, 1, 0.18)];
  for (const y of [-0.12, 0.22]) {
    const railX = new THREE.BoxGeometry(0.86, 0.14, 0.14);
    const railZ = new THREE.BoxGeometry(0.14, 0.14, 0.86);
    railX.translate(0, y, 0);
    railZ.translate(0, y, 0);
    pieces.push(railX, railZ);
  }
  const merged = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  return merged;
}

function makeBee() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.28, 0.2, 0.42),
    new THREE.MeshBasicMaterial({ color: 0xf2c14e }),
  );
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.22, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x222222 }),
  );
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.04, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xf2f7ff, transparent: true, opacity: 0.7 }),
  );
  wing.position.y = 0.14;
  g.add(body, stripe, wing);
  return g;
}
