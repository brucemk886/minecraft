import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve(process.argv[2] || "D:/方块跑酷模拟器视频");
const concurrency = Math.max(1, Math.min(6, Number(process.argv[3]) || 3));
const POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return /\.(mp4|webm)$/i.test(entry.name) ? [fullPath] : [];
  });
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout));
      else reject(new Error(stderr.trim() || `${file} exited ${code}`));
    });
  });
}

async function duration(filePath) {
  const output = await run("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath,
  ]);
  return Number(output.toString().trim()) || 0;
}

function frameHash(frame) {
  const average = frame.reduce((sum, value) => sum + value, 0) / Math.max(1, frame.length);
  let hash = "";
  for (let index = 0; index < frame.length; index += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit++) if (frame[index + bit] >= average) nibble |= 1 << (3 - bit);
    hash += nibble.toString(16);
  }
  return { hash, brightness: average };
}

async function sampleFrame(filePath, timestamp) {
  const output = await run("ffmpeg", [
    "-v", "error", "-ss", timestamp.toFixed(3), "-i", filePath,
    "-frames:v", "1", "-vf", "scale=16:16:flags=area,format=gray", "-f", "rawvideo", "pipe:1",
  ]);
  if (output.length < 256) throw new Error("decoded frame is incomplete");
  return frameHash(output.subarray(0, 256));
}

function baseTheme(filePath) {
  return path.basename(filePath).match(/^minecraft-parkour-([a-z]+)(?:-v\d+)?-/i)?.[1]?.toLowerCase() || "unknown";
}

async function analyze(filePath) {
  const seconds = await duration(filePath);
  const timestamps = [0.08, 0.27, 0.48, 0.69, 0.90].map((ratio) => Math.max(0, seconds * ratio));
  const frames = [];
  for (const timestamp of timestamps) frames.push(await sampleFrame(filePath, timestamp));
  return {
    filePath,
    fileName: path.basename(filePath),
    theme: baseTheme(filePath),
    seconds,
    hashes: frames.map((frame) => frame.hash),
    brightness: frames.map((frame) => Number(frame.brightness.toFixed(2))),
  };
}

function similarity(first, second) {
  const frames = Math.min(first.length, second.length);
  let different = 0;
  let total = 0;
  for (let frame = 0; frame < frames; frame++) {
    const length = Math.min(first[frame].length, second[frame].length);
    for (let index = 0; index < length; index++) {
      different += POPCOUNT[Number.parseInt(first[frame][index], 16) ^ Number.parseInt(second[frame][index], 16)];
      total += 4;
    }
  }
  return total ? 1 - different / total : 0;
}

async function pooled(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { filePath: items[index], error: error.message || String(error) };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, consume));
  return results;
}

const files = walk(root).sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
const analyzed = await pooled(files, analyze);
const valid = analyzed.filter((video) => !video.error);
const pairs = [];
for (let first = 0; first < valid.length; first++) {
  for (let second = first + 1; second < valid.length; second++) {
    pairs.push({
      similarity: similarity(valid[first].hashes, valid[second].hashes),
      sameTheme: valid[first].theme === valid[second].theme,
      first: valid[first].fileName,
      second: valid[second].fileName,
    });
  }
}
pairs.sort((a, b) => b.similarity - a.similarity);

const withinVideoMotion = valid.map((video) => {
  const adjacent = [];
  for (let index = 1; index < video.hashes.length; index++) {
    adjacent.push(1 - similarity([video.hashes[index - 1]], [video.hashes[index]]));
  }
  return {
    fileName: video.fileName,
    theme: video.theme,
    averageHashChange: adjacent.reduce((sum, value) => sum + value, 0) / Math.max(1, adjacent.length),
    averageBrightness: video.brightness.reduce((sum, value) => sum + value, 0) / video.brightness.length,
  };
}).sort((a, b) => a.averageHashChange - b.averageHashChange);

const report = {
  root,
  totalFiles: files.length,
  analyzedFiles: valid.length,
  errors: analyzed.filter((video) => video.error),
  duration: {
    minimum: Math.min(...valid.map((video) => video.seconds)),
    maximum: Math.max(...valid.map((video) => video.seconds)),
    average: valid.reduce((sum, video) => sum + video.seconds, 0) / Math.max(1, valid.length),
  },
  pairsAtOrAbove945: pairs.filter((pair) => pair.similarity >= 0.945).length,
  sameThemePairsAtOrAbove945: pairs.filter((pair) => pair.sameTheme && pair.similarity >= 0.945).length,
  topSameThemePairs: pairs.filter((pair) => pair.sameTheme).slice(0, 20),
  lowestMotionVideos: withinVideoMotion.slice(0, 12),
  darkestVideos: [...withinVideoMotion].sort((a, b) => a.averageBrightness - b.averageBrightness).slice(0, 12),
};

console.log(JSON.stringify(report, null, 2));
