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
  minecraftTemplateForBatchIndex,
} from "../src/minecraft-templates.js";

test("Minecraft exposes 100 real templates and cycles without repeats", () => {
  assert.equal(MINECRAFT_BASE_THEMES.length, 10);
  assert.equal(MINECRAFT_TEMPLATE_STYLES.length, 10);
  assert.equal(MINECRAFT_TEMPLATES.length, 100);
  assert.equal(new Set(MINECRAFT_TEMPLATES.map((template) => template.id)).size, 100);
  assert.equal(new Set(Array.from({ length: 100 }, (_, index) => minecraftTemplateForBatchIndex(index + 1, 17).id)).size, 100);
  assert.equal(minecraftTemplateForBatchIndex(1, 17).id, minecraftTemplateForBatchIndex(101, 17).id);
  assert.equal(minecraftBaseTheme("crystal-v10"), "crystal");
  assert.equal(minecraftBaseTheme("library"), "library");
});

test("desktop and director pass all 100 template ids into distinct route structures", () => {
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
  assert.ok(htmlSource.includes("每次随机 100 套模板（前100条不重复）"));
  assert.ok(rendererSource.includes("initializeMinecraftTemplateOptions"));
  assert.ok(rendererSource.includes("minecraftTemplateForBatchIndex(index, templateOffset)"));
  assert.ok(rendererSource.includes("templateOffset"));
  assert.ok(mainSource.includes("TEMPLATE_ID_PATTERN"));
  assert.ok(mainSource.includes("isRealTheme"));
  assert.ok(directorSource.includes("TEMPLATE_COUNT = 100"));
  assert.ok(directorSource.includes("CourseBuilder.isTemplateId(normalized)"));
  assert.ok(directorSource.includes('String.format("%s-v%02d"'));
  assert.ok(builderSource.includes("decorateTemplateVariant(stage)"));
  assert.ok(builderSource.includes("templateVariant(String theme)"));
  assert.ok(builderSource.includes("templateVariant * 0x94D049BB133111EBL"));
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
  assert.ok(htmlSource.includes('<option value="600" selected>'));
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
  assert.ok(rendererSource.includes("PARKOUR_HEARTBEAT_TIMEOUT_MS = 15_000"));
  assert.ok(rendererSource.includes("PARKOUR_VISUAL_FREEZE_TIMEOUT_MS = 15_000"));
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
