/**
 * Scenario tests go through the core's public surface only: `createWorld` and
 * `resetWorld`. A scenario is DATA, so these tests read like a description of
 * the car park the player is dropped into — two parked cars, a kerb of a stated
 * height, a marked bay, and a consistent approach pose.
 */

import { describe, expect, it } from 'vitest';
import type { Obstacle } from '../src/core/index';
import {
  PARALLEL_PARK_PARAMETERS,
  SCENARIO_IDS,
  createWorld,
  resetWorld,
  scenarioTemplate,
  vehicleLength,
  VEHICLE,
} from '../src/core/index';
import { degrees, hold } from './helpers/drive';

function obstaclesOfKind(obstacles: readonly Obstacle[], kind: Obstacle['kind']): Obstacle[] {
  return obstacles.filter((o) => o.kind === kind);
}

describe('scenario data model', () => {
  it('lists the parallel park scenario', () => {
    expect(SCENARIO_IDS).toContain('parallel-park');
  });

  it('declares its tunable parameters with defaults and ranges as data', () => {
    const template = scenarioTemplate('parallel-park');
    for (const name of ['gapLength', 'bayWidth', 'kerbHeight']) {
      const spec = template.parameters[name];
      expect(spec, `parameter ${name}`).toBeDefined();
      if (!spec) continue;
      expect(spec.min).toBeLessThan(spec.default);
      expect(spec.max).toBeGreaterThan(spec.default);
    }
  });

  it('states difficulty and pass criteria before the attempt starts', () => {
    const template = scenarioTemplate('parallel-park');
    expect(template.difficulty).toBe('hard');
    expect(template.summary.length).toBeGreaterThan(0);
    expect(template.passSummary.length).toBeGreaterThan(0);
    expect(template.pass.fullyInsideBay).toBe(true);
  });

  it('keeps scoring tolerances in the scenario data, not in logic', () => {
    const { scenario } = createWorld('parallel-park');
    const ids = scenario.criteria.map((c) => c.criterion);
    expect(ids).toContain('centring');
    expect(ids).toContain('alignment');
    expect(ids).toContain('kerbDistance');
    expect(ids).toContain('foreAft');
    for (const criterion of scenario.criteria) {
      expect(criterion.tolerance, criterion.criterion).toBeGreaterThan(0);
      expect(criterion.weight, criterion.criterion).toBeGreaterThan(0);
    }
    // Weights are a partition of the score, which is what lets ticket 09 sum a
    // breakdown that matches the total.
    const total = scenario.criteria.reduce((sum, c) => sum + c.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });
});

describe('createWorld for the parallel park scenario', () => {
  it('produces the expected spawn pose: alongside the front parked car, out in the lane', () => {
    const world = createWorld('parallel-park');
    const gap = PARALLEL_PARK_PARAMETERS.gapLength;
    const front = world.scenario.obstacles.find((o) => o.id === 'parked-car-front');

    expect(world.scenario.spawn).toEqual(world.vehicle.pose);
    expect(world.vehicle.pose.x).toBeCloseTo(gap / 2 + vehicleLength() / 2, 6);
    expect(degrees(world.vehicle.pose.yaw)).toBeCloseTo(0, 6);
    // Out in the lane: clear of the parked cars by at least half a metre.
    expect(front).toBeDefined();
    if (front) {
      const clearance =
        world.vehicle.pose.y - VEHICLE.bodyWidth / 2 - (front.centre.y + front.halfWidth);
      expect(clearance).toBeGreaterThan(0.5);
      // Level with the front car, so every attempt starts from the same view.
      expect(world.vehicle.pose.x).toBeCloseTo(front.centre.x, 6);
    }
    // Wheels are placed for the spawn pose, not left at the origin.
    expect(world.vehicle.wheels.rearLeft.position.x).toBeCloseTo(
      world.vehicle.pose.x - VEHICLE.wheelbase / 2,
      6,
    );
  });

  it('produces the expected obstacle set: two parked cars either side of the gap, walls and a bollard', () => {
    const { scenario } = createWorld('parallel-park');
    const cars = obstaclesOfKind(scenario.obstacles, 'parked-car');
    expect(cars).toHaveLength(2);
    expect(obstaclesOfKind(scenario.obstacles, 'wall').length).toBeGreaterThanOrEqual(1);
    expect(obstaclesOfKind(scenario.obstacles, 'bollard').length).toBeGreaterThanOrEqual(1);

    // The two cars straddle x = 0 and leave exactly the gap between them.
    const [a, b] = [...cars].sort((p, q) => p.centre.x - q.centre.x) as [Obstacle, Obstacle];
    const innerGap = b.centre.x - b.halfLength - (a.centre.x + a.halfLength);
    expect(innerGap).toBeCloseTo(PARALLEL_PARK_PARAMETERS.gapLength, 6);
    // Both parked square to the kerb, and each is a car's worth of metal.
    for (const car of cars) {
      expect(degrees(car.yaw)).toBeCloseTo(0, 6);
      expect(car.halfLength * 2).toBeCloseTo(vehicleLength(), 6);
      expect(car.centre.y).toBeGreaterThan(0);
    }
  });

  it('has a kerb with a stated height running along the bay', () => {
    const { scenario } = createWorld('parallel-park');
    expect(scenario.kerb).not.toBeNull();
    if (!scenario.kerb) return;
    expect(scenario.kerb.height).toBeCloseTo(PARALLEL_PARK_PARAMETERS.kerbHeight, 6);
    expect(scenario.kerb.polyline.length).toBeGreaterThanOrEqual(2);
    // The kerb line is the bay's y = 0 edge, so kerb distance and bay centring
    // are measured against the same geometry.
    for (const point of scenario.kerb.polyline) expect(point.y).toBeCloseTo(0, 6);
  });

  it('marks a parallel bay that the car actually fits in', () => {
    const { scenario } = createWorld('parallel-park');
    expect(scenario.bay).not.toBeNull();
    if (!scenario.bay) return;
    expect(scenario.bay.type).toBe('parallel');
    expect(scenario.bay.polygon).toHaveLength(4);
    expect(scenario.bay.length).toBeCloseTo(PARALLEL_PARK_PARAMETERS.gapLength, 6);
    expect(scenario.bay.width).toBeCloseTo(PARALLEL_PARK_PARAMETERS.bayWidth, 6);
    expect(scenario.bay.length).toBeGreaterThan(vehicleLength());
    expect(scenario.bay.width).toBeGreaterThan(VEHICLE.bodyWidth);
    expect(scenario.bay.centre.x).toBeCloseTo(0, 6);
    expect(degrees(scenario.bay.axisYaw)).toBeCloseTo(0, 6);
  });
});

describe('tunable parameters', () => {
  it('a longer gap moves the parked cars apart and lengthens the bay, with no new code path', () => {
    const tight = createWorld('parallel-park', { parameters: { gapLength: 5.4 } });
    const roomy = createWorld('parallel-park', { parameters: { gapLength: 8.5 } });

    expect(tight.scenario.bay?.length).toBeCloseTo(5.4, 6);
    expect(roomy.scenario.bay?.length).toBeCloseTo(8.5, 6);
    const carX = (w: typeof tight, id: string): number =>
      w.scenario.obstacles.find((o) => o.id === id)?.centre.x ?? NaN;
    expect(carX(roomy, 'parked-car-front')).toBeGreaterThan(carX(tight, 'parked-car-front'));
    expect(carX(roomy, 'parked-car-rear')).toBeLessThan(carX(tight, 'parked-car-rear'));
    // The approach pose stays relative to the layout, so attempts at one gap
    // size remain comparable with each other.
    expect(roomy.vehicle.pose.x).toBeGreaterThan(tight.vehicle.pose.x);
  });

  it('a wider bay widens the bay only', () => {
    const wide = createWorld('parallel-park', { parameters: { bayWidth: 3.0 } });
    expect(wide.scenario.bay?.width).toBeCloseTo(3.0, 6);
    expect(wide.scenario.bay?.length).toBeCloseTo(PARALLEL_PARK_PARAMETERS.gapLength, 6);
  });

  it('a higher kerb is data too', () => {
    const high = createWorld('parallel-park', { parameters: { kerbHeight: 0.18 } });
    expect(high.scenario.kerb?.height).toBeCloseTo(0.18, 6);
  });

  it('clamps a parameter to its declared range rather than building a broken world', () => {
    const world = createWorld('parallel-park', { parameters: { gapLength: 100 } });
    const spec = scenarioTemplate('parallel-park').parameters.gapLength;
    expect(world.scenario.parameters.gapLength).toBe(spec?.max);
  });
});

describe('instant restart', () => {
  it('returns the world to its exact initial state', () => {
    const initial = createWorld('parallel-park');
    const driven = hold(initial, 3, { gear: 'reverse', throttle: 0.4, steer: -1 }).world;
    expect(driven.vehicle.pose.x).not.toBe(initial.vehicle.pose.x);

    const restarted = resetWorld(driven);
    expect(JSON.stringify(restarted)).toBe(JSON.stringify(initial));
  });

  it('preserves the tuned parameters and the seed across a restart', () => {
    const initial = createWorld('parallel-park', {
      seed: 7,
      parameters: { gapLength: 5.6, kerbHeight: 0.17 },
    });
    const driven = hold(initial, 1, { gear: 'forward', throttle: 0.3 }).world;
    const restarted = resetWorld(driven);

    expect(restarted.seed).toBe(7);
    expect(restarted.scenario.parameters.gapLength).toBeCloseTo(5.6, 6);
    expect(JSON.stringify(restarted)).toBe(JSON.stringify(initial));
  });

  it('keeps a spawn override across a restart', () => {
    const spawn = { x: 3, y: -2, yaw: 0.4 };
    const initial = createWorld('parallel-park', { spawn });
    const restarted = resetWorld(hold(initial, 1, { gear: 'forward', throttle: 0.3 }).world);
    expect(restarted.vehicle.pose).toEqual(spawn);
    expect(JSON.stringify(restarted)).toBe(JSON.stringify(initial));
  });
});
