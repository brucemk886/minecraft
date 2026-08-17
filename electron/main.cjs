const { app, BrowserWindow, desktopCapturer, dialog, globalShortcut, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execFile, spawn } = require("child_process");

const MINECRAFT_VERSION = "26.2";
const FABRIC_LOADER_VERSION = "0.19.3";
const REAL_THEMES = new Set([
  "village", "library", "lava", "lush", "checker", "honey",
  "cherry", "ice", "nether", "crystal", "random",
]);
const recordingSessions = new Map();

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

function selectedTheme() {
  try {
    const value = fs.readFileSync(themeConfigPath(), "utf8").trim().toLowerCase();
    return REAL_THEMES.has(value) ? value : "village";
  } catch {
    return "village";
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

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  for (const session of recordingSessions.values()) {
    try { fs.closeSync(session.fd); } catch {}
  }
  recordingSessions.clear();
});

ipcMain.handle("minecraft-status", async () => realStatus());

ipcMain.handle("start-parkour-job", async (_event, request = {}) => {
  const requestedTheme = String(request.theme || "random").trim().toLowerCase();
  if (!REAL_THEMES.has(requestedTheme)) throw new Error("未知的 Minecraft 地图主题");
  const durationSeconds = Math.max(120, Math.min(900, Number.parseInt(request.durationSeconds, 10) || 150));
  const requestedSeed = String(request.seed || "").trim();
  const seed = /^-?\d+$/.test(requestedSeed) ? requestedSeed : newRouteSeed();
  const jobId = crypto.randomUUID();
  writeAtomic(themeConfigPath(), `${requestedTheme}\n`);
  writeAtomic(durationConfigPath(), `${durationSeconds}\n`);
  writeAtomic(parkourJobPath(), [
    `jobId=${jobId}`,
    "action=start",
    `theme=${requestedTheme}`,
    `seed=${seed}`,
    `durationSeconds=${durationSeconds}`,
    "",
  ].join("\n"));
  return { jobId, theme: requestedTheme, seed, durationSeconds };
});

ipcMain.handle("stop-parkour-job", async () => {
  const jobId = crypto.randomUUID();
  writeAtomic(parkourJobPath(), `jobId=${jobId}\naction=stop\n`);
  return { jobId };
});

ipcMain.handle("get-parkour-status", async () => parseProperties(parkourStatusPath()));

ipcMain.handle("set-minecraft-theme", async (_event, requestedTheme) => {
  const theme = String(requestedTheme || "").trim().toLowerCase();
  if (!REAL_THEMES.has(theme)) throw new Error("未知的 Minecraft 地图主题");
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
  lines = lines.filter((line) => !/^\s*(enableShaders|shaderPack)=/i.test(line));
  lines.push("enableShaders=true", `shaderPack=${shaderPackName}`);
  fs.writeFileSync(configPath, `${lines.filter(Boolean).join("\n")}\n`, "utf8");

  // Complementary's MEDIUM profile keeps the lighting upgrade while avoiding
  // the heavy reflection/colored-lighting passes that can stall modest GPUs.
  const mediumProfile = [
    "SHADOW_QUALITY=1",
    "shadowDistance=128.0",
    "WATER_REFLECT_QUALITY=2",
    "BLOCK_REFLECT_QUALITY=1",
    "LIGHTSHAFT_QUALI_DEFINE=1",
    "SSAO_QUALI_DEFINE=2",
    "FXAA_DEFINE=1",
    "DETAIL_QUALITY=2",
    "CLOUD_QUALITY=2",
    "ANISOTROPIC_FILTER=0",
    "COLORED_LIGHTING=0",
    "WORLD_SPACE_REFLECTIONS=-1",
    "ENTITY_SHADOW=-1",
    "TM_EXPOSURE=1.10",
    "TM_CONTRAST=0.95",
    "T_SATURATION=1.30",
    "T_VIBRANCE=1.25",
    "AMBIENT_MULT=140",
    "CAVE_LIGHTING=180",
    "BLOOM_STRENGTH=0.10",
    "LESS_LAVA_FOG=true",
  ];
  const shaderOptionsPath = path.join(minecraftDir(), "shaderpacks", `${shaderPackName}.txt`);
  fs.writeFileSync(shaderOptionsPath, `${mediumProfile.join("\n")}\n`, "utf8");
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
      "unsharp=5:5:0.32:5:5:0.0",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "17",
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
