import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CAPTURE_START_ATTEMPTS,
  RECORDED_COLOR_FILTER,
  RECORDED_VIGNETTE_ALPHA,
  averageRgbFrameDifference,
  chooseMinecraftSource,
  coverCrop,
  isMinecraftGameSourceName,
  minecraftCaptureConstraints,
  minecraftContentCrop,
  recordedColorFilter,
  retryOperation,
} from "../src/minecraft.js";
import {
  MINECRAFT_BASE_THEMES,
  MINECRAFT_TEMPLATE_STYLES,
  MINECRAFT_TEMPLATES,
  minecraftBaseTheme,
  minecraftDailyTemplateOffset,
  minecraftTemplateForBatchIndex,
} from "../src/minecraft-templates.js";

test("Minecraft exposes 300 balanced templates across 60 themes", () => {
  assert.equal(MINECRAFT_BASE_THEMES.length, 60);
  assert.equal(MINECRAFT_TEMPLATE_STYLES.length, 5);
  assert.equal(MINECRAFT_TEMPLATES.length, 300);
  assert.equal(new Set(MINECRAFT_TEMPLATES.map((template) => template.id)).size, 300);
  assert.equal(new Set(Array.from({ length: 300 }, (_, index) => minecraftTemplateForBatchIndex(index + 1, 17).id)).size, 300);
  assert.equal(new Set(Array.from({ length: 60 }, (_, index) => minecraftTemplateForBatchIndex(index + 1, 17).baseTheme)).size, 60);
  assert.equal(minecraftTemplateForBatchIndex(1, 17).id, minecraftTemplateForBatchIndex(301, 17).id);
  const firstDayOffset = minecraftDailyTemplateOffset(new Date(2026, 7, 20));
  const secondDayOffset = minecraftDailyTemplateOffset(new Date(2026, 7, 21));
  const firstDay = new Set(Array.from({ length: 150 }, (_, index) => minecraftTemplateForBatchIndex(index + 1, firstDayOffset).id));
  const secondDay = new Set(Array.from({ length: 150 }, (_, index) => minecraftTemplateForBatchIndex(index + 1, secondDayOffset).id));
  assert.notEqual(firstDayOffset, secondDayOffset);
  assert.equal([...firstDay].filter((id) => secondDay.has(id)).length, 0);
  assert.equal(new Set([...firstDay, ...secondDay]).size, 300);
  assert.equal(minecraftBaseTheme("crystal-v05"), "crystal");
  assert.equal(minecraftBaseTheme("savanna-v05"), "savanna");
  assert.equal(minecraftBaseTheme("stadium-v05"), "stadium");
  assert.equal(minecraftBaseTheme("library"), "library");
});

test("desktop and director pass all 300 template ids into distinct route structures", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const htmlSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const rendererSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const directorSource = fs.readFileSync(
    new URL("../minecraft-mod/src/client/java/com/parkoursim/director/client/ParkourDirectorClient.java", import.meta.url),
    "utf8",
  );
  const builderSource = fs.readFileSync(
    new URL("../minecraft-mod/src/main/java/com/parkoursim/director/CourseBuilder.java", import.meta.url),
    "utf8",
  );
  assert.ok(htmlSource.includes("每日轮换 60 个主题 · 300 套模板"));
  assert.ok(rendererSource.includes("initializeMinecraftTemplateOptions"));
  assert.ok(rendererSource.includes("minecraftTemplateForBatchIndex(index, templateOffset)"));
  assert.ok(rendererSource.includes("templateOffset"));
  assert.ok(mainSource.includes("TEMPLATE_ID_PATTERN"));
  assert.ok(mainSource.includes("isRealTheme"));
  assert.ok(directorSource.includes("TEMPLATE_COUNT = 300"));
  assert.ok(directorSource.includes("TEMPLATE_VARIANTS_PER_THEME = 5"));
  assert.ok(directorSource.includes("CourseBuilder.isTemplateId(normalized)"));
  assert.ok(directorSource.includes('String.format("%s-v%02d"'));
  assert.ok(builderSource.includes("decorateTemplateVariant(stage)"));
  assert.ok(builderSource.includes("templateVariant(String theme)"));
  assert.ok(builderSource.includes("templateVariant * 0x94D049BB133111EBL"));
});

