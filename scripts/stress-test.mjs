import { performance } from "node:perf_hooks";

import {
  MINECRAFT_BASE_THEMES,
  MINECRAFT_TEMPLATES,
  minecraftDailyTemplateOffset,
  minecraftTemplateForBatchIndex,
} from "../src/minecraft-templates.js";

const MASK_64 = (1n << 64n) - 1n;
const VARIATION_SALTS = {
  palette: 0x632be59bd9b4e019n,
  landmark: 0x8cb92ba72f3d8dd7n,
  terrain: 0x9e3779b97f4a7c15n,
  scene: 0xd1b54a32d192ed03n,
  camera: 0xa24baed4963ee407n,
};

function unsigned64(value) {
  return BigInt.asUintN(64, value) & MASK_64;
}

function mix64(value) {
  let mixed = unsigned64(value);
  mixed = unsigned64((mixed ^ (mixed >> 30n)) * 0xbf58476d1ce4e5b9n);
  mixed = unsigned64((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn);
  return BigInt.asIntN(64, mixed ^ (mixed >> 31n));
}

function floorMod(value, bound) {
  const divisor = BigInt(bound);
  return Number(((value % divisor) + divisor) % divisor);
}

function candidateSeed(jobIndex, attempt) {
  return BigInt.asIntN(64, mix64(BigInt(jobIndex + 1) * 0x9e3779b97f4a7c15n + BigInt(attempt + 1))).toString();
}

function variation(template, seed) {
  const value = BigInt(seed);
  const result = {
    palette: floorMod(mix64(unsigned64(value) ^ VARIATION_SALTS.palette), 4),
    landmark: floorMod(mix64(unsigned64(value) ^ VARIATION_SALTS.landmark), 6),
    terrain: floorMod(mix64(unsigned64(value) ^ VARIATION_SALTS.terrain), 4),
    scene: floorMod(mix64(unsigned64(value) ^ VARIATION_SALTS.scene), 8),
    camera: floorMod(mix64(unsigned64(value) ^ VARIATION_SALTS.camera), 4),
  };
  result.signature = [template.id, result.palette, result.landmark, result.terrain, result.scene, result.camera].join(":");
  result.visualKey = [template.baseTheme, result.palette, result.landmark, result.terrain, result.scene, result.camera].join(":");
  return result;
}

function syntheticFingerprint(key) {
  const hashes = [];
  let state = 0n;
  for (const character of key) state = unsigned64(state * 131n + BigInt(character.codePointAt(0)));
  for (let frame = 0; frame < 5; frame++) {
    let hash = "";
    for (let block = 0; block < 4; block++) {
      state = unsigned64(mix64(state + BigInt(frame * 7 + block + 1)));
      hash += state.toString(16).padStart(16, "0");
    }
    hashes.push(hash);
  }
  return hashes;
}

function simulateBatch(count, offset) {
  const usedSignatures = new Set();
  const usedVisualKeys = new Set();
  const templateCounts = new Map();
  const themeCounts = new Map();
  let seedRetries = 0;
  let visualRetries = 0;
  let failedAfterSixAttempts = 0;
  const records = [];

  for (let job = 0; job < count; job++) {
    const template = minecraftTemplateForBatchIndex(job + 1, offset);
    templateCounts.set(template.id, (templateCounts.get(template.id) || 0) + 1);
    themeCounts.set(template.baseTheme, (themeCounts.get(template.baseTheme) || 0) + 1);
    let accepted = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const seed = candidateSeed(job, attempt);
      const candidate = variation(template, seed);
      if (usedSignatures.has(candidate.signature)) {
        seedRetries++;
        continue;
      }
      usedSignatures.add(candidate.signature);
      if (usedVisualKeys.has(candidate.visualKey)) {
        visualRetries++;
        continue;
      }
      usedVisualKeys.add(candidate.visualKey);
      records.push({
        createdAt: Date.now(),
        theme: template.id,
        baseTheme: template.baseTheme,
        signature: candidate.signature,
        fingerprint: syntheticFingerprint(candidate.visualKey),
        filePath: `D:/stress/video-${String(job + 1).padStart(5, "0")}.mp4`,
      });
      accepted = true;
      break;
    }
    if (!accepted) failedAfterSixAttempts++;
  }

  const counts = [...themeCounts.values()];
  return {
    count,
    uniqueTemplates: templateCounts.size,
    repeatedTemplateJobs: count - templateCounts.size,
    uniqueSignatures: usedSignatures.size,
    acceptedVisualKeys: usedVisualKeys.size,
    seedRetries,
    visualRetries,
    failedAfterSixAttempts,
    minThemeCount: Math.min(...counts),
    maxThemeCount: Math.max(...counts),
    records,
  };
}

