/**
 * Steering geometry and the rack, driven entirely through the core seam
 * (`createWorld` + `step`, via the shared drive helper). Tolerances are stated
 * in metres / degrees / seconds.
 */

import { describe, expect, it } from 'vitest';
import { VEHICLE, createWorld, FIXED_DT } from '../src/core/index';
import {
  degrees,
  drive,
  fitCircle,
  hold,
  rackTravelSeconds,
  wheelPath,
} from './helpers/drive';

/** Ackermann turning radius of the rear-axle centre at a given reference angle. */
function ackermannRearAxleRadius(referenceAngle: number): number {
  return VEHICLE.wheelbase / Math.tan(Math.abs(referenceAngle));
}

describe('Ackermann front wheel angles', () => {
  it('gives the inner wheel more lock than the outer at full lock', () => {
    const result = hold(createWorld('debug-plane'), 6, { gear: 'forward', throttle: 0.3, steer: 1 });
    const wheels = result.world.vehicle.wheels;

    // Turning left: the left wheel is the inner one.
    expect(result.world.vehicle.rack).toBeCloseTo(1, 6);
    expect(wheels.frontLeft.steerAngle).toBeGreaterThan(wheels.frontRight.steerAngle);
    expect(wheels.rearLeft.steerAngle).toBe(0);
    expect(wheels.rearRight.steerAngle).toBe(0);
  });

  it('matches the geometry predicted by the vehicle definition wheelbase and track', () => {
    const result = hold(createWorld('debug-plane'), 6, { gear: 'forward', throttle: 0.3, steer: 1 });
    const wheels = result.world.vehicle.wheels;

    const radius = ackermannRearAxleRadius(VEHICLE.maxSteerAngle);
    const inner = Math.atan(VEHICLE.wheelbase / (radius - VEHICLE.trackFront / 2));
    const outer = Math.atan(VEHICLE.wheelbase / (radius + VEHICLE.trackFront / 2));

    // Within a tenth of a degree of the closed-form Ackermann angles.
    expect(degrees(wheels.frontLeft.steerAngle)).toBeCloseTo(degrees(inner), 1);
    expect(degrees(wheels.frontRight.steerAngle)).toBeCloseTo(degrees(outer), 1);
  });

  it('mirrors the angles when steering the other way', () => {
    const result = hold(createWorld('debug-plane'), 6, {
      gear: 'forward',
      throttle: 0.3,
      steer: -1,
    });
    const wheels = result.world.vehicle.wheels;
    expect(wheels.frontRight.steerAngle).toBeLessThan(wheels.frontLeft.steerAngle);
    expect(degrees(wheels.frontRight.steerAngle)).toBeCloseTo(
      -degrees(
        Math.atan(
          VEHICLE.wheelbase / (ackermannRearAxleRadius(VEHICLE.maxSteerAngle) - VEHICLE.trackFront / 2),
        ),
      ),
      1,
    );
  });

  it('centres both front wheels with the rack centred', () => {
    const world = createWorld('debug-plane');
    expect(world.vehicle.wheels.frontLeft.steerAngle).toBe(0);
    expect(world.vehicle.wheels.frontRight.steerAngle).toBe(0);
  });
});

describe('turning circle', () => {
  it('at full lock matches the Ackermann prediction for the wheelbase and track', () => {
    // Wind to full lock first, then drive a long arc so the fit is over steady
    // full-lock geometry only.
    const wound = hold(createWorld('debug-plane'), 5, { gear: 'forward', throttle: 0.3, steer: 1 });
    const arc = hold(wound.world, 12, { gear: 'forward', throttle: 0.3, steer: 1 });

    const centre = arc.history.map((w) => {
      const l = w.vehicle.wheels.rearLeft.position;
      const r = w.vehicle.wheels.rearRight.position;
      return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
    });

    const fitted = fitCircle(centre);
    const predicted = ackermannRearAxleRadius(VEHICLE.maxSteerAngle);

    // 5 cm on a ~4.1 m radius.
    expect(Math.abs(fitted.radius - predicted)).toBeLessThan(0.05);
  });

  it('has the rear wheels tracking inside the front wheels through a turn', () => {
    const wound = hold(createWorld('debug-plane'), 5, { gear: 'forward', throttle: 0.3, steer: 1 });
    const arc = hold(wound.world, 12, { gear: 'forward', throttle: 0.3, steer: 1 });

    const frontInner = fitCircle(wheelPath(arc.history, 'frontLeft'));
    const rearInner = fitCircle(wheelPath(arc.history, 'rearLeft'));
    const frontOuter = fitCircle(wheelPath(arc.history, 'frontRight'));
    const rearOuter = fitCircle(wheelPath(arc.history, 'rearRight'));

    // Both rear wheels cut inside their corresponding front wheel by a clear
    // margin (at least 10 cm) — the behaviour that kerbs real rear wheels.
    expect(rearInner.radius).toBeLessThan(frontInner.radius - 0.1);
    expect(rearOuter.radius).toBeLessThan(frontOuter.radius - 0.1);
  });
});

