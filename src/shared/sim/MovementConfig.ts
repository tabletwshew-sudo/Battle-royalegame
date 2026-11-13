/**
 * Movement tunables (GAME_SPEC §2, values from MECHANICS_NOTES "Movement").
 * Plain data so the debug panel (F4) can edit it live and the server can
 * share it. Values marked UNKNOWN in the notes are design defaults.
 */
export interface MovementConfig {
  // --- Ground (M2) ---
  /** Ground speeds in m/s. */
  runSpeed: number;
  crouchSpeed: number;
  adsWalkSpeed: number;
  /** Rate at which ground velocity reaches the target speed, m/s^2. */
  groundAccel: number;
  /** Rate at which ground velocity drops when there is no input, m/s^2. */
  groundDecel: number;
  /** Deceleration while faster than the target speed (keeps slide/launch momentum), m/s^2. */
  overspeedDecel: number;
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

  // --- Tactical sprint (M3) ---
  sprintSpeed: number;
  staminaMax: number;
  /** Stamina drained per second of sprinting. */
  staminaDrain: number;
  /** Stamina regained per second once regeneration starts. */
  staminaRegen: number;
  /** Seconds after the last drain before regeneration starts. */
  staminaRegenDelay: number;
  /** Sprint cannot start below this much stamina. */
  sprintMinStart: number;
  /** Seconds sprint stays locked after stamina runs out. */
  sprintEmptyLockout: number;
  /** Sprint needs mostly-forward input: moveZ at least this. */
  sprintMinForward: number;
  /** Jump height multiplier and forward speed bonus (m/s) for a sprint jump. */
  sprintJumpHeightMult: number;
  sprintJumpForwardBoost: number;
  /** Seconds to raise the held item after sprint ends. */
  sprintRaiseTime: number;

  // --- Slide (M3) ---
  /** Horizontal speed needed to start a slide, m/s. */
  slideMinEntrySpeed: number;
  /** Slides start at least this fast (flat-ground slides feel like a run), m/s. */
  slideMinStartSpeed: number;
  /** Deceleration on flat ground, m/s^2. */
  slideFlatDecel: number;
  /** Extra deceleration per unit of uphill slope (scaled by sin(slope)*g), multiplier. */
  slideUphillDecelMult: number;
  /** Downhill acceleration multiplier on g*sin(slope). */
  slideDownhillBoost: number;
  slideMaxSpeed: number;
  /** Slide ends below this speed, m/s. */
  slideEndSpeed: number;
  /** Max turn rate of the slide direction, degrees per second. */
  slideSteerRate: number;
  /** Horizontal speed multiplier when jumping out of a slide. */
  slideJumpBoost: number;
  /** Extra take-off speed (m/s) at full downhill momentum for a boosted jump. */
  boostedJumpLift: number;
  /** Slide kick (RulesConfig.slideKick): damage, knockback speed, per-target cooldown, reach. */
  slideKickDamage: number;
  slideKickKnockback: number;
  slideKickCooldown: number;
  slideKickRange: number;
  /** Slide kick needs at least this much speed, m/s. */
  slideKickMinSpeed: number;

  // --- Mantle / hurdle (M3) ---
  mantleMinHeight: number;
  mantleMaxHeight: number;
  /** While airborne, ledges up to this far above the feet can be grabbed. */
  mantleAirReach: number;
  /** Horizontal reach of the ledge probe in front of the capsule surface. */
  mantleReach: number;
  mantleMinTime: number;
  mantleMaxTime: number;
  /** After a mantle, jump/crouch presses are ignored for this long. */
  mantleInputLock: number;
  /** After a mantle, the held item needs this long before it can be used. */
  mantleRaiseDelay: number;
  hurdleMaxHeight: number;
  /** Hurdles keep at least this horizontal speed through the vault, m/s. */
  hurdleMinSpeed: number;
  /** Thickest obstacle that can be hurdled (ground must be found behind it), metres. */
  hurdleMaxDepth: number;

  // --- Doors (M3) ---
  /** Distance in front of the capsule at which a sprint/slide bashes a door open. */
  bashReach: number;

  // --- Landing / fall damage (M3) ---
  /** Impact speed (m/s) below which falls are harmless. */
  fallDamageMinSpeed: number;
  /** Damage per m/s above the threshold. */
  fallDamagePerSpeed: number;
  /** Jump pressed this long before touching down turns a damaging landing into a roll. */
  rollWindow: number;
  rollDamageMult: number;
  rollStaminaRefund: number;
  rollTime: number;
  /** Face-plant duration after a would-be-lethal fall (modern rule). */
  splatTime: number;

