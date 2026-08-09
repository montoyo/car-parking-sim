/**
 * Device-agnostic, normalised control input. Keyboard and gamepad adapters both
 * produce this shape; the core never learns which device the player used.
 */

export type Gear = 'forward' | 'neutral' | 'reverse';

export interface ControlInput {
  /** Steering rack TARGET in [-1, 1]; +1 is full left lock. */
  readonly steer: number;
  /** Throttle in [0, 1]. */
  readonly throttle: number;
  /** Brake in [0, 1]. */
  readonly brake: number;
  readonly handbrake: boolean;
  readonly gear: Gear;
}

export const NEUTRAL_INPUT: ControlInput = {
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  gear: 'neutral',
};

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Clamp an input's continuous channels into their legal ranges. */
export function sanitiseInput(input: ControlInput): ControlInput {
  return {
    steer: clamp(input.steer, -1, 1),
    throttle: clamp(input.throttle, 0, 1),
    brake: clamp(input.brake, 0, 1),
    handbrake: input.handbrake,
    gear: input.gear,
  };
}
