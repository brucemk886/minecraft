import { recordingBitrate } from "./recorder.js";

export const RECORDED_COLOR_FILTER = "saturate(1.22) contrast(0.97) brightness(1.03)";
export const RECORDED_VIGNETTE_ALPHA = 0.07;

export function chooseMinecraftSource(sources) {
  const windows = Array.isArray(sources) ? sources : [];
  return (
    windows.find((source) => /minecraft/i.test(source.name) && !/launcher/i.test(source.name)) ||
    null
  );
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
    this.completion = Promise.resolve(null);
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

  async start({ record, seconds, width, height, fileName }) {
    if (this.active) {
      this.stop();
      await this.completion.catch(() => {});
    }
    await this.close(false);
    if (!window.desktop?.listCaptureSources) {
      throw new Error("当前不是桌面 EXE，无法捕获 Minecraft 窗口");
    }
    const sources = await window.desktop.listCaptureSources();
    const source = chooseMinecraftSource(sources);
    if (!source) {
      throw new Error("没有找到 Minecraft 游戏窗口。请先进入 Java 版单人世界，不要停在 Launcher");
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.sourceStream = await navigator.mediaDevices.getUserMedia(minecraftCaptureConstraints(source.id));
    this.video.srcObject = this.sourceStream;
    await this.video.play();
    this.running = true;
    this.drawFrame();

    if (record) await this.beginRecording(seconds, fileName);
    else this.onStatus(`正在预览真实窗口：${source.name}`);
    return { source, completion: this.completion };
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
    this.completion = new Promise((resolve, reject) => {
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
      try {
        await this.writeQueue;
        if (this.writeError) throw this.writeError;
        const result = await window.desktop.finishRecordingFile(this.fileSession.sessionId);
        this.onStatus(result.converted ? `已保存 MP4：${result.filePath}` : `已保存：${result.filePath}`);
        resolveCompletion(result);
      } catch (error) {
        this.onStatus(`导出失败：${error.message}`);
        if (this.fileSession) await window.desktop.abortRecordingFile(this.fileSession.sessionId).catch(() => {});
        rejectCompletion(error);
      } finally {
        this.fileSession = null;
        await this.close(false);
      }
    };
    this.recorder.start(1000);
    this.recording = true;
    this.onStatus(seconds ? `正在录制真实 Minecraft：${seconds} 秒…` : "正在录制真实 Minecraft，按停止结束");
    if (seconds > 0) this.timer = window.setTimeout(() => this.stop(), seconds * 1000);
  }

  drawFrame = () => {
    if (!this.running) return;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const sourceWidth = this.video.videoWidth || width;
    const sourceHeight = this.video.videoHeight || height;
    const crop = minecraftContentCrop(sourceWidth, sourceHeight, width, height);
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = "high";
    this.ctx.filter = RECORDED_COLOR_FILTER;
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
    this.animation = requestAnimationFrame(this.drawFrame);
  };

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
    this.close(false);
    return this.completion;
  }

  async close(stopRecorder = true) {
    window.clearTimeout(this.timer);
    if (stopRecorder && this.recorder && this.recorder.state !== "inactive") {
      this.recording = false;
      this.recorder.stop();
      return;
    }
    this.running = false;
    cancelAnimationFrame(this.animation);
    this.sourceStream?.getTracks().forEach((track) => track.stop());
    this.recordStream?.getVideoTracks().forEach((track) => track.stop());
    this.sourceStream = null;
    this.recordStream = null;
    this.video.srcObject = null;
    this.recorder = null;
  }
}
