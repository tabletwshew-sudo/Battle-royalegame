import { clamp, wrapAngle } from "./MathUtil";

/**
 * One tick of player intent. Humans (client Input), bots (BotBrain) and the
 * network all produce this same structure, and the sim consumes nothing else.
 */
export interface InputFrame {
  /** Strafe: -1 (left) .. +1 (right). */
  moveX: number;
  /** Forward: -1 (back) .. +1 (forward). */
  moveZ: number;
  /** Absolute look yaw in radians (see MathUtil.lookDirection). */
  yaw: number;
  /** Absolute look pitch in radians, positive up. */
  pitch: number;
  /** Bitmask of Button values held this tick. */
  buttons: number;
}

/** Held-button bits. Edge detection is done in the sim from the previous frame. */
export const Button = {
  Jump: 1 << 0,
  Crouch: 1 << 1,
  Sprint: 1 << 2,
  Fire: 1 << 3,
  Ads: 1 << 4,
  Interact: 1 << 5,
  Reload: 1 << 6,
  Pickaxe: 1 << 7,
  Pocket: 1 << 8,
  Ping: 1 << 9,
  Drop: 1 << 10,
  ShoulderSwap: 1 << 11,
  Slot1: 1 << 12,
  Slot2: 1 << 13,
  Slot3: 1 << 14,
  Slot4: 1 << 15,
  Slot5: 1 << 16,
  Follow: 1 << 17,
} as const;
export type ButtonName = keyof typeof Button;

/** Every defined button bit OR-ed together. */
export const ALL_BUTTONS: number = Object.values(Button).reduce((acc, bit) => acc | bit, 0);

/** Pitch limit just short of straight up/down (89 degrees). */
export const MAX_PITCH = (89 * Math.PI) / 180;

export function neutralInput(): InputFrame {
  return { moveX: 0, moveZ: 0, yaw: 0, pitch: 0, buttons: 0 };
}

export function isHeld(frame: InputFrame, button: number): boolean {
  return (frame.buttons & button) !== 0;
}

/** True on the tick a button goes from up to down. */
export function wasPressed(buttons: number, previousButtons: number, button: number): boolean {
  return (buttons & button) !== 0 && (previousButtons & button) === 0;
}

/** True on the tick a button goes from down to up. */
export function wasReleased(buttons: number, previousButtons: number, button: number): boolean {
  return (buttons & button) === 0 && (previousButtons & button) !== 0;
}

/**
 * Returns a safe copy of an input frame: finite numbers, clamped axes, a
 * move vector no longer than 1, wrapped yaw, limited pitch and known buttons
 * only. The server runs every received frame through this.
 */
export function sanitizeInput(frame: InputFrame): InputFrame {
  const finite = (n: number): number => (Number.isFinite(n) ? n : 0);
  let moveX = clamp(finite(frame.moveX), -1, 1);
  let moveZ = clamp(finite(frame.moveZ), -1, 1);
  const length = Math.hypot(moveX, moveZ);
  if (length > 1) {
    moveX /= length;
    moveZ /= length;
  }
  return {
    moveX,
    moveZ,
    yaw: wrapAngle(finite(frame.yaw)),
    pitch: clamp(finite(frame.pitch), -MAX_PITCH, MAX_PITCH),
    buttons: (finite(frame.buttons) | 0) & ALL_BUTTONS,
  };
}
