const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  saveClip: (buffer, name) => ipcRenderer.invoke("save-clip", buffer, name),
  startRecordingFile: (name) => ipcRenderer.invoke("start-recording-file", name),
  appendRecordingChunk: (sessionId, buffer) => ipcRenderer.invoke("append-recording-chunk", sessionId, buffer),
  finishRecordingFile: (sessionId) => ipcRenderer.invoke("finish-recording-file", sessionId),
  abortRecordingFile: (sessionId) => ipcRenderer.invoke("abort-recording-file", sessionId),
  openClips: () => ipcRenderer.invoke("open-clips"),
  getClipsDirectory: () => ipcRenderer.invoke("get-clips-directory"),
  chooseClipsDirectory: () => ipcRenderer.invoke("choose-clips-directory"),
  setKeepAwake: (enabled) => ipcRenderer.invoke("set-keep-awake", enabled),
  getMinecraftStatus: () => ipcRenderer.invoke("minecraft-status"),
  listCaptureSources: () => ipcRenderer.invoke("minecraft-sources"),
  installRealEngine: () => ipcRenderer.invoke("install-real-engine"),
  setMinecraftTheme: (theme) => ipcRenderer.invoke("set-minecraft-theme", theme),
  startParkourJob: (request) => ipcRenderer.invoke("start-parkour-job", request),
  stopParkourJob: () => ipcRenderer.invoke("stop-parkour-job"),
  getParkourStatus: () => ipcRenderer.invoke("get-parkour-status"),
  openMinecraftLauncher: () => ipcRenderer.invoke("open-minecraft-launcher"),
  openMinecraftFolder: () => ipcRenderer.invoke("open-minecraft-folder"),
  openShaderDownload: () => ipcRenderer.invoke("open-shader-download"),
});
