import RAPIER from "@dimforge/rapier3d-compat";
import { axisQuat, interactionGroups, Layer, type PhysicsWorld } from "../physics/PhysicsWorld";
import { SIM_DT } from "../sim/Constants";
import type { StateHasher } from "../sim/Hash";
import { clamp } from "../sim/MathUtil";

/**
 * Hinged doors (GAME_SPEC §2 "shoulder bash"). Each door is a kinematic
 * body rotating about a vertical hinge. A sprinting or sliding character
 * bashes a closed door open; anyone can toggle a door with Interact. Doors
 * always swing away from the character that opened them.
 *
 * Door space: the panel extends from the hinge along local +X (its width);
 * yaw rotates it about +Y like every other yaw in the game.
 */
export interface DoorDef {
  /** Hinge position at floor level. */
  hingeX: number;
  hingeY: number;
  hingeZ: number;
  width: number;
  height: number;
  thickness: number;
  /** Yaw of the closed door. */
  closedYaw: number;
}

export interface DoorState {
  /** Swing angle relative to closed, radians (sign = side it opened toward). */
  angle: number;
  targetAngle: number;
  /** Swing speed in rad/s for the current motion. */
  speed: number;
}

export const DOOR_DEFAULTS = {
  openAngle: (100 * Math.PI) / 180,
  /** Normal open/close swing, degrees per second. */
  swingRate: 260,
  /** Shoulder-bash swing, degrees per second. */
  bashRate: 720,
} as const;

export type DoorAction = "bash" | "open" | "close";

export class DoorSystem {
  readonly defs: readonly DoorDef[];
  readonly states: DoorState[];
  private readonly bodyHandles: number[] = [];
  private readonly doorByCollider = new Map<number, number>();

  constructor(
    private readonly physics: PhysicsWorld,
    defs: readonly DoorDef[],
  ) {
    this.defs = defs;
    this.states = defs.map(() => ({ angle: 0, targetAngle: 0, speed: 0 }));
    defs.forEach((def, i) => {
      const body = physics.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(def.hingeX, def.hingeY, def.hingeZ)
          .setRotation(axisQuat("y", def.closedYaw)),
      );
      const collider = physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(def.width / 2, def.height / 2, def.thickness / 2)
          .setTranslation(def.width / 2, def.height / 2, 0)
          .setCollisionGroups(interactionGroups(Layer.World, Layer.All)),
        body,
      );
      this.bodyHandles.push(body.handle);
      this.doorByCollider.set(collider.handle, i);
    });
  }

  /** Index of the door owning a collider, or -1. */
  doorOfCollider(colliderHandle: number): number {
    return this.doorByCollider.get(colliderHandle) ?? -1;
  }

  isClosed(index: number): boolean {
    const state = this.states[index];
    return state !== undefined && state.targetAngle === 0 && Math.abs(state.angle) < 0.05;
  }

  /**
   * Opens (or closes) a door. Opening swings away from the actor at (x, z).
   * @returns the action taken, or null when nothing changed
   */
  operate(index: number, actorX: number, actorZ: number, bash: boolean): DoorAction | null {
    const def = this.defs[index];
    const state = this.states[index];
    if (def === undefined || state === undefined) return null;
    if (bash && !this.isClosed(index)) return null;
    if (!bash && state.targetAngle !== 0) {
      state.targetAngle = 0;
      state.speed = (DOOR_DEFAULTS.swingRate * Math.PI) / 180;
      return "close";
    }
    // Door normal is local +Z rotated by the closed yaw. An actor on the +Z side
    // pushes the door toward -Z, which is a positive rotation about +Y.
    const nx = Math.sin(def.closedYaw);
    const nz = Math.cos(def.closedYaw);
    const side = (actorX - def.hingeX) * nx + (actorZ - def.hingeZ) * nz;
    state.targetAngle = side >= 0 ? DOOR_DEFAULTS.openAngle : -DOOR_DEFAULTS.openAngle;
    state.speed = ((bash ? DOOR_DEFAULTS.bashRate : DOOR_DEFAULTS.swingRate) * Math.PI) / 180;
    return bash ? "bash" : "open";
  }

  /** Advances door swings by one tick. Call before `PhysicsWorld.step()`. */
  step(): void {
    this.states.forEach((state, i) => {
      if (state.angle === state.targetAngle) return;
      const maxStep = state.speed * SIM_DT;
      state.angle += clamp(state.targetAngle - state.angle, -maxStep, maxStep);
      const def = this.defs[i] as DoorDef;
      const body = this.physics.world.getRigidBody(this.bodyHandles[i] as number);
      body.setNextKinematicRotation(axisQuat("y", def.closedYaw + state.angle));
    });
  }

  /**
   * Door whose doorway (the closed panel's centre) is nearest to (x, z)
   * within `maxDistance`, or -1.
   */
  nearestDoor(x: number, z: number, maxDistance: number): number {
    let best = -1;
    let bestDistance = maxDistance;
    this.defs.forEach((def, i) => {
      const cx = def.hingeX + (Math.cos(def.closedYaw) * def.width) / 2;
      const cz = def.hingeZ - (Math.sin(def.closedYaw) * def.width) / 2;
      const distance = Math.hypot(x - cx, z - cz);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    });
    return best;
  }

  /** Current yaw of door `index` (for rendering). */
  yawOf(index: number): number {
    return (this.defs[index]?.closedYaw ?? 0) + (this.states[index]?.angle ?? 0);
  }

  hashInto(hasher: StateHasher): void {
    for (const state of this.states) hasher.addNumber(state.angle).addNumber(state.targetAngle).addNumber(state.speed);
  }

  saveStates(): DoorState[] {
    return this.states.map((state) => ({ ...state }));
  }

  loadStates(saved: readonly DoorState[]): void {
    saved.forEach((state, i) => Object.assign(this.states[i] as DoorState, state));
  }
}
