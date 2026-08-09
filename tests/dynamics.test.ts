/**
 * The vehicle model: tyre forces, weight transfer, the RWD drivetrain, the
 * brakes, and above all the low-speed regime. Driven entirely through the core
 * seam (`createWorld` + `step`, via the shared drive helper) — nothing here
 * reaches inside the tyre model or the integrator, it only reads the state and
 * the events the game itself reads.
 *
 * Tolerances are in physical units: m, m/s, N, degrees.
 */

import { describe, expect, it } from 'vitest';
import { GRAVITY, VEHICLE, WHEEL_IDS, createWorld } from '../src/core/index';
import type { WheelId, WorldState } from '../src/core/index';
import { degrees, drive, hold, largestStep, track } from './helpers/drive';

const MU = VEHICLE.tyre.peakFrictionCoefficient;

/** Idle creep at full left lock — how a player actually crawls a car around. */
const CREEP_LEFT = { gear: 'forward' as const, steer: 1 };

describe('the crawl regime', () => {
  it('creeps along smoothly at part lock with no jitter in the pose', () => {
    const result = hold(createWorld('debug-plane'), 10, { gear: 'forward', steer: 0.6 });
    const v = result.world.vehicle;

    // A real crawl: a metre or two per second, not a lurch and not a stall.
    expect(Math.abs(v.longitudinalVelocity)).toBeGreaterThan(0.5);
    expect(Math.abs(v.longitudinalVelocity)).toBeLessThan(2.5);
    // Deep in the blend, so this is the regime the whole game happens in.
    expect(v.kinematicBlend).toBeGreaterThan(0.2);

    // Non-oscillating: the car never stops going forwards, and the yaw rate
    // never reverses, once it is under way.
    const settled = result.history.slice(240);
    for (const w of settled) {
      expect(w.vehicle.longitudinalVelocity).toBeGreaterThan(0);
      expect(w.vehicle.yawRate).toBeGreaterThan(0);
    }

    // Smooth: the yaw rate's curvature stays negligible tick to tick. Jitter
    // shows up here long before it is visible as anything else.
    const yawRates = track(settled, (w) => w.vehicle.yawRate);
    const curvature = secondDifferences(yawRates);
    expect(Math.max(...curvature.map(Math.abs))).toBeLessThan(1e-3);
  });

  it('traces a circle of a steady radius while creeping at full lock', () => {
    // Repeatability at crawl speed: successive laps must not drift outward,
    // which is what a jittering or wandering low-speed model does.
    const wound = hold(createWorld('debug-plane'), 6, CREEP_LEFT);
    const arc = hold(wound.world, 20, CREEP_LEFT);

    // Path curvature, not yaw rate: the creep speed still drifts a little, and
    // it is the RADIUS that must hold steady.
    const curvature = track(arc.history, (w) => w.vehicle.yawRate / w.vehicle.longitudinalVelocity);
    const predicted = Math.tan(VEHICLE.maxSteerAngle) / VEHICLE.wheelbase;
    for (const k of curvature) {
      // 1/R within 1% of the geometric prediction, every tick for 20 seconds.
      expect(Math.abs(k - predicted)).toBeLessThan(predicted * 0.01);
    }
    expect(Math.max(...curvature) - Math.min(...curvature)).toBeLessThan(predicted * 0.01);
  });

  it('has no discontinuity in yaw rate as the car accelerates through the blend', () => {
    // Accelerate from rest at part lock: the car passes right through the
    // kinematic-to-dynamic threshold during this run.
    const result = hold(createWorld('debug-plane'), 8, {
      gear: 'forward',
      throttle: 0.25,
      steer: 0.5,
    });

    const crossing = result.history.filter(
      (w) => w.vehicle.kinematicBlend > 0 && w.vehicle.kinematicBlend < 1,
    );
    // The run really does cross the threshold rather than staying one side of it.
    expect(crossing.length).toBeGreaterThan(60);
    expect(result.world.vehicle.kinematicBlend).toBe(0);
    expect(result.history[0]?.vehicle.kinematicBlend).toBeGreaterThan(0.9);

    // Across the whole crossing the yaw rate changes by no more than a smooth
    // ramp would: 0.01 rad/s per tick is 1.2 rad/s^2, and the manoeuvre's own
    // yaw acceleration is an order of magnitude below that.
    const yawRates = track(crossing, (w) => w.vehicle.yawRate);
    expect(largestStep(yawRates)).toBeLessThan(0.01);

    // And no single tick stands out from its neighbours — a step in the blend
    // would appear as one outsized jump, not as a raised average.
    const steps = firstDifferences(yawRates).map(Math.abs).sort((a, b) => a - b);
    const median = steps[Math.floor(steps.length / 2)] as number;
    expect(largestStep(yawRates)).toBeLessThan(median * 4);
  });
});

