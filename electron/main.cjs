const { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, powerSaveBlocker, screen, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");

const MINECRAFT_VERSION = "26.2";
const FABRIC_LOADER_VERSION = "0.19.3";
const REAL_THEME_ORDER = [
  "village", "library", "lava", "lush", "checker", "honey",
  "cherry", "ice", "nether", "crystal",
  "desert", "bamboo", "ocean", "mushroom", "copper", "redstone",
  "quartz", "castle", "melon", "coral", "rainbow", "swamp",
  "birch", "azalea", "obsidian", "gold", "emerald", "factory",
  "arcade", "savanna",
  "alpine", "jungle", "coast", "oasis", "candy", "clockwork",
  "marble", "vineyard", "pumpkin", "aquarium", "railway", "harbor",
  "cathedral", "dojo", "oriental", "mesa", "quarry", "greenhouse",
  "carnival", "laboratory", "music", "bakery", "volcano", "lagoon",
  "autumn", "winter", "dragon", "maze", "observatory", "stadium",
];
const REAL_BASE_THEMES = new Set(REAL_THEME_ORDER);
const TEMPLATE_ID_PATTERN = /^([a-z][a-z0-9-]*)-v(0[1-5])$/;
const recordingSessions = new Map();
const pendingParkourJobs = new Map();
const GENERATION_HISTORY_DAYS = 30;
const GENERATION_HISTORY_LIMIT = 6000;
const SIMILARITY_REVIEW_THRESHOLD = 0.945;
const MIN_FREE_STORAGE_BYTES = 20 * 1024 * 1024 * 1024;
const MIX64_MASK = (1n << 64n) - 1n;
let keepAwakeBlockerId = null;

app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function readSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function defaultClipsDir() {
  if (process.platform === "win32" && fs.existsSync("D:\\")) {
    return path.join("D:\\", "方块跑酷模拟器视频");
  }
  return path.join(app.getPath("videos"), "方块跑酷模拟器");
}

function clipsDir() {
  const configured = readSettings().clipsDirectory;
  const dir = typeof configured === "string" && path.isAbsolute(configured)
    ? path.resolve(configured)
    : defaultClipsDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function setClipsDir(requestedDirectory) {
  const requested = String(requestedDirectory || "").trim();
  if (!requested || !path.isAbsolute(requested)) throw new Error("请选择有效的绝对目录");
  const directory = path.resolve(requested);
  fs.mkdirSync(directory, { recursive: true });
  writeSettings({ ...readSettings(), clipsDirectory: directory });
  return directory;
}

function recordingStorageStatus() {
  const directory = clipsDir();
  try {
    const stats = fs.statfsSync(directory);
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    return {
      directory,
      supported: true,
      freeBytes,
      freeGigabytes: freeBytes / (1024 ** 3),
      minimumFreeBytes: MIN_FREE_STORAGE_BYTES,
      safe: freeBytes >= MIN_FREE_STORAGE_BYTES,
    };
  } catch (error) {
    return {
      directory,
      supported: false,
      freeBytes: null,
      freeGigabytes: null,
      minimumFreeBytes: MIN_FREE_STORAGE_BYTES,
      safe: true,
      detail: error.message || String(error),
    };
  }
}

function minecraftDir() {
  return path.join(app.getPath("appData"), ".minecraft");
}

function runtimeDir() {
  return path.join(__dirname, "..", "runtime");
}

function themeConfigPath() {
  return path.join(minecraftDir(), "config", "parkoursim-theme.txt");
}

function durationConfigPath() {
  return path.join(minecraftDir(), "config", "parkoursim-duration.txt");
}

function parkourJobPath() {
  return path.join(minecraftDir(), "config", "parkoursim-job.properties");
}

function parkourStatusPath() {
  return path.join(minecraftDir(), "config", "parkoursim-status.properties");
}

function parkourHeartbeatPath() {
  return path.join(minecraftDir(), "config", "parkoursim-heartbeat.txt");
}

function generationHistoryPath() {
  return path.join(app.getPath("userData"), "generation-history.json");
}

function readGenerationHistory() {
  let records = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(generationHistoryPath(), "utf8"));
    records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
  } catch {}
  const cutoff = Date.now() - GENERATION_HISTORY_DAYS * 24 * 60 * 60 * 1000;
  return records
    .filter((record) => record && Number(record.createdAt || 0) >= cutoff)
    .slice(-GENERATION_HISTORY_LIMIT);
}

