import type RAPIER from "@dimforge/rapier3d-compat";
import { makeRayHit, PhysicsWorld } from "../physics/PhysicsWorld";
import { SIM_DT } from "./Constants";
import { EventQueue, type SimEvent } from "./Events";
import { StateHasher } from "./Hash";
import { Button, type InputFrame, wasPressed } from "./InputFrame";
import { lookDirection, type Vec3 } from "./MathUtil";
import { Rng, type RngState } from "./Rng";
import type { Simulation } from "./Simulation";

/**
 * Engine sandbox: a seeded yard of static blocks and loose crates plus a
 * free-flying probe driven by InputFrames. It exercises the whole core
 * pipeline (input -> fixed sim -> physics -> events -> interpolated render)
 * and is the subject of the determinism harness.
 */

export interface SandboxConfig {
  seed: number;
  crateCount: number;
  obstacleCount: number;
}

export const SANDBOX_DEFAULTS = {
  crateCount: 120,
  obstacleCount: 14,
  /** Half size of the square ground slab in metres. */
  groundHalf: 100,
  crateHalf: 0.5,
  probeSpeed: 10,
  probeSprintSpeed: 30,
  kickRange: 60,
  kickRadius: 5,
  kickImpulse: 14,
} as const;

/** Static block description, exposed so the renderer can draw it. */
export interface SandboxObstacle {
  center: Vec3;
  half: Vec3;
}

export interface Probe {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface SandboxSnapshot {
  tick: number;
  generation: number;
  previousButtons: number;
  probe: Probe;
  rng: RngState;
  bodyHandles: number[];
  physics: Uint8Array;
}

/** Floats stored per crate in the transform buffers: position xyz + quaternion xyzw. */
export const TRANSFORM_STRIDE = 7;

export class SandboxSim implements Simulation<SandboxSnapshot> {
  tick = 0;
  readonly seed: number;
  readonly obstacles: SandboxObstacle[] = [];
  readonly probe: Probe = { x: 0, y: 4, z: 26, yaw: 0, pitch: -0.15 };
  readonly previousProbe: Probe = { ...this.probe };
  /** Crate transforms after the latest tick and after the tick before it (for interpolation). */
  transforms: Float32Array;
  previousTransforms: Float32Array;

  private readonly physics: PhysicsWorld;
  private readonly events = new EventQueue();
  private readonly root: Rng;
  private crateRng: Rng;
  private bodies: RAPIER.RigidBody[] = [];
  private generation = 0;
  private previousButtons = 0;
  private readonly forward: Vec3 = { x: 0, y: 0, z: -1 };
  private readonly rayHit = makeRayHit();

  /** initPhysics() must have resolved before constructing. */
  constructor(config: SandboxConfig) {
    this.seed = config.seed >>> 0;
    this.root = new Rng(this.seed);
    this.crateRng = this.root.fork("crates", 0);
    this.physics = new PhysicsWorld();
    this.transforms = new Float32Array(config.crateCount * TRANSFORM_STRIDE);
    this.previousTransforms = new Float32Array(config.crateCount * TRANSFORM_STRIDE);
    this.buildStaticWorld(config.obstacleCount);
    this.spawnCrates(config.crateCount);
    this.readTransforms();
    this.previousTransforms.set(this.transforms);
  }

  get crateCount(): number {
    return this.bodies.length;
  }

  get bodyCount(): number {
    return this.physics.bodyCount;
  }

  /** Number of crates currently awake (being simulated). */
  get awakeCount(): number {
    let awake = 0;
    for (const body of this.bodies) if (!body.isSleeping()) awake++;
    return awake;
  }

  step(input: InputFrame): void {
    this.previousTransforms.set(this.transforms);
    Object.assign(this.previousProbe, this.probe);

    this.moveProbe(input);
    if (wasPressed(input.buttons, this.previousButtons, Button.Fire)) this.kick();
    if (wasPressed(input.buttons, this.previousButtons, Button.Reload)) this.respawnCrates();
    this.previousButtons = input.buttons;

    this.physics.step();
    this.readTransforms();
    this.tick++;
  }

  drainEvents(): SimEvent[] {
    return this.events.drain();
  }

  hash(): number {
    const hasher = new StateHasher();
    hasher.addInt(this.tick).addInt(this.generation).addInt(this.previousButtons);
    hasher.addNumber(this.probe.x).addNumber(this.probe.y).addNumber(this.probe.z);
    hasher.addNumber(this.probe.yaw).addNumber(this.probe.pitch);
    for (const body of this.bodies) {
      const t = body.translation();
      const r = body.rotation();
      const v = body.linvel();
      hasher.addNumber(t.x).addNumber(t.y).addNumber(t.z);
      hasher.addNumber(r.x).addNumber(r.y).addNumber(r.z).addNumber(r.w);
      hasher.addNumber(v.x).addNumber(v.y).addNumber(v.z);
    }
    return hasher.digest();
  }

  snapshot(): SandboxSnapshot {
    return {
      tick: this.tick,
      generation: this.generation,
      previousButtons: this.previousButtons,
      probe: { ...this.probe },
      rng: this.crateRng.getState(),
      bodyHandles: this.bodies.map((body) => body.handle),
      physics: this.physics.takeSnapshot(),
    };
  }

