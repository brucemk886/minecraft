import * as THREE from "three";

import {
  damp,
  dampAngle,
  parabolicArc,
  parabolicArcSlope,
  shortestAngleDelta,
} from "./motion.js";

export class ParkourPlayer {
  constructor(camera, world, platforms, mode) {
    this.camera = camera;
    this.world = world;
    this.platforms = platforms;
    this.mode = mode;
    this.index = 0;
    this.jumpT = 1;
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.onGround = true;
    this.keys = new Set();
    this.yaw = Math.PI;
    this.pitch = -0.14;
    this.roll = 0;
    this.eye = 1.62;
    this.runTime = 0;
    this.verticalSpeed = 0;
    this.landingDip = 0;
    this.landingVelocity = 0;
    this.baseFov = camera.fov;
    this.bound = false;
    this.placeAt(0);
  }

  placeAt(index) {
    const platform = this.platforms[index];
    this.index = index;
    this.pos.set(platform.x, platform.y, platform.z);
    this.jumpT = 1;
    const ahead = this.platforms[Math.min(index + 2, this.platforms.length - 1)];
    this.yaw = Math.atan2(-(ahead.x - platform.x), -(ahead.z - platform.z));
    this.pitch = -0.14;
    this.roll = 0;
  }

  bindManual(canvas) {
    if (this.bound) return;
    this.bound = true;
    this.canvas = canvas;
    this.onKeyDown = (event) => this.keys.add(event.code);
    this.onKeyUp = (event) => this.keys.delete(event.code);
    this.onCanvasClick = () => canvas.requestPointerLock();
    this.onMouseMove = (event) => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= event.movementX * 0.0022;
      this.pitch -= event.movementY * 0.0022;
      this.pitch = Math.max(-1.2, Math.min(1.0, this.pitch));
    };
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("click", this.onCanvasClick);
    document.addEventListener("mousemove", this.onMouseMove);
  }

  destroy() {
    if (!this.bound) return;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas?.removeEventListener("click", this.onCanvasClick);
    document.removeEventListener("mousemove", this.onMouseMove);
    this.keys.clear();
    this.bound = false;
  }

  update(dt) {
    this.runTime += dt;
    if (this.mode === "auto") this.updateAuto(dt);
    else this.updateManual(dt);

    this.landingVelocity += (-92 * this.landingDip - 14 * this.landingVelocity) * dt;
    this.landingDip += this.landingVelocity * dt;
    if (Math.abs(this.landingDip) < 0.0001 && Math.abs(this.landingVelocity) < 0.001) {
      this.landingDip = 0;
      this.landingVelocity = 0;
    }

    const airborne = this.mode === "auto" && this.jumpT < 1;
    const stride = airborne ? 0 : Math.sin(this.runTime * 10.5) * 0.012;
    const sideSway = Math.sin(this.runTime * 5.25) * 0.009;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this.camera.position.copy(this.pos);
    this.camera.position.addScaledVector(right, sideSway);
    this.camera.position.y += this.eye + stride - this.landingDip;
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = this.roll;

    const sprintPulse = airborne ? Math.sin(Math.PI * Math.min(1, this.jumpT)) * 1.2 : 0;
    const targetFov = this.baseFov + 3.2 + sprintPulse * 1.8;
    const nextFov = damp(this.camera.fov, targetFov, 7, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  updateAuto(dt) {
    if (this.index >= this.platforms.length - 1) this.placeAt(0);

    if (this.jumpT >= 1) {
      this.from.copy(this.pos);
      const next = this.platforms[this.index + 1];
      this.to.set(next.x, next.y, next.z);
      const distance = Math.hypot(this.to.x - this.from.x, this.to.z - this.from.z);
      const rise = this.to.y - this.from.y;
      this.jumpDuration = THREE.MathUtils.clamp(0.22 + distance * 0.047 + Math.max(0, rise) * 0.018, 0.31, 0.44);
      this.arc = Math.max(0.78, 0.5 + distance * 0.14 + Math.max(0, rise) * 0.22);
      this.jumpT = 0;
    }

    this.jumpT += dt / this.jumpDuration;
    const t = Math.min(1, this.jumpT);
    this.pos.x = THREE.MathUtils.lerp(this.from.x, this.to.x, t);
    this.pos.z = THREE.MathUtils.lerp(this.from.z, this.to.z, t);
    this.pos.y = THREE.MathUtils.lerp(this.from.y, this.to.y, t) + parabolicArc(t) * this.arc;
    this.verticalSpeed =
      ((this.to.y - this.from.y) + parabolicArcSlope(t) * this.arc) / this.jumpDuration;

    const landing = this.platforms[Math.min(this.index + 1, this.platforms.length - 1)];
    const follow = this.platforms[Math.min(this.index + 2, this.platforms.length - 1)];
    const lookBlend = THREE.MathUtils.smoothstep(t, 0.45, 0.94);
    const lookX = THREE.MathUtils.lerp(landing.x, follow.x, lookBlend * 0.58);
    const lookZ = THREE.MathUtils.lerp(landing.z, follow.z, lookBlend * 0.58);
    const targetYaw = Math.atan2(-(lookX - this.pos.x), -(lookZ - this.pos.z));
    const turn = shortestAngleDelta(this.yaw, targetYaw);
    this.yaw = dampAngle(this.yaw, targetYaw, t < 0.35 ? 7.5 : 10.5, dt);

    const horizontalDistance = Math.max(0.01, Math.hypot(landing.x - this.pos.x, landing.z - this.pos.z));
    const landingAngle = Math.atan2(landing.y + 0.15 - (this.pos.y + this.eye), horizontalDistance);
    const motionLook = THREE.MathUtils.clamp(this.verticalSpeed * 0.009, -0.055, 0.045);
    const targetPitch = THREE.MathUtils.clamp(landingAngle * 0.52 - 0.11 + motionLook, -0.46, -0.035);
    this.pitch = damp(this.pitch, targetPitch, 11.5, dt);

    const turnRoll = THREE.MathUtils.clamp(-turn * 0.16, -0.04, 0.04);
    const airRoll = Math.sin(Math.PI * t) * Math.sin(this.runTime * 3.1) * 0.006;
    this.roll = damp(this.roll, turnRoll + airRoll, 10, dt);

    if (t >= 1) {
      this.index += 1;
      this.pos.copy(this.to);
      this.landingDip = 0.09;
      this.landingVelocity = -0.42;
      this.verticalSpeed = 0;
    }
  }

  updateManual(dt) {
    const speed = this.keys.has("ShiftLeft") ? 6.4 : 4.4;
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = new THREE.Vector3();
    if (this.keys.has("KeyW")) wish.add(forward);
    if (this.keys.has("KeyS")) wish.sub(forward);
    if (this.keys.has("KeyD")) wish.add(right);
    if (this.keys.has("KeyA")) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    this.velocity.x = wish.x;
    this.velocity.z = wish.z;
    this.velocity.y -= 28 * dt;
    if (this.onGround && this.keys.has("Space")) {
      this.velocity.y = 8.6;
      this.onGround = false;
    }

    this.moveAxis("x", this.velocity.x * dt);
    this.moveAxis("z", this.velocity.z * dt);
    this.moveAxis("y", this.velocity.y * dt);
    this.roll = damp(this.roll, 0, 10, dt);
  }

  moveAxis(axis, delta) {
    this.pos[axis] += delta;
    const radius = 0.3;
    const minY = this.pos.y;
    const maxY = this.pos.y + 1.7;
    const minX = this.pos.x - radius;
    const maxX = this.pos.x + radius;
    const minZ = this.pos.z - radius;
    const maxZ = this.pos.z + radius;
    const x0 = Math.floor(minX);
    const x1 = Math.floor(maxX);
    const y0 = Math.floor(minY);
    const y1 = Math.floor(maxY);
    const z0 = Math.floor(minZ);
    const z1 = Math.floor(maxZ);

    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!this.world.solidAt(x, y, z)) continue;
          const bx0 = x;
          const bx1 = x + 1;
          const by0 = y;
          const by1 = y + 1;
          const bz0 = z;
          const bz1 = z + 1;
          if (maxX <= bx0 || minX >= bx1 || maxY <= by0 || minY >= by1 || maxZ <= bz0 || minZ >= bz1) continue;
          if (axis === "x") {
            this.pos.x = delta > 0 ? bx0 - radius : bx1 + radius;
          } else if (axis === "z") {
            this.pos.z = delta > 0 ? bz0 - radius : bz1 + radius;
          } else if (delta < 0) {
            this.pos.y = by1;
            this.velocity.y = 0;
            this.onGround = true;
          } else {
            this.pos.y = by0 - 1.7;
            this.velocity.y = 0;
          }
        }
      }
    }
    if (axis === "y" && delta < 0 && this.velocity.y < -1) this.onGround = false;
  }
}