function benchmarkHistory(records) {
  const json = JSON.stringify({ version: 1, records });
  const parseStart = performance.now();
  for (let index = 0; index < 100; index++) JSON.parse(json);
  const parseMilliseconds = performance.now() - parseStart;
  const signaturesStart = performance.now();
  for (let index = 0; index < 100; index++) new Set(records.map((record) => record.signature));
  const signatureMilliseconds = performance.now() - signaturesStart;
  const compareStart = performance.now();
  let comparisons = 0;
  for (let job = 0; job < 150; job++) {
    const baseTheme = MINECRAFT_BASE_THEMES[job % MINECRAFT_BASE_THEMES.length].id;
    for (const record of records) {
      if (record.baseTheme !== baseTheme) continue;
      comparisons++;
      for (let frame = 0; frame < record.fingerprint.length; frame++) {
        void record.fingerprint[frame].charCodeAt(job % 64);
      }
    }
  }
  const compareMilliseconds = performance.now() - compareStart;
  return {
    jsonBytes: Buffer.byteLength(json),
    parse100Milliseconds: Number(parseMilliseconds.toFixed(2)),
    signatureSet100Milliseconds: Number(signatureMilliseconds.toFixed(2)),
    comparisons,
    compare150JobsMilliseconds: Number(compareMilliseconds.toFixed(2)),
  };
}

function routeFootprint(durationSeconds) {
  const targetStages = Math.max(3, Math.ceil((durationSeconds + 25) / 10.2));
  const rowSpacingBlocks = 5120;
  return {
    durationSeconds,
    targetStages,
    routeDepthBlocks: targetStages * 48,
    rowSpacingBlocks,
    overlapsNextRowByBlocks: Math.max(0, targetStages * 48 - rowSpacingBlocks),
  };
}

const offset = minecraftDailyTemplateOffset(new Date(2026, 7, 20));
const batchSizes = [100, 150, 300, 1000, 4500];
const simulations = batchSizes.map((count) => simulateBatch(count, offset));
const firstDay = new Set(Array.from({ length: 150 }, (_, index) => minecraftTemplateForBatchIndex(index + 1, offset).id));
const nextOffset = minecraftDailyTemplateOffset(new Date(2026, 7, 21));
const secondDay = new Set(Array.from({ length: 150 }, (_, index) => minecraftTemplateForBatchIndex(index + 1, nextOffset).id));
const crossDayTemplateOverlap = [...firstDay].filter((id) => secondDay.has(id)).length;
const historyBenchmark = benchmarkHistory(simulations.at(-1).records.slice(-4500));

const report = {
  generatedAt: new Date().toISOString(),
  templates: MINECRAFT_TEMPLATES.length,
  themes: MINECRAFT_BASE_THEMES.length,
  dailyOffset: offset,
  nextDailyOffset: nextOffset,
  crossDayTemplateOverlapAmong150: crossDayTemplateOverlap,
  simulations: simulations.map(({ records, ...summary }) => summary),
  historyBenchmark,
  footprints: [120, 150, 180, 300, 600, 900].map(routeFootprint),
  processMemory: process.memoryUsage(),
};

console.log(JSON.stringify(report, null, 2));
