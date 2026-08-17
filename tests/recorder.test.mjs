import assert from "node:assert/strict";
import test from "node:test";

import { recordingBitrate } from "../src/recorder.js";

test("recorder gives 1080p enough bitrate without inflating 720p files", () => {
  assert.equal(recordingBitrate(720, 1280), 9_000_000);
  assert.equal(recordingBitrate(1080, 1920), 16_000_000);
});