test("all 60 themes expose eight dedicated sub-scenes in continuous curated cycles", () => {
  const builderSource = fs.readFileSync(
    new URL("../minecraft-mod/src/main/java/com/parkoursim/director/CourseBuilder.java", import.meta.url),
    "utf8",
  );
  assert.ok(builderSource.includes("SUBSCENES_PER_THEME = 8"));
  assert.ok(builderSource.includes("SUBSCENE_ORDERS"));
  assert.ok(builderSource.includes("decorateThemeSubscene(stage, normalizedTheme, subscene)"));
  assert.ok(builderSource.includes("renameLatestStage(normalizedTheme, subscene)"));
  assert.ok(builderSource.includes("return SUBSCENE_ORDERS[orderIndex][position]"));
  for (const theme of MINECRAFT_BASE_THEMES) {
    const line = builderSource.split(/\r?\n/).find((candidate) => candidate.includes(`case "${theme.id}" -> new String[]`));
    assert.ok(line, `missing sub-scenes for ${theme.id}`);
    assert.equal((line.match(/"[^"]+"/g) || []).length, 9, `${theme.id} should have exactly eight named sub-scenes`);
  }
  const orders = [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [0, 2, 1, 4, 3, 6, 5, 7],
    [0, 3, 1, 5, 2, 6, 4, 7],
    [0, 1, 4, 2, 5, 3, 6, 7],
    [0, 4, 1, 3, 2, 5, 6, 7],
    [0, 2, 4, 1, 5, 3, 6, 7],
    [0, 3, 2, 4, 1, 6, 5, 7],
    [0, 1, 3, 5, 2, 4, 6, 7],
  ];
  for (const order of orders) {
    assert.equal(new Set(order).size, 8);
    assert.equal(order[0], 0);
    assert.equal(order.at(-1), 7);
    assert.ok(builderSource.includes(`{${order.join(", ")}}`));
  }
});

test("visual watchdog distinguishes a frozen frame from meaningful movement", () => {
  const still = new Uint8ClampedArray([20, 40, 60, 255, 80, 100, 120, 255]);
  const same = new Uint8ClampedArray(still);
  const moved = new Uint8ClampedArray([35, 55, 75, 255, 60, 80, 100, 255]);
  assert.equal(averageRgbFrameDifference(still, same), 0);
  assert.ok(averageRgbFrameDifference(still, moved) > 1.1);
  assert.equal(averageRgbFrameDifference(null, moved), Number.POSITIVE_INFINITY);
});

test("transient capture startup failures are retried", async () => {
  let attempts = 0;
  const retries = [];
  const result = await retryOperation(
    async () => {
      attempts++;
      if (attempts < CAPTURE_START_ATTEMPTS) throw new Error("temporary capture failure");
      return "ready";
    },
    {
      wait: () => Promise.resolve(),
      onRetry: (_error, attempt) => retries.push(attempt),
    },
  );
  assert.equal(result, "ready");
  assert.equal(attempts, CAPTURE_START_ATTEMPTS);
  assert.deepEqual(retries, [1, 2]);
});

test("capture startup reports the final error after bounded retries", async () => {
  let attempts = 0;
  await assert.rejects(
    retryOperation(async () => {
      attempts++;
      throw new Error("capture unavailable");
    }, { wait: () => Promise.resolve() }),
    /capture unavailable/,
  );
  assert.equal(attempts, CAPTURE_START_ATTEMPTS);
});

test("Minecraft capture selects the game and never the launcher", () => {
  const source = chooseMinecraftSource([
    { id: "launcher", name: "Minecraft Launcher" },
    { id: "github", name: "brucemk886/minecraft: source code - Google Chrome" },
    { id: "search", name: "Minecraft - Google Search - Google Chrome" },
    { id: "game", name: "Minecraft 26.2 - Singleplayer" },
  ]);
  assert.equal(source.id, "game");
  assert.equal(chooseMinecraftSource([{ id: "launcher", name: "Minecraft Launcher" }]), null);
  assert.equal(chooseMinecraftSource([{ id: "github", name: "GitHub - brucemk886/minecraft - Google Chrome" }]), null);
  assert.equal(isMinecraftGameSourceName("Minecraft* 26.2 - Singleplayer"), true);
  assert.equal(isMinecraftGameSourceName("Minecraft 1.21.8 - Multiplayer"), true);
  assert.equal(isMinecraftGameSourceName("minecraft - GitHub - Google Chrome"), false);
});

test("Minecraft capture uses the compatible desktop-video path without audio", () => {
  assert.deepEqual(minecraftCaptureConstraints("window:123"), {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: "window:123",
        maxFrameRate: 60,
      },
    },
  });
});