describe('the drivetrain', () => {
  it('creeps forward at idle in gear once the brake is released', () => {
    const braked = hold(createWorld('debug-plane'), 3, { gear: 'forward', brake: 1 });
    expect(braked.world.vehicle.pose.x).toBeCloseTo(0, 6);
    expect(braked.world.vehicle.longitudinalVelocity).toBe(0);

    // Same input minus the brake, no throttle at all: the car pulls away.
    const creeping = hold(braked.world, 4, { gear: 'forward' });
    expect(creeping.world.vehicle.longitudinalVelocity).toBeGreaterThan(0.5);
    expect(creeping.world.vehicle.pose.x).toBeGreaterThan(2);
    // Creep, not acceleration: it settles to a walking pace and stays there.
    expect(creeping.world.vehicle.longitudinalVelocity).toBeLessThan(2);
  });

  it('creeps backwards at idle in reverse', () => {
    const result = hold(createWorld('debug-plane'), 4, { gear: 'reverse' });
    expect(result.world.vehicle.longitudinalVelocity).toBeLessThan(-0.5);
    expect(result.world.vehicle.pose.x).toBeLessThan(-1);
  });

  it('drives from the rear wheels only', () => {
    const result = hold(createWorld('debug-plane'), 1.5, { gear: 'forward', throttle: 0.6 });
    const wheels = result.world.vehicle.wheels;

    expect(wheels.rearLeft.longitudinalForce).toBeGreaterThan(500);
    expect(wheels.rearRight.longitudinalForce).toBeGreaterThan(500);
    // The fronts are along for the ride: only rolling resistance acts on them,
    // which is a small NEGATIVE longitudinal force.
    expect(wheels.frontLeft.longitudinalForce).toBeLessThan(0);
    expect(Math.abs(wheels.frontLeft.longitudinalForce)).toBeLessThan(200);
  });

  it('splits drive torque equally between the rear wheels, as an open diff does', () => {
    const result = hold(createWorld('debug-plane'), 1.5, { gear: 'forward', throttle: 0.6 });
    const wheels = result.world.vehicle.wheels;
    expect(wheels.rearLeft.longitudinalForce).toBeCloseTo(wheels.rearRight.longitudinalForce, 6);
  });

  it('gears reverse lower than forward, so it is torquier and slower', () => {
    const forwards = hold(createWorld('debug-plane'), 12, { gear: 'forward', throttle: 1 });
    const backwards = hold(createWorld('debug-plane'), 12, { gear: 'reverse', throttle: 1 });
    expect(Math.abs(backwards.world.vehicle.longitudinalVelocity)).toBeLessThan(
      Math.abs(forwards.world.vehicle.longitudinalVelocity) - 1,
    );
  });
});

describe('the brakes', () => {
  it('stops the car and then holds it still', () => {
    const rolling = hold(createWorld('debug-plane'), 3, { gear: 'forward', throttle: 0.5 });
    expect(rolling.world.vehicle.longitudinalVelocity).toBeGreaterThan(1);

    const stopped = hold(rolling.world, 3, { gear: 'forward', brake: 1 });
    expect(stopped.world.vehicle.longitudinalVelocity).toBe(0);

    // Held: creep torque is still there in gear, and the brake still wins.
    const held = hold(stopped.world, 3, { gear: 'forward', brake: 1 });
    expect(Math.abs(held.world.vehicle.pose.x - stopped.world.vehicle.pose.x)).toBeLessThan(0.005);
  });

  it('brakes the front axle harder than the rear', () => {
    const rolling = hold(createWorld('debug-plane'), 3, { gear: 'forward', throttle: 0.5 });
    const braking = hold(rolling.world, 0.25, { gear: 'forward', brake: 0.5 });
    const wheels = braking.world.vehicle.wheels;

    expect(wheels.frontLeft.longitudinalForce).toBeLessThan(0);
    expect(wheels.rearLeft.longitudinalForce).toBeLessThan(0);
    expect(Math.abs(wheels.frontLeft.longitudinalForce)).toBeGreaterThan(
      Math.abs(wheels.rearLeft.longitudinalForce),
    );
  });

  it('holds the car with the handbrake, and holds it with the rears alone', () => {
    const rolling = hold(createWorld('debug-plane'), 3, { gear: 'forward', throttle: 0.4 });
    const secured = hold(rolling.world, 4, { gear: 'forward', handbrake: true });
    expect(secured.world.vehicle.longitudinalVelocity).toBe(0);

    const stillThere = hold(secured.world, 5, { gear: 'forward', handbrake: true });
    expect(Math.abs(stillThere.world.vehicle.pose.x - secured.world.vehicle.pose.x)).toBeLessThan(
      0.005,
    );

    // The handbrake acts on the rear wheels only: they are stopped, the fronts
    // are merely not being driven.
    expect(secured.world.vehicle.wheels.rearLeft.spinRate).toBe(0);
    expect(secured.world.vehicle.wheels.rearRight.spinRate).toBe(0);
  });

  it('never lets go once the car has stopped under the brakes', () => {
    const result = drive(createWorld('debug-plane'), [
      { seconds: 2, input: { gear: 'forward', throttle: 0.5 } },
      { seconds: 4, input: { gear: 'forward', brake: 1 } },
    ]);
    // No creeping back and forth on numerical dust: once stopped, stopped.
    const tail = result.history.slice(-240);
    for (const w of tail) expect(w.vehicle.longitudinalVelocity).toBe(0);
  });
});

