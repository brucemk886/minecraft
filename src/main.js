import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { ParkourPlayer } from "./player.js";
import { ClipRecorder } from "./recorder.js";
import { RealMinecraftRecorder } from "./minecraft.js";
import {
  MINECRAFT_BASE_THEMES,
  MINECRAFT_TEMPLATES,
  minecraftDailyTemplateOffset,
  minecraftTemplateForBatchIndex,
} from "./minecraft-templates.js";
import { buildCourse, themeFog, themeSky } from "./themes.js";
import { createMaterials } from "./textures.js";
import { VoxelWorld } from "./world.js";

const canvas = document.querySelector("#view");
const realCanvas = document.querySelector("#realView");
const phone = document.querySelector("#phone");
const statusEl = document.querySelector("#status");
const hint = document.querySelector("#hint");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(76, 9 / 16, 0.08, 220);
const clock = new THREE.Clock();
const recorder = new ClipRecorder(canvas, setStatus);
const minecraftRecorder = new RealMinecraftRecorder(realCanvas, setStatus);
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(720, 1280), 0.2, 0.28, 0.94);
const gradePass = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, 1.1);
      color = (color - 0.18) * 1.035 + 0.18;
      float edge = smoothstep(0.42, 0.88, length((vUv - 0.5) * vec2(0.72, 1.0)));
      color *= mix(1.0, 0.86, edge);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const outputPass = new OutputPass();
const composer = new EffectComposer(renderer);
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(gradePass);
composer.addPass(outputPass);

const LIGHTING = {
  village: { sun: 2.35, hemi: 1.15, fill: 0.06, sunColor: 0xfff1cf, ground: 0x6b5335 },
  library: { sun: 0.48, hemi: 0.74, fill: 8.5, sunColor: 0xffd49a, ground: 0x4a3526 },
  canyon: { sun: 2.5, hemi: 1.12, fill: 0.08, sunColor: 0xffdfaa, ground: 0x71401f },
  cave: { sun: 0.16, hemi: 0.82, fill: 13.5, sunColor: 0xffc070, ground: 0x3b393d },
  checker: { sun: 2.25, hemi: 1.08, fill: 0.1, sunColor: 0xffedca, ground: 0x5b4635 },
  honey: { sun: 0.22, hemi: 0.72, fill: 10.5, sunColor: 0xffb43c, ground: 0x4b321b },
  sunset: { sun: 2.2, hemi: 0.95, fill: 0.16, sunColor: 0xffa85a, ground: 0x5a2d29 },
};

let world = null;
let player = null;
let running = false;
let lighting = null;
let atmosphere = null;
let activeTheme = null;
let minecraftAutomationRunning = false;
let minecraftAutomationCancelled = false;
let scheduledRecording = null;
let scheduleTickTimer = 0;
let batchCheckpoint = null;
let pendingBatchResume = null;
const MINECRAFT_ITEM_ATTEMPTS = 3;
const RECORDING_SCHEDULE_KEY = "parkoursim-recording-schedule-v1";
const BATCH_CHECKPOINT_KEY = "parkoursim-batch-checkpoint-v1";
const PARKOUR_HEALTH_POLL_MS = 2000;
const PARKOUR_HEARTBEAT_TIMEOUT_MS = 60_000;
const PARKOUR_VISUAL_FREEZE_TIMEOUT_MS = 60_000;
const BATCH_MAINTENANCE_INTERVAL = 50;
const BATCH_MAINTENANCE_DELAY_MS = 8_000;
const forward = new THREE.Vector3();
const profileColor = new THREE.Color();

function setStatus(text) {
  statusEl.textContent = text;
}

function fatalBatchError(message, openLauncher = true) {
  const error = new Error(message);
  error.fatalBatch = true;
  error.openLauncher = openLauncher;
  return error;
}

async function ensureRecordingStorage() {
  const storage = await window.desktop.getRecordingStorageStatus?.().catch(() => null);
  if (storage?.supported && storage.safe === false) {
    throw fatalBatchError(
      `视频盘仅剩 ${Number(storage.freeGigabytes).toFixed(1)} GB，低于 20 GB 安全线；任务已暂停并保留断点`,
      false,
    );
  }
  return storage;
}

async function performBatchMaintenance(completedIndex, batchCount) {
  if (completedIndex >= batchCount || completedIndex % BATCH_MAINTENANCE_INTERVAL !== 0) return;
  setStatus(`已完成 ${completedIndex}/${batchCount} 条：正在进行 8 秒资源维护，释放录屏源和旧任务…`);
  await window.desktop.stopParkourJob().catch(() => {});
  await minecraftRecorder.close(false).catch(() => {});
  await delay(BATCH_MAINTENANCE_DELAY_MS);
  const runtime = await window.desktop.getMinecraftStatus?.().catch(() => null);
  if (runtime && runtime.running === false) {
    throw fatalBatchError("资源维护时发现 Minecraft 已退出；断点已保留，并已尝试打开 Launcher");
  }
  await ensureRecordingStorage();
}

function failedBatchItem(index, theme, error) {
  return {
    index,
    theme,
    error: String(error?.message || error || "未知异常"),
    failedAt: Date.now(),
  };
}

function upsertFailedBatchItem(items, item) {
  return [...items.filter((current) => current.index !== item.index), item]
    .sort((left, right) => left.index - right.index);
}

function sizeRenderer() {
  const vertical = document.querySelector("#aspect").value === "vertical";
  const res = Number(document.querySelector("#resolution").value);
  const width = vertical ? res : Math.round((res * 16) / 9);
  const height = vertical ? Math.round((res * 16) / 9) : res;
  renderer.setSize(width, height, false);
  realCanvas.width = width;
  realCanvas.height = height;
  composer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  phone.classList.toggle("landscape", !vertical);
}

