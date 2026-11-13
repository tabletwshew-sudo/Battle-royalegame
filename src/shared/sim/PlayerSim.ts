import RAPIER from "@dimforge/rapier3d-compat";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { SIM_DT } from "./Constants";
import type { EventQueue } from "./Events";
import type { StateHasher } from "./Hash";
import { Button, type InputFrame, wasPressed } from "./InputFrame";
import { clamp, type Vec3, wrapAngle } from "./MathUtil";
import { capsuleHalfHeight, jumpVelocity, type MovementConfig } from "./MovementConfig";

/**
 * Character movement v1 (GAME_SPEC §2): walk/run, crouch, ADS walk, jump with
 * coyote time and jump buffering, slopes, steps, ground snapping, shoulder
 * swap and body facing. Driven only by InputFrames so humans, bots and the
 * server share it. All mutable state is in `PlayerState` (plain data) so it
 * can be hashed, snapshotted and interpolated.
 */

export interface PlayerState {
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
  /** Seconds left in which a buffered jump press is honoured. */
  jumpBufferLeft: number;
  /** True from a jump until the next landing (blocks coyote double jumps). */
  jumping: boolean;
  /** Idle body is turning to catch up with the look direction. */
  turningInPlace: boolean;
  /** Unit normal of the walkable surface under the character (0,1,0 in the air). */
  groundNx: number;
  groundNy: number;
  groundNz: number;
  /** Buttons of the previous tick, for edge detection. */
  previousButtons: number;
  spawnX: number;
  spawnY: number;
  spawnZ: number;
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

export class PlayerController {
  readonly state: PlayerState;
  /** Capsule collider handle (stable across snapshot restores). */
  readonly colliderHandle: number;
  private controller: RAPIER.KinematicCharacterController;
  private readonly desired: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly collision = new RAPIER.CharacterCollision();
  /** cos(max slope): contacts with a normal.y at or above this are walkable ground. */
  private readonly walkableNy: number;
  private readonly center: Vec3 = { x: 0, y: 0, z: 0 };

