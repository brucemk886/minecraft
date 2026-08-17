export function recordingBitrate(width, height) {
  return width * height >= 1_800_000 ? 16_000_000 : 9_000_000;
}

export class ClipRecorder {
  constructor(canvas, onStatus) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    this.recorder = null;
    this.chunks = [];
    this.timer = 0;
  }

  get supportedType() {
    const types = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    return types.find((type) => window.MediaRecorder?.isTypeSupported(type)) || "";
  }

  start(seconds) {
    if (!this.supportedType) {
      this.onStatus("当前环境不支持录制");
      return false;
    }
    this.chunks = [];
    const stream = this.canvas.captureStream(30);
    const videoBitsPerSecond = recordingBitrate(this.canvas.width, this.canvas.height);
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.supportedType,
      videoBitsPerSecond,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.onstop = () => {
      this.exportClip().catch((err) => this.onStatus(`导出失败：${err.message}`));
    };
    this.recorder.start(1000);
    this.onStatus(seconds ? `正在录制 ${seconds} 秒…` : "正在录制，按停止结束");
    if (seconds > 0) {
      this.timer = window.setTimeout(() => this.stop(), seconds * 1000);
    }
    return true;
  }

  stop() {
    window.clearTimeout(this.timer);
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
      this.onStatus("正在导出视频…");
      return true;
    }
    return false;
  }

  async exportClip() {
    const blob = new Blob(this.chunks, { type: "video/webm" });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `parkour-${stamp}.webm`;

    if (window.desktop?.saveClip) {
      const buffer = await blob.arrayBuffer();
      const result = await window.desktop.saveClip(buffer, name);
      this.onStatus(result.converted ? `已保存 MP4：${result.filePath}` : `已保存：${result.filePath}`);
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    this.onStatus("已下载 WebM，可用 ffmpeg 转成 mp4");
  }
}