test("wide Minecraft windows are center-cropped to vertical video", () => {
  const crop = coverCrop(1920, 1080, 1080, 1920);
  assert.equal(crop.sy, 0);
  assert.equal(crop.sh, 1080);
  assert.equal(crop.sw, 607.5);
  assert.equal(crop.sx, 656.25);
});

test("Minecraft window title bar is excluded from the vertical crop", () => {
  const crop = minecraftContentCrop(856, 512, 720, 1280);
  assert.equal(crop.sy, 33);
  assert.equal(crop.sh, 479);
  assert.equal(crop.sw, 269.4375);
});

test("recorded gameplay lifts shadows without crushing them with extra contrast", () => {
  assert.equal(RECORDED_COLOR_FILTER, "saturate(1.16) contrast(0.98) brightness(1.00)");
  assert.equal(RECORDED_VIGNETTE_ALPHA, 0.07);
  assert.match(recordedColorFilter("library"), /brightness\(1\.07\)/);
  assert.match(recordedColorFilter("checker"), /brightness\(0\.93\)/);
  assert.equal(recordedColorFilter("unknown"), RECORDED_COLOR_FILTER);
});

test("managed shader profile raises cave visibility and color on the safe renderer", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  for (const setting of [
    '"TM_EXPOSURE=1.10"',
    '"TM_CONTRAST=0.95"',
    '"T_SATURATION=1.30"',
    '"T_VIBRANCE=1.25"',
    '"AMBIENT_MULT=140"',
    '"CAVE_LIGHTING=180"',
    '"LESS_LAVA_FOG=true"',
  ]) {
    assert.ok(mainSource.includes(setting), `missing shader option ${setting}`);
  }
  assert.ok(mainSource.includes('"COLORED_LIGHTING=0"'));
  assert.ok(mainSource.includes('"WORLD_SPACE_REFLECTIONS=-1"'));
});

test("desktop output directory defaults to D drive and can be changed persistently", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const preloadSource = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
  const htmlSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const rendererSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.ok(mainSource.includes('path.join("D:\\\\", "方块跑酷模拟器视频")'));
  assert.ok(mainSource.includes('ipcMain.handle("get-clips-directory"'));
  assert.ok(mainSource.includes('ipcMain.handle("choose-clips-directory"'));
  assert.ok(mainSource.includes('ipcMain.handle("start-recording-file"'));
  assert.ok(mainSource.includes('ipcMain.handle("append-recording-chunk"'));
  assert.ok(mainSource.includes('ipcMain.handle("finish-recording-file"'));
  assert.ok(mainSource.includes('path.basename(String(suggestedName'));
  assert.ok(preloadSource.includes("chooseClipsDirectory"));
  assert.ok(htmlSource.includes('id="clipDirectory"'));
  assert.ok(htmlSource.includes('id="btnChooseClipDirectory"'));
  assert.ok(rendererSource.includes("refreshClipDirectory();"));
});

