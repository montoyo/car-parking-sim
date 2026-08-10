/**
 * Completion: the player declares they are finished by asking to be — the
 * `finishRequested` channel of the control input, which the UI raises from the
 * finish button or its key. Nothing about the pose ends an attempt on its own.
 * Everything here goes through the core's public surface — `createWorld` and
 * `step` (via the shared `drive` helper) — and asserts on the `scenarioComplete`
 * event and `world.completion`.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, canFinish, PARALLEL_PARK_PARAMETERS } from '../src/core/index';
import { drive, eventsOfKind, hold } from './helpers/drive';

/** A pose in the bay: the bay centre is (0, bayWidth / 2) with the axis along +x. */
const IN_THE_BAY = { x: 0.04, y: PARALLEL_PARK_PARAMETERS.bayWidth / 2, yaw: 0 };

describe('completion detection', () => {
  it('never ends an attempt the player has not asked to end', () => {
    // Stopped in the bay, handbrake set, hands off: the old rules would have
    // called this done. It is a driver thinking about the next shunt.
    const result = drive(createWorld('parallel-park', { spawn: IN_THE_BAY }), [
      { seconds: 1.5, input: { gear: 'forward' } },
      { seconds: 6, input: { gear: 'neutral', brake: 1, handbrake: true } },
    ]);
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(0);
    expect(result.world.completion.status).toBe('driving');
  });

  it('completes when the player asks to finish a stopped car', () => {
    const result = drive(createWorld('parallel-park', { spawn: IN_THE_BAY }), [
      { seconds: 1.5, input: { gear: 'forward' } },
      { seconds: 1.5, input: { gear: 'neutral', brake: 1 } },
      { seconds: 0.1, input: { gear: 'neutral', brake: 1, finishRequested: true } },
    ]);
    const completed = eventsOfKind(result.events, 'scenarioComplete');
    expect(completed).toHaveLength(1);
    expect(result.world.completion.status).toBe('complete');
    expect(result.world.completion.endedTick).toBe(completed[0]?.tick);
  });

  it('completes wherever the car is stopped, not only inside the bay', () => {
    // Out in the road is a bad place to finish, not an impossible one: where the
    // player stopped is the pass gates' business, not completion's.
    const result = drive(createWorld('parallel-park'), [
      { seconds: 1.5, input: { gear: 'forward' } },
      { seconds: 1.5, input: { gear: 'neutral', brake: 1 } },
      { seconds: 0.1, input: { gear: 'neutral', brake: 1, finishRequested: true } },
    ]);
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(1);
  });

  it('refuses a request made while the car is still rolling', () => {
    // Asking to finish mid-manoeuvre is a misclick, and it must not become a
    // standing order that fires the moment the car happens to stop.
    const rolling = drive(createWorld('parallel-park'), [
      { seconds: 1.5, input: { gear: 'forward', throttle: 0.4 } },
      { seconds: 1, input: { gear: 'forward', throttle: 0.4, finishRequested: true } },
    ]);
    expect(eventsOfKind(rolling.events, 'scenarioComplete')).toHaveLength(0);
    expect(rolling.world.completion.status).toBe('driving');

    // ...and once stopped, with nobody asking again, it stays an attempt.
    const stopped = hold(rolling.world, 4, { gear: 'neutral', brake: 1 });
    expect(eventsOfKind(stopped.events, 'scenarioComplete')).toHaveLength(0);
    expect(stopped.world.completion.status).toBe('driving');
  });

  it('reports completion once and then latches', () => {
    const result = drive(createWorld('parallel-park', { spawn: IN_THE_BAY }), [
      { seconds: 1.5, input: { gear: 'forward' } },
      { seconds: 1.5, input: { gear: 'neutral', brake: 1 } },
      { seconds: 4, input: { gear: 'neutral', brake: 1, finishRequested: true } },
    ]);
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(1);
    // Latched: the recorded end time does not creep forward with the clock.
    expect(result.world.completion.endedTime).toBeLessThan(result.world.time);
  });

  it('never completes a scenario with no bay', () => {
    const result = drive(createWorld('debug-plane'), [
      { seconds: 1.5, input: { gear: 'forward' } },
      { seconds: 3, input: { gear: 'neutral', brake: 1, finishRequested: true } },
    ]);
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(0);
  });
});

describe('canFinish is the one rule the button and the core share', () => {
  it('is false while the car is rolling and true once it has stopped', () => {
    const world = createWorld('parallel-park');
    const rolling = hold(world, 1.5, { gear: 'forward', throttle: 0.4 });
    expect(canFinish(rolling.world.vehicle, rolling.world.scenario)).toBe(false);

    const stopped = hold(rolling.world, 3, { gear: 'neutral', brake: 1 });
    expect(canFinish(stopped.world.vehicle, stopped.world.scenario)).toBe(true);
  });

  it('is false on a scenario that is not an attempt at anything', () => {
    const debug = createWorld('debug-plane');
    expect(canFinish(debug.vehicle, debug.scenario)).toBe(false);
  });
});