function clearWorld() {
  player?.destroy();
  player = null;
  if (world) {
    scene.remove(world.group);
    const materials = new Set();
    world.group.traverse((object) => {
      object.geometry?.dispose();
      if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material));
      else if (object.material) materials.add(object.material);
    });
    materials.forEach((material) => material.dispose());
    world = null;
  }
  if (lighting) {
    scene.remove(lighting.group);
    lighting = null;
  }
  if (atmosphere) {
    scene.remove(atmosphere);
    atmosphere.geometry.dispose();
    atmosphere.material.dispose();
    atmosphere = null;
  }
  activeTheme = null;
}

function createLighting(theme) {
  const group = new THREE.Group();
  const profile = LIGHTING[theme] || LIGHTING.village;
  const hemi = new THREE.HemisphereLight(0xcfe9ff, profile.ground, profile.hemi);
  const sun = new THREE.DirectionalLight(profile.sunColor, profile.sun);
  const target = new THREE.Object3D();
  const fill = new THREE.PointLight(0xffc98a, profile.fill, 11, 2);

  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -15;
  sun.shadow.camera.right = 15;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -12;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 72;
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.025;
  sun.shadow.intensity = 0.68;
  sun.target = target;
  group.add(hemi, sun, target, fill);
  scene.add(group);
  return { group, hemi, sun, target, fill };
}

function createAtmosphere(theme) {
  const base = new THREE.Color(themeSky(theme));
  const top = base.clone().offsetHSL(0.015, 0.12, 0.015);
  const bottom = base.clone().offsetHSL(-0.015, -0.04, 0.09);
  if (["cave", "honey", "library"].includes(theme)) {
    top.multiplyScalar(0.2);
    bottom.multiplyScalar(0.12);
  }
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: top },
      bottomColor: { value: bottom },
      sunColor: { value: new THREE.Color(0xfff0bd) },
      sunDirection: { value: new THREE.Vector3(-0.3, 0.55, -0.7).normalize() },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDirection;
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      void main() {
        float horizon = smoothstep(-0.18, 0.78, vDirection.y);
        vec3 color = mix(bottomColor, topColor, horizon);
        float sun = pow(max(dot(normalize(vDirection), sunDirection), 0.0), 420.0);
        float glow = pow(max(dot(normalize(vDirection), sunDirection), 0.0), 18.0) * 0.12;
        color += sunColor * (sun * 3.0 + glow);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 18), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  scene.add(mesh);
  return mesh;
}

function applyEnvironment(theme, dt, immediate = false) {
  const profile = LIGHTING[theme] || LIGHTING.village;
  const response = immediate ? 1 : 1 - Math.exp(-2.2 * dt);
  const sky = new THREE.Color(themeSky(theme));
  const fog = themeFog(theme);

  scene.background.lerp(sky, response);
  scene.fog.color.lerp(sky, response);
  scene.fog.near = THREE.MathUtils.lerp(scene.fog.near, fog.near, response);
  scene.fog.far = THREE.MathUtils.lerp(scene.fog.far, fog.far, response);
  lighting.sun.intensity = THREE.MathUtils.lerp(lighting.sun.intensity, profile.sun, response);
  lighting.hemi.intensity = THREE.MathUtils.lerp(lighting.hemi.intensity, profile.hemi, response);
  lighting.fill.intensity = THREE.MathUtils.lerp(lighting.fill.intensity, profile.fill, response);
  profileColor.set(profile.sunColor);
  lighting.sun.color.lerp(profileColor, response);
  profileColor.set(profile.ground);
  lighting.hemi.groundColor.lerp(profileColor, response);

  const top = sky.clone().offsetHSL(0.015, 0.12, 0.015);
  const bottom = sky.clone().offsetHSL(-0.015, -0.04, 0.09);
  if (["cave", "honey", "library"].includes(theme)) {
    top.multiplyScalar(0.2);
    bottom.multiplyScalar(0.12);
  }
  atmosphere.material.uniforms.topColor.value.lerp(top, response);
  atmosphere.material.uniforms.bottomColor.value.lerp(bottom, response);
}

function startGame(shouldRecord) {
  if (document.querySelector("#engine").value === "minecraft") {
    return startMinecraft(shouldRecord).catch(async (error) => {
      await setRecordingKeepAwake(Boolean(scheduledRecording));
      console.error(error);
      setStatus(minecraftAutomationCancelled ? "已停止" : `真实画面启动失败：${error.message || error}`);
    });
  }
  try {
    startGameUnsafe(shouldRecord);
  } catch (error) {
    console.error(error);
    setStatus(`启动失败：${error.message || error}`);
  }
}