  restore(snapshot: SandboxSnapshot): void {
    this.tick = snapshot.tick;
    this.generation = snapshot.generation;
    this.previousButtons = snapshot.previousButtons;
    Object.assign(this.probe, snapshot.probe);
    Object.assign(this.previousProbe, snapshot.probe);
    this.crateRng = Rng.fromState(snapshot.rng);
    this.physics.restoreSnapshot(snapshot.physics);
    this.bodies = snapshot.bodyHandles.map((handle) => this.physics.world.getRigidBody(handle));
    this.readTransforms();
    this.previousTransforms.set(this.transforms);
    this.events.drain();
  }

  dispose(): void {
    this.physics.dispose();
  }

  /** Ground slab plus seeded blocks and pillars to bounce crates off. */
  private buildStaticWorld(obstacleCount: number): void {
    const g = SANDBOX_DEFAULTS.groundHalf;
    this.physics.addStaticBox({ x: 0, y: -0.5, z: 0 }, { x: g, y: 0.5, z: g });
    const rng = this.root.fork("obstacles");
    for (let i = 0; i < obstacleCount; i++) {
      const half = { x: rng.range(0.8, 3), y: rng.range(0.5, 4), z: rng.range(0.8, 3) };
      const angle = rng.range(0, Math.PI * 2);
      const radius = rng.range(6, 32);
      const center = { x: Math.cos(angle) * radius, y: half.y, z: Math.sin(angle) * radius };
      this.physics.addStaticBox(center, half);
      this.obstacles.push({ center, half });
    }
  }

  private spawnCrates(count: number): void {
    const h = SANDBOX_DEFAULTS.crateHalf;
    for (let i = 0; i < count; i++) {
      this.bodies.push(this.physics.addDynamicBox(this.randomCratePosition(), { x: h, y: h, z: h }));
    }
  }

  private randomCratePosition(): Vec3 {
    const rng = this.crateRng;
    return { x: rng.range(-9, 9), y: rng.range(2, 34), z: rng.range(-9, 9) };
  }

  /** Free-fly movement along the look direction; Jump rises, Crouch sinks. */
  private moveProbe(input: InputFrame): void {
    const probe = this.probe;
    probe.yaw = input.yaw;
    probe.pitch = input.pitch;
    const sprinting = (input.buttons & Button.Sprint) !== 0;
    const speed = sprinting ? SANDBOX_DEFAULTS.probeSprintSpeed : SANDBOX_DEFAULTS.probeSpeed;
    const forward = lookDirection(probe.yaw, probe.pitch, this.forward);
    // Right vector is horizontal and perpendicular to the yaw heading.
    const rightX = Math.cos(probe.yaw);
    const rightZ = -Math.sin(probe.yaw);
    const rise = ((input.buttons & Button.Jump) !== 0 ? 1 : 0) - ((input.buttons & Button.Crouch) !== 0 ? 1 : 0);
    const step = speed * SIM_DT;
    probe.x += (forward.x * input.moveZ + rightX * input.moveX) * step;
    probe.y += (forward.y * input.moveZ + rise) * step;
    probe.z += (forward.z * input.moveZ + rightZ * input.moveX) * step;
    const limit = SANDBOX_DEFAULTS.groundHalf;
    probe.x = Math.min(limit, Math.max(-limit, probe.x));
    probe.z = Math.min(limit, Math.max(-limit, probe.z));
    probe.y = Math.min(80, Math.max(0.5, probe.y));
  }

  /** Pushes every crate near the aimed point away from it. */
  private kick(): void {
    const d = SANDBOX_DEFAULTS;
    const forward = lookDirection(this.probe.yaw, this.probe.pitch, this.forward);
    const hit = this.physics.raycast(this.probe, forward, d.kickRange, this.rayHit);
    const reach = hit !== null ? hit.distance : 8;
    const px = this.probe.x + forward.x * reach;
    const py = this.probe.y + forward.y * reach;
    const pz = this.probe.z + forward.z * reach;
    let affected = 0;
    for (const body of this.bodies) {
      const t = body.translation();
      const dx = t.x - px;
      const dy = t.y - py;
      const dz = t.z - pz;
      const distance = Math.hypot(dx, dy, dz);
      if (distance > d.kickRadius) continue;
      const strength = (d.kickImpulse * (1 - distance / d.kickRadius)) / Math.max(distance, 0.25);
      // A little upward bias makes stacks burst instead of just sliding.
      body.applyImpulse({ x: dx * strength, y: dy * strength + d.kickImpulse * 0.35, z: dz * strength }, true);
      affected++;
    }
    this.events.push("sandboxKick", this.tick, { x: px, y: py, z: pz, bodies: affected });
  }

  /** Re-seeds every crate with a fresh fork so each generation differs but stays reproducible. */
  private respawnCrates(): void {
    this.generation++;
    this.crateRng = this.root.fork("crates", this.generation);
    for (const body of this.bodies) {
      body.setTranslation(this.randomCratePosition(), true);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.events.push("sandboxRespawn", this.tick, { generation: this.generation, crates: this.bodies.length });
  }

  private readTransforms(): void {
    const out = this.transforms;
    let o = 0;
    for (const body of this.bodies) {
      const t = body.translation();
      const r = body.rotation();
      out[o] = t.x;
      out[o + 1] = t.y;
      out[o + 2] = t.z;
      out[o + 3] = r.x;
      out[o + 4] = r.y;
      out[o + 5] = r.z;
      out[o + 6] = r.w;
      o += TRANSFORM_STRIDE;
    }
  }
}
