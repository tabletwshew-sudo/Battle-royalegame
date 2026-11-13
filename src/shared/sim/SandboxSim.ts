import type RAPIER from "@dimforge/rapier3d-compat";
import { makeRayHit, PhysicsWorld, QUERY_WORLD_AND_PROPS } from "../physics/PhysicsWorld";
import { type Block, buildPlayground, CRATE_AREA, PLAYGROUND } from "../world/Playground";
import { type CameraConfig, computeCameraPose, defaultCameraConfig, makeCameraPose } from "./CameraRig";
import { EventQueue, type SimEvent } from "./Events";
import { StateHasher } from "./Hash";
import { Button, type InputFrame, wasPressed } from "./InputFrame";
import type { Vec3 } from "./MathUtil";
import { defaultMovementConfig, type MovementConfig } from "./MovementConfig";
import { PlayerController, type PlayerState } from "./PlayerSim";
import { Rng, type RngState } from "./Rng";
import type { Simulation } from "./Simulation";

/**
 * Engine sandbox: the movement playground (fixed course + seeded scenery),
 * a pile of loose crates and one player character driven by InputFrames.
 * It exercises the whole pipeline (input -> fixed sim -> physics -> events
 * -> interpolated render) and is the subject of the determinism harness.
 */

export interface SandboxConfig {
  seed: number;
  crateCount: number;
  movement?: MovementConfig;
  camera?: CameraConfig;
}

export const SANDBOX_DEFAULTS = {
  crateCount: 80,
  crateHalf: 0.5,
  kickRange: 60,
  kickRadius: 4,
  kickImpulse: 14,
} as const;

export interface SandboxSnapshot {
  tick: number;
  generation: number;
  previousButtons: number;
  rng: RngState;
  bodyHandles: number[];
  player: PlayerState;
  physics: Uint8Array;
}

/** Floats stored per crate in the transform buffers: position xyz + quaternion xyzw. */
export const TRANSFORM_STRIDE = 7;

/** Entity id of the local player in the sandbox. */
export const SANDBOX_PLAYER_ID = 1;

export class SandboxSim implements Simulation<SandboxSnapshot> {
  tick = 0;
  readonly seed: number;
  readonly blocks: Block[];
  readonly player: PlayerController;
  /** Player state after the previous tick (render interpolation). */
  readonly previousPlayer: PlayerState;
  readonly movement: MovementConfig;
  readonly camera: CameraConfig;
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
  private readonly cameraPose = makeCameraPose();
  private readonly rayHit = makeRayHit();

  /** initPhysics() must have resolved before constructing. */
  constructor(config: SandboxConfig) {
    this.seed = config.seed >>> 0;
    this.movement = config.movement ?? defaultMovementConfig();
    this.camera = config.camera ?? defaultCameraConfig();
    this.root = new Rng(this.seed);
    this.crateRng = this.root.fork("crates", 0);
    this.physics = new PhysicsWorld(this.movement.gravity);
    this.blocks = buildPlayground(this.seed);
    for (const block of this.blocks) this.physics.addStaticBox(block.center, block.half, {}, block.rotation);
    this.spawnCrates(config.crateCount);
    this.player = new PlayerController(
      SANDBOX_PLAYER_ID,
      this.physics,
      this.movement,
      PLAYGROUND.spawn,
      PLAYGROUND.spawnYaw,
    );
    this.previousPlayer = this.player.saveState();
    this.transforms = new Float32Array(config.crateCount * TRANSFORM_STRIDE);
    this.previousTransforms = new Float32Array(config.crateCount * TRANSFORM_STRIDE);
    this.readTransforms();
    this.previousTransforms.set(this.transforms);
  }

  /** The physics world (read-only use by the client: camera collision, debug probes). */
  get world(): PhysicsWorld {
    return this.physics;
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
    Object.assign(this.previousPlayer, this.player.state);

    this.player.step(input, this.tick, this.events);
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
    this.player.hashInto(hasher);
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
      rng: this.crateRng.getState(),
      bodyHandles: this.bodies.map((body) => body.handle),
      player: this.player.saveState(),
      physics: this.physics.takeSnapshot(),
    };
  }

  restore(snapshot: SandboxSnapshot): void {
    this.tick = snapshot.tick;
    this.generation = snapshot.generation;
    this.previousButtons = snapshot.previousButtons;
    this.crateRng = Rng.fromState(snapshot.rng);
    this.physics.restoreSnapshot(snapshot.physics);
    this.bodies = snapshot.bodyHandles.map((handle) => this.physics.world.getRigidBody(handle));
    this.player.loadState(snapshot.player);
    Object.assign(this.previousPlayer, snapshot.player);
    this.readTransforms();
    this.previousTransforms.set(this.transforms);
    this.events.drain();
  }

  dispose(): void {
    this.player.dispose();
    this.physics.dispose();
  }

  private spawnCrates(count: number): void {
    const h = SANDBOX_DEFAULTS.crateHalf;
    for (let i = 0; i < count; i++) {
      this.bodies.push(this.physics.addDynamicBox(this.randomCratePosition(), { x: h, y: h, z: h }));
    }
  }

  private randomCratePosition(): Vec3 {
    const rng = this.crateRng;
    const spread = CRATE_AREA.spread;
    return { x: CRATE_AREA.x + rng.range(-spread, spread), y: rng.range(2, 26), z: CRATE_AREA.z + rng.range(-spread, spread) };
  }

  /** Pushes every crate near the point aimed at through the crosshair (camera ray). */
  private kick(): void {
    const d = SANDBOX_DEFAULTS;
    const pose = computeCameraPose(this.player.state, this.camera, this.physics, this.player.collider, this.cameraPose);
    const hit = this.physics.raycast(pose.position, pose.forward, d.kickRange, this.rayHit, {
      groups: QUERY_WORLD_AND_PROPS,
      exclude: this.player.collider,
    });
    const reach = hit !== null ? hit.distance : 12;
    const px = pose.position.x + pose.forward.x * reach;
    const py = pose.position.y + pose.forward.y * reach;
    const pz = pose.position.z + pose.forward.z * reach;
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