async function startMinecraft(shouldRecord) {
  running = false;
  clearWorld();
  sizeRenderer();
  canvas.classList.add("hidden");
  realCanvas.classList.remove("hidden");
  hint.classList.add("hidden");
  const resume = shouldRecord ? pendingBatchResume : null;
  pendingBatchResume = null;
  const theme = resume?.theme || document.querySelector("#realTheme").value;
  if (window.desktop?.setMinecraftTheme) await window.desktop.setMinecraftTheme(theme);
  if (!shouldRecord) {
    setStatus("正在连接 Minecraft 游戏窗口…");
    await minecraftRecorder.start({
      record: false,
      seconds: 0,
      width: realCanvas.width,
      height: realCanvas.height,
      theme,
    });
    return;
  }

  if (minecraftAutomationRunning) throw new Error("自动录制任务已在运行");
  if (!window.desktop?.startParkourJob || !window.desktop?.getParkourStatus) {
    throw new Error("当前 EXE 缺少自动地图控制组件");
  }

  await setRecordingKeepAwake(true);
  minecraftAutomationRunning = true;
  minecraftAutomationCancelled = false;
  const recordButton = document.querySelector("#btnRecord");
  recordButton.disabled = true;
  const seconds = resume?.seconds || Number(document.querySelector("#realDuration").value);
  const requestedBatchCount = resume?.batchCount ?? Math.floor(Number(document.querySelector("#realBatchCount").value));
  const batchCount = Math.max(1, Math.min(999, Number.isFinite(requestedBatchCount) ? requestedBatchCount : 1));
  const startIndex = Math.max(1, Math.min(batchCount + 1, Number(resume?.nextIndex) || 1));
  const templateOffset = Number.isInteger(resume?.templateOffset)
    ? resume.templateOffset
    : minecraftDailyTemplateOffset();
  let failedItems = normalizeFailedBatchItems(resume?.failedItems, batchCount);
  document.querySelector("#realBatchCount").value = String(batchCount);
  saveBatchCheckpoint({
    theme,
    seconds,
    batchCount,
    nextIndex: startIndex,
    templateOffset,
    failedItems,
    state: "running",
    lastError: "",
  });
  try {
    for (let index = startIndex; index <= batchCount; index++) {
      if (minecraftAutomationCancelled) break;
      saveBatchCheckpoint({
        theme,
        seconds,
        batchCount,
        nextIndex: index,
        templateOffset,
        failedItems,
        state: "running",
        lastError: "",
      });
      const itemTheme = theme === "random"
        ? minecraftTemplateForBatchIndex(index, templateOffset).id
        : theme;
      const result = await recordMinecraftItemWithRetries({
        index,
        batchCount,
        theme: itemTheme,
        seconds,
        phase: "主队列",
      });
      if (minecraftAutomationCancelled) break;
      if (!result.completed) {
        failedItems = upsertFailedBatchItem(failedItems, failedBatchItem(index, itemTheme, result.error));
        setStatus(`第 ${index}/${batchCount} 条已记入补跑队列，继续下一条…`);
      } else {
        failedItems = failedItems.filter((item) => item.index !== index);
      }
      saveBatchCheckpoint({
        theme,
        seconds,
        batchCount,
        nextIndex: index + 1,
        templateOffset,
        failedItems,
        state: "running",
        lastError: result.completed ? "" : `第 ${index} 条等待批次末尾补跑`,
      });
      await performBatchMaintenance(index, batchCount);
    }
    if (minecraftAutomationCancelled) {
      clearBatchCheckpoint(false);
    } else if (failedItems.length > 0) {
      const retryQueue = [...failedItems];
      const stillFailed = [];
      for (let position = 0; position < retryQueue.length; position++) {
        const item = retryQueue[position];
        saveBatchCheckpoint({
          theme,
          seconds,
          batchCount,
          nextIndex: batchCount + 1,
          templateOffset,
          failedItems: [...stillFailed, ...retryQueue.slice(position)],
          state: "running",
          lastError: `正在补跑第 ${item.index} 条`,
        });
        const result = await recordMinecraftItemWithRetries({
          index: item.index,
          batchCount,
          theme: item.theme,
          seconds,
          phase: `补跑 ${position + 1}/${retryQueue.length}`,
        });
        if (minecraftAutomationCancelled) break;
        if (!result.completed) {
          stillFailed.push(failedBatchItem(item.index, item.theme, result.error));
        }
      }
      failedItems = stillFailed;
      if (minecraftAutomationCancelled) {
        clearBatchCheckpoint(false);
      } else if (failedItems.length > 0) {
        saveBatchCheckpoint({
          theme,
          seconds,
          batchCount,
          nextIndex: batchCount + 1,
          templateOffset,
          failedItems,
          state: "paused",
          lastError: `主队列已完成，仍有 ${failedItems.length} 条补跑失败`,
        });
        setStatus(`主队列已完成；${failedItems.length} 条仍失败，断点已保留，可稍后继续补跑`);
      } else {
        clearBatchCheckpoint(false);
        setStatus(`自动批量录制完成，共 ${batchCount} 条；失败条目已全部补跑成功`);
      }
    } else {
      clearBatchCheckpoint(false);
      setStatus(`自动批量录制完成，共 ${batchCount} 条，已保存到指定目录`);
    }
  } catch (error) {
    pauseBatchCheckpoint(error);
    await window.desktop.stopParkourJob().catch(() => {});
    if (error?.fatalBatch && error.openLauncher !== false) {
      await window.desktop.openMinecraftLauncher?.().catch(() => {});
    }
    throw error;
  } finally {
    if (minecraftRecorder.recording) {
      const saving = minecraftRecorder.stop();
      if (saving) await saving.catch(() => {});
    }
    await window.desktop.stopParkourJob().catch(() => {});
    await minecraftRecorder.close(false).catch(() => {});
    minecraftAutomationRunning = false;
    recordButton.disabled = false;
    await setRecordingKeepAwake(Boolean(scheduledRecording));
  }
}

async function recordMinecraftItemWithRetries({ index, batchCount, theme, seconds, phase }) {
  let lastError = null;
  for (let attempt = 1; attempt <= MINECRAFT_ITEM_ATTEMPTS; attempt++) {
    if (minecraftAutomationCancelled) return { completed: false, error: new Error("用户已停止任务") };
    try {
      const completed = await recordMinecraftBatchItem({ index, batchCount, theme, seconds });
      if (completed) return { completed: true, error: null };
      lastError = new Error("录制未达到预定时长");
    } catch (error) {
      lastError = error;
      await minecraftRecorder.close(false).catch(() => {});
      if (error?.fatalBatch) throw error;
    }
    if (minecraftAutomationCancelled) break;
    if (attempt < MINECRAFT_ITEM_ATTEMPTS) {
      setStatus(`${phase}第 ${index}/${batchCount} 条中断，正在自动重试 ${attempt + 1}/${MINECRAFT_ITEM_ATTEMPTS}…`);
      await delay(1500 * attempt);
    }
  }
  return { completed: false, error: lastError || new Error("未知录制错误") };
}

