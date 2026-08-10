/**
 * When an attempt is over.
 *
 * The player declares they are finished EXPLICITLY — `finishRequested` on the
 * control input, which the UI raises from a "finish attempt" button (or its key).
 * Nothing about the pose ends an attempt on the player's behalf: a car sitting
 * still with the handbrake on is a driver thinking about the next shunt just as
 * often as it is a driver who is done, and guessing between those two took the
 * decision away from the person making it. Scoring (see `scoring.ts`) then decides
 * whether the place they stopped in is any good, which is a separate question from
 * whether they are done.
 *
 * Two guards keep the declaration from being nonsense:
 *
 * 1. The car must be STATIONARY. Finishing is parking, and a car still rolling is
 *    not parked; `canFinish` is exported so the button can grey itself out for the
 *    same reason rather than by a rule of its own.
 * 2. The scenario must have a bay. The debug plane is a fixture for vehicle-model
 *    tests, not an attempt at anything, so nothing there ever completes.
 *
 * The state is latched: once an attempt is complete or failed it stays that way,
 * and the `scenarioComplete` / `scenarioFailed` event is emitted exactly once.
 */

import type { ContactEvent, SimEvent } from './events';
import type { Scenario } from './scenario';
import type { VehicleState } from './world';

/** Speed (m/s) below which the car counts as stationary. */
export const STATIONARY_SPEED = 0.08;
/** Yaw rate (rad/s) below which the car counts as stationary. */
export const STATIONARY_YAW_RATE = 0.06;
/**
 * Speed (m/s) the car must have exceeded at some point for the attempt to be
 * considered under way. Well above `STATIONARY_SPEED`, and below idle creep.
 */
export const UNDER_WAY_SPEED = 0.3;

export type AttemptStatus = 'driving' | 'complete' | 'failed';

/**
 * Progress of the attempt. Part of `WorldState` because the dwell timer and the
 * "has moved" latch are state, not something derivable from one pose.
 */
export interface CompletionState {
  readonly status: AttemptStatus;
  /** Whether the car has been driven at all yet. */
  readonly underWay: boolean;
  /** Seconds the car has been continuously stationary. */
  readonly stillSeconds: number;
  /** Tick and simulated time (s) the attempt ended at; null while driving. */
  readonly endedTick: number | null;
  readonly endedTime: number | null;
  /** Why the attempt failed, if it did. */
  readonly reason: string | null;
}

export const INITIAL_COMPLETION: CompletionState = {
  status: 'driving',
  underWay: false,
  stillSeconds: 0,
  endedTick: null,
  endedTime: null,
  reason: null,
};

/** Whether the car is at a standstill this tick. */
export function isStationary(vehicle: VehicleState): boolean {
  return (
    Math.abs(vehicle.longitudinalVelocity) <= STATIONARY_SPEED &&
    Math.abs(vehicle.lateralVelocity) <= STATIONARY_SPEED &&
    Math.abs(vehicle.yawRate) <= STATIONARY_YAW_RATE
  );
}

/**
 * Whether pressing "finish attempt" right now would end the attempt. The button
 * asks this so that what it offers and what the core will accept are one rule.
 */
export function canFinish(vehicle: VehicleState, scenario: Scenario): boolean {
  return scenario.bay !== null && isStationary(vehicle);
}

export interface CompletionUpdate {
  readonly completion: CompletionState;
  readonly events: readonly SimEvent[];
}

/**
 * Advance the attempt's progress by one tick. Pure; the caller supplies this
 * tick's contact events so hard mode can end the attempt on a severe impact
 * without a second collision pass.
 */
export function updateCompletion(
  previous: CompletionState,
  vehicle: VehicleState,
  scenario: Scenario,
  contacts: readonly ContactEvent[],
  finishRequested: boolean,
  tick: number,
  time: number,
  dt: number,
): CompletionUpdate {
  // Latched: an attempt ends once.
  if (previous.status !== 'driving') return { completion: previous, events: [] };

  if (scenario.pass.endOnSevereImpact && contacts.some((c) => c.severity === 'impact')) {
    return {
      completion: {
        ...previous,
        status: 'failed',
        endedTick: tick,
        endedTime: time,
        reason: 'severe impact',
      },
      events: [{ kind: 'scenarioFailed', tick, reason: 'severe impact' }],
    };
  }

  const still = isStationary(vehicle);
  const underWay =
    previous.underWay || Math.abs(vehicle.longitudinalVelocity) >= UNDER_WAY_SPEED;
  const stillSeconds = still ? previous.stillSeconds + dt : 0;
  const driving: CompletionState = { ...previous, underWay, stillSeconds };

  if (!finishRequested || !canFinish(vehicle, scenario)) {
    return { completion: driving, events: [] };
  }

  return {
    completion: { ...driving, status: 'complete', endedTick: tick, endedTime: time },
    events: [{ kind: 'scenarioComplete', tick }],
  };
}
