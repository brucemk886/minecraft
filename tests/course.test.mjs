import assert from "node:assert/strict";
import test from "node:test";

import { buildCourse } from "../src/themes.js";

class CourseWorld {
  constructor() {
    this.voxels = new Map();
    this.lights = [];
    this.bees = [];
  }

  set(x, y, z, type, shape = "full") {
    this.voxels.set(`${x},${y},${z}`, { type, shape });
  }

  addLight(...light) {
    this.lights.push(light);
  }

  addBee(...bee) {
    this.bees.push(bee);
  }
}

test("course generation is deterministic and every jump is reachable", () => {
  const a = new CourseWorld();
  const b = new CourseWorld();
  const first = buildCourse(a, { theme: "tour", seed: "reddit" });
  const second = buildCourse(b, { theme: "tour", seed: "reddit" });

  assert.deepEqual(first, second);
  assert.ok(first.length >= 200);
  assert.ok(new Set(first.map((platform) => platform.theme)).size >= 7);

  let longestThemeRun = 1;
  let currentThemeRun = 1;
  let climbs = 0;
  let drops = 0;

  for (let i = 1; i < first.length; i++) {
    const previous = first[i - 1];
    const current = first[i];
    const distance = Math.hypot(current.x - previous.x, current.z - previous.z);
    assert.ok(distance <= 3.7, `jump ${i} is too long: ${distance}`);
    assert.ok(Math.abs(current.y - previous.y) <= 1.5, `jump ${i} changes height too much`);
    if (current.theme === previous.theme) {
      currentThemeRun += 1;
      longestThemeRun = Math.max(longestThemeRun, currentThemeRun);
    } else {
      currentThemeRun = 1;
    }
    if (current.y > previous.y) climbs += 1;
    if (current.y < previous.y) drops += 1;
  }

  assert.ok(longestThemeRun <= 9, `scene lasts too long: ${longestThemeRun} jumps`);
  assert.ok(climbs >= 60, `not enough upward movement: ${climbs}`);
  assert.ok(drops >= 60, `not enough downward movement: ${drops}`);
});