async function recordMinecraftBatchItem({ index, batchCount, theme, seconds }) {
  let jobStarted = false;
  try {
    await ensureRecordingStorage();
    setStatus(`第 ${index}/${batchCount} 条：正在创建全新随机路线…`);
    const job = await window.desktop.startParkourJob({ theme, durationSeconds: seconds, batchIndex: index });
    jobStarted = true;
    const director = await waitForParkourReady(job.jobId, index, batchCount);
    if (minecraftAutomationCancelled) return false;

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const resolvedTheme = director.theme || job.theme;
    const fileName = `minecraft-parkour-${resolvedTheme}-${stamp}.webm`;
    const capture = await minecraftRecorder.start({
      record: true,
      seconds: 0,
      width: realCanvas.width,
      height: realCanvas.height,
      fileName,
      keepSource: true,
      theme: resolvedTheme,
    });
    setStatus(`第 ${index}/${batchCount} 条正在录制 ${Math.round(seconds / 60)} 分钟：${director.themeName || resolvedTheme}`);
    const completedDuration = await waitForRecordingDuration(
      seconds * 1000,
      capture.completion,
      job.jobId,
      index,
      batchCount,
    );
    const saving = minecraftRecorder.stop();
    await window.desktop.stopParkourJob().catch(() => {});
    jobStarted = false;
    const saved = saving ? await saving : null;
    if (completedDuration && saved?.filePath) {
      setStatus(`第 ${index}/${batchCount} 条：正在抽取 5 帧检查近 30 天画面重复度…`);
      const review = await window.desktop.completeParkourJob({
        jobId: job.jobId,
        filePath: saved.filePath,
      });
      if (!review.accepted) {
        throw new Error(`画面与近期视频过于相似（${Math.round(review.similarity * 100)}%），已移入 _similar-review 并自动换路线重录`);
      }
    }
    return completedDuration;
  } catch (error) {
    if (minecraftRecorder.recording) await minecraftRecorder.discard().catch(() => {});
    throw error;
  } finally {
    if (jobStarted) await window.desktop.stopParkourJob().catch(() => {});
  }
}

async function waitForParkourReady(jobId, index, total) {
  const deadline = Date.now() + 240_000;
  let lastRuntimeCheck = 0;
  while (Date.now() < deadline) {
    if (minecraftAutomationCancelled) throw new Error("用户已停止任务");
    const state = await window.desktop.getParkourStatus();
    if (state.jobId === jobId) {
      if (state.state === "running") return state;
      if (state.state === "error") throw new Error(state.detail || "Minecraft 路线生成失败");
      const built = Number(state.builtStages || 0);
      const target = Number(state.targetStages || 0);
      setStatus(`第 ${index}/${total} 条：Minecraft 正在预生成开头场景 ${built}/${Math.min(4, target || 4)}，就绪后自动录制…`);
    } else {
      setStatus(`第 ${index}/${total} 条：等待 Minecraft 接收任务，请保持在单人世界内…`);
    }
    if (Date.now() - lastRuntimeCheck >= 10_000) {
      lastRuntimeCheck = Date.now();
      const runtime = await window.desktop.getMinecraftStatus?.().catch(() => null);
      if (runtime && runtime.running === false) {
        throw fatalBatchError("Minecraft 游戏已经退出；任务断点已保留，并已尝试打开 Launcher");
      }
    }
    await delay(500);
  }
  throw new Error("等待 Minecraft 地图就绪超时，请确认已使用 Fabric 26.2 进入单人世界");
}

async function monitorParkourRecording(jobId, milliseconds, itemIndex, batchCount, signal) {
  const deadline = Date.now() + milliseconds;
  let lastElapsedSeconds = -1;
  let lastProgressAt = Date.now();
  while (Date.now() < deadline) {
    if (signal.aborted) return false;
    if (minecraftAutomationCancelled) return false;
    const state = await window.desktop.getParkourStatus();
    if (state.jobId !== jobId) throw new Error("Minecraft 跑酷任务心跳已切换或丢失");
    const heartbeatAge = Number(state.statusFileAgeMs);
    if (!Number.isFinite(heartbeatAge) || heartbeatAge > PARKOUR_HEARTBEAT_TIMEOUT_MS) {
      const runtime = await window.desktop.getMinecraftStatus?.().catch(() => null);
      if (runtime && runtime.running === false) {
        throw fatalBatchError("Minecraft 游戏已经退出；任务断点已保留，并已尝试打开 Launcher");
      }
      throw new Error(`Minecraft 心跳超过 ${PARKOUR_HEARTBEAT_TIMEOUT_MS / 1000} 秒未更新`);
    }
    if (["error", "stopped", "finished"].includes(state.state)) {
      throw new Error(state.detail || `Minecraft 跑酷任务提前进入 ${state.state} 状态`);
    }
    const statusElapsedSeconds = Number(state.elapsedSeconds);
    const heartbeatElapsedSeconds = Number(state.heartbeatElapsedSeconds);
    const elapsedSeconds = Math.max(
      Number.isFinite(statusElapsedSeconds) ? statusElapsedSeconds : -1,
      Number.isFinite(heartbeatElapsedSeconds) ? heartbeatElapsedSeconds : -1,
    );
    if (Number.isFinite(elapsedSeconds) && elapsedSeconds > lastElapsedSeconds) {
      lastElapsedSeconds = elapsedSeconds;
      lastProgressAt = Date.now();
    }
    if (Date.now() - lastProgressAt > PARKOUR_HEARTBEAT_TIMEOUT_MS) {
      throw new Error(`Minecraft 跑酷进度连续 ${PARKOUR_HEARTBEAT_TIMEOUT_MS / 1000} 秒没有前进`);
    }
    const visualIdle = minecraftRecorder.visualIdleMilliseconds();
    if (visualIdle > PARKOUR_VISUAL_FREEZE_TIMEOUT_MS) {
      throw new Error(`Minecraft 画面连续 ${PARKOUR_VISUAL_FREEZE_TIMEOUT_MS / 1000} 秒静止`);
    }
    const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setStatus(`第 ${itemIndex}/${batchCount} 条运行正常：已录制 ${Math.max(0, elapsedSeconds || 0)} 秒，剩余约 ${remainingSeconds} 秒`);
    await delay(PARKOUR_HEALTH_POLL_MS);
  }
  return true;
}