function writeGenerationHistory(records) {
  writeAtomic(generationHistoryPath(), `${JSON.stringify({ version: 1, records: records.slice(-GENERATION_HISTORY_LIMIT) }, null, 2)}\n`);
}

function unsigned64(value) {
  return BigInt.asUintN(64, value) & MIX64_MASK;
}

function mix64BigInt(value) {
  let mixed = unsigned64(value);
  mixed = unsigned64((mixed ^ (mixed >> 30n)) * 0xbf58476d1ce4e5b9n);
  mixed = unsigned64((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn);
  return BigInt.asIntN(64, mixed ^ (mixed >> 31n));
}

function floorModBigInt(value, bound) {
  const divisor = BigInt(bound);
  return Number(((value % divisor) + divisor) % divisor);
}

function variationIndex(seed, salt, bound) {
  return floorModBigInt(mix64BigInt(unsigned64(BigInt(seed)) ^ salt), bound);
}

function resolvedThemeForSeed(requestedTheme, seed) {
  const templateMatch = TEMPLATE_ID_PATTERN.exec(requestedTheme);
  if (templateMatch && REAL_BASE_THEMES.has(templateMatch[1])) return requestedTheme;
  const mixed = mix64BigInt(BigInt(seed));
  if (REAL_BASE_THEMES.has(requestedTheme)) {
    return `${requestedTheme}-v${String(floorModBigInt(mixed, 5) + 1).padStart(2, "0")}`;
  }
  const templateIndex = floorModBigInt(mixed, REAL_THEME_ORDER.length * 5);
  return `${REAL_THEME_ORDER[Math.floor(templateIndex / 5)]}-v${String(templateIndex % 5 + 1).padStart(2, "0")}`;
}

function variationForSeed(requestedTheme, seed) {
  const theme = resolvedThemeForSeed(requestedTheme, seed);
  const variation = {
    theme,
    baseTheme: TEMPLATE_ID_PATTERN.exec(theme)?.[1] || theme,
    paletteVariant: variationIndex(seed, 0x632be59bd9b4e019n, 4),
    landmarkPack: variationIndex(seed, 0x8cb92ba72f3d8dd7n, 6),
    terrainProfile: variationIndex(seed, 0x9e3779b97f4a7c15n, 4),
    sceneOrderProfile: variationIndex(seed, 0xd1b54a32d192ed03n, 8),
    cameraProfile: variationIndex(seed, 0xa24baed4963ee407n, 4),
  };
  variation.signature = [
    variation.theme,
    variation.paletteVariant,
    variation.landmarkPack,
    variation.terrainProfile,
    variation.sceneOrderProfile,
    variation.cameraProfile,
  ].join(":");
  return variation;
}

function chooseUnusedRouteSeed(requestedTheme) {
  const pendingCutoff = Date.now() - 60 * 60 * 1000;
  for (const [jobId, pending] of pendingParkourJobs) {
    if (Number(pending.startedAt || 0) < pendingCutoff) pendingParkourJobs.delete(jobId);
  }
  const used = new Set(readGenerationHistory().map((record) => record.signature).filter(Boolean));
  for (const pending of pendingParkourJobs.values()) {
    if (pending.signature) used.add(pending.signature);
  }
  let fallbackSeed = newRouteSeed();
  let fallbackVariation = variationForSeed(requestedTheme, fallbackSeed);
  for (let attempt = 0; attempt < 256; attempt++) {
    const seed = attempt === 0 ? fallbackSeed : newRouteSeed();
    const variation = variationForSeed(requestedTheme, seed);
    fallbackSeed = seed;
    fallbackVariation = variation;
    if (!used.has(variation.signature)) return { seed, variation };
  }
  return { seed: fallbackSeed, variation: fallbackVariation };
}

function averageHashFrame(frame) {
  if (!frame.length) return "";
  const average = frame.reduce((sum, value) => sum + value, 0) / frame.length;
  let hash = "";
  for (let index = 0; index < frame.length; index += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit++) {
      if (frame[index + bit] >= average) nibble |= 1 << (3 - bit);
    }
    hash += nibble.toString(16);
  }
  return hash;
}

