/**
 * Keyboard adapter: turns key state into a `ControlInput`.
 *
 * The adapter — not the core — owns steering wind-on and self-centre ramping, so
 * that an analogue device (gamepad, ticket 13) can map its axis straight to the
 * rack target and the core sees the same shape from both.
 */

import type { ControlInput, Gear } from '../core/index';
import { clamp } from '../core/index';

/** Rate at which held left/right winds the target on, in units of [-1,1] per second. */
const WIND_ON_RATE = 1.6;
/** Rate at which an unheld target returns to centre. */
const SELF_CENTRE_RATE = 2.4;
/** Pedal ramp rates so keyboard throttle/brake are not on/off. */
const PEDAL_ON_RATE = 4.0;
const PEDAL_OFF_RATE = 6.0;

export interface KeyBindings {
  readonly steerLeft: readonly string[];
  readonly steerRight: readonly string[];
  readonly throttle: readonly string[];
  readonly brake: readonly string[];
  readonly handbrake: readonly string[];
  readonly gearForward: readonly string[];
  readonly gearNeutral: readonly string[];
  readonly gearReverse: readonly string[];
}

export const DEFAULT_BINDINGS: KeyBindings = {
  steerLeft: ['ArrowLeft', 'KeyA'],
  steerRight: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  handbrake: ['Space'],
  gearForward: ['KeyF', 'Digit1'],
  gearNeutral: ['KeyN', 'Digit2'],
  gearReverse: ['KeyR', 'Digit3'],
};

export class KeyboardAdapter {
  private readonly held = new Set<string>();
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private gear: Gear = 'neutral';

  constructor(private readonly bindings: KeyBindings = DEFAULT_BINDINGS) {}

  /** Attach listeners to a DOM target. Returns a detach function. */
  attach(target: Window | HTMLElement): () => void {
    const down = (e: Event) => {
      const code = (e as KeyboardEvent).code;
      this.held.add(code);
      if (this.bindings.gearForward.includes(code)) this.gear = 'forward';
      else if (this.bindings.gearNeutral.includes(code)) this.gear = 'neutral';
      else if (this.bindings.gearReverse.includes(code)) this.gear = 'reverse';
      if (this.isBound(code)) e.preventDefault();
    };
    const up = (e: Event) => {
      this.held.delete((e as KeyboardEvent).code);
    };
    const blur = () => this.held.clear();

    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    };
  }

  /** Advance the ramps by `dt` seconds and read the resulting input. */
  sample(dt: number): ControlInput {
    const left = this.any(this.bindings.steerLeft);
    const right = this.any(this.bindings.steerRight);
    const steerDir = (left ? 1 : 0) - (right ? 1 : 0);

    if (steerDir !== 0) {
      this.steer = clamp(this.steer + steerDir * WIND_ON_RATE * dt, -1, 1);
    } else {
      const decay = SELF_CENTRE_RATE * dt;
      this.steer = Math.abs(this.steer) <= decay ? 0 : this.steer - Math.sign(this.steer) * decay;
    }

    this.throttle = ramp(this.throttle, this.any(this.bindings.throttle), dt);
    this.brake = ramp(this.brake, this.any(this.bindings.brake), dt);

    return {
      steer: this.steer,
      throttle: this.throttle,
      brake: this.brake,
      handbrake: this.any(this.bindings.handbrake),
      gear: this.gear,
    };
  }

  private any(codes: readonly string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  private isBound(code: string): boolean {
    return Object.values(this.bindings).some((codes) => codes.includes(code));
  }
}

function ramp(value: number, pressed: boolean, dt: number): number {
  const target = pressed ? 1 : 0;
  const rate = pressed ? PEDAL_ON_RATE : PEDAL_OFF_RATE;
  const delta = clamp(target - value, -rate * dt, rate * dt);
  return clamp(value + delta, 0, 1);
}
