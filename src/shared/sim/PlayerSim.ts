import RAPIER from "@dimforge/rapier3d-compat";
import { applyDamage, applyHealthDamage, freshVitals, tickVitals, type Vitals, type VitalsConfig } from "../combat/Vitals";
import { makeRayHit, type PhysicsWorld, QUERY_WORLD_AND_PROPS, QUERY_WORLD_ONLY } from "../physics/PhysicsWorld";
import type { RulesConfig } from "../rules/RulesConfig";
import type { DoorSystem } from "../world/Doors";
import type { LaunchPad } from "../world/Playground";
import { SIM_DT } from "./Constants";
import type { EventQueue } from "./Events";
import type { StateHasher } from "./Hash";
import { Button, type InputFrame, wasPressed } from "./InputFrame";
import { probeTraversal, type TraversalPlan } from "./LedgeProbe";
import { clamp, lerp, type Vec3, wrapAngle } from "./MathUtil";
import { capsuleHalfHeight, fallDamage, jumpVelocity, launchSpeedForHeight, type MovementConfig } from "./MovementConfig";

/**
 * Character movement (GAME_SPEC §2): walk/run, crouch, ADS walk, jump with
 * coyote time and buffering, tactical sprint with stamina, slide, mantle,
 * hurdle, shoulder-bash doors, roll landing, skydive, glider (cut and
 * redeploy), launch pads and fall damage. Driven only by InputFrames so
 * humans, bots and the server share it. All mutable state is plain data in
 * `PlayerState`, so it can be hashed, snapshotted and interpolated.
 */

/**
 * walk: normal ground/air locomotion (also sprint, crouch and jumps)
 * slide, mantle, hurdle, roll, skydive, glide: as named
 * splat: face-plant after a would-be-lethal fall (modern rule); no control
 */
export type MoveMode = "walk" | "slide" | "mantle" | "hurdle" | "roll" | "skydive" | "glide" | "splat" | "swim";

/** Hotbar slot of the harvesting tool. */
export const PICKAXE_SLOT = 0;
export const HOTBAR_SLOTS = 5;

export interface PlayerState {
  mode: MoveMode;
  /** Seconds spent in the current mode. */
  modeTime: number;
  /** Feet position (bottom of the capsule, including the controller skin). */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Look angles (camera). */
  yaw: number;
  pitch: number;
  /** Facing of the character model and its hitboxes. */
  bodyYaw: number;
  grounded: boolean;
  /** Capsule is in its short shape. */
  crouched: boolean;
  /** 0..1 visual/camera crouch amount following `crouched`. */
  crouchBlend: number;
  adsBlend: number;
  /** Target shoulder: +1 right, -1 left. */
  shoulder: number;
  /** -1..+1, eased toward `shoulder`. */
  shoulderBlend: number;
  /** Seconds since the character last stood on ground. */
  airTime: number;
  /** Highest feet height since leaving the ground (fall distance = this - y). */
  fallStartY: number;
  /** Seconds left in which a buffered jump press is honoured. */
  jumpBufferLeft: number;
  /** Seconds since Jump was last pressed (roll landing window). */
  jumpPressAge: number;
  /** True from a jump until the next landing (blocks coyote double jumps). */
  jumping: boolean;
  /** Idle body is turning to catch up with the look direction. */
  turningInPlace: boolean;
  /** Unit normal of the walkable surface under the character (0,1,0 in the air). */
  groundNx: number;
  groundNy: number;
  groundNz: number;

  // Sprint and stamina.
  sprinting: boolean;
  stamina: number;
  /** Seconds since stamina was last drained. */
  sinceDrain: number;
  /** Seconds left before sprint may start again after running dry. */
  sprintLockout: number;
  /** A door was already bashed during this sprint/slide. */
  bashUsed: boolean;

  // Held item.
  /** 0 = Pickaxe, 1..5 = hotbar slots. */
  equipSlot: number;
  /** The held item is lowered (sprinting, traversing, gliding). */
  holstered: boolean;
  /** Seconds until the held item can be used again (raise delay). */
  itemReadyIn: number;
  /** Seconds left during which jump/crouch/sprint presses are ignored (after a mantle). */
  inputLockLeft: number;

  // Slide.
  /** Seconds of the current slide spent going downhill (boosted jumps). */
  slideDownhill: number;

  // Mantle / hurdle path.
  travelStartX: number;
  travelStartY: number;
  travelStartZ: number;
  travelEndX: number;
  travelEndY: number;
  travelEndZ: number;
  /** Mantle: obstacle top. Hurdle: extra arc height so the feet clear the obstacle. */
  travelTopY: number;
  travelArc: number;
  travelDuration: number;
  travelDirX: number;
  travelDirZ: number;
  /** Horizontal speed to leave a hurdle with. */
  travelExitSpeed: number;
  travelEndCrouched: boolean;

  // Air.
  /** Thrown by a launch pad; turns into a skydive at the apex. */
  launched: boolean;
  /** Height of the feet above the ground below (updated while airborne). */
  aboveGround: number;
  /** Glider heading (yaw) and visual bank (-1..1). */
  glideHeading: number;
  glideBank: number;
  /** Seconds before the glider can open again. */
  gliderCooldown: number;
  /** The glider was opened mid-fall (not from a skydive). */
  redeployed: boolean;

  vitals: Vitals;
  /** Per-target slide kick cooldowns. */
  kickCooldowns: { target: number; left: number }[];

  /** Buttons of the previous tick, for edge detection. */
  previousButtons: number;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
}

/** What the character's surroundings provide besides physics. */
export interface MovementWorld {
  physics: PhysicsWorld;
  rules: RulesConfig;
  vitals: VitalsConfig;
  doors: DoorSystem | null;
  launchPads: readonly LaunchPad[];
  /** Water surface height, or null for worlds without water. */
  waterLevel: number | null;
}

/** Converts feet position to capsule centre height offset for a total height. */
function centerOffset(config: MovementConfig, height: number): number {
  return config.controllerOffset + height / 2;
}

/** Moves `value` toward `target` by at most `maxDelta`. */
function approach(value: number, target: number, maxDelta: number): number {
  if (value < target) return Math.min(target, value + maxDelta);
  return Math.max(target, value - maxDelta);
}

/** Smoothstep easing on 0..1. */
function ease(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/** Feeds every number/boolean/string in a value (recursively) into a hasher, in key order. */
function hashValue(hasher: StateHasher, value: unknown): void {
  if (typeof value === "number") hasher.addNumber(value);
  else if (typeof value === "boolean") hasher.addInt(value ? 1 : 0);
  else if (typeof value === "string") for (let i = 0; i < value.length; i++) hasher.addInt(value.charCodeAt(i));
  else if (Array.isArray(value)) {
    hasher.addInt(value.length);
    for (const item of value) hashValue(hasher, item);
  } else if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value)) hashValue(hasher, (value as Record<string, unknown>)[key]);
  }
}

/** Deep copy of a player state (it only contains numbers, booleans, strings, one object and one array). */
export function clonePlayerState(state: PlayerState): PlayerState {
  return { ...state, vitals: { ...state.vitals }, kickCooldowns: state.kickCooldowns.map((k) => ({ ...k })) };
}

