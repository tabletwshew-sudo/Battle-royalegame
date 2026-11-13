/**
 * Movement tunables (GAME_SPEC §2, values from MECHANICS_NOTES "Movement").
 * Plain data so the debug panel can edit it live and the server can share it.
 * M2 covers walk/run, crouch, ADS walk and jump; M3 adds sprint, slide,
 * mantle, glider and fall damage fields.
 */
export interface MovementConfig {
  /** Ground speeds in m/s. */
  runSpeed: number;
  crouchSpeed: number;
  adsWalkSpeed: number;
  /** Rate at which ground velocity reaches the target speed, m/s^2. */
  groundAccel: number;
  /** Rate at which ground velocity drops when there is no input, m/s^2. */
  groundDecel: number;
  /** Air steering acceleration, m/s^2 (only toward the wished direction; no air braking). */
  airAccel: number;
  gravity: number;
  /** Peak height of a standing jump, metres. */
  jumpHeight: number;
  terminalFallSpeed: number;
  /** Seconds after leaving a ledge during which a jump still works. */
  coyoteTime: number;
  /** Seconds a jump press is remembered before landing. */
  jumpBuffer: number;
  capsuleRadius: number;
  standHeight: number;
  crouchHeight: number;
  /** How fast the visual crouch blend follows the capsule, per second. */
  crouchBlendRate: number;
  /** Tallest step climbed without jumping, metres (measured from the floor). */
  autostepHeight: number;
  /** Free width needed on top of a step, metres. */
  autostepMinWidth: number;
  maxSlopeDeg: number;
  /** Ground snapping distance when walking down slopes and steps. */
  snapDistance: number;
  /** Skin gap Rapier keeps between the capsule and the world. */
  controllerOffset: number;
  /** Seconds for the ADS blend to go 0 -> 1. */
  adsTime: number;
  /** Seconds for a shoulder swap. */
  shoulderSwapTime: number;
  /** Body turn rate toward the look direction, degrees per second. */
  bodyTurnRate: number;
  /** When idle, the body only turns once the look yaw is this far away, degrees. */
  idleTurnThreshold: number;
  /** Looking up/down limit for the third-person camera, degrees. */
  maxPitchDeg: number;
  /** Characters falling below this height are put back at their spawn. */
  killPlaneY: number;
  /** Mass the controller uses when pushing props, kg. */
  characterMass: number;
}

export function defaultMovementConfig(): MovementConfig {
  return {
    runSpeed: 6.0,
    crouchSpeed: 3.0,
    adsWalkSpeed: 3.5,
    groundAccel: 70,
    groundDecel: 55,
    airAccel: 10,
    gravity: 25,
    jumpHeight: 1.2,
    terminalFallSpeed: 55,
    coyoteTime: 0.1,
    jumpBuffer: 0.12,
    capsuleRadius: 0.35,
    standHeight: 1.8,
    crouchHeight: 1.1,
    crouchBlendRate: 9,
    autostepHeight: 0.45,
    autostepMinWidth: 0.2,
    maxSlopeDeg: 50,
    snapDistance: 0.35,
    controllerOffset: 0.02,
    adsTime: 0.2,
    shoulderSwapTime: 0.18,
    bodyTurnRate: 720,
    idleTurnThreshold: 70,
    maxPitchDeg: 80,
    killPlaneY: -50,
    characterMass: 80,
  };
}

/**
 * Launch speed whose apex is exactly `jumpHeight` with the sim's integrator
 * (velocity updated before position, fixed dt). The continuous formula
 * sqrt(2 g h) undershoots by about v*dt/2 at 60 Hz, so the dt term adds it back:
 * apex = v^2/(2g) - v*dt/2  =>  v = g*dt/2 + sqrt((g*dt/2)^2 + 2*g*h).
 */
export function jumpVelocity(config: MovementConfig, dt: number): number {
  const half = (config.gravity * dt) / 2;
  return half + Math.sqrt(half * half + 2 * config.gravity * config.jumpHeight);
}

/** Half height of the capsule's cylinder part for a total character height. */
export function capsuleHalfHeight(totalHeight: number, radius: number): number {
  return Math.max(0.01, totalHeight / 2 - radius);
}