  // --- Skydive / glider (M3) ---
  skydiveTerminalSpeed: number;
  skydiveDiveSpeed: number;
  /** Horizontal steering speed while skydiving, m/s. */
  skydiveSteerSpeed: number;
  skydiveSteerAccel: number;
  /** The glider opens by itself at this height above the ground while skydiving. */
  gliderAutoDeployHeight: number;
  gliderForwardSpeed: number;
  gliderSinkSpeed: number;
  /** W adds forward speed and sink; S trades both away. */
  gliderFastForwardBonus: number;
  gliderFastSinkBonus: number;
  gliderSlowForwardPenalty: number;
  gliderSlowSinkPenalty: number;
  /** Heading turn rate toward the look direction, degrees per second. */
  gliderTurnRate: number;
  /** A/D steer the glider heading this far to the side of the look direction, degrees. */
  gliderBankAngle: number;
  /** Glider closes this close to the ground and the landing is soft. */
  gliderAutoCloseHeight: number;
  /** Glider redeploy: falling at least this far and this fast. */
  redeployMinFall: number;
  redeployMinSpeed: number;
  /** Seconds between closing the glider and opening it again. */
  gliderCooldown: number;
  /** Launch pad take-off speed, m/s. */
  launchPadSpeed: number;
}

export function defaultMovementConfig(): MovementConfig {
  return {
    runSpeed: 6.0,
    crouchSpeed: 3.0,
    adsWalkSpeed: 3.5,
    groundAccel: 70,
    groundDecel: 55,
    overspeedDecel: 9,
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

    sprintSpeed: 8.5,
    staminaMax: 100,
    staminaDrain: 10,
    staminaRegen: 14,
    staminaRegenDelay: 0.8,
    sprintMinStart: 15,
    sprintEmptyLockout: 0.5,
    sprintMinForward: 0.3,
    sprintJumpHeightMult: 1.15,
    sprintJumpForwardBoost: 1.5,
    sprintRaiseTime: 0.25,

    slideMinEntrySpeed: 5.5,
    slideMinStartSpeed: 6.0,
    slideFlatDecel: 4,
    slideUphillDecelMult: 1.6,
    slideDownhillBoost: 1.0,
    slideMaxSpeed: 20,
    slideEndSpeed: 3.0,
    slideSteerRate: 70,
    slideJumpBoost: 1.15,
    boostedJumpLift: 3,
    slideKickDamage: 15,
    slideKickKnockback: 6,
    slideKickCooldown: 10,
    slideKickRange: 0.85,
    slideKickMinSpeed: 5,

    mantleMinHeight: 0.5,
    mantleMaxHeight: 2.3,
    mantleAirReach: 1.1,
    mantleReach: 0.6,
    mantleMinTime: 0.3,
    mantleMaxTime: 0.75,
    mantleInputLock: 0.15,
    mantleRaiseDelay: 0.35,
    hurdleMaxHeight: 1.1,
    hurdleMinSpeed: 5.5,
    hurdleMaxDepth: 1.0,

    bashReach: 0.6,

    fallDamageMinSpeed: 14,
    fallDamagePerSpeed: 3.2,
    rollWindow: 0.2,
    rollDamageMult: 0.5,
    rollStaminaRefund: 10,
    rollTime: 0.45,
    splatTime: 1.5,

    skydiveTerminalSpeed: 55,
    skydiveDiveSpeed: 75,
    skydiveSteerSpeed: 18,
    skydiveSteerAccel: 14,
    gliderAutoDeployHeight: 120,
    gliderForwardSpeed: 22,
    gliderSinkSpeed: 7,
    gliderFastForwardBonus: 4,
    gliderFastSinkBonus: 3,
    gliderSlowForwardPenalty: 6,
    gliderSlowSinkPenalty: 2,
    gliderTurnRate: 60,
    gliderBankAngle: 35,
    gliderAutoCloseHeight: 2,
    redeployMinFall: 6,
    redeployMinSpeed: 12,
    gliderCooldown: 1,
    launchPadSpeed: 95,
  };
}

/**
 * Launch speed whose apex is exactly `height` with the sim's integrator
 * (velocity updated before position, fixed dt). The continuous formula
 * sqrt(2 g h) undershoots by about v*dt/2 at 60 Hz, so the dt term adds it back:
 * apex = v^2/(2g) - v*dt/2  =>  v = g*dt/2 + sqrt((g*dt/2)^2 + 2*g*h).
 */
export function launchSpeedForHeight(gravity: number, height: number, dt: number): number {
  const half = (gravity * dt) / 2;
  return half + Math.sqrt(half * half + 2 * gravity * height);
}

/** Take-off speed for a standing jump of `config.jumpHeight`. */
export function jumpVelocity(config: MovementConfig, dt: number): number {
  return launchSpeedForHeight(config.gravity, config.jumpHeight, dt);
}

/** Half height of the capsule's cylinder part for a total character height. */
export function capsuleHalfHeight(totalHeight: number, radius: number): number {
  return Math.max(0.01, totalHeight / 2 - radius);
}

/** Fall damage for an impact speed, before roll or rule adjustments. */
export function fallDamage(config: MovementConfig, impactSpeed: number): number {
  return Math.min(100, Math.max(0, (impactSpeed - config.fallDamageMinSpeed) * config.fallDamagePerSpeed));
}