test("real workflow supports long one-way seeded jobs and automatic batches", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const preloadSource = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
  const htmlSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const rendererSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const directorSource = fs.readFileSync(
    new URL("../minecraft-mod/src/client/java/com/parkoursim/director/client/ParkourDirectorClient.java", import.meta.url),
    "utf8",
  );
  const builderSource = fs.readFileSync(
    new URL("../minecraft-mod/src/main/java/com/parkoursim/director/CourseBuilder.java", import.meta.url),
    "utf8",
  );
  assert.ok(mainSource.includes('ipcMain.handle("start-parkour-job"'));
  assert.ok(mainSource.includes('ipcMain.handle("get-parkour-status"'));
  assert.ok(preloadSource.includes("startParkourJob"));
  assert.ok(htmlSource.includes('<option value="120" selected>'));
  assert.ok(htmlSource.includes('<option value="600">'));
  assert.ok(htmlSource.includes('<option value="900">'));
  assert.ok(htmlSource.includes('id="realBatchCount" type="number"'));
  assert.ok(htmlSource.includes('max="999"'));
  assert.ok(rendererSource.includes("waitForParkourReady"));
  assert.ok(rendererSource.includes("keepSource: true"));
  assert.ok(rendererSource.includes("waitForRecordingDuration"));
  assert.ok(rendererSource.includes("MINECRAFT_ITEM_ATTEMPTS = 3"));
  assert.ok(directorSource.includes("STREAM_AHEAD_STAGES"));
  assert.ok(directorSource.includes("INITIAL_BUILD_BATCH = 320"));
  assert.ok(directorSource.includes("STREAM_BUILD_BATCH = 220"));
  assert.ok(directorSource.includes("PREBUILD_STAGES = 3"));
  assert.ok(directorSource.includes("STREAM_AHEAD_STAGES = 3"));
  assert.ok(directorSource.includes("targetDurationSeconds + 25.0"));
  assert.ok(directorSource.includes("WALK_LOOK_AHEAD = 7"));
  assert.ok(directorSource.includes("paceFactor()"));
  assert.doesNotMatch(directorSource, /beginTurnaround|advanceTurnaround|routeDirection/);
  assert.ok(builderSource.includes("planStage(BlockPos playerOrigin, String theme, long seed, int stage)"));
  assert.ok(builderSource.includes("seededInt("));
});

test("scheduled batches persist their parameters and keep the app active until recording", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const preloadSource = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
  const htmlSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const rendererSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.ok(htmlSource.includes('id="scheduledStartAt" type="datetime-local"'));
  assert.ok(htmlSource.includes('id="btnScheduleRecording"'));
  assert.ok(htmlSource.includes('id="btnCancelSchedule"'));
  assert.ok(preloadSource.includes("setKeepAwake"));
  assert.ok(mainSource.includes('powerSaveBlocker.start("prevent-app-suspension")'));
  assert.ok(rendererSource.includes('RECORDING_SCHEDULE_KEY = "parkoursim-recording-schedule-v1"'));
  assert.ok(rendererSource.includes("window.localStorage.setItem(RECORDING_SCHEDULE_KEY"));
  assert.ok(rendererSource.includes("scheduleTickTimer = window.setInterval(tickRecordingSchedule, 1000)"));
  assert.ok(rendererSource.includes("applyScheduledParameters(task)"));
  assert.ok(rendererSource.includes("startGame(true)"));
});

test("overnight batches detect stalls, discard bad clips, and keep a resumable checkpoint", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const htmlSource = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const rendererSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const captureSource = fs.readFileSync(new URL("../src/minecraft.js", import.meta.url), "utf8");
  assert.ok(mainSource.includes("status.statusFileAgeMs"));
  assert.ok(rendererSource.includes("PARKOUR_HEARTBEAT_TIMEOUT_MS = 60_000"));
  assert.ok(rendererSource.includes("PARKOUR_VISUAL_FREEZE_TIMEOUT_MS = 60_000"));
  assert.ok(rendererSource.includes("monitorParkourRecording"));
  assert.ok(rendererSource.includes("minecraftRecorder.discard()"));
  assert.ok(captureSource.includes("visualIdleMilliseconds()"));
  assert.ok(captureSource.includes("abortRecordingFile(this.fileSession.sessionId)"));
  assert.ok(rendererSource.includes('BATCH_CHECKPOINT_KEY = "parkoursim-batch-checkpoint-v1"'));
  assert.ok(rendererSource.includes("saveBatchCheckpoint"));
  assert.ok(rendererSource.includes("pauseBatchCheckpoint"));
  assert.ok(htmlSource.includes('id="btnResumeBatch"'));
  assert.ok(htmlSource.includes('id="btnDiscardBatch"'));
});