async function waitForRecordingDuration(milliseconds, completion, jobId, itemIndex, batchCount) {
  const controller = new AbortController();
  try {
    return await Promise.race([
      monitorParkourRecording(jobId, milliseconds, itemIndex, batchCount, controller.signal),
      Promise.resolve(completion).then(() => {
        if (minecraftAutomationCancelled) return false;
        throw new Error("Minecraft 窗口录制在预定时长前意外结束");
      }),
    ]);
  } finally {
    controller.abort();
  }
}

function currentRecordingParameters() {
  const requestedBatchCount = Math.floor(Number(document.querySelector("#realBatchCount").value));
  return {
    theme: document.querySelector("#realTheme").value,
    seconds: Number(document.querySelector("#realDuration").value),
    batchCount: Math.max(1, Math.min(999, Number.isFinite(requestedBatchCount) ? requestedBatchCount : 1)),
  };
}

function initializeMinecraftTemplateOptions() {
  const select = document.querySelector("#realTheme");
  const randomOption = document.createElement("option");
  randomOption.value = "random";
  randomOption.textContent = "每日轮换 60 个主题 · 300 套模板";
  select.replaceChildren(randomOption);
  for (const baseTheme of MINECRAFT_BASE_THEMES) {
    const group = document.createElement("optgroup");
    group.label = baseTheme.name;
    for (const template of MINECRAFT_TEMPLATES.filter((item) => item.baseTheme === baseTheme.id)) {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name;
      group.append(option);
    }
    select.append(group);
  }
  select.value = "random";
}

function localDateTimeValue(timestamp) {
  const date = new Date(timestamp);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatCountdown(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours} 小时 ${minutes} 分` : minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
}

async function setRecordingKeepAwake(enabled) {
  if (!window.desktop?.setKeepAwake) return;
  try {
    await window.desktop.setKeepAwake(Boolean(enabled));
  } catch (error) {
    console.warn("设置后台运行状态失败", error);
  }
}

function updateScheduleUi() {
  const scheduleStatus = document.querySelector("#scheduleStatus");
  const cancelButton = document.querySelector("#btnCancelSchedule");
  cancelButton.disabled = !scheduledRecording;
  if (!scheduledRecording) {
    scheduleStatus.textContent = "到点自动使用上面的主题、时长和条数开始。请保持本程序和 Minecraft 单人世界打开，不要锁屏。";
    return;
  }
  const themeSelect = document.querySelector("#realTheme");
  const themeName = themeSelect.querySelector(`option[value="${scheduledRecording.theme}"]`)?.textContent || scheduledRecording.theme;
  const at = new Date(scheduledRecording.startAt).toLocaleString("zh-CN", { hour12: false });
  scheduleStatus.textContent = `已预约 ${at}，还有 ${formatCountdown(scheduledRecording.startAt - Date.now())}；${themeName}，${Math.round(scheduledRecording.seconds / 60)} 分钟 × ${scheduledRecording.batchCount} 条。`;
}

async function cancelRecordingSchedule(announce = true) {
  scheduledRecording = null;
  window.localStorage.removeItem(RECORDING_SCHEDULE_KEY);
  updateScheduleUi();
  if (!minecraftAutomationRunning) await setRecordingKeepAwake(false);
  if (announce) setStatus("已取消定时录制");
}

async function armRecordingSchedule() {
  const input = document.querySelector("#scheduledStartAt");
  const startAt = new Date(input.value).getTime();
  if (!Number.isFinite(startAt) || startAt <= Date.now() + 10_000) {
    setStatus("请选择至少 10 秒后的开始时间");
    return;
  }
  const params = currentRecordingParameters();
  scheduledRecording = { startAt, ...params };
  document.querySelector("#realBatchCount").value = String(params.batchCount);
  window.localStorage.setItem(RECORDING_SCHEDULE_KEY, JSON.stringify(scheduledRecording));
  await setRecordingKeepAwake(true);
  updateScheduleUi();
  setStatus("定时录制已设置，到点会自动开始整批任务");
}

function applyScheduledParameters(task) {
  document.querySelector("#engine").value = "minecraft";
  document.querySelector("#realTheme").value = task.theme;
  document.querySelector("#realDuration").value = String(task.seconds);
  document.querySelector("#realBatchCount").value = String(task.batchCount);
  applyEngineMode();
}

function tickRecordingSchedule() {
  if (!scheduledRecording) return;
  if (scheduledRecording.startAt > Date.now()) {
    updateScheduleUi();
    return;
  }
  const task = scheduledRecording;
  scheduledRecording = null;
  window.localStorage.removeItem(RECORDING_SCHEDULE_KEY);
  updateScheduleUi();
  if (minecraftAutomationRunning) {
    setStatus("定时时间已到，但已有录制任务正在运行，本次定时已跳过");
    return;
  }
  clearBatchCheckpoint(false);
  applyScheduledParameters(task);
  setStatus("定时时间已到，正在自动开始生成并录制…");
  startGame(true);
}

function initializeRecordingSchedule() {
  const input = document.querySelector("#scheduledStartAt");
  const rounded = Math.ceil((Date.now() + 10 * 60_000) / (5 * 60_000)) * 5 * 60_000;
  input.value = localDateTimeValue(rounded);
  try {
    const restored = JSON.parse(window.localStorage.getItem(RECORDING_SCHEDULE_KEY) || "null");
    if (restored && Number(restored.startAt) > Date.now()) {
      scheduledRecording = restored;
      input.value = localDateTimeValue(restored.startAt);
      setRecordingKeepAwake(true);
    } else {
      window.localStorage.removeItem(RECORDING_SCHEDULE_KEY);
    }
  } catch {
    window.localStorage.removeItem(RECORDING_SCHEDULE_KEY);
  }
  updateScheduleUi();
  window.clearInterval(scheduleTickTimer);
  scheduleTickTimer = window.setInterval(tickRecordingSchedule, 1000);
}

function normalizeFailedBatchItems(value, batchCount) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  for (const item of value.slice(0, batchCount)) {
    const index = Math.floor(Number(item?.index));
    const theme = String(item?.theme || "").trim().toLowerCase();
    if (index < 1 || index > batchCount) continue;
    if (!document.querySelector(`#realTheme option[value="${theme}"]`)) continue;
    normalized.push({
      index,
      theme,
      error: String(item?.error || "未知异常"),
      failedAt: Number(item?.failedAt) || Date.now(),
    });
  }
  return [...new Map(normalized.map((item) => [item.index, item])).values()]
    .sort((left, right) => left.index - right.index);
}

