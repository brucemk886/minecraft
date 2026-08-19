import { recordingBitrate } from "./recorder.js";
import { minecraftTemplateById } from "./minecraft-templates.js";

export const RECORDED_COLOR_FILTER = "saturate(1.16) contrast(0.98) brightness(1.00)";
export const RECORDED_VIGNETTE_ALPHA = 0.07;
export const CAPTURE_START_ATTEMPTS = 3;
export const CAPTURE_RETRY_DELAY_MS = 1200;

export function recordedColorFilter(theme) {
  const profiles = {
    village: "saturate(1.10) contrast(0.98) brightness(0.94)",
    checker: "saturate(1.06) contrast(0.98) brightness(0.93)",
    cherry: "saturate(1.10) contrast(0.98) brightness(0.95)",
    crystal: "saturate(1.12) contrast(0.98) brightness(0.97)",
    ice: "saturate(1.10) contrast(0.98) brightness(0.98)",
    library: "saturate(1.16) contrast(0.98) brightness(1.07)",
    lush: "saturate(1.18) contrast(0.98) brightness(1.06)",
    honey: "saturate(1.13) contrast(0.98) brightness(1.02)",
    lava: "saturate(1.12) contrast(0.98) brightness(1.00)",
    nether: "saturate(1.12) contrast(0.98) brightness(1.03)",
  };
  const normalized = String(theme || "").trim().toLowerCase();
  const baseTheme = minecraftTemplateById(normalized)?.baseTheme || normalized;
  return profiles[baseTheme] || RECORDED_COLOR_FILTER;
}

export function averageRgbFrameDifference(previous, current) {
  if (!previous || !current || previous.length !== current.length || current.length < 4) return Number.POSITIVE_INFINITY;
  let difference = 0;
  let pixels = 0;
  for (let index = 0; index < current.length; index += 4) {
    difference += Math.abs(current[index] - previous[index]);
    difference += Math.abs(current[index + 1] - previous[index + 1]);
    difference += Math.abs(current[index + 2] - previous[index + 2]);
    pixels++;
  }
  return difference / (pixels * 3);
}

export async function retryOperation(operation, {
  attempts = CAPTURE_START_ATTEMPTS,
  wait = () => Promise.resolve(),
  onRetry = () => {},
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= Math.max(1, attempts); attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      onRetry(error, attempt);
      await wait(attempt);
    }
  }
  throw lastError;
}

export function isMinecraftGameSourceName(name) {
  const title = String(name || "").trim();
  return /^minecraft(?:\*|™)?\s+\d+(?:\.\d+)+(?:\s|$)/i.test(title)
    && !/(launcher|google chrome|microsoft edge|firefox|brave|opera|github|visual studio code|cursor)/i.test(title);
}

export function chooseMinecraftSource(sources) {
  const windows = Array.isArray(sources) ? sources : [];
  return windows.find((source) => isMinecraftGameSourceName(source.name)) || null;
}

export function coverCrop(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every((value) => value > 0)) {
    return { sx: 0, sy: 0, sw: 1, sh: 1 };
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const sw = sourceHeight * targetRatio;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / targetRatio;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

export function minecraftContentCrop(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const titleBarHeight = sourceHeight >= 300 ? Math.min(48, Math.round(sourceHeight * 0.065)) : 0;
  const contentHeight = Math.max(1, sourceHeight - titleBarHeight);
  const crop = coverCrop(sourceWidth, contentHeight, targetWidth, targetHeight);
  return { ...crop, sy: crop.sy + titleBarHeight };
}

export function minecraftCaptureConstraints(sourceId) {
  return {
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: 60,
      },
    },
  };
}