  constructor(
    readonly id: number,
    private readonly physics: PhysicsWorld,
    private readonly config: MovementConfig,
    spawn: Vec3,
    yaw = 0,
  ) {
    this.state = {
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
      jumpBufferLeft: 0,
      jumping: false,
      turningInPlace: false,
      groundNx: 0,
      groundNy: 1,
      groundNz: 0,
      previousButtons: 0,
      spawnX: spawn.x,
      spawnY: spawn.y,
      spawnZ: spawn.z,
    };
    const height = config.standHeight;
    const collider = physics.addCharacterCapsule(
      { x: spawn.x, y: spawn.y + centerOffset(config, height), z: spawn.z },
      capsuleHalfHeight(height, config.capsuleRadius),
      config.capsuleRadius,
    );
    this.colliderHandle = collider.handle;
    this.walkableNy = Math.cos((config.maxSlopeDeg * Math.PI) / 180);
    this.controller = this.buildController();
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

  /** Advances one fixed tick. Must run before `PhysicsWorld.step()` of the same tick. */
  step(input: InputFrame, tick: number, events: EventQueue): void {
    const s = this.state;
    const c = this.config;
    const dt = SIM_DT;
    const buttons = input.buttons;
    const pressed = (button: number): boolean => wasPressed(buttons, s.previousButtons, button);

    // Look.
    const maxPitch = (c.maxPitchDeg * Math.PI) / 180;
    s.yaw = wrapAngle(input.yaw);
    s.pitch = clamp(input.pitch, -maxPitch, maxPitch);

    // Shoulder swap and ADS blends.
    if (pressed(Button.ShoulderSwap)) s.shoulder = -s.shoulder;
    s.shoulderBlend = approach(s.shoulderBlend, s.shoulder, (2 / c.shoulderSwapTime) * dt);
    const aiming = (buttons & Button.Ads) !== 0;
    s.adsBlend = approach(s.adsBlend, aiming ? 1 : 0, dt / c.adsTime);

    // Crouch (hold). Standing up needs head room.
    const wantCrouch = (buttons & Button.Crouch) !== 0;
    if (wantCrouch && !s.crouched) this.setCrouched(true);
    else if (!wantCrouch && s.crouched && this.canStand()) this.setCrouched(false);
    s.crouchBlend = approach(s.crouchBlend, s.crouched ? 1 : 0, c.crouchBlendRate * dt);

    // Desired horizontal velocity from input, relative to the look yaw.
    const sinYaw = Math.sin(s.yaw);
    const cosYaw = Math.cos(s.yaw);
    let wishX = cosYaw * input.moveX - sinYaw * input.moveZ;
    let wishZ = -sinYaw * input.moveX - cosYaw * input.moveZ;
    const wishLength = Math.hypot(wishX, wishZ);
    if (wishLength > 1) {
      wishX /= wishLength;
      wishZ /= wishLength;
    }
    const speed = s.crouched ? c.crouchSpeed : aiming ? c.adsWalkSpeed : c.runSpeed;
    const targetX = wishX * speed;
    const targetZ = wishZ * speed;

    if (s.grounded) {
      const rate = wishLength > 0.01 ? c.groundAccel : c.groundDecel;
      this.accelerateHorizontal(targetX, targetZ, rate * dt);
    } else if (wishLength > 0.01) {
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

    // Jump: buffered presses, coyote time after leaving a ledge.
    if (pressed(Button.Jump)) s.jumpBufferLeft = c.jumpBuffer;
    else s.jumpBufferLeft = Math.max(0, s.jumpBufferLeft - dt);
    const onGroundForJump = s.grounded || (!s.jumping && s.airTime <= c.coyoteTime);
    let jumpedThisTick = false;
    if (s.jumpBufferLeft > 0 && onGroundForJump) {
      s.vy = jumpVelocity(c, dt);
      s.jumpBufferLeft = 0;
      s.jumping = true;
      s.grounded = false;
      jumpedThisTick = true;
      events.push("jump", tick, { id: this.id, x: s.x, y: s.y, z: s.z });
    }

    // Gravity (also while grounded, so the capsule keeps pressing on the floor).
    s.vy = Math.max(-c.terminalFallSpeed, s.vy - c.gravity * dt);

    this.move(dt, jumpedThisTick, tick, events);

    // Body facing: follows the look while moving or aiming, otherwise lags until the gap is large.
    const moving = this.horizontalSpeed > 0.5;
    const gap = wrapAngle(s.yaw - s.bodyYaw);
    const threshold = (c.idleTurnThreshold * Math.PI) / 180;
    // Once an idle turn starts it finishes, instead of stopping at the threshold.
    if (Math.abs(gap) > threshold) s.turningInPlace = true;
    if (moving || s.adsBlend > 0 || s.turningInPlace) {
      const maxTurn = ((c.bodyTurnRate * Math.PI) / 180) * dt;
      s.bodyYaw = wrapAngle(s.bodyYaw + clamp(gap, -maxTurn, maxTurn));
      if (Math.abs(wrapAngle(s.yaw - s.bodyYaw)) < 1e-6) s.turningInPlace = false;
    }

    if (s.y < c.killPlaneY) this.respawn(tick, events);
    s.previousButtons = buttons;
  }

  /** Places the character at a position with zero velocity (tests, respawn, spawn points). */
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
    s.airTime = 0;
    s.groundNx = 0;
    s.groundNy = 1;
    s.groundNz = 0;
    this.syncCollider();
  }

  /** Mixes all state into a determinism hash. */
  hashInto(hasher: StateHasher): void {
    const s = this.state;
    hasher.addNumber(s.x).addNumber(s.y).addNumber(s.z);
    hasher.addNumber(s.vx).addNumber(s.vy).addNumber(s.vz);
    hasher.addNumber(s.yaw).addNumber(s.pitch).addNumber(s.bodyYaw);
    hasher.addInt((s.grounded ? 1 : 0) | (s.crouched ? 2 : 0) | (s.jumping ? 4 : 0) | (s.turningInPlace ? 8 : 0));
    hasher.addNumber(s.crouchBlend).addNumber(s.adsBlend).addNumber(s.shoulder).addNumber(s.shoulderBlend);
    hasher.addNumber(s.airTime).addNumber(s.jumpBufferLeft).addInt(s.previousButtons);
    hasher.addNumber(s.groundNx).addNumber(s.groundNy).addNumber(s.groundNz);
  }

  /** Copy of the state for snapshots. */
  saveState(): PlayerState {
    return { ...this.state };
  }

  /**
   * Restores state saved by `saveState`. Call after the PhysicsWorld itself
   * was restored: the controller is rebuilt against the new world.
   */
  loadState(saved: PlayerState): void {
    Object.assign(this.state, saved);
    this.controller = this.buildController();
  }

  dispose(): void {
    this.controller.free();
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
  private move(dt: number, jumpedThisTick: boolean, tick: number, events: EventQueue): void {
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
      if (!wasGrounded) events.push("land", tick, { id: this.id, speed: fallSpeed, x: s.x, y: s.y, z: s.z });
      if (s.vy < 0) s.vy = 0;
      s.airTime = 0;
      s.jumping = false;
      if (groundNy < 0) {
        // Grounded by snapping without a contact this tick: assume flat.
        s.groundNx = 0;
        s.groundNy = 1;
        s.groundNz = 0;
      }
    } else {
      s.airTime += dt;
      s.groundNx = 0;
      s.groundNy = 1;
      s.groundNz = 0;
    }
    this.syncCollider();
  }

  private setCrouched(crouched: boolean): void {
    const c = this.config;
    this.state.crouched = crouched;
    this.collider.setHalfHeight(capsuleHalfHeight(crouched ? c.crouchHeight : c.standHeight, c.capsuleRadius));
    this.syncCollider();
  }

  /** True when the standing capsule fits at the current position. */
  private canStand(): boolean {
    const c = this.config;
    const s = this.state;
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

  private respawn(tick: number, events: EventQueue): void {
    const s = this.state;
    this.teleport(s.spawnX, s.spawnY, s.spawnZ);
    events.push("respawn", tick, { id: this.id, x: s.x, y: s.y, z: s.z });
  }
}