function normalizeBatchCheckpoint(value) {
  if (!value || typeof value !== "object") return null;
  const theme = String(value.theme || "");
  const seconds = Number(value.seconds);
  const batchCount = Math.max(1, Math.min(999, Math.floor(Number(value.batchCount)) || 1));
  const nextIndex = Math.max(1, Math.floor(Number(value.nextIndex)) || 1);
  const templateOffset = ((Math.floor(Number(value.templateOffset)) || 0) % MINECRAFT_TEMPLATES.length
    + MINECRAFT_TEMPLATES.length) % MINECRAFT_TEMPLATES.length;
  const validTheme = Boolean(document.querySelector(`#realTheme option[value="${theme}"]`));
  const validDuration = Boolean(document.querySelector(`#realDuration option[value="${seconds}"]`));
  if (!validTheme || !validDuration || nextIndex > batchCount + 1) return null;
  return {
    theme,
    seconds,
    batchCount,
    nextIndex,
    templateOffset,
    failedItems: normalizeFailedBatchItems(value.failedItems, batchCount),
    state: value.state === "paused" ? "paused" : "running",
    lastError: String(value.lastError || ""),
    updatedAt: Number(value.updatedAt) || Date.now(),
  };
}

function updateBatchRecoveryUi() {
  const resumeButton = document.querySelector("#btnResumeBatch");
  const discardButton = document.querySelector("#btnDiscardBatch");
  const recoveryStatus = document.querySelector("#batchRecoveryStatus");
  const canManage = Boolean(batchCheckpoint) && !minecraftAutomationRunning;
  resumeButton.disabled = !canManage;
  discardButton.disabled = !canManage;
  if (!batchCheckpoint) {
    recoveryStatus.textContent = "暂无未完成的批量任务。";
    return;
  }
  const themeName = document.querySelector(`#realTheme option[value="${batchCheckpoint.theme}"]`)?.textContent || batchCheckpoint.theme;
  const prefix = minecraftAutomationRunning
    ? "断点保护中"
    : batchCheckpoint.state === "paused"
      ? "任务已暂停"
      : "检测到上次异常中断";
  const reason = batchCheckpoint.lastError ? `；原因：${batchCheckpoint.lastError}` : "";
  const progress = batchCheckpoint.nextIndex > batchCheckpoint.batchCount
    ? `主队列已完成，将补跑 ${batchCheckpoint.failedItems.length} 条失败任务`
    : `将从第 ${batchCheckpoint.nextIndex}/${batchCheckpoint.batchCount} 条继续`;
  recoveryStatus.textContent = `${prefix}：${progress}，${themeName}${reason}`;
}

function saveBatchCheckpoint(value) {
  const checkpoint = normalizeBatchCheckpoint({ ...value, updatedAt: Date.now() });
  if (!checkpoint) {
    clearBatchCheckpoint(false);
    return;
  }
  batchCheckpoint = checkpoint;
  window.localStorage.setItem(BATCH_CHECKPOINT_KEY, JSON.stringify(checkpoint));
  updateBatchRecoveryUi();
}

function pauseBatchCheckpoint(error) {
  if (!batchCheckpoint) return;
  saveBatchCheckpoint({
    ...batchCheckpoint,
    state: "paused",
    lastError: String(error?.message || error || "未知异常"),
  });
}

function clearBatchCheckpoint(announce = true) {
  batchCheckpoint = null;
  window.localStorage.removeItem(BATCH_CHECKPOINT_KEY);
  updateBatchRecoveryUi();
  if (announce) setStatus("已放弃未完成的批量任务断点");
}