test("large batches skip failed items, retry them at the end, and reuse a persistent bounded theme grid", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const rendererSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const directorSource = fs.readFileSync(
    new URL("../minecraft-mod/src/client/java/com/parkoursim/director/client/ParkourDirectorClient.java", import.meta.url),
    "utf8",
  );
  assert.ok(rendererSource.includes("recordMinecraftItemWithRetries"));
  assert.ok(rendererSource.includes("failedItems"));
  assert.ok(rendererSource.includes("已记入补跑队列，继续下一条"));
  assert.ok(rendererSource.includes("主队列已完成，将补跑"));
  assert.ok(rendererSource.includes("batchCount + 1"));
  assert.ok(rendererSource.includes("fatalBatchError"));
  assert.ok(mainSource.includes("parkoursim-heartbeat.txt"));
  assert.ok(mainSource.includes("heartbeatElapsedSeconds"));
  assert.ok(mainSource.includes("batchIndex=${batchIndex}"));
  assert.ok(mainSource.includes("optimizeMinecraftVideoSettings();"));
  assert.ok(directorSource.includes("THEME_GRID_COLUMNS = 6"));
  assert.ok(directorSource.includes("THEME_COLUMN_SPACING = 64"));
  assert.ok(directorSource.includes("THEME_ROW_SPACING = 5120"));
  assert.ok(directorSource.includes("ANCHOR_LAYOUT_VERSION = \"grid60-v3\""));
  assert.ok(directorSource.includes("batchAnchor"));
  assert.ok(directorSource.includes("parkoursim-anchor.properties"));
  assert.ok(directorSource.includes("worldAnchorPrefix()"));
  assert.ok(directorSource.includes("per-world fixed 60-theme region grid"));
  assert.ok(directorSource.includes('.filter(key -> key.startsWith(regionPrefix))'));
  assert.ok(directorSource.includes('properties.remove(staleRegionKey)'));
  assert.ok(directorSource.includes("regionY."));
  assert.ok(directorSource.includes("client.options.renderDistance().set(MANAGED_RENDER_DISTANCE)"));
  assert.ok(directorSource.includes("client.options.simulationDistance().set(MANAGED_SIMULATION_DISTANCE)"));
  assert.ok(directorSource.includes("parkoursim-heartbeat.txt"));
});

test("large overnight batches enforce disk safety and recycle capture resources every 50 clips", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const preloadSource = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
  const rendererSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.ok(mainSource.includes("MIN_FREE_STORAGE_BYTES = 20 * 1024 * 1024 * 1024"));
  assert.ok(mainSource.includes("fs.statfsSync(directory)"));
  assert.ok(mainSource.includes('ipcMain.handle("get-recording-storage-status"'));
  assert.ok(preloadSource.includes("getRecordingStorageStatus"));
  assert.ok(rendererSource.includes("BATCH_MAINTENANCE_INTERVAL = 50"));
  assert.ok(rendererSource.includes("performBatchMaintenance(index, batchCount)"));
  assert.ok(rendererSource.includes("minecraftRecorder.close(false)"));
  assert.ok(rendererSource.includes("低于 20 GB 安全线；任务已暂停并保留断点"));
});

test("generation history avoids 30-day combinations and reviews five-frame visual similarity", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  const preloadSource = fs.readFileSync(new URL("../electron/preload.cjs", import.meta.url), "utf8");
  const rendererSource = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const directorSource = fs.readFileSync(
    new URL("../minecraft-mod/src/client/java/com/parkoursim/director/client/ParkourDirectorClient.java", import.meta.url),
    "utf8",
  );
  const builderSource = fs.readFileSync(
    new URL("../minecraft-mod/src/main/java/com/parkoursim/director/CourseBuilder.java", import.meta.url),
    "utf8",
  );
  assert.ok(mainSource.includes("GENERATION_HISTORY_DAYS = 30"));
  assert.ok(mainSource.includes('"generation-history.json"'));
  assert.ok(mainSource.includes('ipcMain.handle("complete-parkour-job"'));
  assert.ok(mainSource.includes('"-frames:v", "5"'));
  assert.ok(mainSource.includes('"_similar-review"'));
  assert.ok(preloadSource.includes("completeParkourJob"));
  assert.ok(rendererSource.includes("正在抽取 5 帧检查近 30 天画面重复度"));
  for (const field of ["paletteVariant", "landmarkPack", "terrainProfile", "sceneOrderProfile", "cameraProfile"]) {
    assert.ok(mainSource.includes(field), `desktop should persist ${field}`);
    assert.ok(directorSource.includes(field), `director should expose ${field}`);
  }
  assert.ok(builderSource.includes("clearKnownDecorations(stage)"));
});