describe('weight transfer', () => {
  it('always carries the car and nothing more', () => {
    const result = hold(createWorld('debug-plane'), 2, { gear: 'forward', throttle: 0.7 });
    for (const w of result.history) {
      const total = sumLoads(w);
      // Within 1 N of the car's weight: transfer moves load, it never adds any.
      expect(Math.abs(total - VEHICLE.mass * GRAVITY)).toBeLessThan(1);
    }
  });

  it('moves load rearward under acceleration and forward under braking', () => {
    const staticFront = VEHICLE.mass * GRAVITY * VEHICLE.frontWeightFraction;

    const accelerating = hold(createWorld('debug-plane'), 1.5, {
      gear: 'forward',
      throttle: 0.8,
    }).world.vehicle.wheels;
    expect(axleLoad(accelerating, 'front')).toBeLessThan(staticFront - 200);

    const rolling = hold(createWorld('debug-plane'), 3, { gear: 'forward', throttle: 0.6 });
    const braking = hold(rolling.world, 0.3, { gear: 'forward', brake: 1 }).world.vehicle.wheels;
    expect(axleLoad(braking, 'front')).toBeGreaterThan(staticFront + 200);
  });

  it('moves load onto the outside wheels through a turn', () => {
    // A brisk left-hander: load goes to the right-hand (outside) wheels.
    const wound = hold(createWorld('debug-plane'), 4, { gear: 'forward', throttle: 0.3, steer: 1 });
    const turning = hold(wound.world, 3, { gear: 'forward', throttle: 0.3, steer: 1 }).world.vehicle;
    expect(turning.lateralAcceleration).toBeGreaterThan(1);
    expect(turning.wheels.frontRight.load).toBeGreaterThan(turning.wheels.frontLeft.load + 200);
    expect(turning.wheels.rearRight.load).toBeGreaterThan(turning.wheels.rearLeft.load + 200);
  });
});

describe('grip limits', () => {
  it('produces measurable rear slip when the throttle is abused', () => {
    const gentle = hold(createWorld('debug-plane'), 2, { gear: 'forward', throttle: 0.1, steer: 1 });
    const abused = hold(createWorld('debug-plane'), 2, { gear: 'forward', throttle: 1, steer: 1 });

    expect(gentle.world.vehicle.wheels.rearLeft.slipRatio).toBeLessThan(0.1);
    // Wheelspin: the driven wheels are turning far faster than the road.
    expect(abused.world.vehicle.wheels.rearLeft.slipRatio).toBeGreaterThan(0.5);
    // And it is the DRIVEN wheels that slip, not the fronts.
    expect(abused.world.vehicle.wheels.frontLeft.slipRatio).toBeLessThan(0.1);
    // Spinning up means the tyre is past the peak of its curve: it is using
    // most of the grip available and delivering less than it would at the peak.
    expect(abused.world.vehicle.wheels.rearLeft.gripUtilisation).toBeGreaterThan(0.6);
    expect(abused.world.vehicle.wheels.rearLeft.gripUtilisation).toBeLessThan(1);
  });

  it('never lets a wheel exceed the friction circle', () => {
    const result = drive(createWorld('debug-plane'), [
      { seconds: 3, input: { gear: 'forward', throttle: 1, steer: 1 } },
      { seconds: 2, input: { gear: 'forward', brake: 1, steer: -1 } },
      { seconds: 3, input: { gear: 'reverse', throttle: 1, steer: 1 } },
    ]);

    for (const w of result.history) {
      for (const id of WHEEL_IDS) {
        const wheel = w.vehicle.wheels[id];
        const total = Math.hypot(wheel.longitudinalForce, wheel.lateralForce);
        // The whole point: drive and cornering draw on ONE budget.
        expect(total).toBeLessThanOrEqual(MU * wheel.load + 1e-6);
      }
    }
  });

  it('trades cornering force away for drive force at the same steering angle', () => {
    // Same rack, same speed band, different throttle: the wheel that is being
    // asked for drive has less left over to corner with.
    const wound = hold(createWorld('debug-plane'), 4, { gear: 'forward', throttle: 0.3, steer: 1 });
    const coasting = hold(wound.world, 0.5, { gear: 'forward', steer: 1 }).world.vehicle;
    const driving = hold(wound.world, 0.5, { gear: 'forward', throttle: 1, steer: 1 }).world.vehicle;

    const rearDrive = driving.wheels.rearLeft;
    const rearCoast = coasting.wheels.rearLeft;
    expect(rearDrive.longitudinalForce).toBeGreaterThan(rearCoast.longitudinalForce + 1000);
    expect(Math.abs(rearDrive.lateralForce)).toBeLessThan(Math.abs(rearCoast.lateralForce));
  });
});