function resumeBatchFromCheckpoint() {
  if (!batchCheckpoint || minecraftAutomationRunning) return;
  pendingBatchResume = { ...batchCheckpoint };
  applyScheduledParameters(batchCheckpoint);
  setStatus(batchCheckpoint.nextIndex > batchCheckpoint.batchCount
    ? `正在恢复 ${batchCheckpoint.failedItems.length} 条补跑任务…`
    : `正在从第 ${batchCheckpoint.nextIndex}/${batchCheckpoint.batchCount} 条恢复任务…`);
  startGame(true);
}

function initializeBatchRecovery() {
  try {
    batchCheckpoint = normalizeBatchCheckpoint(JSON.parse(window.localStorage.getItem(BATCH_CHECKPOINT_KEY) || "null"));
  } catch {
    batchCheckpoint = null;
  }
  if (!batchCheckpoint) window.localStorage.removeItem(BATCH_CHECKPOINT_KEY);
  updateBatchRecoveryUi();
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, milliseconds)));
}

function startGameUnsafe(shouldRecord) {
  realCanvas.classList.add("hidden");
  canvas.classList.remove("hidden");
  clearWorld();
  sizeRenderer();

  const theme = document.querySelector("#theme").value;
  const mode = document.querySelector("#mode").value;
  const seed = document.querySelector("#seed").value || "parkour";

  world = new VoxelWorld();
  const platforms = buildCourse(world, { theme, seed });
  const materials = createMaterials(renderer.capabilities.getMaxAnisotropy());
  scene.add(world.build(materials));

  const firstTheme = theme === "tour" ? platforms[0].theme : theme;
  const sky = themeSky(firstTheme);
  const fog = themeFog(firstTheme);
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, fog.near, fog.far);
  lighting = createLighting(firstTheme);
  atmosphere = createAtmosphere(firstTheme);
  applyEnvironment(firstTheme, 1, true);

  camera.fov = 76;
  camera.updateProjectionMatrix();
  player = new ParkourPlayer(camera, world, platforms, mode);
  if (mode === "manual") {
    player.bindManual(canvas);
    hint.classList.remove("hidden");
  } else {
    hint.classList.add("hidden");
  }

  running = true;
  clock.start();
  setStatus(mode === "auto" ? "高速多场景自动跑酷中" : "手动模式，点击画面锁定鼠标");

  if (shouldRecord) {
    const seconds = Number(document.querySelector("#duration").value);
    recorder.start(seconds);
  }
}

async function stopGame() {
  minecraftAutomationCancelled = true;
  if (minecraftAutomationRunning || minecraftRecorder.active) clearBatchCheckpoint(false);
  if (minecraftRecorder.active) {
    const saving = minecraftRecorder.stop();
    if (window.desktop?.stopParkourJob) await window.desktop.stopParkourJob().catch(() => {});
    hint.classList.add("hidden");
    if (saving) await saving.catch(() => {});
    setStatus("已停止");
    return;
  }
  if (window.desktop?.stopParkourJob && minecraftAutomationRunning) {
    await window.desktop.stopParkourJob().catch(() => {});
  }
  running = false;
  const saving = recorder.stop();
  hint.classList.add("hidden");
  if (!saving) setStatus("已停止");
}

function updateLighting() {
  camera.getWorldDirection(forward);
  lighting.sun.position.set(camera.position.x - 18, camera.position.y + 30, camera.position.z - 12);
  lighting.target.position.copy(camera.position).addScaledVector(forward, 10);
  lighting.target.position.y -= 2.5;
  lighting.fill.position.copy(camera.position);
  lighting.fill.position.y -= 0.35;
  atmosphere.position.copy(camera.position);
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, clock.getDelta());
  if (!running || !player) return;
  player.update(dt);
  world.tick(clock.elapsedTime, dt);
  const theme = player.platforms[player.index]?.theme || "village";
  const themeChanged = theme !== activeTheme;
  applyEnvironment(theme, dt, themeChanged);
  activeTheme = theme;
  window.__parkourDebug = {
    theme,
    platformIndex: player.index,
    playerY: player.pos.y,
    cameraPitch: player.pitch,
    jumpProgress: player.jumpT,
    updatedAt: performance.now(),
  };
  updateLighting();
  composer.render();
}