function fingerprintVideo(filePath, durationSeconds) {
  return new Promise((resolve, reject) => {
    const interval = Math.max(1, Math.floor((Math.max(30, Number(durationSeconds) || 120) - 8) / 4));
    const child = spawn("ffmpeg", [
      "-v", "error", "-i", filePath,
      "-vf", `fps=1/${interval},scale=16:16:flags=area,format=gray`,
      "-frames:v", "5", "-f", "rawvideo", "pipe:1",
    ], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let errorText = "";
    const timeout = setTimeout(() => child.kill(), 60_000);
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => { errorText += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(errorText.trim() || "视频相似度分析失败"));
        return;
      }
      const raw = Buffer.concat(chunks);
      const hashes = [];
      for (let offset = 0; offset + 256 <= raw.length && hashes.length < 5; offset += 256) {
        hashes.push(averageHashFrame(raw.subarray(offset, offset + 256)));
      }
      if (hashes.length < 3) reject(new Error("视频有效抽帧不足 3 帧"));
      else resolve(hashes);
    });
  });
}

const NIBBLE_POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

function fingerprintSimilarity(first, second) {
  const frameCount = Math.min(first?.length || 0, second?.length || 0);
  if (frameCount < 3) return 0;
  let differentBits = 0;
  let totalBits = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    const length = Math.min(first[frame].length, second[frame].length);
    for (let index = 0; index < length; index++) {
      differentBits += NIBBLE_POPCOUNT[Number.parseInt(first[frame][index], 16) ^ Number.parseInt(second[frame][index], 16)];
      totalBits += 4;
    }
  }
  return totalBits ? 1 - differentBits / totalBits : 0;
}

function moveToSimilarityReview(filePath) {
  const reviewDirectory = path.join(path.dirname(filePath), "_similar-review");
  fs.mkdirSync(reviewDirectory, { recursive: true });
  const parsed = path.parse(filePath);
  let destination = path.join(reviewDirectory, parsed.base);
  if (fs.existsSync(destination)) destination = path.join(reviewDirectory, `${parsed.name}-${crypto.randomUUID().slice(0, 8)}${parsed.ext}`);
  fs.renameSync(filePath, destination);
  return destination;
}

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, "utf8");
  try {
    fs.renameSync(tempPath, filePath);
  } catch {
    fs.rmSync(filePath, { force: true });
    fs.renameSync(tempPath, filePath);
  }
}

function parseProperties(filePath) {
  try {
    const result = {};
    for (const rawLine of fs.readFileSync(filePath, "latin1").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || line.startsWith("!")) continue;
      const separator = line.search(/[=:]/);
      const key = separator < 0 ? line : line.slice(0, separator).trim();
      const value = separator < 0 ? "" : line.slice(separator + 1).trim();
      result[key] = value
        .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
        .replace(/\\([\\:= ])/g, "$1");
    }
    return result;
  } catch {
    return {};
  }
}

function newRouteSeed() {
  return BigInt.asIntN(64, crypto.randomBytes(8).readBigUInt64LE()).toString();
}

function isRealTheme(value) {
  const match = TEMPLATE_ID_PATTERN.exec(value);
  return value === "random" || REAL_BASE_THEMES.has(value) || Boolean(match && REAL_BASE_THEMES.has(match[1]));
}

function selectedTheme() {
  try {
    const value = fs.readFileSync(themeConfigPath(), "utf8").trim().toLowerCase();
    return isRealTheme(value) ? value : "random";
  } catch {
    return "random";
  }
}

