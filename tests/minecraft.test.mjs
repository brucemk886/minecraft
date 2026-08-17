import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  RECORDED_COLOR_FILTER,
  RECORDED_VIGNETTE_ALPHA,
  chooseMinecraftSource,
  coverCrop,
  minecraftCaptureConstraints,
  minecraftContentCrop,
} from "../src/minecraft.js";

test("Minecraft capture selects the game and never the launcher", () => {
  const source = chooseMinecraftSource([
    { id: "launcher", name: "Minecraft Launcher" },
    { id: "game", name: "Minecraft 26.2 - Singleplayer" },
  ]);
  assert.equal(source.id, "game");
  assert.equal(chooseMinecraftSource([{ id: "launcher", name: "Minecraft Launcher" }]), null);
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
  assert.equal(RECORDED_COLOR_FILTER, "saturate(1.22) contrast(0.97) brightness(1.03)");
  assert.equal(RECORDED_VIGNETTE_ALPHA, 0.07);
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
  assert.ok(htmlSource.includes('id="realBatchCount"'));
  assert.ok(rendererSource.includes("waitForParkourReady"));
  assert.ok(directorSource.includes("STREAM_AHEAD_STAGES"));
  assert.ok(directorSource.includes("targetDurationSeconds + 25.0"));
  assert.doesNotMatch(directorSource, /beginTurnaround|advanceTurnaround|routeDirection/);
  assert.ok(builderSource.includes("planStage(BlockPos playerOrigin, String theme, long seed, int stage)"));
  assert.ok(builderSource.includes("seededInt("));
});

test("director no longer forces the Minecraft window to maximize", () => {
  const directorSource = fs.readFileSync(
    new URL("../minecraft-mod/src/client/java/com/parkoursim/director/client/ParkourDirectorClient.java", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(directorSource, /glfwMaximizeWindow|windowMaximized/);
});
