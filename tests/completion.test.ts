/**
 * Completion: the player declares they are finished by parking properly, not by
 * pressing a button. Everything here goes through the core's public surface —
 * `createWorld` and `step` (via the shared `drive` helper) — and asserts on the
 * `scenarioComplete` event and `world.completion`.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, PARALLEL_PARK_PARAMETERS } from '../src/core/index';
import { drive, eventsOfKind, hold } from './helpers/drive';

/** A pose in the bay: the bay centre is (0, bayWidth / 2) with the axis along +x. */
const IN_THE_BAY = { x: 0.04, y: PARALLEL_PARK_PARAMETERS.bayWidth / 2, yaw: 0 };

describe('completion detection', () => {
  it('does not end the attempt before the player has driven anywhere', () => {
    // The car spawns stationary with no handbrake: the dwell must not fire on a
    // player who is still reading the scenario description.
    const result = hold(createWorld('parallel-park'), 6, { brake: 1 });
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(0);
    expect(result.world.completion.status).toBe('driving');
  });

  it('completes when the car is stationary with the handbrake set', () => {
    const result = drive(createWorld('parallel-park', { spawn: IN_THE_BAY }), [
      { seconds: 1.5, input: { gear: 'forward' } },
      { seconds: 2, input: { gear: 'forward', brake: 1, handbrake: true } },
    ]);
    const completed = eventsOfKind(result.events, 'scenarioComplete');
    expect(completed).toHaveLength(1);
    expect(result.world.completion.status).toBe('complete');
    expect(result.world.completion.endedTick).toBe(completed[0]?.tick);
  });

  it('completes on the dwell alone when the car is left stopped in the bay', () => {
    const result = drive(createWorld('parallel-park', { spawn: IN_THE_BAY }), [
      { seconds: 1.5, input: { gear: 'forward' } },
      { seconds: 4, input: { gear: 'neutral', brake: 1 } },
    ]);
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(1);
    expect(result.world.completion.status).toBe('complete');
  });

  it('does not end the attempt when the player stops out in the road to think', () => {
    // Stopped, hands off, but nowhere near the bay: that is a pause mid-manoeuvre.
    const result = drive(createWorld('parallel-park'), [
      { seconds: 1.5, input: { gear: 'forward' } },
      { seconds: 5, input: { gear: 'neutral', brake: 1 } },
    ]);
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(0);
    expect(result.world.completion.status).toBe('driving');
  });

  it('reports completion once and then latches', () => {
    const result = drive(createWorld('parallel-park', { spawn: IN_THE_BAY }), [
      { seconds: 1.5, input: { gear: 'forward' } },
      { seconds: 6, input: { gear: 'forward', brake: 1, handbrake: true } },
    ]);
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(1);
    // Latched: the recorded end time does not creep forward with the clock.
    expect(result.world.completion.endedTime).toBeLessThan(result.world.time);
  });

  it('never completes a scenario with no bay', () => {
    const result = drive(createWorld('debug-plane'), [
      { seconds: 1.5, input: { gear: 'forward' } },
      { seconds: 3, input: { gear: 'forward', brake: 1, handbrake: true } },
    ]);
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(0);
  });
});