export class PlayerController {
  readonly state: PlayerState;
  /** Capsule collider handle (stable across snapshot restores). */
  readonly colliderHandle: number;
  private controller: RAPIER.KinematicCharacterController;
  private readonly desired: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly collision = new RAPIER.CharacterCollision();
  /** cos(max slope): contacts with a normal.y at or above this are walkable ground. */
  private walkableNy: number;
  private readonly center: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly scratch: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly rayDir: Vec3 = { x: 0, y: -1, z: 0 };
  private readonly rayHit = makeRayHit();
  // Per-tick input values shared by the mode handlers.
  private wishX = 0;
  private wishZ = 0;
  private wishLength = 0;
  private buttons = 0;
  private tick = 0;
  private events: EventQueue | null = null;

  constructor(
    readonly id: number,
    private readonly world: MovementWorld,
    readonly config: MovementConfig,
    spawn: Vec3,
    yaw = 0,
  ) {
    this.state = {
      mode: "walk",
      modeTime: 0,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw,
      pitch: 0,
      bodyYaw: yaw,
      grounded: false,
      crouched: false,
      crouchBlend: 0,
      adsBlend: 0,
      shoulder: 1,
      shoulderBlend: 1,
      airTime: 0,
      fallStartY: spawn.y,
      jumpBufferLeft: 0,
      jumpPressAge: 10,
      jumping: false,
      turningInPlace: false,
      groundNx: 0,
      groundNy: 1,
      groundNz: 0,
      sprinting: false,
      stamina: config.staminaMax,
      sinceDrain: config.staminaRegenDelay,
      sprintLockout: 0,
      bashUsed: false,
      equipSlot: 1,
      holstered: false,
      itemReadyIn: 0,
      inputLockLeft: 0,
      slideDownhill: 0,
      travelStartX: 0,
      travelStartY: 0,
      travelStartZ: 0,
      travelEndX: 0,
      travelEndY: 0,
      travelEndZ: 0,
      travelTopY: 0,
      travelArc: 0,
      travelDuration: 0,
      travelDirX: 0,
      travelDirZ: 0,
      travelExitSpeed: 0,
      travelEndCrouched: false,
      launched: false,
      aboveGround: 0,
      glideHeading: yaw,
      glideBank: 0,
      gliderCooldown: 0,
      redeployed: false,
      vitals: freshVitals(world.vitals),
      kickCooldowns: [],
      previousButtons: 0,
      spawnX: spawn.x,
      spawnY: spawn.y,
      spawnZ: spawn.z,
    };
    const height = config.standHeight;
    const collider = world.physics.addCharacterCapsule(
      { x: spawn.x, y: spawn.y + centerOffset(config, height), z: spawn.z },
      capsuleHalfHeight(height, config.capsuleRadius),
      config.capsuleRadius,
    );
    this.colliderHandle = collider.handle;
    this.walkableNy = Math.cos((config.maxSlopeDeg * Math.PI) / 180);
    this.controller = this.buildController();
  }

  private get physics(): PhysicsWorld {
    return this.world.physics;
  }

  /** The capsule collider (looked up each time; the world object changes on restore). */
  get collider(): RAPIER.Collider {
    return this.physics.getCollider(this.colliderHandle);
  }

  /** Current capsule height. */
  get height(): number {
    return this.state.crouched ? this.config.crouchHeight : this.config.standHeight;
  }

  /** Horizontal speed in m/s. */
  get horizontalSpeed(): number {
    return Math.hypot(this.state.vx, this.state.vz);
  }

  /** Height fallen since the highest point of the current airtime. */
  get fallDistance(): number {
    return Math.max(0, this.state.fallStartY - this.state.y);
  }

  /** True when the held item may be used this tick (not lowered, raised, not traversing). */
  get canUseItem(): boolean {
    const s = this.state;
    return (s.mode === "walk" || s.mode === "slide") && !s.holstered && s.itemReadyIn <= 0;
  }

  /** Infinite sprint applies: rule on and the Pickaxe in hand. */
  get infiniteSprint(): boolean {
    return this.world.rules.pickaxeInfiniteSprint && this.state.equipSlot === PICKAXE_SLOT;
  }

  /** Glider redeploy would succeed if Jump were pressed now (HUD prompt). */
  get canRedeployNow(): boolean {
    return this.state.mode === "walk" && !this.state.grounded && this.canRedeploy();
  }

  /**
   * Re-applies config values the physics controller caches (step height,
   * slopes). Call after editing the shared MovementConfig live.
   */
  applyConfigChanges(): void {
    this.walkableNy = Math.cos((this.config.maxSlopeDeg * Math.PI) / 180);
    this.controller.free();
    this.controller = this.buildController();
  }

  /** Advances one fixed tick. Must run before `PhysicsWorld.step()` of the same tick. */
  step(input: InputFrame, tick: number, events: EventQueue): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    this.tick = tick;
    this.events = events;
    this.buttons = input.buttons;

    // Timers.
    s.modeTime += dt;
    s.itemReadyIn = Math.max(0, s.itemReadyIn - dt);
    s.inputLockLeft = Math.max(0, s.inputLockLeft - dt);
    s.gliderCooldown = Math.max(0, s.gliderCooldown - dt);
    s.sprintLockout = Math.max(0, s.sprintLockout - dt);
    s.jumpPressAge = Math.min(10, s.jumpPressAge + dt);
    for (const kick of s.kickCooldowns) kick.left -= dt;
    s.kickCooldowns = s.kickCooldowns.filter((kick) => kick.left > 0);

    // Look.
    const maxPitch = (c.maxPitchDeg * Math.PI) / 180;
    s.yaw = wrapAngle(input.yaw);
    s.pitch = clamp(input.pitch, -maxPitch, maxPitch);
    if (this.pressed(Button.Jump)) s.jumpPressAge = 0;

    // Shoulder swap, held slot and ADS.
    if (this.pressed(Button.ShoulderSwap)) s.shoulder = -s.shoulder;
    s.shoulderBlend = approach(s.shoulderBlend, s.shoulder, (2 / c.shoulderSwapTime) * dt);
    this.updateEquip();
    const canAim = s.mode === "walk" || s.mode === "slide";
    const aiming = canAim && (this.buttons & Button.Ads) !== 0;
    s.adsBlend = approach(s.adsBlend, aiming ? 1 : 0, dt / c.adsTime);

    this.computeWish(input);

    // Falling or walking into deep water starts a swim (no fall damage in water).
    if (this.inDeepWater() && s.mode !== "swim" && s.mode !== "mantle" && s.mode !== "hurdle") this.startSwim();

    switch (s.mode) {
      case "walk":
        this.stepWalk(input, aiming);
        break;
      case "slide":
        this.stepSlide();
        break;
      case "mantle":
      case "hurdle":
        this.stepTraversal();
        break;
      case "roll":
        this.stepRoll();
        break;
      case "skydive":
        this.stepSkydive(input);
        break;
      case "glide":
        this.stepGlide(input);
        break;
      case "splat":
        this.stepSplat();
        break;
      case "swim":
        this.stepSwim();
        break;
    }