function realStatus() {
  const gameDir = minecraftDir();
  const versionJson = path.join(gameDir, "versions", MINECRAFT_VERSION, `${MINECRAFT_VERSION}.json`);
  const fabricId = `fabric-loader-${FABRIC_LOADER_VERSION}-${MINECRAFT_VERSION}`;
  const fabricJson = path.join(gameDir, "versions", fabricId, `${fabricId}.json`);
  const modsDir = path.join(gameDir, "mods");
  const modNames = fs.existsSync(modsDir) ? fs.readdirSync(modsDir) : [];
  const modInstalled = modNames.some((name) => /^parkour-director-.*\.jar$/i.test(name));
  const apiInstalled = modNames.some((name) => /^fabric-api-.*\.jar$/i.test(name));
  const irisInstalled = modNames.some((name) => /^iris-fabric-.*\.jar$/i.test(name));
  const sodiumInstalled = modNames.some((name) => /^sodium-fabric-.*\.jar$/i.test(name));
  const shaderpacksDir = path.join(gameDir, "shaderpacks");
  const shaderPacks = fs.existsSync(shaderpacksDir)
    ? fs.readdirSync(shaderpacksDir).filter((name) => /^ComplementaryReimagined_.*\.zip$/i.test(name))
    : [];
  const irisConfigPath = path.join(gameDir, "config", "iris.properties");
  let irisConfig = "";
  try {
    irisConfig = fs.readFileSync(irisConfigPath, "utf8");
  } catch {
    irisConfig = "";
  }
  const shaderEnabled = /^enableShaders=true\s*$/im.test(irisConfig);
  const selectedShader = irisConfig.match(/^shaderPack=(.+)\s*$/im)?.[1]?.trim() || "";
  const shaderPack = shaderPacks.includes(selectedShader) ? selectedShader : shaderPacks.at(-1) || null;
  const graphicsInstalled = irisInstalled && sodiumInstalled && shaderPacks.length > 0;
  const graphicsReady = graphicsInstalled && shaderEnabled && shaderPacks.includes(selectedShader);
  const ready = fs.existsSync(versionJson) && fs.existsSync(fabricJson) && modInstalled && apiInstalled;
  return {
    gameDir,
    gameInstalled: fs.existsSync(versionJson),
    fabricInstalled: fs.existsSync(fabricJson),
    modInstalled,
    apiInstalled,
    irisInstalled,
    sodiumInstalled,
    shaderPack,
    graphicsInstalled,
    graphicsReady,
    ready,
    fullyReady: ready && graphicsReady,
    minecraftVersion: MINECRAFT_VERSION,
    fabricVersion: FABRIC_LOADER_VERSION,
    selectedTheme: selectedTheme(),
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#0e1116",
    autoHideMenuBar: true,
    title: "方块跑酷模拟器",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  if (app.isPackaged || process.env.PARKOUR_TEST_DIST === "1") {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  } else {
    win.loadURL("http://localhost:5173");
  }
}

app.whenReady().then(() => {
  optimizeMinecraftVideoSettings();
  createWindow();
  globalShortcut.register("F7", () => {
    BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript("window.startGame?.(true)");
  });

  globalShortcut.register("F6", () => {
    BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript("window.stopGame?.()");
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("save-clip", async (_event, buffer, suggestedName) => {
  const filePath = path.join(clipsDir(), path.basename(String(suggestedName || "parkour.webm")));
  fs.writeFileSync(filePath, Buffer.from(buffer));
  const mp4Path = filePath.replace(/\.webm$/i, ".mp4");
  const converted = await convertMp4(filePath, mp4Path);
  return { filePath: converted || filePath, converted: Boolean(converted) };
});

ipcMain.handle("start-recording-file", async (_event, suggestedName) => {
  const storage = recordingStorageStatus();
  if (storage.supported && !storage.safe) {
    throw new Error(`视频盘仅剩 ${storage.freeGigabytes.toFixed(1)} GB，低于 20 GB 安全线，已停止创建新视频`);
  }
  const requested = path.basename(String(suggestedName || "minecraft-parkour.webm"));
  const safeName = requested.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\.webm$/i, "") + ".webm";
  let filePath = path.join(clipsDir(), safeName);
  if (fs.existsSync(filePath)) {
    filePath = path.join(clipsDir(), `${path.parse(safeName).name}-${crypto.randomUUID().slice(0, 8)}.webm`);
  }
  const sessionId = crypto.randomUUID();
  const fd = fs.openSync(filePath, "wx");
  recordingSessions.set(sessionId, { fd, filePath });
  return { sessionId, filePath };
});

ipcMain.handle("append-recording-chunk", async (_event, sessionId, buffer) => {
  const session = recordingSessions.get(String(sessionId));
  if (!session) throw new Error("录制会话已失效");
  const chunk = Buffer.from(buffer);
  fs.writeSync(session.fd, chunk, 0, chunk.length);
  return chunk.length;
});

ipcMain.handle("finish-recording-file", async (_event, sessionId) => {
  const key = String(sessionId);
  const session = recordingSessions.get(key);
  if (!session) throw new Error("录制会话已失效");
  recordingSessions.delete(key);
  fs.closeSync(session.fd);
  const mp4Path = session.filePath.replace(/\.webm$/i, ".mp4");
  const converted = await convertMp4(session.filePath, mp4Path);
  if (converted) fs.rmSync(session.filePath, { force: true });
  return { filePath: converted || session.filePath, converted: Boolean(converted) };
});

ipcMain.handle("abort-recording-file", async (_event, sessionId) => {
  const key = String(sessionId);
  const session = recordingSessions.get(key);
  if (!session) return false;
  recordingSessions.delete(key);
  try { fs.closeSync(session.fd); } catch {}
  fs.rmSync(session.filePath, { force: true });
  return true;
});

ipcMain.handle("open-clips", async () => {
  const dir = clipsDir();
  await shell.openPath(dir);
  return dir;
});

ipcMain.handle("get-clips-directory", async () => clipsDir());

ipcMain.handle("get-recording-storage-status", async () => recordingStorageStatus());

ipcMain.handle("choose-clips-directory", async () => {
  const options = {
    title: "选择视频保存目录",
    defaultPath: clipsDir(),
    properties: ["openDirectory", "createDirectory"],
  };
  const parent = BrowserWindow.getFocusedWindow();
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true, directory: clipsDir() };
  }
  return { canceled: false, directory: setClipsDir(result.filePaths[0]) };
});

ipcMain.handle("set-keep-awake", async (_event, requestedEnabled) => {
  const enabled = Boolean(requestedEnabled);
  if (enabled && (keepAwakeBlockerId === null || !powerSaveBlocker.isStarted(keepAwakeBlockerId))) {
    keepAwakeBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!enabled && keepAwakeBlockerId !== null) {
    if (powerSaveBlocker.isStarted(keepAwakeBlockerId)) powerSaveBlocker.stop(keepAwakeBlockerId);
    keepAwakeBlockerId = null;
  }
  return { enabled, blockerId: keepAwakeBlockerId };
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (keepAwakeBlockerId !== null && powerSaveBlocker.isStarted(keepAwakeBlockerId)) {
    powerSaveBlocker.stop(keepAwakeBlockerId);
  }
  keepAwakeBlockerId = null;
  for (const session of recordingSessions.values()) {
    try { fs.closeSync(session.fd); } catch {}
  }
  recordingSessions.clear();
});

ipcMain.handle("minecraft-status", async () => ({
  ...realStatus(),
  running: await minecraftProcessesRunning(),
}));

ipcMain.handle("start-parkour-job", async (_event, request = {}) => {
  const requestedTheme = String(request.theme || "random").trim().toLowerCase();
  if (!isRealTheme(requestedTheme)) throw new Error("未知的 Minecraft 地图模板");
  const durationSeconds = Math.max(120, Math.min(900, Number.parseInt(request.durationSeconds, 10) || 150));
  const batchIndex = Math.max(1, Math.min(999, Number.parseInt(request.batchIndex, 10) || 1));
  const requestedSeed = String(request.seed || "").trim();
  const selected = /^-?\d+$/.test(requestedSeed)
    ? { seed: requestedSeed, variation: variationForSeed(requestedTheme, requestedSeed) }
    : chooseUnusedRouteSeed(requestedTheme);
  const { seed, variation } = selected;
  const jobId = crypto.randomUUID();
  pendingParkourJobs.set(jobId, {
    ...variation,
    seed,
    durationSeconds,
    batchIndex,
    startedAt: Date.now(),
  });
  writeAtomic(themeConfigPath(), `${requestedTheme}\n`);
  writeAtomic(durationConfigPath(), `${durationSeconds}\n`);
  writeAtomic(parkourJobPath(), [
    `jobId=${jobId}`,
    "action=start",
    `theme=${requestedTheme}`,
    `seed=${seed}`,
    `durationSeconds=${durationSeconds}`,
    `batchIndex=${batchIndex}`,
    `paletteVariant=${variation.paletteVariant}`,
    `landmarkPack=${variation.landmarkPack}`,
    `terrainProfile=${variation.terrainProfile}`,
    `sceneOrderProfile=${variation.sceneOrderProfile}`,
    `cameraProfile=${variation.cameraProfile}`,
    "",
  ].join("\n"));
  return { jobId, theme: requestedTheme, resolvedTheme: variation.theme, seed, durationSeconds, batchIndex, variation };
});

ipcMain.handle("complete-parkour-job", async (_event, request = {}) => {
  const jobId = String(request.jobId || "").trim();
  const pending = pendingParkourJobs.get(jobId);
  if (!pending) throw new Error("找不到本条视频对应的生成任务");
  const filePath = path.resolve(String(request.filePath || ""));
  const outputRoot = path.resolve(clipsDir());
  const relative = path.relative(outputRoot, filePath);
  if (!filePath || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath)) {
    pendingParkourJobs.delete(jobId);
    throw new Error("生成的视频不在当前保存目录，无法执行去重检查");
  }

  const history = readGenerationHistory();
  let fingerprint = null;
  let analysisError = "";
  try {
    fingerprint = await fingerprintVideo(filePath, pending.durationSeconds);
  } catch (error) {
    analysisError = error.message || String(error);
  }

  let closest = null;
  if (fingerprint) {
    for (const record of history) {
      if (record.baseTheme !== pending.baseTheme || !Array.isArray(record.fingerprint)) continue;
      const similarity = fingerprintSimilarity(fingerprint, record.fingerprint);
      if (!closest || similarity > closest.similarity) closest = { similarity, record };
    }
  }
  const tooSimilar = Boolean(closest && closest.similarity >= SIMILARITY_REVIEW_THRESHOLD);
  const finalPath = tooSimilar ? moveToSimilarityReview(filePath) : filePath;
  const record = {
    jobId,
    createdAt: Date.now(),
    seed: pending.seed,
    signature: pending.signature,
    theme: pending.theme,
    baseTheme: pending.baseTheme,
    paletteVariant: pending.paletteVariant,
    landmarkPack: pending.landmarkPack,
    terrainProfile: pending.terrainProfile,
    sceneOrderProfile: pending.sceneOrderProfile,
    cameraProfile: pending.cameraProfile,
    fingerprint,
    filePath: finalPath,
    rejectedAsSimilar: tooSimilar,
    similarity: closest?.similarity || 0,
    analysisError,
  };
  history.push(record);
  writeGenerationHistory(history);
  pendingParkourJobs.delete(jobId);
  return {
    accepted: !tooSimilar,
    filePath: finalPath,
    similarity: closest?.similarity || 0,
    comparedWith: closest?.record?.filePath || "",
    analysisError,
  };
});

ipcMain.handle("stop-parkour-job", async () => {
  const jobId = crypto.randomUUID();
  writeAtomic(parkourJobPath(), `jobId=${jobId}\naction=stop\n`);
  return { jobId };
});

ipcMain.handle("get-parkour-status", async () => {
  const path = parkourStatusPath();
  const heartbeatPath = parkourHeartbeatPath();
  const status = parseProperties(path);
  let modifiedAt = 0;
  try {
    modifiedAt = fs.statSync(path).mtimeMs;
  } catch {}
  try {
    const heartbeatModifiedAt = fs.statSync(heartbeatPath).mtimeMs;
    const [heartbeatJobId = "", heartbeatElapsedSeconds = "", heartbeatState = ""] = fs.readFileSync(heartbeatPath, "utf8").trim().split(/\r?\n/);
    if (heartbeatJobId && (heartbeatJobId === status.jobId || heartbeatModifiedAt >= modifiedAt)) {
      if (heartbeatModifiedAt >= modifiedAt) {
        status.jobId = heartbeatJobId;
        status.elapsedSeconds = heartbeatElapsedSeconds;
        if (heartbeatState) status.state = heartbeatState;
      }
      status.heartbeatElapsedSeconds = heartbeatElapsedSeconds;
      modifiedAt = Math.max(modifiedAt, heartbeatModifiedAt);
    }
  } catch {}
  status.statusFileMtimeMs = modifiedAt;
  status.statusFileAgeMs = modifiedAt > 0 ? Math.max(0, Date.now() - modifiedAt) : Number.POSITIVE_INFINITY;
  return status;
});

ipcMain.handle("set-minecraft-theme", async (_event, requestedTheme) => {
  const theme = String(requestedTheme || "").trim().toLowerCase();
  if (!isRealTheme(theme)) throw new Error("未知的 Minecraft 地图模板");
  const configPath = themeConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${theme}\n`, "utf8");
  return { theme, configPath };
});

ipcMain.handle("minecraft-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  });
  return sources.map(({ id, name }) => ({ id, name }));
});

ipcMain.handle("install-real-engine", async () => {
  const before = realStatus();
  if (!before.gameInstalled) {
    throw new Error(`尚未找到 Java ${MINECRAFT_VERSION}。请先在 Launcher 选择“Latest Release”，进入一次主菜单后退出游戏和启动器`);
  }
  if (await minecraftProcessesRunning()) {
    throw new Error("安装前请先完全退出 Minecraft 游戏和 Launcher，然后再点一次安装");
  }

  const installer = path.join(runtimeDir(), "fabric-installer-1.1.2.jar");
  const bundledJava = path.join(runtimeDir(), "java-runtime", "bin", "java.exe");
  const directorJar = findRuntimeFile(/^parkour-director-.*\.jar$/i);
  const fabricApiJar = findRuntimeFile(/^fabric-api-.*\.jar$/i);
  const irisJar = findRuntimeFile(/^iris-fabric-.*\.jar$/i);
  const sodiumJar = findRuntimeFile(/^sodium-fabric-.*\.jar$/i);
  const shaderPack = findRuntimeFile(/^ComplementaryReimagined_.*\.zip$/i);
  if (!fs.existsSync(installer) || !fs.existsSync(bundledJava) || !directorJar || !fabricApiJar || !irisJar || !sodiumJar || !shaderPack) {
    throw new Error("EXE 内缺少真实引擎组件，请重新获取完整的 ParkourSim 文件夹");
  }

  // Newer Microsoft Store launchers still keep their editable installation
  // profiles in launcher_profiles.json. Only select microsoft_store when its
  // matching profile file actually exists, otherwise Fabric aborts immediately.
  const launcher = fs.existsSync(path.join(before.gameDir, "launcher_profiles_microsoft_store.json"))
    ? "microsoft_store"
    : "win32";

  await runFile(bundledJava, [
    "-jar",
    installer,
    "client",
    "-dir",
    before.gameDir,
    "-mcversion",
    MINECRAFT_VERSION,
    "-loader",
    FABRIC_LOADER_VERSION,
    "-launcher",
    launcher,
  ]);

  const modsDir = path.join(before.gameDir, "mods");
  fs.mkdirSync(modsDir, { recursive: true });
  const managedMods = [
    /^parkour-director-.*\.jar$/i,
    /^fabric-api-.*\.jar$/i,
    /^iris-fabric-.*\.jar$/i,
    /^sodium-fabric-.*\.jar$/i,
  ];
  for (const name of fs.readdirSync(modsDir)) {
    if (managedMods.some((pattern) => pattern.test(name))) fs.rmSync(path.join(modsDir, name));
  }
  fs.copyFileSync(directorJar, path.join(modsDir, path.basename(directorJar)));
  fs.copyFileSync(fabricApiJar, path.join(modsDir, path.basename(fabricApiJar)));
  fs.copyFileSync(irisJar, path.join(modsDir, path.basename(irisJar)));
  fs.copyFileSync(sodiumJar, path.join(modsDir, path.basename(sodiumJar)));

  const shaderpacksDir = path.join(before.gameDir, "shaderpacks");
  fs.mkdirSync(shaderpacksDir, { recursive: true });
  fs.copyFileSync(shaderPack, path.join(shaderpacksDir, path.basename(shaderPack)));
  enableIrisShader(path.basename(shaderPack));
  return realStatus();
});

ipcMain.handle("open-minecraft-launcher", async () => {
  const managedShader = findRuntimeFile(/^ComplementaryReimagined.*\.zip$/i);
  if (managedShader) enableIrisShader(path.basename(managedShader));
  const child = spawn(
    "explorer.exe",
    ["shell:AppsFolder\\Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft"],
    { detached: true, windowsHide: true, stdio: "ignore" },
  );
  child.unref();
  return true;
});

ipcMain.handle("open-minecraft-folder", async () => {
  fs.mkdirSync(minecraftDir(), { recursive: true });
  await shell.openPath(minecraftDir());
  return minecraftDir();
});

ipcMain.handle("open-shader-download", async () => {
  await shell.openExternal("https://modrinth.com/shader/complementary-reimagined");
  return true;
});

function enableIrisShader(shaderPackName) {
  const configPath = path.join(minecraftDir(), "config", "iris.properties");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let lines = [];
  try {
    lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  } catch {
    lines = [];
  }
  lines = lines.filter((line) => !/^\s*(enableShaders|shaderPack|maxShadowRenderDistance)=/i.test(line));
  lines.push("enableShaders=true", `shaderPack=${shaderPackName}`, "maxShadowRenderDistance=24");
  fs.writeFileSync(configPath, `${lines.filter(Boolean).join("\n")}\n`, "utf8");

  optimizeMinecraftVideoSettings();

  // Keep the lighting upgrade while preserving crisp source pixels for the
  // portrait crop. Temporal AA stays enabled on its least blurry setting.
  const mediumProfile = [
    "SHADOW_QUALITY=1",
    "shadowDistance=64.0",
    "WATER_REFLECT_QUALITY=2",
    "BLOCK_REFLECT_QUALITY=1",
    "LIGHTSHAFT_QUALI_DEFINE=1",
    "SSAO_QUALI_DEFINE=2",
    "FXAA_DEFINE=-1",
    "TAA_MODE=1",
    "TAA_SMOOTHING=2",
    "DETAIL_QUALITY=2",
    "CLOUD_QUALITY=2",
    "ANISOTROPIC_FILTER=8",
    "COLORED_LIGHTING=0",
    "WORLD_SPACE_REFLECTIONS=-1",
    "ENTITY_SHADOW=-1",
    "TM_EXPOSURE=1.10",
    "TM_CONTRAST=0.95",
    "T_SATURATION=1.30",
    "T_VIBRANCE=1.25",
    "AMBIENT_MULT=140",
    "CAVE_LIGHTING=180",
    "BLOOM_STRENGTH=0.045",
    "IMAGE_SHARPENING=5",
    "MOTION_BLUR_EFFECT=-1",
    "WORLD_BLUR=0",
    "CHROMA_ABERRATION=0",
    "LESS_LAVA_FOG=true",
  ];
  const shaderOptionsPath = path.join(minecraftDir(), "shaderpacks", `${shaderPackName}.txt`);
  fs.writeFileSync(shaderOptionsPath, `${mediumProfile.join("\n")}\n`, "utf8");
}

function optimizeMinecraftVideoSettings() {
  const optionsPath = path.join(minecraftDir(), "options.txt");
  if (!fs.existsSync(optionsPath)) return;
  let lines = fs.readFileSync(optionsPath, "utf8").split(/\r?\n/);
  const windowSize = preferredMinecraftWindowSize();
  const managed = new Map([
    ["renderDistance", "renderDistance:12"],
    ["simulationDistance", "simulationDistance:8"],
    ["maxFps", "maxFps:90"],
    ["mipmapLevels", "mipmapLevels:4"],
    ["overrideWidth", `overrideWidth:${windowSize.width}`],
    ["overrideHeight", `overrideHeight:${windowSize.height}`],
    ["fullscreen", "fullscreen:false"],
    ["exclusiveFullscreen", "exclusiveFullscreen:false"],
  ]);
  const found = new Set();
  lines = lines.map((line) => {
    const key = line.split(":", 1)[0];
    if (!managed.has(key)) return line;
    found.add(key);
    return managed.get(key);
  });
  for (const [key, value] of managed) {
    if (!found.has(key)) lines.push(value);
  }
  fs.writeFileSync(optionsPath, `${lines.filter(Boolean).join("\n")}\n`, "utf8");
}

function preferredMinecraftWindowSize() {
  let workArea = { width: 1920, height: 1080 };
  try {
    workArea = screen.getPrimaryDisplay().workAreaSize;
  } catch {}
  const availableWidth = Math.max(640, Number(workArea.width || 1920) - 96);
  const availableHeight = Math.max(360, Number(workArea.height || 1080) - 120);
  const boundedWidth = Math.min(1600, availableWidth, availableHeight * (16 / 9));
  const width = Math.max(640, Math.floor(boundedWidth / 16) * 16);
  return { width, height: Math.round(width * (9 / 16)) };
}

function findRuntimeFile(pattern) {
  if (!fs.existsSync(runtimeDir())) return null;
  const name = fs.readdirSync(runtimeDir()).find((entry) => pattern.test(entry));
  return name ? path.join(runtimeDir(), name) : null;
}

function minecraftProcessesRunning() {
  return desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 0, height: 0 },
    fetchWindowIcons: false,
  }).then((sources) => sources.some((source) => /minecraft/i.test(source.name) && !/launcher/i.test(source.name)))
    .catch(() => false);
}

function runFile(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 180_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || stdout || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

function convertMp4(input, output) {
  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-vf",
      "unsharp=5:5:0.40:5:5:0.0",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "21",
      "-profile:v",
      "high",
      "-level",
      "4.1",
      "-r",
      "30",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      output,
    ], { windowsHide: true });
    ff.on("error", () => resolve(null));
    ff.on("close", (code) => resolve(code === 0 ? output : null));
  });
}
