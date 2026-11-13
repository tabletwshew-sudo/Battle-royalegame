import { Button, type ButtonName, type InputFrame, MAX_PITCH } from "../shared/sim/InputFrame";
import { clamp, wrapAngle } from "../shared/sim/MathUtil";

/**
 * Input system. `InputState` is the DOM-free core (binding lookup, look
 * angles, frame sampling); `Input` connects it to keyboard, mouse and pointer
 * lock. Codes are KeyboardEvent.code values, or "Mouse0".."Mouse4" for buttons.
 */

export interface Bindings {
  moveForward: string[];
  moveBack: string[];
  moveLeft: string[];
  moveRight: string[];
  buttons: Record<ButtonName, string[]>;
}

export function defaultBindings(): Bindings {
  return {
    moveForward: ["KeyW", "ArrowUp"],
    moveBack: ["KeyS", "ArrowDown"],
    moveLeft: ["KeyA", "ArrowLeft"],
    moveRight: ["KeyD", "ArrowRight"],
    buttons: {
      Jump: ["Space"],
      Crouch: ["KeyC", "ControlLeft"],
      Sprint: ["ShiftLeft"],
      Fire: ["Mouse0"],
      Ads: ["Mouse2"],
      Interact: ["KeyE"],
      Reload: ["KeyR"],
      Pickaxe: ["KeyQ"],
      Pocket: ["KeyV"],
      Ping: ["Mouse1"],
      Drop: ["KeyG"],
      ShoulderSwap: ["KeyX"],
      Slot1: ["Digit1"],
      Slot2: ["Digit2"],
      Slot3: ["Digit3"],
      Slot4: ["Digit4"],
      Slot5: ["Digit5"],
      Follow: ["KeyF"],
    },
  };
}

/**
 * hold: sprint while the key is held. toggle: a press starts sprint until you
 * stop moving forward or press it again. auto: always sprint when moving
 * forward; holding the key walks instead.
 */
export type SprintMode = "hold" | "toggle" | "auto";
export const SPRINT_MODES: readonly SprintMode[] = ["hold", "toggle", "auto"];

/** Radians of rotation per pixel of mouse travel at sensitivity 1. */
export const LOOK_RADIANS_PER_PIXEL = 0.0022;

/**
 * Largest believable mouse delta in one event, in pixels. Some browsers send a
 * single huge spike right after pointer lock is gained (the distance from the
 * old cursor position); real mice report far smaller steps per event.
 */
export const MAX_MOUSE_DELTA = 400;

export class InputState {
  yaw = 0;
  pitch = 0;
  sensitivity = 1;
  invertY = false;
  /** Largest allowed |pitch| in radians (the camera may use less than MAX_PITCH). */
  pitchLimit = MAX_PITCH;
  sprintMode: SprintMode = "hold";
  /** Toggle-mode latch. */
  private sprintLatched = false;
  private sprintKeyWasDown = false;
  private readonly down = new Set<string>();
  /** Codes pressed since the last sample, kept even if already released (see sample()). */
  private readonly tapped = new Set<string>();

  constructor(public bindings: Bindings = defaultBindings()) {}

  /** Records a key or mouse button going down or up. */
  setCode(code: string, isDown: boolean): void {
    if (isDown) {
      this.down.add(code);
      this.tapped.add(code);
    } else {
      this.down.delete(code);
    }
  }

  /** Applies relative mouse movement in pixels to the look angles. Implausible spikes are ignored. */
  addLook(dxPixels: number, dyPixels: number): void {
    if (Math.abs(dxPixels) > MAX_MOUSE_DELTA || Math.abs(dyPixels) > MAX_MOUSE_DELTA) return;
    const k = LOOK_RADIANS_PER_PIXEL * this.sensitivity;
    this.yaw = wrapAngle(this.yaw - dxPixels * k);
    this.pitch = clamp(this.pitch + (this.invertY ? dyPixels : -dyPixels) * k, -this.pitchLimit, this.pitchLimit);
  }

  /** Sets the look direction directly (used when a scene starts). */
  setLook(yaw: number, pitch: number): void {
    this.yaw = wrapAngle(yaw);
    this.pitch = clamp(pitch, -this.pitchLimit, this.pitchLimit);
  }

  /** Releases everything (focus loss, pointer unlock). */
  releaseAll(): void {
    this.down.clear();
    this.tapped.clear();
    this.sprintLatched = false;
  }

  isCodeDown(code: string): boolean {
    return this.down.has(code);
  }