describe('reversing', () => {
  it('yaws the car the opposite way for the same steering lock', () => {
    const forwards = hold(createWorld('debug-plane'), 4, { gear: 'forward', steer: 1 });
    const backwards = hold(createWorld('debug-plane'), 4, { gear: 'reverse', steer: 1 });

    // Full left lock: forwards the nose swings left, reversing it swings right.
    expect(forwards.world.vehicle.yawRate).toBeGreaterThan(0.05);
    expect(backwards.world.vehicle.yawRate).toBeLessThan(-0.05);
    expect(degrees(forwards.world.vehicle.pose.yaw)).toBeGreaterThan(5);
    expect(degrees(backwards.world.vehicle.pose.yaw)).toBeLessThan(-5);
  });

  it('pivots about the rear axle in both directions', () => {
    // Reversing, the rear axle still leads the geometry: the front of the car
    // swings much further than the back.
    const result = hold(createWorld('debug-plane'), 5, { gear: 'reverse', steer: 1 });
    const start = createWorld('debug-plane').vehicle.wheels;
    const end = result.world.vehicle.wheels;
    const frontTravel = Math.hypot(
      end.frontLeft.position.x - start.frontLeft.position.x,
      end.frontLeft.position.y - start.frontLeft.position.y,
    );
    const rearTravel = Math.hypot(
      end.rearLeft.position.x - start.rearLeft.position.x,
      end.rearLeft.position.y - start.rearLeft.position.y,
    );
    expect(frontTravel).toBeGreaterThan(rearTravel);
  });
});

describe('cosmetic body attitude', () => {
  it('pitches nose-up under acceleration and nose-down under braking', () => {
    const accelerating = hold(createWorld('debug-plane'), 1.5, { gear: 'forward', throttle: 1 });
    expect(accelerating.world.vehicle.pitch).toBeGreaterThan(0.001);

    const braking = hold(accelerating.world, 0.4, { gear: 'forward', brake: 1 });
    expect(braking.world.vehicle.pitch).toBeLessThan(-0.001);
  });

  it('rolls away from a turn', () => {
    const wound = hold(createWorld('debug-plane'), 4, { gear: 'forward', throttle: 0.3, steer: 1 });
    const left = hold(wound.world, 2, { gear: 'forward', throttle: 0.3, steer: 1 }).world.vehicle;
    // Turning left leans the body onto its right-hand side: roll is negative.
    expect(left.roll).toBeLessThan(-0.002);
  });

  it('stays cosmetic: attitude is small and never becomes a degree of freedom', () => {
    const result = drive(createWorld('debug-plane'), [
      { seconds: 3, input: { gear: 'forward', throttle: 1, steer: 1 } },
      { seconds: 2, input: { gear: 'forward', brake: 1, steer: -1 } },
    ]);
    for (const w of result.history) {
      // A few degrees of lean at most — and nothing in the solve reads it back,
      // so it cannot integrate away anywhere.
      expect(Math.abs(degrees(w.vehicle.pitch))).toBeLessThan(4);
      expect(Math.abs(degrees(w.vehicle.roll))).toBeLessThan(4);
    }
  });
});

function sumLoads(world: WorldState): number {
  return WHEEL_IDS.reduce((total, id) => total + world.vehicle.wheels[id].load, 0);
}

function axleLoad(
  wheels: WorldState['vehicle']['wheels'],
  axle: 'front' | 'rear',
): number {
  const ids: readonly WheelId[] =
    axle === 'front' ? ['frontLeft', 'frontRight'] : ['rearLeft', 'rearRight'];
  return ids.reduce((total, id) => total + wheels[id].load, 0);
}

function firstDifferences(values: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < values.length; i++) {
    out.push((values[i] as number) - (values[i - 1] as number));
  }
  return out;
}

function secondDifferences(values: readonly number[]): number[] {
  return firstDifferences(firstDifferences(values));
}
