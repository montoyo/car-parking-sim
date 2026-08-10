/**
 * Keyboard adapter: turns key state into a `ControlInput`.
 *
 * The adapter — not the core — owns steering wind-on and self-centre ramping, so
 * that an analogue device (gamepad, ticket 13) can map its axis straight to the
 * rack target and the core sees the same shape from both. It also owns the two
 * DRIVE MODES, for the same reason: an EV's single go-pedal and an automatic's
 * gear selector are two ways of asking for the same `ControlInput`, and the core
 * never learns which the player chose.
 *
 *   'ev'      — hold W to go forward, S to go backward, neither to brake. There
 *               is no gear to select; direction is whichever key is down.
 *   'gearbox' — the classic selector: F/N/R pick a gear, W is the throttle and
 *               S the brake within it.
 *
 * In EV mode the gear is not a thing the player sets, so asking for a direction
 * the car is currently moving AGAINST brakes instead of engaging it. That is what
 * a real EV does — regen down to a stop, then away the other way — and it is also
 * the only way to stop W-into-reverse from being a shunt.
 */

import type { ControlInput, Gear } from '../core/index';
import { clamp } from '../core/index';
import { DEFAULT_BINDING_SET, keyBindingsFrom } from './bindings';
import { nextInputRequest } from './request';

/** Rate at which held left/right winds the target on, in units of [-1,1] per second. */
const WIND_ON_RATE = 1.6;
/** Rate at which an unheld target returns to centre. */
const SELF_CENTRE_RATE = 2.4;
/** Pedal ramp rates so keyboard throttle/brake are not on/off. */
const PEDAL_ON_RATE = 4.0;
const PEDAL_OFF_RATE = 6.0;

/** How the drive keys are read. See the module comment. */
export type DriveMode = 'ev' | 'gearbox';

export const DEFAULT_DRIVE_MODE: DriveMode = 'ev';

/**
 * Brake applied in EV mode when neither direction key is held. Enough to bring a
 * parking crawl to a stop and hold it there, well short of standing the car on
 * its nose.
 */
export const EV_AUTO_BRAKE = 0.55;
/**
 * Road speed (m/s) above which asking for the OPPOSITE direction brakes rather
 * than engaging. Below it the car is as good as stopped and the direction takes.
 */
export const EV_DIRECTION_CHANGE_SPEED = 0.25;

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

/**
 * The shipped keys are not written here: they come from the one binding registry,
 * which is also what guarantees none of them collides with a non-driving key.
 */
export const DEFAULT_BINDINGS: KeyBindings = keyBindingsFrom(DEFAULT_BINDING_SET);

/**
 * Bindings may be handed over as a fixed set or as a getter, so that remapping
 * takes effect immediately without rebuilding the adapter.
 */
export type KeyBindingsSource = KeyBindings | (() => KeyBindings);

/** The mode may be fixed or read live, so switching it takes effect immediately. */
export type DriveModeSource = DriveMode | (() => DriveMode);

export class KeyboardAdapter {
  private readonly held = new Set<string>();
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private gear: Gear = 'neutral';
  private gearRequestSequence = 0;
  private readonly bindingsOf: () => KeyBindings;
  private readonly modeOf: () => DriveMode;

  constructor(
    bindings: KeyBindingsSource = DEFAULT_BINDINGS,
    mode: DriveModeSource = DEFAULT_DRIVE_MODE,
  ) {
    this.bindingsOf = typeof bindings === 'function' ? bindings : () => bindings;
    this.modeOf = typeof mode === 'function' ? mode : () => mode;
  }

  /** The bindings in force right now. */
  get bindings(): KeyBindings {
    return this.bindingsOf();
  }

  /** The drive mode in force right now. */
  get mode(): DriveMode {
    return this.modeOf();
  }

  /**
   * Forget the selected gear and let the pedals fall back to rest. A restart puts
   * the car in neutral, and the adapter holding the old gear would silently drive
   * it straight back out of the reset pose.
   */
  reset(): void {
    this.gear = 'neutral';
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
  }

  /** When the keyboard last asked for a gear, for merging with another device. */
  get gearRequest(): number {
    return this.gearRequestSequence;
  }

  /** Attach listeners to a DOM target. Returns a detach function. */
  attach(target: Window | HTMLElement): () => void {
    const down = (e: Event) => {
      const code = (e as KeyboardEvent).code;
      const bindings = this.bindings;
      this.held.add(code);
      // EV mode has no selector: the gear keys are inert rather than a second,
      // invisible way to set a direction the go-pedal is already deciding.
      let requested = this.mode === 'gearbox';
      if (requested) {
        if (bindings.gearForward.includes(code)) this.gear = 'forward';
        else if (bindings.gearNeutral.includes(code)) this.gear = 'neutral';
        else if (bindings.gearReverse.includes(code)) this.gear = 'reverse';
        else requested = false;
      }
      if (requested) this.gearRequestSequence = nextInputRequest();
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

  /**
   * Advance the ramps by `dt` seconds and read the resulting input.
   *
   * `roadSpeed` is the car's signed longitudinal velocity (m/s), which EV mode
   * needs to tell "go the other way" from "stop first". Gearbox mode ignores it.
   */
  sample(dt: number, roadSpeed = 0): ControlInput {
    const bindings = this.bindings;
    const left = this.any(bindings.steerLeft);
    const right = this.any(bindings.steerRight);
    const steerDir = (left ? 1 : 0) - (right ? 1 : 0);

    if (steerDir !== 0) {
      this.steer = clamp(this.steer + steerDir * WIND_ON_RATE * dt, -1, 1);
    } else {
      const decay = SELF_CENTRE_RATE * dt;
      this.steer = Math.abs(this.steer) <= decay ? 0 : this.steer - Math.sign(this.steer) * decay;
    }

    const forwardKey = this.any(bindings.throttle);
    const backwardKey = this.any(bindings.brake);

    if (this.mode === 'ev') {
      // W and S are DIRECTIONS here, not a throttle and a brake; both down (or
      // neither) is the same request as "stop".
      const wanted = (forwardKey ? 1 : 0) - (backwardKey ? 1 : 0);
      const movingAgainst = wanted !== 0 && Math.sign(roadSpeed) === -wanted &&
        Math.abs(roadSpeed) > EV_DIRECTION_CHANGE_SPEED;
      const driving = wanted !== 0 && !movingAgainst;

      this.gear = !driving ? 'neutral' : wanted > 0 ? 'forward' : 'reverse';
      this.throttle = ramp(this.throttle, driving, dt);
      // Lifting off is the brake: the car does not coast, it stops and holds.
      this.brake = rampTo(this.brake, driving ? 0 : EV_AUTO_BRAKE, dt);
    } else {
      this.throttle = ramp(this.throttle, forwardKey, dt);
      this.brake = ramp(this.brake, backwardKey, dt);
    }

    return {
      steer: this.steer,
      throttle: this.throttle,
      brake: this.brake,
      handbrake: this.any(bindings.handbrake),
      gear: this.gear,
      // The declaration that the attempt is over is a UI action, not a pedal.
      finishRequested: false,
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
  return rampTo(value, pressed ? 1 : 0, dt);
}

function rampTo(value: number, target: number, dt: number): number {
  const rate = target > value ? PEDAL_ON_RATE : PEDAL_OFF_RATE;
  const delta = clamp(target - value, -rate * dt, rate * dt);
  return clamp(value + delta, 0, 1);
}
