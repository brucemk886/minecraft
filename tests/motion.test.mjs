import assert from "node:assert/strict";
import test from "node:test";

import {
  damp,
  dampAngle,
  parabolicArc,
  parabolicArcSlope,
  shortestAngleDelta,
} from "../src/motion.js";

test("parabolic jump starts and lands on the platform", () => {
  assert.equal(parabolicArc(0), 0);
  assert.equal(parabolicArc(1), 0);
  assert.equal(parabolicArc(0.5), 1);
  assert.ok(parabolicArc(0.25) > 0);
  assert.equal(parabolicArcSlope(0.5), 0);
});

test("camera turn always takes the shortest direction", () => {
  const from = (179 * Math.PI) / 180;
  const to = (-179 * Math.PI) / 180;
  assert.ok(Math.abs(shortestAngleDelta(from, to)) < (3 * Math.PI) / 180);
  assert.ok(Math.abs(dampAngle(from, to, 10, 1 / 30) - from) < 0.02);
});

test("damping is stable across frame rates", () => {
  let at30 = 0;
  let at60 = 0;
  for (let i = 0; i < 30; i++) at30 = damp(at30, 1, 8, 1 / 30);
  for (let i = 0; i < 60; i++) at60 = damp(at60, 1, 8, 1 / 60);
  assert.ok(Math.abs(at30 - at60) < 1e-10);
});