document.querySelector("#btnStart").addEventListener("click", () => startGame(false));
document.querySelector("#btnRecord").addEventListener("click", async () => {
  if (scheduledRecording) await cancelRecordingSchedule(false);
  clearBatchCheckpoint(false);
  startGame(true);
});
document.querySelector("#btnHalt").addEventListener("click", async () => {
  if (scheduledRecording) await cancelRecordingSchedule(false);
  await stopGame();
});
document.querySelector("#btnScheduleRecording").addEventListener("click", armRecordingSchedule);
document.querySelector("#btnCancelSchedule").addEventListener("click", () => cancelRecordingSchedule(true));
document.querySelector("#btnResumeBatch").addEventListener("click", resumeBatchFromCheckpoint);
document.querySelector("#btnDiscardBatch").addEventListener("click", () => clearBatchCheckpoint(true));
document.querySelector("#btnFolder").addEventListener("click", async () => {
  if (window.desktop?.openClips) {
    const dir = await window.desktop.openClips();
    setStatus(`视频目录：${dir}`);
    return;
  }
  setStatus("请使用桌面版打开视频文件夹");
});
document.querySelector("#btnChooseClipDirectory").addEventListener("click", async () => {
  if (!window.desktop?.chooseClipsDirectory) {
    setStatus("请使用桌面版选择视频目录");
    return;
  }
  try {
    const result = await window.desktop.chooseClipsDirectory();
    document.querySelector("#clipDirectory").value = result.directory;
    document.querySelector("#clipDirectory").title = result.directory;
    setStatus(result.canceled ? "未修改视频目录" : `以后的视频将保存到：${result.directory}`);
  } catch (error) {
    setStatus(`视频目录设置失败：${error.message || error}`);
  }
});
document.querySelector("#btnMcFolder").addEventListener("click", async () => {
  if (window.desktop?.openMinecraftFolder) await window.desktop.openMinecraftFolder();
});
document.querySelector("#btnDetect").addEventListener("click", refreshMinecraftStatus);
const installButton = document.querySelector("#btnInstall");
installButton.addEventListener("click", async () => {
  installButton.disabled = true;
  installButton.textContent = "安装中，请等待…";
  try {
    setStatus("正在安装 Fabric、跑酷导演、Iris、Sodium 与免费光影…");
    await window.desktop.installRealEngine();
    await refreshMinecraftStatus();
    setStatus("整套真实引擎已安装。请在 Launcher 选择 Fabric 26.2 后启动");
    installButton.textContent = "安装完成";
  } catch (error) {
    const message = error.message || String(error);
    setStatus(`安装失败：${message}`);
    installButton.textContent = "安装失败，点此重试";
    window.alert(`安装失败：${message}`);
  } finally {
    installButton.disabled = false;
  }
});
document.querySelector("#btnLauncher").addEventListener("click", async () => {
  if (window.desktop?.openMinecraftLauncher) await window.desktop.openMinecraftLauncher();
});
document.querySelector("#btnShaders").addEventListener("click", async () => {
  if (window.desktop?.openShaderDownload) await window.desktop.openShaderDownload();
});
document.querySelector("#realTheme").addEventListener("change", async (event) => {
  if (!window.desktop?.setMinecraftTheme) return;
  try {
    await window.desktop.setMinecraftTheme(event.target.value);
    setStatus("主题已保存。回到 Minecraft 按 F8 生成新的单主题地图");
  } catch (error) {
    setStatus(`主题保存失败：${error.message || error}`);
  }
});
document.querySelector("#engine").addEventListener("change", applyEngineMode);
document.querySelector("#aspect").addEventListener("change", sizeRenderer);
document.querySelector("#resolution").addEventListener("change", sizeRenderer);

window.startGame = startGame;
window.stopGame = stopGame;
initializeMinecraftTemplateOptions();
sizeRenderer();
tick();
applyEngineMode();
refreshMinecraftStatus();
refreshClipDirectory();
initializeRecordingSchedule();
initializeBatchRecovery();

function applyEngineMode() {
  const real = document.querySelector("#engine").value === "minecraft";
  document.querySelector("#realSetup").classList.toggle("hidden", !real);
  document.querySelector("#simControls").classList.toggle("hidden", real);
  document.querySelector("#btnMcFolder").classList.toggle("hidden", !real);
  document.querySelector("#btnStart").textContent = real ? "预览窗口" : "开始模拟";
  document.querySelector("#btnRecord").textContent = real ? "自动生成并录制" : "开始并录制";
  canvas.classList.toggle("hidden", real);
  realCanvas.classList.toggle("hidden", !real);
  if (!real) setStatus("内置模拟仅用于预览；最终视频建议使用真实 Minecraft 模式");
}

async function refreshClipDirectory() {
  const field = document.querySelector("#clipDirectory");
  if (!window.desktop?.getClipsDirectory) {
    field.value = "仅桌面 EXE 支持选择目录";
    return;
  }
  try {
    const directory = await window.desktop.getClipsDirectory();
    field.value = directory;
    field.title = directory;
  } catch (error) {
    field.value = "读取失败";
    setStatus(`读取视频目录失败：${error.message || error}`);
  }
}

async function refreshMinecraftStatus() {
  if (!window.desktop?.getMinecraftStatus) {
    setStatus("请运行桌面 EXE 以检测 Minecraft");
    return;
  }
  try {
    const state = await window.desktop.getMinecraftStatus();
    const gameState = document.querySelector("#gameState");
    const modState = document.querySelector("#modState");
    const graphicsState = document.querySelector("#graphicsState");
    gameState.textContent = state.gameInstalled ? "已安装" : "未下载";
    gameState.classList.toggle("ready", state.gameInstalled);
    modState.textContent = state.ready ? "已就绪" : state.fabricInstalled ? "组件不完整" : "未安装";
    modState.classList.toggle("ready", state.ready);
    graphicsState.textContent = state.graphicsReady ? "已启用" : state.graphicsInstalled ? "待启用" : "未安装";
    graphicsState.classList.toggle("ready", state.graphicsReady);
    if (state.selectedTheme && document.querySelector(`#realTheme option[value="${state.selectedTheme}"]`)) {
      document.querySelector("#realTheme").value = state.selectedTheme;
    }
    document.querySelector("#btnInstall").disabled = !state.gameInstalled;
    document.querySelector("#realGuide").textContent = state.fullyReady
      ? "整套引擎与光影已就绪：可按选定时长自动生成全新单向路线，就绪后自动录制。"
      : state.ready
        ? "跑酷引擎已就绪，但免费光影组件不完整。请退出游戏和 Launcher 后点“安装/修复整套引擎”。"
      : state.gameInstalled
        ? "已找到 Java 26.2。退出游戏和 Launcher 后点击“安装/修复整套引擎”。"
        : "请在 Launcher 选择 Latest Release，启动到主菜单一次，退出后再检测。";
    if (document.querySelector("#engine").value === "minecraft") {
      setStatus(state.fullyReady ? "真实引擎与免费光影已就绪" : state.ready ? "跑酷已就绪，等待补齐免费光影" : "等待完成真实引擎设置");
    }
  } catch (error) {
    setStatus(`检测失败：${error.message || error}`);
  }
}