describe('steering rack rate', () => {
  it('takes the specified time to travel lock-to-lock while rolling', () => {
    // Wind to full right lock, then time the sweep to full left lock.
    const wound = hold(createWorld('debug-plane'), 6, { gear: 'forward', throttle: 0.4, steer: -1 });
    const sweep = hold(wound.world, 6, { gear: 'forward', throttle: 0.4, steer: 1 });

    const seconds = rackTravelSeconds(sweep.history, 1);
    expect(seconds).not.toBeNull();
    // Within 50 ms of the stated lock-to-lock time.
    expect(Math.abs((seconds as number) - VEHICLE.rackLockToLockSeconds)).toBeLessThan(0.05);
  });

  it('takes noticeably longer from a standstill than rolling', () => {
    const stationary = hold(createWorld('debug-plane'), 8, { gear: 'neutral', brake: 1, steer: 1 });
    const stationarySeconds = rackTravelSeconds(stationary.history, 1);

    const rolling = hold(createWorld('debug-plane'), 8, {
      gear: 'forward',
      throttle: 0.4,
      steer: 1,
    });
    const rollingSeconds = rackTravelSeconds(rolling.history, 1);

    expect(stationarySeconds).not.toBeNull();
    expect(rollingSeconds).not.toBeNull();
    // Dry-steer resistance: at least 25% slower than rolling.
    expect(stationarySeconds as number).toBeGreaterThan((rollingSeconds as number) * 1.25);
  });

  it('cannot move faster than the rate limit in a single tick', () => {
    const result = hold(createWorld('debug-plane'), FIXED_DT, {
      gear: 'forward',
      throttle: 0.4,
      steer: 1,
    });
    const maxPerTick = (2 / VEHICLE.rackLockToLockSeconds) * FIXED_DT;
    expect(result.world.vehicle.rack).toBeLessThanOrEqual(maxPerTick + 1e-12);
    expect(result.world.vehicle.rack).toBeGreaterThan(0);
  });
});

describe('finite lock', () => {
  it('leaves the rack at lock when the input asks for more', () => {
    // sanitiseInput clamps the channel, and the rack clamps again — a request
    // beyond lock parks the rack exactly at lock and the wheels at max angle.
    const result = hold(createWorld('debug-plane'), 8, {
      gear: 'forward',
      throttle: 0.3,
      steer: 5,
    });
    expect(result.world.vehicle.rack).toBe(1);

    const reverseLock = hold(createWorld('debug-plane'), 8, {
      gear: 'forward',
      throttle: 0.3,
      steer: -5,
    });
    expect(reverseLock.world.vehicle.rack).toBe(-1);

    // And no front wheel ever exceeds the definition's max steer angle by more
    // than the Ackermann inner-wheel geometry allows.
    const inner = Math.atan(
      VEHICLE.wheelbase /
        (ackermannRearAxleRadius(VEHICLE.maxSteerAngle) - VEHICLE.trackFront / 2),
    );
    const angles = drive(createWorld('debug-plane'), [
      { seconds: 4, input: { gear: 'forward', throttle: 0.3, steer: 3 } },
      { seconds: 4, input: { gear: 'forward', throttle: 0.3, steer: -3 } },
    ]).history.flatMap((w) => [
      w.vehicle.wheels.frontLeft.steerAngle,
      w.vehicle.wheels.frontRight.steerAngle,
    ]);
    for (const a of angles) {
      expect(Math.abs(a)).toBeLessThanOrEqual(inner + 1e-9);
    }
  });
});
