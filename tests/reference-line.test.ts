/**
 * The reference line: the "clean path" the replay can overlay on the player's own
 * trace. It is data derived from the scenario alone (spawn pose in, parked pose
 * out), so it is pure core and tested here rather than by eye — what is verified
 * by eye is only how it is DRAWN.
 *
 * The load-bearing property is the last one: a reference line the car could not
 * physically follow would be worse than no guidance at all, so it is never tighter
 * than the vehicle's own minimum turning circle.
 */

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/core/index';
import {
  VEHICLE,
  bodyCentre,
  createWorld,
  referenceLine,
  referencePath,
  turnRadius,
} from '../src/core/index';

const scenario = createWorld('parallel-park').scenario;

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Direction of the last segment, as an undirected line angle in degrees. */
function segmentAngleDegrees(a: Vec2, b: Vec2): number {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  return (((angle * 180) / Math.PI) % 180 + 180) % 180;
}

describe('reference line', () => {
  it('runs from the scenario spawn to the middle of the bay', () => {
    const line = referenceLine(scenario);
    expect(line.length).toBeGreaterThan(8);
    const bay = scenario.bay;
    if (!bay) throw new Error('parallel-park has a bay');
    expect(distance(line[0] as Vec2, bodyCentre(scenario.spawn))).toBeLessThan(0.05);
    expect(distance(line[line.length - 1] as Vec2, bay.centre)).toBeLessThan(0.05);
  });

  it('finishes parallel to the bay axis, so it ends the way a parked car sits', () => {
    const path = referencePath(scenario);
    const bay = scenario.bay;
    if (!bay) throw new Error('parallel-park has a bay');
    const last = path[path.length - 1];
    if (!last) throw new Error('non-empty path');
    const axis = (((bay.axisYaw * 180) / Math.PI) % 180 + 180) % 180;
    expect(Math.abs(((last.pose.yaw * 180) / Math.PI) - (bay.axisYaw * 180) / Math.PI)).toBeLessThan(
      2,
    );
    const line = referenceLine(scenario);
    const tangent = segmentAngleDegrees(line[line.length - 2] as Vec2, line[line.length - 1] as Vec2);
    expect(Math.abs(tangent - axis)).toBeLessThan(8);
  });

  it('is never tighter than the car can actually turn at full lock', () => {
    const line = referenceLine(scenario);
    const minRadius = turnRadius(1, VEHICLE);
    for (let i = 1; i < line.length - 1; i++) {
      const radius = circumRadius(line[i - 1] as Vec2, line[i] as Vec2, line[i + 1] as Vec2);
      // 2% slack: the path is sampled, and discrete curvature over samples is
      // slightly pessimistic at the tightest point.
      expect(radius).toBeGreaterThan(minRadius * 0.98);
    }
  });

  it('has no reference line for a scenario with no bay', () => {
    expect(referenceLine(createWorld('debug-plane').scenario)).toEqual([]);
  });

  it('is pure: the same scenario gives the same line', () => {
    expect(referenceLine(scenario)).toEqual(referenceLine(scenario));
  });
});

/** Radius of the circle through three points; Infinity when they are collinear. */
function circumRadius(a: Vec2, b: Vec2, c: Vec2): number {
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ca = distance(c, a);
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  if (area < 1e-12) return Infinity;
  return (ab * bc * ca) / (4 * area);
}