test("director no longer forces the Minecraft window to maximize", () => {
  const directorSource = fs.readFileSync(
    new URL("../minecraft-mod/src/client/java/com/parkoursim/director/client/ParkourDirectorClient.java", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(directorSource, /glfwMaximizeWindow|windowMaximized/);
});

test("new routes avoid dark terrain and receive invisible path lighting", () => {
  const directorSource = fs.readFileSync(
    new URL("../minecraft-mod/src/client/java/com/parkoursim/director/client/ParkourDirectorClient.java", import.meta.url),
    "utf8",
  );
  const builderSource = fs.readFileSync(
    new URL("../minecraft-mod/src/main/java/com/parkoursim/director/CourseBuilder.java", import.meta.url),
    "utf8",
  );
  assert.ok(directorSource.includes("terrainY + 8"));
  assert.ok(directorSource.includes("FIXED_DAY_TIME = 6000L"));
  assert.ok(directorSource.includes("setPaused(clock, true)"));
  assert.ok(builderSource.includes("Blocks.LIGHT"));
});

test("long recordings rotate through distinct sub-scenes inside one theme", () => {
  const builderSource = fs.readFileSync(
    new URL("../minecraft-mod/src/main/java/com/parkoursim/director/CourseBuilder.java", import.meta.url),
    "utf8",
  );
  for (const helper of [
    "villageSectionName", "lushSectionName", "checkerSectionName", "honeySectionName",
    "cherrySectionName", "iceSectionName", "netherSectionName", "crystalSectionName",
  ]) {
    assert.ok(builderSource.includes(`${helper}(int stage)`), `${helper} should vary by stage`);
  }
  assert.ok(builderSource.match(/Math\.floorMod\(sceneIndex\(stage\), 5\)/g).length >= 8);
  assert.ok(builderSource.includes("Math.floorMod(sceneIndex(stage), 4)"));
});

test("managed Minecraft graphics keep shaders while reducing startup pressure", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  assert.ok(mainSource.includes('"maxShadowRenderDistance=24"'));
  assert.ok(mainSource.includes('"shadowDistance=64.0"'));
  assert.ok(mainSource.includes('["renderDistance", "renderDistance:12"]'));
  assert.ok(mainSource.includes('["simulationDistance", "simulationDistance:8"]'));
  assert.ok(mainSource.includes('["maxFps", "maxFps:90"]'));
});

test("managed Minecraft capture favors sharp windowed source pixels", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  assert.ok(mainSource.includes('"FXAA_DEFINE=-1"'));
  assert.ok(mainSource.includes('"TAA_MODE=1"'));
  assert.ok(mainSource.includes('"TAA_SMOOTHING=2"'));
  assert.ok(mainSource.includes('"ANISOTROPIC_FILTER=8"'));
  assert.ok(mainSource.includes('"BLOOM_STRENGTH=0.045"'));
  assert.ok(mainSource.includes('"IMAGE_SHARPENING=5"'));
  assert.ok(mainSource.includes('"MOTION_BLUR_EFFECT=-1"'));
  assert.ok(mainSource.includes('"WORLD_BLUR=0"'));
  assert.ok(mainSource.includes('["mipmapLevels", "mipmapLevels:4"]'));
  assert.ok(mainSource.includes('["overrideWidth", `overrideWidth:${windowSize.width}`]'));
  assert.ok(mainSource.includes('["overrideHeight", `overrideHeight:${windowSize.height}`]'));
  assert.ok(mainSource.includes('["fullscreen", "fullscreen:false"]'));
});

test("MP4 export uses balanced compact H.264 video without audio", () => {
  const mainSource = fs.readFileSync(new URL("../electron/main.cjs", import.meta.url), "utf8");
  assert.ok(mainSource.includes('"libx264"'));
  assert.ok(mainSource.includes('"slow"'));
  assert.match(mainSource, /"-crf",\s*"21"/);
  assert.ok(mainSource.includes('"unsharp=5:5:0.40:5:5:0.0"'));
  assert.ok(mainSource.includes('"0:v:0"'));
  assert.doesNotMatch(mainSource, /"0:a/);
});
