/**
 * When an attempt is over.
 *
 * The player declares they are finished by PARKING PROPERLY, not by pressing a
 * "finish" button: the attempt completes when the car is stationary with the
 * handbrake set, or when it has simply been held stopped past a dwell time. That
 * is the whole interaction — scoring (see `scoring.ts`) then decides whether the
 * place they stopped in is any good, which is a separate question from whether
 * they are done.
 *
 * Two guards keep that from firing at the wrong moment:
 *
 * 1. The car must have MOVED first. A world starts stationary with no handbrake,
 *    so without this the dwell timer would end the attempt before the player has
 *    touched a pedal.
 * 2. The scenario must have a bay. The debug plane is a fixture for vehicle-model
 *    tests, not an attempt at anything, so nothing there ever completes.
 *
 * And the DWELL path additionally wants the car to be at least in the bay: a
 * player who stops in the middle of the road to think about the next shunt has not
 * finished, whereas one who rolls into the bay and takes their hands off the wheel
 * plainly has. Setting the handbrake needs no such qualification — that is the
 * player declaring they are done, and being declared done in a hopeless position
 * is exactly what the pass gates are for.
 *
 * The state is latched: once an attempt is complete or failed it stays that way,
 * and the `scenarioComplete` / `scenarioFailed` event is emitted exactly once.
 */

import { bodyCentre, pointInConvex } from './collision';
import type { ContactEvent, SimEvent } from './events';
import type { Scenario } from './scenario';
import type { VehicleState } from './world';

/** Speed (m/s) below which the car counts as stationary. */
export const STATIONARY_SPEED = 0.08;
/** Yaw rate (rad/s) below which the car counts as stationary. */
export const STATIONARY_YAW_RATE = 0.06;
/** Seconds the car must be held stopped to complete without the handbrake. */
export const COMPLETION_DWELL_SECONDS = 2.5;
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
  handbrake: boolean,
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

  if (scenario.bay === null || !underWay || !still) return { completion: driving, events: [] };

  // Handbrake set is the player saying "done"; the dwell is the same statement
  // made by a driver who leaves it in gear on the brake and takes their hands off.
  const inBay = pointInConvex(bodyCentre(vehicle.pose), scenario.bay.polygon);
  const declared = handbrake || (inBay && stillSeconds >= COMPLETION_DWELL_SECONDS);
  if (!declared) return { completion: driving, events: [] };

  return {
    completion: { ...driving, status: 'complete', endedTick: tick, endedTime: time },
    events: [{ kind: 'scenarioComplete', tick }],
  };
}