  /**
   * Builds the InputFrame for the next sim tick from the current device state.
   * A key that was pressed and released entirely between two samples (a quick
   * tap during a slow frame) still counts as held for this one frame.
   */
  sample(): InputFrame {
    const b = this.bindings;
    let moveX = (this.anyDown(b.moveRight) ? 1 : 0) - (this.anyDown(b.moveLeft) ? 1 : 0);
    let moveZ = (this.anyDown(b.moveForward) ? 1 : 0) - (this.anyDown(b.moveBack) ? 1 : 0);
    if (moveX !== 0 && moveZ !== 0) {
      // Diagonals must not be faster than straight movement.
      moveX *= Math.SQRT1_2;
      moveZ *= Math.SQRT1_2;
    }
    let buttons = 0;
    for (const name of Object.keys(b.buttons) as ButtonName[]) {
      if (this.anyDown(b.buttons[name])) buttons |= Button[name];
    }
    buttons = this.applySprintMode(buttons, moveZ);
    this.tapped.clear();
    return { moveX, moveZ, yaw: this.yaw, pitch: this.pitch, buttons };
  }

  /** Turns the raw sprint key state into the Sprint bit for the chosen sprint mode. */
  private applySprintMode(buttons: number, moveZ: number): number {
    const keyDown = (buttons & Button.Sprint) !== 0;
    const pressed = keyDown && !this.sprintKeyWasDown;
    this.sprintKeyWasDown = keyDown;
    const forward = moveZ > 0;
    let sprint = keyDown;
    if (this.sprintMode === "toggle") {
      if (pressed) this.sprintLatched = !this.sprintLatched;
      if (!forward || (buttons & Button.Crouch) !== 0) this.sprintLatched = false;
      sprint = this.sprintLatched;
    } else if (this.sprintMode === "auto") {
      sprint = forward && !keyDown;
    }
    return sprint ? buttons | Button.Sprint : buttons & ~Button.Sprint;
  }

  private anyDown(codes: readonly string[]): boolean {
    for (const code of codes) if (this.down.has(code) || this.tapped.has(code)) return true;
    return false;
  }
}

/** Function key that toggles the stats overlay. More debug keys are added as their tools ship. */
export const DEFAULT_DEBUG_KEYS: readonly string[] = ["F3"];

export interface InputCallbacks {
  /** A debug function key was pressed. */
  onDebugKey(code: string): void;
  /** Pointer lock was gained or lost. */
  onPointerLockChange(locked: boolean): void;
}

export class Input {
  readonly state: InputState;
  private readonly removers: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: InputCallbacks,
    bindings: Bindings = defaultBindings(),
    /** Key codes reported through onDebugKey; their browser defaults are suppressed. */
    private readonly debugKeys: readonly string[] = DEFAULT_DEBUG_KEYS,
  ) {
    this.state = new InputState(bindings);
    this.listen(window, "keydown", (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, "keyup", (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, "blur", () => this.state.releaseAll());
    this.listen(canvas, "mousedown", (e) => this.onMouseButton(e as MouseEvent, true));
    this.listen(window, "mouseup", (e) => this.onMouseButton(e as MouseEvent, false));
    this.listen(canvas, "contextmenu", (e) => e.preventDefault());
    this.listen(document, "mousemove", (e) => this.onMouseMove(e as MouseEvent));
    this.listen(document, "pointerlockchange", () => this.onLockChange());
  }

  get isLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Asks the browser to capture the mouse. Must be called from a user gesture. */
  requestLock(): void {
    if (this.isLocked) return;
    try {
      const result = this.canvas.requestPointerLock() as unknown;
      // Newer browsers return a promise that rejects if the lock is refused
      // (for example right after Esc); the player can simply click again.
      if (result instanceof Promise) result.catch(() => undefined);
    } catch {
      // Older browsers throw synchronously for the same reason.
    }
  }

  dispose(): void {
    for (const remove of this.removers) remove();
    this.removers.length = 0;
    if (this.isLocked) document.exitPointerLock();
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    this.removers.push(() => target.removeEventListener(type, handler));
  }

  private onKey(event: KeyboardEvent, isDown: boolean): void {
    if (this.debugKeys.includes(event.code)) {
      event.preventDefault();
      if (isDown && !event.repeat) this.callbacks.onDebugKey(event.code);
      return;
    }
    // Keep Space/arrows from scrolling and Tab from moving focus while playing.
    if (this.isLocked && !event.metaKey) event.preventDefault();
    this.state.setCode(event.code, isDown);
  }

  private onMouseButton(event: MouseEvent, isDown: boolean): void {
    if (!isDown) {
      this.state.setCode(`Mouse${event.button}`, false);
      return;
    }
    if (!this.isLocked) {
      // The first click only captures the mouse; it is not a game action.
      this.requestLock();
      return;
    }
    event.preventDefault();
    this.state.setCode(`Mouse${event.button}`, true);
  }

  private onMouseMove(event: MouseEvent): void {
    if (this.isLocked) this.state.addLook(event.movementX, event.movementY);
  }

  private onLockChange(): void {
    if (!this.isLocked) this.state.releaseAll();
    this.callbacks.onPointerLockChange(this.isLocked);
  }
}
