/**
 * Gamepad adapter: analogue steering and analogue pedals.
 *
 * The stick maps DIRECTLY to the rack target — no wind-on, no self-centre — so the
 * player gets proportional control: half a stick is half a rack. That is the whole
 * point of the analogue device, and it is why the ramping the keyboard needs lives
 * in the keyboard adapter and not in the core. Both adapters hand out the same
 * normalised `ControlInput`, and the core never learns which one produced it.
 *
 * Everything here is a pure function of a pad snapshot except the class, which only
 * polls `navigator.getGamepads()` and remembers button edges for gear selection.
 */

import type { ControlInput, Gear } from '../core/index';
import { clamp, sanitiseInput } from '../core/index';
import { nextInputRequest } from './request';

/** The slice of the Gamepad API this reads, so a test can hand it a literal. */
export interface PadButton {
  readonly pressed: boolean;
  readonly value: number;
}

export interface PadSnapshot {
  readonly axes: readonly number[];
  readonly buttons: readonly PadButton[];
}

/**
 * Standard-mapping layout. Sticks and triggers where a driving pad puts them:
 * left stick steers, right trigger is the throttle, left trigger the brake,
 * shoulders and B select the gear, A is the handbrake.
 */
export const PAD_MAPPING = {
  steerAxis: 0,
  throttleButton: 7,
  brakeButton: 6,
  handbrakeButton: 0,
  gearNeutralButton: 1,
  gearReverseButton: 4,
  gearForwardButton: 5,
} as const;

/**
 * Stick slop that must not steer the car. Beyond it the remaining travel is
 * rescaled to the full [-1, 1], so the very first movement off the deadzone is a
 * small rack angle rather than a jump.
 */
export const STICK_DEADZONE = 0.08;
/** Trigger travel below this is treated as a rest position. */
export const TRIGGER_DEADZONE = 0.04;

/** Stick axis to rack target: +1 is full LEFT lock, and axis -1 is left. */
export function padSteer(axis: number, deadzone: number = STICK_DEADZONE): number {
  const magnitude = Math.abs(axis);
  if (magnitude <= deadzone) return 0;
  const scaled = (magnitude - deadzone) / (1 - deadzone);
  return clamp(-Math.sign(axis) * scaled, -1, 1);
}

/** A trigger's travel, falling back to a digital press on pads without analogue. */
export function padPedal(button: PadButton | undefined): number {
  if (!button) return 0;
  const value = button.value > 0 ? button.value : button.pressed ? 1 : 0;
  return value <= TRIGGER_DEADZONE ? 0 : clamp((value - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE), 0, 1);
}

function pressed(pad: PadSnapshot, index: number): boolean {
  const button = pad.buttons[index];
  return button !== undefined && (button.pressed || button.value > 0.5);
}

/**
 * One pad snapshot plus the gear currently selected becomes a `ControlInput` —
 * exactly the shape the keyboard adapter produces.
 */
export function padControlInput(pad: PadSnapshot, gear: Gear): ControlInput {
  return sanitiseInput({
    steer: padSteer(pad.axes[PAD_MAPPING.steerAxis] ?? 0),
    throttle: padPedal(pad.buttons[PAD_MAPPING.throttleButton]),
    brake: padPedal(pad.buttons[PAD_MAPPING.brakeButton]),
    handbrake: pressed(pad, PAD_MAPPING.handbrakeButton),
    gear,
  });
}

/** Which gear a snapshot is asking for, or `null` if no gear button is down. */
export function padGearRequest(pad: PadSnapshot): Gear | null {
  if (pressed(pad, PAD_MAPPING.gearForwardButton)) return 'forward';
  if (pressed(pad, PAD_MAPPING.gearReverseButton)) return 'reverse';
  if (pressed(pad, PAD_MAPPING.gearNeutralButton)) return 'neutral';
  return null;
}

/** Whether any control on the pad is away from rest — i.e. the player is using it. */
export function padActive(pad: PadSnapshot): boolean {
  const input = padControlInput(pad, 'neutral');
  return input.steer !== 0 || input.throttle > 0 || input.brake > 0 || input.handbrake;
}

export type PadSource = () => readonly (PadSnapshot | null | undefined)[];

function navigatorPads(): readonly (PadSnapshot | null | undefined)[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  return navigator.getGamepads() as readonly (PadSnapshot | null | undefined)[];
}

export class GamepadAdapter {
  private gear: Gear = 'neutral';
  private previousGearRequest: Gear | null = null;
  private gearRequestSequence = 0;
  private live = false;
  private active = false;

  constructor(private readonly source: PadSource = navigatorPads) {}

  /**
   * The first connected pad's input, or `null` when there is no pad — in which case
   * the loop simply uses the keyboard.
   */
  sample(): ControlInput | null {
    const pad = this.firstPad();
    this.live = pad !== null;
    if (pad === null) {
      this.active = false;
      this.previousGearRequest = null;
      return null;
    }

    // Gear is edge-triggered: holding the shoulder button does not keep re-selecting.
    const request = padGearRequest(pad);
    if (request !== null && request !== this.previousGearRequest) {
      this.gear = request;
      this.gearRequestSequence = nextInputRequest();
    }
    this.previousGearRequest = request;
    this.active = padActive(pad) || request !== null;

    return padControlInput(pad, this.gear);
  }

  /** Whether a pad is plugged in, for the control reference to say so. */
  get connected(): boolean {
    return this.live;
  }

  /** Whether the pad is being used right now (as opposed to sitting idle). */
  get inUse(): boolean {
    return this.active;
  }

  /** When the pad last asked for a gear, so the newest request across devices wins. */
  get gearRequest(): number {
    return this.gearRequestSequence;
  }

  private firstPad(): PadSnapshot | null {
    for (const pad of this.source()) {
      if (pad && pad.axes && pad.buttons) return pad;
    }
    return null;
  }
}
