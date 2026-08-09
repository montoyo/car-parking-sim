/**
 * Head adapter: mouse movement and the snap-look keys become a `LookState`.
 *
 * Like the keyboard adapter, this is a device adapter — it owns the smoothing
 * and the pointer-lock plumbing, and hands the renderer nothing but two angles.
 * A shoulder check costs one held key; free look is the mouse. Releasing a snap
 * key swings the head back to wherever the mouse had it, so the two never fight.
 */

import type { LookState } from '../render/camera';
import { LOOK_AHEAD, SNAP_LOOK, approachLook, clampLook } from '../render/camera';

/** Radians of view rotation per pixel of mouse movement. */
const MOUSE_SENSITIVITY = 0.0022;
/** Time constant (s) for swinging the head to and from a snap look. */
const SNAP_RESPONSE = 0.11;
/** Time constant (s) for the mouse itself — small, so the mouse still feels 1:1. */
const FREE_RESPONSE = 0.03;

export interface LookBindings {
  readonly lookLeft: readonly string[];
  readonly lookRight: readonly string[];
  readonly lookBack: readonly string[];
  /** Recentre the free-look direction straight ahead. */
  readonly lookAhead: readonly string[];
}

export const DEFAULT_LOOK_BINDINGS: LookBindings = {
  lookLeft: ['KeyQ'],
  lookRight: ['KeyE'],
  lookBack: ['KeyC'],
  lookAhead: ['KeyZ'],
};

export class LookController {
  private readonly held = new Set<string>();
  /** Where the mouse has aimed the head. Snaps ride on top of this. */
  private free: LookState = LOOK_AHEAD;
  private current: LookState = LOOK_AHEAD;
  private pointerLocked = false;

  constructor(private readonly bindings: LookBindings = DEFAULT_LOOK_BINDINGS) {}

  /** Attach mouse-look and snap keys. Returns a detach function. */
  attach(canvas: HTMLCanvasElement, keyTarget: Window | HTMLElement = window): () => void {
    const click = (): void => {
      void canvas.requestPointerLock();
    };
    const lockChange = (): void => {
      this.pointerLocked = document.pointerLockElement === canvas;
    };
    const move = (e: Event): void => {
      if (!this.pointerLocked) return;
      const m = e as MouseEvent;
      this.free = clampLook({
        // Moving the mouse right looks right, i.e. toward negative yaw.
        yaw: this.free.yaw - m.movementX * MOUSE_SENSITIVITY,
        pitch: this.free.pitch - m.movementY * MOUSE_SENSITIVITY,
      });
    };
    const down = (e: Event): void => {
      const code = (e as KeyboardEvent).code;
      this.held.add(code);
      if (this.bindings.lookAhead.includes(code)) this.free = LOOK_AHEAD;
    };
    const up = (e: Event): void => {
      this.held.delete((e as KeyboardEvent).code);
    };
    const blur = (): void => this.held.clear();

    canvas.addEventListener('click', click);
    document.addEventListener('pointerlockchange', lockChange);
    document.addEventListener('mousemove', move);
    keyTarget.addEventListener('keydown', down);
    keyTarget.addEventListener('keyup', up);
    keyTarget.addEventListener('blur', blur);
    return () => {
      canvas.removeEventListener('click', click);
      document.removeEventListener('pointerlockchange', lockChange);
      document.removeEventListener('mousemove', move);
      keyTarget.removeEventListener('keydown', down);
      keyTarget.removeEventListener('keyup', up);
      keyTarget.removeEventListener('blur', blur);
    };
  }

  /** Advance the head by `dt` seconds and read where the driver is looking. */
  sample(dt: number): LookState {
    const snap = this.snapTarget();
    const target = snap === null ? this.free : { yaw: snap, pitch: this.free.pitch };
    const response = snap === null ? FREE_RESPONSE : SNAP_RESPONSE;
    this.current = clampLook(approachLook(this.current, target, dt, response));
    return this.current;
  }

  /** Whether the pointer is captured — the HUD tells the player to click if not. */
  get locked(): boolean {
    return this.pointerLocked;
  }

  private snapTarget(): number | null {
    if (this.any(this.bindings.lookBack)) return SNAP_LOOK.back;
    if (this.any(this.bindings.lookLeft)) return SNAP_LOOK.left;
    if (this.any(this.bindings.lookRight)) return SNAP_LOOK.right;
    return null;
  }

  private any(codes: readonly string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }
}