export class RealMinecraftRecorder {
  constructor(canvas, onStatus) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.onStatus = onStatus;
    this.sourceStream = null;
    this.video = document.createElement("video");
    this.video.muted = true;
    this.video.playsInline = true;
    this.running = false;
    this.recording = false;
    this.recorder = null;
    this.timer = 0;
    this.animation = 0;
    this.recordStream = null;
    this.fileSession = null;
    this.writeQueue = Promise.resolve();
    this.writeError = null;
    this.captureError = null;
    this.sourceName = "";
    this.keepSourceBetweenRecordings = false;
    this.completion = Promise.resolve(null);
    this.colorFilter = RECORDED_COLOR_FILTER;
    this.activityCanvas = document.createElement("canvas");
    this.activityCanvas.width = 18;
    this.activityCanvas.height = 32;
    this.activityContext = this.activityCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
    this.lastActivityPixels = null;
    this.lastActivitySampleAt = 0;
    this.lastVisualChangeAt = 0;
    this.discardRecording = false;
  }

  get active() {
    return this.running || this.recording;
  }

  get supportedType() {
    const types = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    return types.find((type) => window.MediaRecorder?.isTypeSupported(type)) || "";
  }

  async start({ record, seconds, width, height, fileName, keepSource = false, theme = "" }) {
    if (this.recording) {
      const saving = this.stop();
      if (saving) await saving;
    }
    this.keepSourceBetweenRecordings = Boolean(keepSource);
    this.colorFilter = recordedColorFilter(theme);
    const source = await this.ensureSource({ width, height });

    if (record) {
      await retryOperation(
        async () => {
          try {
            await this.beginRecording(seconds, fileName);
          } catch (error) {
            await this.abortRecordingStart();
            throw error;
          }
        },
        {
          wait: (attempt) => this.wait(CAPTURE_RETRY_DELAY_MS * attempt),
          onRetry: (_error, attempt) => this.onStatus(`录制组件启动失败，正在重试 ${attempt + 1}/${CAPTURE_START_ATTEMPTS}…`),
        },
      );
    } else {
      this.onStatus(`正在预览真实窗口：${source.name}`);
    }
    return { source, completion: this.completion };
  }

  hasLiveSource() {
    const track = this.sourceStream?.getVideoTracks?.()[0];
    return Boolean(track && track.readyState === "live" && this.video.srcObject === this.sourceStream);
  }

  async ensureSource({ width, height }) {
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.hasLiveSource()) {
      this.running = true;
      if (!this.animation) this.drawFrame();
      return { name: this.sourceName };
    }

    await this.releaseSource();
    if (!window.desktop?.listCaptureSources) {
      throw new Error("当前不是桌面 EXE，无法捕获 Minecraft 窗口");
    }

    return retryOperation(
      async () => {
        let stream = null;
        try {
          const sources = await window.desktop.listCaptureSources();
          const source = chooseMinecraftSource(sources);
          if (!source) {
            throw new Error("没有找到 Minecraft 游戏窗口。请先进入 Java 版单人世界，不要停在 Launcher");
          }
          stream = await navigator.mediaDevices.getUserMedia(minecraftCaptureConstraints(source.id));
          const sourceTrack = stream.getVideoTracks()[0];
          if (!sourceTrack || sourceTrack.readyState !== "live") {
            throw new Error("Minecraft 窗口捕获轨道未能启动");
          }
          this.sourceStream = stream;
          this.sourceName = source.name;
          this.captureError = null;
          sourceTrack.addEventListener("ended", () => {
            if (this.sourceStream !== stream) return;
            this.captureError = new Error("Minecraft 游戏窗口捕获意外中断");
            if (this.recording) this.stop();
            this.onStatus("Minecraft 游戏窗口捕获已中断，当前任务将自动重试");
          }, { once: true });
          this.video.srcObject = stream;
          await this.video.play();
          this.running = true;
          this.drawFrame();
          return source;
        } catch (error) {
          if (this.sourceStream === stream) await this.releaseSource();
          else stream?.getTracks().forEach((track) => track.stop());
          throw error;
        }
      },
      {
        wait: async (attempt) => {
          await this.releaseSource();
          await this.wait(CAPTURE_RETRY_DELAY_MS * attempt);
        },
        onRetry: (_error, attempt) => this.onStatus(`Minecraft 窗口捕获失败，正在重试 ${attempt + 1}/${CAPTURE_START_ATTEMPTS}…`),
      },
    );
  }

  async beginRecording(seconds, requestedName) {
    if (!this.supportedType) throw new Error("当前环境不支持视频录制");
    if (!window.desktop?.startRecordingFile) throw new Error("桌面端录制组件不完整");
    const output = this.canvas.captureStream(30);
    this.recordStream = output;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = requestedName || `minecraft-parkour-${stamp}.webm`;
    this.fileSession = await window.desktop.startRecordingFile(name);
    this.writeQueue = Promise.resolve();
    this.writeError = null;
    this.discardRecording = false;
    this.lastVisualChangeAt = performance.now();
    try {
      this.recorder = new MediaRecorder(output, {
        mimeType: this.supportedType,
        videoBitsPerSecond: recordingBitrate(this.canvas.width, this.canvas.height),
      });
    } catch (error) {
      await window.desktop.abortRecordingFile(this.fileSession.sessionId);
      this.fileSession = null;
      throw error;
    }
    let resolveCompletion;
    let rejectCompletion;
    const completion = new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    this.recorder.ondataavailable = (event) => {
      if (!event.data.size || !this.fileSession) return;
      const sessionId = this.fileSession.sessionId;
      this.writeQueue = this.writeQueue
        .then(async () => window.desktop.appendRecordingChunk(sessionId, await event.data.arrayBuffer()))
        .catch((error) => {
          this.writeError ||= error;
        });
    };
    this.recorder.onstop = async () => {
      let result = null;
      let failure = null;
      try {
        await this.writeQueue;
        if (this.discardRecording) {
          await window.desktop.abortRecordingFile(this.fileSession.sessionId);
          result = { aborted: true };
          this.onStatus("已丢弃异常录制，正在自动重试…");
        } else {
          if (this.writeError) throw this.writeError;
          if (this.captureError) throw this.captureError;
          result = await window.desktop.finishRecordingFile(this.fileSession.sessionId);
          this.onStatus(result.converted ? `已保存 MP4：${result.filePath}` : `已保存：${result.filePath}`);
        }
      } catch (error) {
        failure = error;
        this.onStatus(`导出失败：${error.message}`);
        if (this.fileSession) await window.desktop.abortRecordingFile(this.fileSession.sessionId).catch(() => {});
      } finally {
        this.fileSession = null;
        this.finishRecordingState();
        if (!this.keepSourceBetweenRecordings) await this.releaseSource();
      }
      if (failure) rejectCompletion(failure);
      else resolveCompletion(result);
    };
    try {
      this.recorder.start(1000);
    } catch (error) {
      this.recorder.ondataavailable = null;
      this.recorder.onstop = null;
      await window.desktop.abortRecordingFile(this.fileSession.sessionId).catch(() => {});
      this.fileSession = null;
      this.finishRecordingState();
      throw error;
    }
    this.completion = completion;
    this.recording = true;
    this.onStatus(seconds ? `正在录制真实 Minecraft：${seconds} 秒…` : "正在录制真实 Minecraft，按停止结束");
    if (seconds > 0) this.timer = window.setTimeout(() => this.stop(), seconds * 1000);
  }

  drawFrame = () => {
    this.animation = 0;
    if (!this.running) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const sourceWidth = this.video.videoWidth || width;
    const sourceHeight = this.video.videoHeight || height;
    const crop = minecraftContentCrop(sourceWidth, sourceHeight, width, height);
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.ctx.filter = this.colorFilter;
    this.ctx.drawImage(
      this.video,
      crop.sx,
      crop.sy,
      crop.sw,
      crop.sh,
      0,
      0,
      width,
      height,
    );
    this.ctx.restore();
    this.drawVignette();
    this.sampleVisualActivity();
    this.animation = requestAnimationFrame(this.drawFrame);
  };

  sampleVisualActivity() {
    const now = performance.now();
    if (!this.activityContext || now - this.lastActivitySampleAt < 1000) return;
    this.lastActivitySampleAt = now;
    this.activityContext.drawImage(this.canvas, 0, 0, this.activityCanvas.width, this.activityCanvas.height);
    const pixels = this.activityContext.getImageData(0, 0, this.activityCanvas.width, this.activityCanvas.height).data;
    if (!this.lastActivityPixels) {
      this.lastActivityPixels = new Uint8ClampedArray(pixels);
      this.lastVisualChangeAt = now;
      return;
    }
    const averageDifference = averageRgbFrameDifference(this.lastActivityPixels, pixels);
    if (averageDifference >= 1.1) this.lastVisualChangeAt = now;
    this.lastActivityPixels.set(pixels);
  }

  visualIdleMilliseconds() {
    return this.lastVisualChangeAt > 0 ? Math.max(0, performance.now() - this.lastVisualChangeAt) : 0;
  }

  drawVignette() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const vignette = ctx.createRadialGradient(
      width * 0.5,
      height * 0.46,
      width * 0.16,
      width * 0.5,
      height * 0.5,
      height * 0.72,
    );
    vignette.addColorStop(0.55, "rgba(0,0,0,0)");
    vignette.addColorStop(1, `rgba(3,8,16,${RECORDED_VIGNETTE_ALPHA})`);
    ctx.save();
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }

  stop() {
    window.clearTimeout(this.timer);
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recording = false;
      this.recorder.stop();
      this.onStatus("正在导出真实 Minecraft 视频…");
      return this.completion;
    }
    if (!this.keepSourceBetweenRecordings) this.releaseSource();
    return this.completion;
  }

  async discard() {
    window.clearTimeout(this.timer);
    this.discardRecording = true;
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recording = false;
      this.recorder.stop();
    }
    try {
      return await this.completion;
    } catch {
      return { aborted: true };
    }
  }

  async close(stopRecorder = true) {
    window.clearTimeout(this.timer);
    let result = null;
    try {
      if (stopRecorder && this.recorder && this.recorder.state !== "inactive") {
        const saving = this.stop();
        if (saving) result = await saving;
      }
    } finally {
      this.finishRecordingState();
      await this.releaseSource();
    }
    return result;
  }

  finishRecordingState() {
    this.recording = false;
    this.recordStream?.getVideoTracks().forEach((track) => track.stop());
    this.recordStream = null;
    this.recorder = null;
    this.discardRecording = false;
  }

  async abortRecordingStart() {
    if (this.fileSession) {
      await window.desktop.abortRecordingFile(this.fileSession.sessionId).catch(() => {});
      this.fileSession = null;
    }
    this.finishRecordingState();
  }

  async releaseSource() {
    this.running = false;
    if (this.animation) cancelAnimationFrame(this.animation);
    this.animation = 0;
    const stream = this.sourceStream;
    this.sourceStream = null;
    this.sourceName = "";
    if (this.video.srcObject === stream) this.video.srcObject = null;
    stream?.getTracks().forEach((track) => track.stop());
  }

  wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }
}
