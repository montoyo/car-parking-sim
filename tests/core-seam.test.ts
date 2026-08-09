import { describe, expect, it } from 'vitest';
import { createWorld, FIXED_DT } from '../src/core/index';
import { degrees, drive, eventsOfKind, hold, poseDistance } from './helpers/drive';

describe('determinism', () => {
  it('identical input scripts from an identical initial world produce bit-identical final worlds', () => {
    const script = [
      { seconds: 1.5, input: { gear: 'forward' as const, throttle: 0.6, steer: 1 } },
      { seconds: 0.75, input: { gear: 'forward' as const, brake: 1 } },
      { seconds: 2, input: { gear: 'reverse' as const, throttle: 0.4, steer: -0.8 } },
    ];

    const a = drive(createWorld('debug-plane'), script);
    const b = drive(createWorld('debug-plane'), script);

    expect(JSON.stringify(a.world)).toBe(JSON.stringify(b.world));
    expect(a.world.vehicle.pose.x).toBe(b.world.vehicle.pose.x);
    expect(a.world.vehicle.pose.y).toBe(b.world.vehicle.pose.y);
    expect(a.world.vehicle.pose.yaw).toBe(b.world.vehicle.pose.yaw);
    expect(a.events).toEqual(b.events);
  });
});

/**
 * Ticket 01's placeholder was kinematic, so any timestep gave the same path to
 * the last bit. The force-based model of ticket 03 CONVERGES instead of matching
 * exactly, so these assertions are stated over a parking manoeuvre — the regime
 * the game is played in — and they check convergence as well as closeness.
 */
describe('frame-rate independence', () => {
  it('halving dt while doubling tick count leaves the final pose within tolerance', () => {
    // A shunt: creep forward on full lock, stop, reverse out on opposite lock.
    const script = [
      { seconds: 2, input: { gear: 'forward' as const, steer: 1 } },
      { seconds: 0.5, input: { gear: 'forward' as const, brake: 1 } },
      { seconds: 2, input: { gear: 'reverse' as const, steer: -1 } },
    ];

    const coarse = drive(createWorld('debug-plane'), script, { dt: FIXED_DT });
    const fine = drive(createWorld('debug-plane'), script, { dt: FIXED_DT / 2 });
    const finer = drive(createWorld('debug-plane'), script, { dt: FIXED_DT / 4 });

    expect(fine.history.length).toBe(coarse.history.length * 2);
    // Tolerances in physical units: 5 cm of position, 0.5 deg of heading, over
    // roughly 4 m of travel.
    expect(poseDistance(coarse.world.vehicle.pose, fine.world.vehicle.pose)).toBeLessThan(0.05);
    expect(
      Math.abs(degrees(coarse.world.vehicle.pose.yaw - fine.world.vehicle.pose.yaw)),
    ).toBeLessThan(0.5);

    // Converging, not merely close: halving the timestep again moves the answer
    // less than the first halving did.
    expect(poseDistance(fine.world.vehicle.pose, finer.world.vehicle.pose)).toBeLessThan(
      poseDistance(coarse.world.vehicle.pose, fine.world.vehicle.pose),
    );
  });
});

describe('gear direction', () => {
  it('selecting reverse and applying throttle moves the car backwards', () => {
    const start = createWorld('debug-plane');
    const result = hold(start, 2, { gear: 'reverse', throttle: 0.5 });

    // Straight back along -x from a spawn heading of 0.
    expect(result.world.vehicle.pose.x).toBeLessThan(start.vehicle.pose.x - 1);
    expect(Math.abs(result.world.vehicle.pose.y - start.vehicle.pose.y)).toBeLessThan(0.001);
    expect(result.world.vehicle.longitudinalVelocity).toBeLessThan(0);
  });

  it('selecting forward and applying throttle moves the car forwards', () => {
    const result = hold(createWorld('debug-plane'), 2, { gear: 'forward', throttle: 0.5 });
    expect(result.world.vehicle.pose.x).toBeGreaterThan(1);
  });

  it('emits a gearChange event on each change of gear', () => {
    const result = drive(createWorld('debug-plane'), [
      { seconds: 0.5, input: { gear: 'forward', throttle: 0.3 } },
      { seconds: 0.5, input: { gear: 'neutral' } },
      { seconds: 0.5, input: { gear: 'reverse', throttle: 0.3 } },
    ]);

    const changes = eventsOfKind(result.events, 'gearChange');
    expect(changes.map((e) => `${e.from}->${e.to}`)).toEqual([
      'neutral->forward',
      'forward->neutral',
      'neutral->reverse',
    ]);
  });
});

describe('steering rack', () => {
  it('cannot exceed full lock however long the target is held', () => {
    const result = hold(createWorld('debug-plane'), 10, { gear: 'forward', steer: 1 });
    expect(result.world.vehicle.rack).toBeLessThanOrEqual(1);
    expect(result.world.vehicle.rack).toBeCloseTo(1, 6);
  });
});
