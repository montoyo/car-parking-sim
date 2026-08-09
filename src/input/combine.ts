/**
 * Merge two devices into the one `ControlInput` the core takes.
 *
 * Both adapters already produce the same normalised shape, so combining them is
 * arithmetic rather than a special case: pedals take whichever is pressed harder,
 * the handbrake is either, steering prefers the analogue device whenever the stick
 * is off centre (so a keyboard's self-centre ramp cannot fight a held stick), and
 * gear goes to whichever device asked most recently.
 *
 * The core stays unaware of all of this — it is handed one `ControlInput`.
 */

import type { ControlInput } from '../core/index';

export interface DeviceInput {
  readonly input: ControlInput;
  /** Stamp from `nextInputRequest()` when this device last asked for a gear. */
  readonly gearRequest: number;
}

export function combineInputs(digital: DeviceInput, analogue: DeviceInput | null): ControlInput {
  if (analogue === null) return digital.input;
  const a = digital.input;
  const b = analogue.input;
  const newer = analogue.gearRequest > digital.gearRequest ? b : a;
  return {
    // Analogue wins when it is actually being held off centre.
    steer: b.steer !== 0 ? b.steer : a.steer,
    throttle: Math.max(a.throttle, b.throttle),
    brake: Math.max(a.brake, b.brake),
    handbrake: a.handbrake || b.handbrake,
    gear: newer.gear,
  };
}