    this.updateStamina();
    const wasHolstered = s.holstered;
    s.holstered =
      s.sprinting ||
      s.mode === "mantle" ||
      s.mode === "hurdle" ||
      s.mode === "skydive" ||
      s.mode === "glide" ||
      s.mode === "roll" ||
      s.mode === "splat" ||
      s.mode === "swim";
    if (wasHolstered && !s.holstered) s.itemReadyIn = Math.max(s.itemReadyIn, c.sprintRaiseTime);
    s.crouchBlend = approach(s.crouchBlend, s.crouched ? 1 : 0, c.crouchBlendRate * dt);
    this.updateBodyYaw();
    tickVitals(s.vitals, this.world.vitals, dt);

    if (s.y < c.killPlaneY) this.respawn("killPlane");
    s.previousButtons = this.buttons;
    this.events = null;
  }

  /** Places the character at a position with zero velocity in walk mode (tests, respawn, spawn points). */
  teleport(x: number, y: number, z: number): void {
    const s = this.state;
    s.x = x;
    s.y = y;
    s.z = z;
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    s.grounded = false;
    s.jumping = false;
    s.launched = false;
    s.airTime = 0;
    s.fallStartY = y;
    s.groundNx = 0;
    s.groundNy = 1;
    s.groundNz = 0;
    s.sprinting = false;
    this.setMode("walk");
    this.syncCollider();
  }

  /** Starts a skydive from the current position (Battle Bus jump, debug tools). */
  startSkydive(): void {
    const s = this.state;
    s.launched = false;
    s.sprinting = false;
    s.fallStartY = s.y;
    this.setCrouched(false);
    this.setMode("skydive");
    this.events?.push("skydiveStart", this.tick, { id: this.id });
  }

  /** Adds an instant velocity change (slide kicks, explosions, shockwaves). */
  applyKnockback(dvx: number, dvy: number, dvz: number): void {
    const s = this.state;
    s.vx += dvx;
    s.vy += dvy;
    s.vz += dvz;
    if (dvy > 0) {
      s.grounded = false;
      s.jumping = true;
    }
    if (s.mode === "slide" || s.mode === "roll") this.setMode("walk");
  }

  /**
   * Shield-layered damage from another character. Returns true when it was
   * lethal (the caller decides what elimination means).
   */
  takeDamage(amount: number): boolean {
    return applyDamage(this.state.vitals, amount).lethal;
  }

  /** Records that this character kicked `target`; returns false while still on cooldown. */
  tryStartKickCooldown(target: number): boolean {
    if (this.state.kickCooldowns.some((kick) => kick.target === target)) return false;
    this.state.kickCooldowns.push({ target, left: this.config.slideKickCooldown });
    return true;
  }

  /** Restores full vitals (sandbox respawn, rebooting). */
  resetVitals(): void {
    this.state.vitals = freshVitals(this.world.vitals);
  }

  /** Mixes all state into a determinism hash. */
  hashInto(hasher: StateHasher): void {
    hashValue(hasher, this.state);
  }

  /** Deep copy of the state for snapshots. */
  saveState(): PlayerState {
    return clonePlayerState(this.state);
  }

  /**
   * Restores state saved by `saveState`. Call after the PhysicsWorld itself
   * was restored: the controller is rebuilt against the new world.
   */
  loadState(saved: PlayerState): void {
    Object.assign(this.state, clonePlayerState(saved));
    this.controller.free();
    this.controller = this.buildController();
  }

  dispose(): void {
    this.controller.free();
  }

  // ---------------------------------------------------------------- modes

  private stepWalk(input: InputFrame, aiming: boolean): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    const locked = s.inputLockLeft > 0;

    // Crouch: a press at speed starts a slide; otherwise hold to crouch.
    const crouchHeld = (this.buttons & Button.Crouch) !== 0;
    if (!locked && s.grounded && this.pressed(Button.Crouch) && this.horizontalSpeed >= c.slideMinEntrySpeed) {
      this.startSlide();
      this.stepSlide();
      return;
    }
    if (crouchHeld && !s.crouched && !s.sprinting) this.setCrouched(true);
    else if (!crouchHeld && s.crouched && this.canStand()) this.setCrouched(false);

    this.updateSprint(input, aiming);

    // Ground speed target.
    const speed = s.crouched ? c.crouchSpeed : aiming ? c.adsWalkSpeed : s.sprinting ? c.sprintSpeed : c.runSpeed;
    const targetX = this.wishX * speed;
    const targetZ = this.wishZ * speed;
    if (s.grounded) {
      let rate = this.wishLength > 0.01 ? c.groundAccel : c.groundDecel;
      // Keep momentum above the target speed (slide -> sprint chains, launches, landings).
      if (this.wishLength > 0.01 && this.horizontalSpeed > speed + 0.05) rate = c.overspeedDecel;
      this.accelerateHorizontal(targetX, targetZ, rate * dt);
    } else if (this.wishLength > 0.01) {
      // Air control steers toward the wished velocity but never brakes below it.
      const before = this.horizontalSpeed;
      this.accelerateHorizontal(targetX, targetZ, c.airAccel * dt);
      const after = this.horizontalSpeed;
      const limit = Math.max(before, speed);
      if (after > limit) {
        s.vx *= limit / after;
        s.vz *= limit / after;
      }
    }

    // Jump / mantle / hurdle.
    if (!locked && this.pressed(Button.Jump)) s.jumpBufferLeft = c.jumpBuffer;
    else s.jumpBufferLeft = Math.max(0, s.jumpBufferLeft - dt);

    if (s.grounded && s.jumpBufferLeft > 0 && this.wishLength > 0.3 && this.tryTraversal(false)) return;

    let jumpedThisTick = false;
    const onGroundForJump = s.grounded || (!s.jumping && s.airTime <= c.coyoteTime);
    if (!s.grounded && !onGroundForJump && this.pressed(Button.Jump)) {
      // Mid-air jump press: glider redeploy when falling fast enough.
      if (this.canRedeploy()) {
        this.openGlider(true);
        this.stepGlide(input);
        return;
      }
    }
    if (s.jumpBufferLeft > 0 && onGroundForJump) {
      const sprintJump = s.sprinting && s.grounded;
      s.vy = sprintJump
        ? launchSpeedForHeight(c.gravity, c.jumpHeight * c.sprintJumpHeightMult, dt)
        : jumpVelocity(c, dt);
      if (sprintJump) this.addForwardBoost(c.sprintJumpForwardBoost);
      this.beginJump(sprintJump, false, false);
      jumpedThisTick = true;
    }

    // Air: grab ledges while moving toward them, launch pads turn into skydives at the apex.
    if (!s.grounded && !jumpedThisTick && this.wishLength > 0.5 && s.vy < 4 && this.tryTraversal(true)) return;
    if (s.launched && !s.grounded && s.vy <= 0) {
      this.startSkydive();
      this.stepSkydive(input);
      return;
    }

    s.vy = Math.max(-c.terminalFallSpeed, s.vy - c.gravity * dt);
    if (s.sprinting && !s.bashUsed) this.tryBashDoor();
    if (!locked && this.pressed(Button.Interact)) this.toggleDoor();
    this.move(dt, jumpedThisTick);
    if (s.mode === "walk" && s.grounded) this.checkLaunchPad();
  }

  private startSlide(): void {
    const s = this.state;
    const c = this.config;
    const speed = this.horizontalSpeed;
    const scale = Math.max(speed, c.slideMinStartSpeed) / Math.max(speed, 1e-6);
    s.vx *= scale;
    s.vz *= scale;
    s.sprinting = false;
    s.slideDownhill = 0;
    s.bashUsed = false;
    this.setCrouched(true);
    this.setMode("slide");
    this.events?.push("slideStart", this.tick, { id: this.id, speed: this.horizontalSpeed });
  }

  private endSlide(toSprint: boolean): void {
    const s = this.state;
    this.events?.push("slideEnd", this.tick, { id: this.id, speed: this.horizontalSpeed });
    this.setMode("walk");
    if (toSprint && this.canStand()) {
      this.setCrouched(false);
      if (s.stamina >= this.config.sprintMinStart || this.infiniteSprint) this.setSprinting(true);
    } else if ((this.buttons & Button.Crouch) === 0 && this.canStand()) {
      this.setCrouched(false);
    }
  }

  private stepSlide(): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    const g = c.gravity;

    if (!s.grounded) {
      // Ground dropped away: keep the momentum as a normal fall.
      this.endSlide(false);
      s.vy = Math.max(-c.terminalFallSpeed, s.vy - g * dt);
      this.move(dt, false);
      return;
    }

    let speed = this.horizontalSpeed;
    let dirX = speed > 1e-6 ? s.vx / speed : -Math.sin(s.yaw);
    let dirZ = speed > 1e-6 ? s.vz / speed : -Math.cos(s.yaw);

    // Steering toward the wished direction at a limited turn rate.
    if (this.wishLength > 0.1) {
      const current = Math.atan2(-dirX, -dirZ);
      const wanted = Math.atan2(-this.wishX, -this.wishZ);
      const maxTurn = ((c.slideSteerRate * Math.PI) / 180) * dt;
      const heading = current + clamp(wrapAngle(wanted - current), -maxTurn, maxTurn);
      dirX = -Math.sin(heading);
      dirZ = -Math.cos(heading);
    }

    // Slope along the slide direction: the horizontal part of the ground normal points downhill.
    const sinSlope = Math.hypot(s.groundNx, s.groundNz);
    const downhill = sinSlope > 1e-4 ? (dirX * s.groundNx + dirZ * s.groundNz) / sinSlope : 0;
    const along = downhill * sinSlope;
    if (along > 0.02) {
      speed += (g * along * c.slideDownhillBoost - c.slideFlatDecel) * dt;
      s.slideDownhill += dt;
    } else if (along < -0.02) {
      speed -= (c.slideFlatDecel + g * -along * c.slideUphillDecelMult) * dt;
      s.slideDownhill = 0;
    } else {
      speed -= c.slideFlatDecel * dt;
    }
    speed = Math.min(c.slideMaxSpeed, speed);
    s.vx = dirX * Math.max(0, speed);
    s.vz = dirZ * Math.max(0, speed);

    if (s.inputLockLeft <= 0 && this.pressed(Button.Jump)) {
      // Slide jump keeps (and boosts) the momentum; downhill speed adds lift.
      const boostable = s.slideDownhill > 0.2;
      const excess = clamp((speed - c.runSpeed) / (c.slideMaxSpeed - c.runSpeed), 0, 1);
      s.vx *= c.slideJumpBoost;
      s.vz *= c.slideJumpBoost;
      s.vy = jumpVelocity(c, dt) + (boostable ? c.boostedJumpLift * excess : 0);
      this.endSlide(false);
      if (this.canStand()) this.setCrouched(false);
      this.beginJump(false, true, boostable && excess > 0);
      s.vy -= g * dt;
      this.move(dt, true);
      return;
    }
    if (s.inputLockLeft <= 0 && this.pressed(Button.Sprint)) {
      this.endSlide(true);
    } else if (speed < c.slideEndSpeed) {
      this.endSlide(false);
    } else if (!s.bashUsed) {
      this.tryBashDoor();
    }

    s.vy = Math.max(-c.terminalFallSpeed, s.vy - g * dt);
    this.move(dt, false);
  }

  /** Mantle and hurdle: kinematic path, no collision until it ends. */
  private stepTraversal(): void {
    const s = this.state;
    const t = Math.min(1, s.modeTime / s.travelDuration);
    const previousX = s.x;
    const previousY = s.y;
    const previousZ = s.z;

    if (s.mode === "mantle") {
      // Rise to just above the top at the start position, then move onto it.
      const riseEnd = 0.6;
      const rise = ease(t / riseEnd);
      const over = ease((t - riseEnd) / (1 - riseEnd));
      s.y = lerp(s.travelStartY, s.travelTopY + 0.12, rise);
      if (t > riseEnd) s.y = lerp(s.travelTopY + 0.12, s.travelEndY, over);
      s.x = lerp(s.travelStartX, s.travelEndX, over);
      s.z = lerp(s.travelStartZ, s.travelEndZ, over);
    } else {
      // Hurdle: straight line plus an arc that clears the obstacle.
      s.x = lerp(s.travelStartX, s.travelEndX, t);
      s.z = lerp(s.travelStartZ, s.travelEndZ, t);
      s.y = lerp(s.travelStartY, s.travelEndY, t) + 4 * s.travelArc * t * (1 - t);
    }
    const dt = SIM_DT;
    s.vx = (s.x - previousX) / dt;
    s.vy = (s.y - previousY) / dt;
    s.vz = (s.z - previousZ) / dt;
    this.syncCollider();

    if (t >= 1) {
      const c = this.config;
      const exit = s.mode === "hurdle" ? s.travelExitSpeed : Math.min(this.horizontalSpeed, 2);
      s.vx = s.travelDirX * exit;
      s.vz = s.travelDirZ * exit;
      s.vy = 0;
      s.grounded = true;
      s.jumping = false;
      s.airTime = 0;
      s.fallStartY = s.y;
      if (s.mode === "mantle") {
        s.inputLockLeft = c.mantleInputLock;
        s.itemReadyIn = Math.max(s.itemReadyIn, c.mantleRaiseDelay);
      }
      this.setMode("walk");
      const wantCrouch = (this.buttons & Button.Crouch) !== 0 || s.travelEndCrouched;
      if (!wantCrouch && this.canStand()) this.setCrouched(false);
      else this.setCrouched(true);
    }
  }

  private stepRoll(): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    // Keep rolling forward at (at least) run speed, no steering.
    const speed = Math.max(this.horizontalSpeed, c.runSpeed * 0.8);
    const heading = this.horizontalSpeed > 0.1 ? Math.atan2(-s.vx, -s.vz) : s.bodyYaw;
    s.vx = -Math.sin(heading) * speed;
    s.vz = -Math.cos(heading) * speed;
    s.vy = Math.max(-c.terminalFallSpeed, s.vy - c.gravity * dt);
    this.move(dt, false);
    if (s.mode === "roll" && s.modeTime >= c.rollTime) {
      this.setMode("walk");
      if ((this.buttons & Button.Crouch) === 0 && this.canStand()) this.setCrouched(false);
    }
  }

  private stepSplat(): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    this.accelerateHorizontal(0, 0, c.groundDecel * dt);
    s.vy = Math.max(-c.terminalFallSpeed, s.vy - c.gravity * dt);
    this.move(dt, false);
    if (s.mode === "splat" && s.modeTime >= c.splatTime) {
      this.setMode("walk");
      if (this.canStand()) this.setCrouched(false);
    }
  }

  private stepSkydive(input: InputFrame): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    s.aboveGround = this.measureAboveGround();

    // Steering relative to the look direction.
    this.accelerateHorizontal(this.wishX * c.skydiveSteerSpeed, this.wishZ * c.skydiveSteerSpeed, c.skydiveSteerAccel * dt);
    // Diving: holding forward while looking down raises the fall speed.
    const dive = clamp(input.moveZ, 0, 1) * clamp(-s.pitch / 0.8, 0, 1);
    const fallSpeed = lerp(c.skydiveTerminalSpeed, c.skydiveDiveSpeed, dive);
    if (s.vy > -fallSpeed) s.vy = Math.max(-fallSpeed, s.vy - c.gravity * dt);
    else s.vy = Math.min(-fallSpeed, s.vy + c.gravity * 0.6 * dt);

    const wantsGlider = this.pressed(Button.Jump) || s.aboveGround <= c.gliderAutoDeployHeight;
    if (wantsGlider && s.gliderCooldown <= 0) {
      this.openGlider(false);
      return;
    }
    this.move(dt, false);
  }

  private stepGlide(input: InputFrame): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    s.aboveGround = this.measureAboveGround();

    // Heading follows the look yaw; A/D bank the heading up to `gliderBankAngle` to the side
    // of the look (and turn faster), so the glider can be steered without moving the camera.
    const bankOffset = -input.moveX * ((c.gliderBankAngle * Math.PI) / 180);
    const turnRate = ((c.gliderTurnRate * Math.PI) / 180) * (1 + 0.5 * Math.abs(input.moveX)) * dt;
    const turn = clamp(wrapAngle(s.yaw + bankOffset - s.glideHeading), -turnRate, turnRate);
    s.glideHeading = wrapAngle(s.glideHeading + turn);
    // Visual bank: roll into the turn, plus a lean while A/D is held.
    const bankTarget = clamp(turn / (((c.gliderTurnRate * Math.PI) / 180) * dt) * 0.7 + -input.moveX * 0.3, -1, 1);
    s.glideBank = approach(s.glideBank, bankTarget, dt * 3);

    const forwardInput = input.moveZ;
    let forward = c.gliderForwardSpeed;
    let sink = c.gliderSinkSpeed;
    if (forwardInput > 0) {
      forward += c.gliderFastForwardBonus * forwardInput;
      sink += c.gliderFastSinkBonus * forwardInput;
    } else if (forwardInput < 0) {
      forward -= c.gliderSlowForwardPenalty * -forwardInput;
      sink -= c.gliderSlowSinkPenalty * -forwardInput;
    }
    const accel = 12 * dt;
    s.vx = approach(s.vx, -Math.sin(s.glideHeading) * forward, accel);
    s.vz = approach(s.vz, -Math.cos(s.glideHeading) * forward, accel);
    s.vy = approach(s.vy, -sink, c.gravity * dt);

    if (this.world.rules.gliderCut && s.modeTime > 0.3 && this.pressed(Button.Jump)) {
      this.closeGlider(true);
      this.move(dt, false);
      return;
    }
    if (s.aboveGround <= c.gliderAutoCloseHeight) {
      this.closeGlider(false);
      // Touch down gently: no fall damage from a glider landing.
      s.vy = Math.max(s.vy, -c.fallDamageMinSpeed * 0.5);
    }
    this.move(dt, false);
  }

  // ------------------------------------------------------------- helpers

  private pressed(button: number): boolean {
    return wasPressed(this.buttons, this.state.previousButtons, button);
  }

  private setMode(mode: MoveMode): void {
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.state.modeTime = 0;
  }

  private computeWish(input: InputFrame): void {
    const yaw = this.state.yaw;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    let x = cosYaw * input.moveX - sinYaw * input.moveZ;
    let z = -sinYaw * input.moveX - cosYaw * input.moveZ;
    const length = Math.hypot(x, z);
    if (length > 1) {
      x /= length;
      z /= length;
    }
    this.wishX = x;
    this.wishZ = z;
    this.wishLength = Math.min(1, length);
  }

  private updateEquip(): void {
    const s = this.state;
    let slot = s.equipSlot;
    if (this.pressed(Button.Pickaxe)) slot = PICKAXE_SLOT;
    const slotButtons = [Button.Slot1, Button.Slot2, Button.Slot3, Button.Slot4, Button.Slot5];
    slotButtons.forEach((button, i) => {
      if (this.pressed(button)) slot = i + 1;
    });
    if (slot !== s.equipSlot) {
      s.equipSlot = slot;
      this.events?.push("equip", this.tick, { id: this.id, slot });
    }
  }

  private setSprinting(sprinting: boolean): void {
    const s = this.state;
    if (s.sprinting === sprinting) return;
    s.sprinting = sprinting;
    if (!sprinting) s.bashUsed = false;
    this.events?.push(sprinting ? "sprintStart" : "sprintEnd", this.tick, { id: this.id });
  }

  /** Sprint state for walk mode (ground decisions; in the air the state is kept). */
  private updateSprint(input: InputFrame, aiming: boolean): void {
    const s = this.state;
    const c = this.config;
    const wants = (this.buttons & Button.Sprint) !== 0 && s.inputLockLeft <= 0;
    const forwardEnough = input.moveZ >= c.sprintMinForward;
    if (!s.grounded) {
      if (!wants) this.setSprinting(false);
      return;
    }
    const enoughStamina = this.infiniteSprint || (s.sprinting ? s.stamina > 0 : s.stamina >= c.sprintMinStart);
    const allowed = wants && forwardEnough && !aiming && !s.crouched && s.sprintLockout <= 0 && enoughStamina;
    this.setSprinting(allowed);
  }

  private updateStamina(): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    const draining = s.sprinting && s.grounded && s.mode === "walk" && !this.infiniteSprint && this.horizontalSpeed > 0.5;
    if (draining) {
      s.stamina = Math.max(0, s.stamina - c.staminaDrain * dt);
      s.sinceDrain = 0;
      if (s.stamina <= 0) {
        s.sprintLockout = c.sprintEmptyLockout;
        this.setSprinting(false);
        this.events?.push("staminaEmpty", this.tick, { id: this.id });
      }
    } else {
      s.sinceDrain += dt;
      if (s.sinceDrain >= c.staminaRegenDelay) s.stamina = Math.min(c.staminaMax, s.stamina + c.staminaRegen * dt);
    }
  }

  private beginJump(sprint: boolean, slide: boolean, boosted: boolean): void {
    const s = this.state;
    s.jumpBufferLeft = 0;
    s.jumping = true;
    s.grounded = false;
    s.fallStartY = s.y;
    this.events?.push("jump", this.tick, { id: this.id, x: s.x, y: s.y, z: s.z, sprint, slide, boosted });
  }

  /** Adds speed along the current horizontal velocity (or facing when standing still). */
  private addForwardBoost(amount: number): void {
    const s = this.state;
    const speed = this.horizontalSpeed;
    const dirX = speed > 0.1 ? s.vx / speed : -Math.sin(s.bodyYaw);
    const dirZ = speed > 0.1 ? s.vz / speed : -Math.cos(s.bodyYaw);
    s.vx += dirX * amount;
    s.vz += dirZ * amount;
  }

  /** Probes for a mantle/hurdle in the wished direction and starts it. */
  private tryTraversal(airborne: boolean): boolean {
    const s = this.state;
    const c = this.config;
    const dirLength = Math.hypot(this.wishX, this.wishZ);
    if (dirLength < 1e-6) return false;
    const plan = probeTraversal(this.physics, c, s, this.wishX / dirLength, this.wishZ / dirLength, {
      airborne,
      speed: this.horizontalSpeed,
      exclude: this.collider,
    });
    if (plan === null) return false;
    this.startTraversal(plan, airborne);
    return true;
  }

  private startTraversal(plan: TraversalPlan, airborne: boolean): void {
    const s = this.state;
    const c = this.config;
    s.travelStartX = s.x;
    s.travelStartY = s.y;
    s.travelStartZ = s.z;
    s.travelEndX = plan.endX;
    s.travelEndY = plan.endY;
    s.travelEndZ = plan.endZ;
    s.travelTopY = plan.topY;
    s.travelDirX = plan.dirX;
    s.travelDirZ = plan.dirZ;
    s.travelEndCrouched = plan.endCrouched;
    s.jumpBufferLeft = 0;
    s.launched = false;
    const span = c.mantleMaxHeight - c.mantleMinHeight;
    if (plan.kind === "mantle") {
      s.travelArc = 0;
      s.travelDuration = lerp(c.mantleMinTime, c.mantleMaxTime, clamp((plan.height - c.mantleMinHeight) / span, 0, 1));
    } else {
      const distance = Math.hypot(plan.endX - s.x, plan.endZ - s.z);
      const speed = Math.max(this.horizontalSpeed, c.hurdleMinSpeed);
      s.travelExitSpeed = speed;
      s.travelDuration = distance / speed;
      // Arc height so the feet clear the top at both faces of the obstacle.
      const clearY = plan.topY + 0.08;
      let arc = 0;
      for (const face of [plan.nearFace, plan.farFace]) {
        const f = clamp(face / distance, 0.05, 0.95);
        const lineY = lerp(s.y, plan.endY, f);
        arc = Math.max(arc, (clearY - lineY) / (4 * f * (1 - f)));
      }
      s.travelArc = arc;
    }
    this.setSprinting(false);
    this.setCrouched(true);
    this.setMode(plan.kind);
    this.events?.push("traverse", this.tick, { id: this.id, kind: plan.kind, height: plan.height, airborne });
  }

  private canRedeploy(): boolean {
    const s = this.state;
    const c = this.config;
    return (
      this.world.rules.gliderRedeploy &&
      s.gliderCooldown <= 0 &&
      this.fallDistance > c.redeployMinFall &&
      -s.vy > c.redeployMinSpeed &&
      this.measureAboveGround() > c.gliderAutoCloseHeight + 1
    );
  }

  private openGlider(redeploy: boolean): void {
    const s = this.state;
    s.glideHeading = this.horizontalSpeed > 1 ? Math.atan2(-s.vx, -s.vz) : s.yaw;
    s.glideBank = 0;
    s.redeployed = redeploy;
    s.launched = false;
    s.sprinting = false;
    this.setCrouched(false);
    this.setMode("glide");
    this.events?.push("gliderOpen", this.tick, { id: this.id, redeploy });
  }

  private closeGlider(cut: boolean): void {
    const s = this.state;
    s.gliderCooldown = this.config.gliderCooldown;
    s.fallStartY = s.y;
    s.jumping = true;
    this.setMode("walk");
    this.events?.push("gliderClose", this.tick, { id: this.id, cut });
  }

  /** Height of the feet above whatever is below (world and props), capped at 2 km. */
  private measureAboveGround(): number {
    const s = this.state;
    this.scratch.x = s.x;
    this.scratch.y = s.y + 0.05;
    this.scratch.z = s.z;
    const hit = this.physics.raycast(this.scratch, this.rayDir, 2000, this.rayHit, {
      groups: QUERY_WORLD_AND_PROPS,
      exclude: this.collider,
    });
    let distance = hit === null ? 2000 : Math.max(0, hit.distance - 0.05);
    // Water counts as ground for glider closing and redeploy checks.
    const water = this.world.waterLevel;
    if (water !== null && s.y >= water) distance = Math.min(distance, s.y - water);
    return distance;
  }

  /** Feet are deep enough below the water surface to swim. */
  private inDeepWater(): boolean {
    const water = this.world.waterLevel;
    return water !== null && this.state.y < water - this.config.swimEnterDepth;
  }

  private startSwim(): void {
    const s = this.state;
    const speed = this.horizontalSpeed;
    // Entering water brakes the fall and most of the horizontal speed.
    s.vy = Math.max(s.vy, -3);
    if (speed > this.config.swimSpeed) {
      s.vx *= this.config.swimSpeed / speed;
      s.vz *= this.config.swimSpeed / speed;
    }
    s.sprinting = false;
    s.launched = false;
    s.jumping = false;
    s.fallStartY = s.y;
    this.setCrouched(false);
    this.setMode("swim");
    this.events?.push("splash", this.tick, { id: this.id, x: s.x, y: this.world.waterLevel ?? s.y, z: s.z });
  }

  /** Swimming: float at `swimDepth`, steer at swim speed, climb out onto ledges, wade out on shallow ground. */
  private stepSwim(): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    const water = this.world.waterLevel ?? s.y;
    this.accelerateHorizontal(this.wishX * c.swimSpeed, this.wishZ * c.swimSpeed, 12 * dt);
    const targetY = water - c.swimDepth;
    s.vy = approach(s.vy, clamp((targetY - s.y) * 3, -3, 3), 20 * dt);
    if (this.wishLength > 0.5 && this.tryTraversal(true)) return;
    this.move(dt, false);
    if (s.mode === "swim" && s.grounded && s.y >= targetY - 0.05) this.setMode("walk");
  }

  /** Casts forward at chest height; a closed door within reach is bashed open. */
  private tryBashDoor(): void {
    const doors = this.world.doors;
    if (doors === null) return;
    const index = this.doorAhead(this.config.capsuleRadius + this.config.bashReach);
    if (index < 0 || !doors.isClosed(index)) return;
    const s = this.state;
    if (doors.operate(index, s.x, s.z, true) !== null) {
      s.bashUsed = true;
      this.events?.push("door", this.tick, { door: index, by: this.id, action: "bash" });
    }
  }

  /** Interact: opens or closes the door the character faces. */
  private toggleDoor(): void {
    const doors = this.world.doors;
    if (doors === null) return;
    const s = this.state;
    let index = this.doorAhead(1.6);
    // An open door is no longer in front of the ray: fall back to the nearest door nearby.
    if (index < 0) index = doors.nearestDoor(s.x, s.z, 2.2);
    if (index < 0) return;
    const action = doors.operate(index, this.state.x, this.state.z, false);
    if (action !== null) this.events?.push("door", this.tick, { door: index, by: this.id, action });
  }

  /** Index of the door hit by a chest-height ray along the movement (or look) direction, or -1. */
  private doorAhead(reach: number): number {
    const doors = this.world.doors;
    if (doors === null) return -1;
    const s = this.state;
    const speed = this.horizontalSpeed;
    this.scratch.x = s.x;
    this.scratch.y = s.y + (s.crouched ? 0.7 : 1.1);
    this.scratch.z = s.z;
    const dir = { x: speed > 1 ? s.vx / speed : -Math.sin(s.yaw), y: 0, z: speed > 1 ? s.vz / speed : -Math.cos(s.yaw) };
    const hit = this.physics.raycast(this.scratch, dir, reach, this.rayHit, { groups: QUERY_WORLD_ONLY, exclude: this.collider });
    return hit === null ? -1 : doors.doorOfCollider(hit.colliderHandle);
  }

  private checkLaunchPad(): void {
    const s = this.state;
    for (const pad of this.world.launchPads) {
      if (s.x < pad.minX || s.x > pad.maxX || s.z < pad.minZ || s.z > pad.maxZ) continue;
      if (Math.abs(s.y - pad.topY) > 0.25) continue;
      s.vy = this.config.launchPadSpeed;
      s.launched = true;
      s.grounded = false;
      s.jumping = true;
      s.sprinting = false;
      s.fallStartY = s.y;
      this.events?.push("launch", this.tick, { id: this.id, x: s.x, y: s.y, z: s.z });
      return;
    }
  }

  /** Landing rules: roll, fall damage, modern splat, slide-on-land. */
  private onLand(impactSpeed: number): void {
    const s = this.state;
    const c = this.config;
    let damage = s.mode === "glide" || s.mode === "swim" ? 0 : fallDamage(c, impactSpeed);
    let roll = false;
    let splat = false;
    if (damage > 0 && s.jumpPressAge <= c.rollWindow) {
      roll = true;
      damage *= c.rollDamageMult;
      s.stamina = Math.min(c.staminaMax, s.stamina + c.rollStaminaRefund);
      s.jumpBufferLeft = 0;
    }
    if (damage > 0) {
      if (damage >= s.vitals.health && this.world.rules.nonLethalFalls) {
        damage = s.vitals.health - 1;
        applyHealthDamage(s.vitals, damage);
        s.vitals.shield = 0;
        s.vitals.overshield = 0;
        splat = true;
        roll = false;
      } else {
        const result = applyHealthDamage(s.vitals, damage);
        if (result.lethal) {
          this.events?.push("land", this.tick, { id: this.id, speed: impactSpeed, x: s.x, y: s.y, z: s.z, damage, roll, splat });
          this.events?.push("eliminated", this.tick, { id: this.id, cause: "fall", by: this.id });
          this.respawn("eliminated");
          return;
        }
      }
    }
    this.events?.push("land", this.tick, { id: this.id, speed: impactSpeed, x: s.x, y: s.y, z: s.z, damage, roll, splat });

    if (splat) {
      s.sprinting = false;
      s.jumpBufferLeft = 0;
      this.setCrouched(true);
      this.setMode("splat");
    } else if (roll) {
      this.setCrouched(true);
      this.setMode("roll");
    } else if (
      s.mode === "walk" &&
      (this.buttons & Button.Crouch) !== 0 &&
      this.horizontalSpeed >= c.slideMinEntrySpeed &&
      s.inputLockLeft <= 0
    ) {
      this.startSlide();
    } else if (s.mode === "skydive" || s.mode === "glide") {
      this.setMode("walk");
    }
  }

  private updateBodyYaw(): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    const maxTurn = ((c.bodyTurnRate * Math.PI) / 180) * dt;
    if (s.mode === "glide") {
      s.bodyYaw = s.glideHeading;
      return;
    }
    if (s.mode === "mantle" || s.mode === "hurdle") {
      s.bodyYaw = wrapAngle(s.bodyYaw + clamp(wrapAngle(Math.atan2(-s.travelDirX, -s.travelDirZ) - s.bodyYaw), -maxTurn, maxTurn));
      return;
    }
    if (s.mode === "slide" || s.mode === "roll") {
      if (this.horizontalSpeed > 0.5) {
        const heading = Math.atan2(-s.vx, -s.vz);
        s.bodyYaw = wrapAngle(s.bodyYaw + clamp(wrapAngle(heading - s.bodyYaw), -maxTurn, maxTurn));
      }
      return;
    }
    if (s.mode === "splat") return;
    // Walk/skydive: follows the look while moving or aiming, otherwise lags until the gap is large.
    const moving = this.horizontalSpeed > 0.5;
    const gap = wrapAngle(s.yaw - s.bodyYaw);
    const threshold = (c.idleTurnThreshold * Math.PI) / 180;
    // Once an idle turn starts it finishes, instead of stopping at the threshold.
    if (Math.abs(gap) > threshold) s.turningInPlace = true;
    if (moving || s.adsBlend > 0 || s.turningInPlace || s.mode === "skydive") {
      s.bodyYaw = wrapAngle(s.bodyYaw + clamp(gap, -maxTurn, maxTurn));
      if (Math.abs(wrapAngle(s.yaw - s.bodyYaw)) < 1e-6) s.turningInPlace = false;
    }
  }

  private buildController(): RAPIER.KinematicCharacterController {
    const c = this.config;
    const controller = this.physics.createCharacterController(c.controllerOffset);
    controller.setUp({ x: 0, y: 1, z: 0 });
    // Rapier measures the step from the capsule bottom, which floats `offset` above the
    // floor; the small extra margin makes a step of exactly autostepHeight climbable.
    controller.enableAutostep(c.autostepHeight + c.controllerOffset + 0.03, c.autostepMinWidth, false);
    controller.setMaxSlopeClimbAngle((c.maxSlopeDeg * Math.PI) / 180);
    controller.setMinSlopeSlideAngle((c.maxSlopeDeg * Math.PI) / 180);
    controller.enableSnapToGround(c.snapDistance);
    controller.setSlideEnabled(true);
    controller.setApplyImpulsesToDynamicBodies(true);
    controller.setCharacterMass(c.characterMass);
    return controller;
  }

  private accelerateHorizontal(targetX: number, targetZ: number, maxDelta: number): void {
    const s = this.state;
    const dx = targetX - s.vx;
    const dz = targetZ - s.vz;
    const length = Math.hypot(dx, dz);
    if (length <= maxDelta || length === 0) {
      s.vx = targetX;
      s.vz = targetZ;
    } else {
      s.vx += (dx / length) * maxDelta;
      s.vz += (dz / length) * maxDelta;
    }
  }

  /**
   * Runs the Rapier character controller and applies the resulting motion.
   *
   * While grounded, the horizontal velocity is laid onto the ground plane
   * (keeping its length) so slopes do not shrink the step; Rapier's own
   * projection would otherwise cost ~cos^2(slope) of the speed every tick.
   * Afterwards velocity is only cancelled against surfaces that actually
   * blocked the motion (walls, too-steep slopes, ceilings), never against
   * walkable ground or the face of a step that autostep climbed.
   */
  private move(dt: number, jumpedThisTick: boolean): void {
    const s = this.state;
    const wasGrounded = s.grounded;
    const fallSpeed = -s.vy;
    const onGround = wasGrounded && !jumpedThisTick;

    // Snapping down steps/slopes only makes sense when walking, never mid-jump.
    if (onGround) this.controller.enableSnapToGround(this.config.snapDistance);
    else this.controller.disableSnapToGround();

    const hx = s.vx * dt;
    const hz = s.vz * dt;
    const horizontal = Math.hypot(hx, hz);
    this.desired.x = hx;
    this.desired.y = s.vy * dt;
    this.desired.z = hz;
    if (onGround && horizontal > 0 && s.groundNy > 0) {
      const tangentY = -(s.groundNx * hx + s.groundNz * hz) / s.groundNy;
      const scale = horizontal / Math.hypot(horizontal, tangentY);
      this.desired.x = hx * scale;
      this.desired.y += tangentY * scale;
      this.desired.z = hz * scale;
    }

    const collider = this.collider;
    this.controller.computeColliderMovement(collider, this.desired);
    const moved = this.controller.computedMovement();
    s.x += moved.x;
    s.y += moved.y;
    s.z += moved.z;
    s.grounded = this.controller.computedGrounded();

    const desiredHorizontal = Math.hypot(this.desired.x, this.desired.z);
    const blocked = Math.hypot(moved.x, moved.z) < desiredHorizontal * 0.95 - 1e-6;
    let groundNy = -1;
    for (let i = 0, n = this.controller.numComputedCollisions(); i < n; i++) {
      const hit = this.controller.computedCollision(i, this.collision);
      if (hit === null) continue;
      // normal1 points from the obstacle toward the character.
      const nx = hit.normal1.x;
      const ny = hit.normal1.y;
      const nz = hit.normal1.z;
      if (ny >= this.walkableNy) {
        if (ny > groundNy) {
          groundNy = ny;
          s.groundNx = nx;
          s.groundNy = ny;
          s.groundNz = nz;
        }
        continue;
      }
      if (ny < -0.3) {
        // Ceiling: stop rising, keep the horizontal motion.
        if (s.vy > 0) s.vy = 0;
        continue;
      }
      if (!blocked) continue;
      // Contacts within step height while grounded are left alone: autostep needs the
      // full per-tick move to climb, and cancelling here would stall it at the step face.
      const contactHeight = hit.witness1.y - (s.y - moved.y);
      if (onGround && contactHeight <= this.config.autostepHeight + 0.05) continue;
      // Walls and too-steep slopes: remove only the horizontal part of the velocity
      // pointing into the surface, so a steep slope never converts speed into lift.
      const horizontalNormal = Math.hypot(nx, nz);
      if (horizontalNormal < 1e-6) continue;
      const hnx = nx / horizontalNormal;
      const hnz = nz / horizontalNormal;
      const into = s.vx * hnx + s.vz * hnz;
      if (into < 0) {
        s.vx -= into * hnx;
        s.vz -= into * hnz;
      }
    }
    // Head bump that the contact list did not report.
    if (s.vy > 0 && moved.y < this.desired.y - 1e-4 && !onGround) s.vy = Math.min(s.vy, moved.y / dt);

    if (s.grounded) {
      if (s.vy < 0) s.vy = 0;
      s.airTime = 0;
      s.jumping = false;
      s.launched = false;
      s.aboveGround = 0;
      // Moving along the ground plane usually produces no ground contact, so the
      // surface below is sampled directly (slides need the slope every tick).
      if (groundNy < 0) this.sampleGroundNormal();
      this.syncCollider();
      s.fallStartY = s.y;
      if (!wasGrounded) this.onLand(fallSpeed);
    } else {
      s.airTime += dt;
      s.fallStartY = Math.max(s.fallStartY, s.y);
      s.groundNx = 0;
      s.groundNy = 1;
      s.groundNz = 0;
      this.syncCollider();
    }
  }

  /** Sets the ground normal from a short ray straight down (flat when nothing walkable is found). */
  private sampleGroundNormal(): void {
    const s = this.state;
    this.scratch.x = s.x;
    this.scratch.y = s.y + 0.2;
    this.scratch.z = s.z;
    const hit = this.physics.raycast(this.scratch, this.rayDir, 0.6, this.rayHit, {
      groups: QUERY_WORLD_AND_PROPS,
      exclude: this.collider,
    });
    if (hit !== null && hit.normal.y >= this.walkableNy) {
      s.groundNx = hit.normal.x;
      s.groundNy = hit.normal.y;
      s.groundNz = hit.normal.z;
    } else {
      s.groundNx = 0;
      s.groundNy = 1;
      s.groundNz = 0;
    }
  }

  private setCrouched(crouched: boolean): void {
    const c = this.config;
    if (this.state.crouched === crouched) return;
    this.state.crouched = crouched;
    this.collider.setHalfHeight(capsuleHalfHeight(crouched ? c.crouchHeight : c.standHeight, c.capsuleRadius));
    this.syncCollider();
  }

  /** True when the standing capsule fits at the current position. */
  private canStand(): boolean {
    const c = this.config;
    const s = this.state;
    if (!s.crouched) return true;
    this.center.x = s.x;
    // Test slightly above the floor so touching the ground does not count as blocked.
    this.center.y = s.y + centerOffset(c, c.standHeight) + 0.02;
    this.center.z = s.z;
    return !this.physics.capsuleOverlaps(this.center, capsuleHalfHeight(c.standHeight, c.capsuleRadius), c.capsuleRadius, {
      exclude: this.collider,
    });
  }

  private syncCollider(): void {
    const s = this.state;
    this.center.x = s.x;
    this.center.y = s.y + centerOffset(this.config, this.height);
    this.center.z = s.z;
    this.collider.setTranslation(this.center);
  }

  private respawn(reason: "killPlane" | "eliminated"): void {
    const s = this.state;
    this.teleport(s.spawnX, s.spawnY, s.spawnZ);
    this.setCrouched(false);
    if (reason === "eliminated") this.resetVitals();
    this.events?.push("respawn", this.tick, { id: this.id, x: s.x, y: s.y, z: s.z, reason });
  }
}
