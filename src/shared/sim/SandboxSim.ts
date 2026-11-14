import type RAPIER from "@dimforge/rapier3d-compat";
import { defaultVitalsConfig, type VitalsConfig } from "../combat/Vitals";
import { makeRayHit, PhysicsWorld, QUERY_WORLD_AND_PROPS } from "../physics/PhysicsWorld";
import { defaultRules, type RulesConfig } from "../rules/RulesConfig";
import { DoorSystem, type DoorState } from "../world/Doors";
import { generateIsland } from "../world/Island";
import { type Block, CRATE_AREA, type LaunchPad, PLAYGROUND, playgroundWorld } from "../world/Playground";
import { buildStaticPhysics, type StaticWorld } from "../world/StaticWorld";
import { type CameraConfig, computeCameraPose, defaultCameraConfig, makeCameraPose } from "./CameraRig";
import { EventQueue, type SimEvent } from "./Events";
import { StateHasher } from "./Hash";
import { Button, type InputFrame, wasPressed } from "./InputFrame";
import type { Vec3 } from "./MathUtil";
import { defaultMovementConfig, type MovementConfig } from "./MovementConfig";
import { clonePlayerState, type MovementWorld, PlayerController, type PlayerState } from "./PlayerSim";
import { Rng, type RngState } from "./Rng";
import type { Simulation } from "./Simulation";
import { resolveSlideKicks } from "./SlideKick";

/**
 * Free-roam simulation of one player in a static world: either the movement
 * playground (fixed course, crates, training dummy) or the island (M4).
 * It exercises the whole pipeline (input -> fixed sim -> physics -> events
 * -> interpolated render) and is the subject of the determinism harness.
 */

export type SandboxWorldKind = "playground" | "island";

export interface SandboxConfig {
  seed: number;
  crateCount: number;
  /** Which static world to stand in (default: playground). */
  world?: SandboxWorldKind;
  movement?: MovementConfig;
  camera?: CameraConfig;
  rules?: RulesConfig;
  vitals?: VitalsConfig;
  /** Adds the training dummy (default true). */
  dummy?: boolean;
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
  players: PlayerState[];
  doors: DoorState[];
  physics: Uint8Array;
}

/** The dummy stands still and only turns. */
const DUMMY_INPUT: InputFrame = { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 };

/** Floats stored per crate in the transform buffers: position xyz + quaternion xyzw. */
export const TRANSFORM_STRIDE = 7;

/** Entity id of the local player in the sandbox. */
export const SANDBOX_PLAYER_ID = 1;
/** Entity id of the training dummy. */
export const SANDBOX_DUMMY_ID = 2;

export class SandboxSim implements Simulation<SandboxSnapshot> {
  tick = 0;
  readonly seed: number;
  /** Static boxes of the world (playground course pieces, island buildings). */
  readonly blocks: Block[];
  readonly staticWorld: StaticWorld;
  /** Number of static colliders built from the world. */
  readonly staticColliders: number;
  readonly player: PlayerController;
  /** Player state after the previous tick (render interpolation). */
  previousPlayer: PlayerState;
  /** Training dummy: a second character that stands still (slide kick target). */
  readonly dummy: PlayerController | null;
  previousDummy: PlayerState | null;
  readonly movement: MovementConfig;
  readonly camera: CameraConfig;
  readonly rules: RulesConfig;
  readonly doors: DoorSystem;
  readonly launchPads: LaunchPad[];
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
    this.rules = config.rules ?? defaultRules();
    this.physics = new PhysicsWorld(this.movement.gravity);
    this.staticWorld = config.world === "island" ? generateIsland(this.seed).world : playgroundWorld(this.seed);
    this.blocks = this.staticWorld.boxes;
    this.staticColliders = buildStaticPhysics(this.physics, this.staticWorld).colliders;
    this.doors = new DoorSystem(this.physics, this.staticWorld.doors);
    this.launchPads = this.staticWorld.launchPads;
    this.spawnCrates(config.crateCount);
    const world: MovementWorld = {
      physics: this.physics,
      rules: this.rules,
      vitals: config.vitals ?? defaultVitalsConfig(),
      doors: this.doors,
      launchPads: this.launchPads,
      waterLevel: this.staticWorld.waterLevel,
    };
    const spawn = this.staticWorld.spawn;
    this.player = new PlayerController(SANDBOX_PLAYER_ID, world, this.movement, spawn, this.staticWorld.spawnYaw);
    this.previousPlayer = this.player.saveState();
    // The dummy stands on the course in the playground and a few metres ahead of the spawn on the island.
    const dummyAt =
      this.staticWorld.kind === "playground" ? PLAYGROUND.dummy : { x: spawn.x + 4, y: spawn.y + 0.5, z: spawn.z - 6 };
    this.dummy =
      config.dummy === false ? null : new PlayerController(SANDBOX_DUMMY_ID, world, this.movement, dummyAt, PLAYGROUND.dummyYaw);
    this.previousDummy = this.dummy?.saveState() ?? null;
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

  /** All characters in a fixed order (player first). */
  get characters(): PlayerController[] {
    return this.dummy === null ? [this.player] : [this.player, this.dummy];
  }

  step(input: InputFrame): void {
    this.previousTransforms.set(this.transforms);
    this.previousPlayer = clonePlayerState(this.player.state);
    if (this.dummy !== null) this.previousDummy = clonePlayerState(this.dummy.state);

    this.player.step(input, this.tick, this.events);
    if (this.dummy !== null) {
      // The dummy only keeps facing the player.
      const p = this.player.state;
      const d = this.dummy.state;
      this.dummy.step({ ...DUMMY_INPUT, yaw: Math.atan2(-(p.x - d.x), -(p.z - d.z)) }, this.tick, this.events);
    }
    for (const id of resolveSlideKicks(this.characters, () => false, this.tick, this.events)) {
      // Sandbox: a knocked-out dummy simply gets back up with full vitals.
      if (id === SANDBOX_DUMMY_ID) this.dummy?.resetVitals();
      else if (id === SANDBOX_PLAYER_ID) this.player.resetVitals();
    }
    if (wasPressed(input.buttons, this.previousButtons, Button.Fire) && this.player.canUseItem) this.kick();
    if (wasPressed(input.buttons, this.previousButtons, Button.Reload)) this.respawnCrates();
    this.previousButtons = input.buttons;

    this.doors.step();
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
    for (const character of this.characters) character.hashInto(hasher);
    this.doors.hashInto(hasher);
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
      players: this.characters.map((character) => character.saveState()),
      doors: this.doors.saveStates(),
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
    this.characters.forEach((character, i) => character.loadState(snapshot.players[i] as PlayerState));
    this.previousPlayer = this.player.saveState();
    this.previousDummy = this.dummy?.saveState() ?? null;
    this.doors.loadStates(snapshot.doors);
    this.readTransforms();
    this.previousTransforms.set(this.transforms);
    this.events.drain();
  }

  dispose(): void {
    this.dummy?.dispose();
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
    // Island crates drop near the spawn; playground crates on their pad.
    const center =
      this.staticWorld.kind === "playground"
        ? { x: CRATE_AREA.x, y: 0, z: CRATE_AREA.z }
        : { x: this.staticWorld.spawn.x + 12, y: this.staticWorld.spawn.y, z: this.staticWorld.spawn.z - 10 };
    return { x: center.x + rng.range(-spread, spread), y: center.y + rng.range(2, 26), z: center.z + rng.range(-spread, spread) };
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
