/**
 * The sun's shadow camera, tested where it is pure maths.
 *
 * How the shadow LOOKS is verified by eye, like the rest of the rendering. What
 * is tested here is what the look depends on: that the light direction is a unit
 * vector, that the depth camera actually covers the ground around the car and
 * puts what is near the car near the middle of the map, that a point on the
 * ground and the point above it project to the same texel (so a caster really
 * covers its own shadow), and that the projection is snapped to whole texels so
 * shadow edges do not crawl while the car creeps.
 */

import { describe, expect, it } from 'vitest';
import {
  SHADOW_EXTENT_METRES,
  SUN_DIRECTION,
  shadowTexelMetres,
  shadowViewProjection,
} from '../src/render/shadow';
import type { Mat4 } from '../src/render/mat4';

/** Project a world point through a view-projection into normalised device coords. */
function project(m: Mat4, p: { x: number; y: number; z: number }) {
  const x = (m[0] as number) * p.x + (m[4] as number) * p.y + (m[8] as number) * p.z + (m[12] as number);
  const y = (m[1] as number) * p.x + (m[5] as number) * p.y + (m[9] as number) * p.z + (m[13] as number);
  const z = (m[2] as number) * p.x + (m[6] as number) * p.y + (m[10] as number) * p.z + (m[14] as number);
  const w = (m[3] as number) * p.x + (m[7] as number) * p.y + (m[11] as number) * p.z + (m[15] as number);
  return { x: x / w, y: y / w, z: z / w };
}

describe('the sun', () => {
  it('is a unit direction pointing up out of the ground', () => {
    expect(Math.hypot(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z)).toBeCloseTo(1, 6);
    expect(SUN_DIRECTION.z).toBeGreaterThan(0);
  });
});

describe('the shadow camera', () => {
  it('puts the ground under the car in the middle of the map', () => {
    const centre = { x: 7, y: -3 };
    const ndc = project(shadowViewProjection(centre), { x: centre.x, y: centre.y, z: 0 });
    // Within a texel or two of dead centre — the snap moves it, nothing else does.
    const slack = (4 * shadowTexelMetres()) / SHADOW_EXTENT_METRES;
    expect(Math.abs(ndc.x)).toBeLessThan(slack);
    expect(Math.abs(ndc.y)).toBeLessThan(slack);
    expect(ndc.z).toBeGreaterThan(-1);
    expect(ndc.z).toBeLessThan(1);
  });

  it('covers the ground a manoeuvre happens on, and no more', () => {
    const vp = shadowViewProjection({ x: 0, y: 0 });
    // A car length or two out in any direction is still inside the map...
    for (const p of [
      { x: 5, y: 0, z: 0 },
      { x: -5, y: 0, z: 0 },
      { x: 0, y: 5, z: 0 },
      { x: 0, y: -5, z: 0 },
    ]) {
      const ndc = project(vp, p);
      expect(Math.abs(ndc.x)).toBeLessThan(1);
      expect(Math.abs(ndc.y)).toBeLessThan(1);
    }
    // ...and the far end of the car park is outside it, where the shader treats
    // points as fully lit rather than stretching the map to reach them.
    const far = project(vp, { x: 60, y: 40, z: 0 });
    expect(Math.max(Math.abs(far.x), Math.abs(far.y))).toBeGreaterThan(1);
  });

  it('projects a caster onto the ground it shades, along the light', () => {
    const vp = shadowViewProjection({ x: 0, y: 0 });
    const height = 1.4;
    // The point of the sky the light comes from, mapped down to the ground: a
    // roof at `height` shades the spot the light would have carried on to.
    const roof = { x: 1, y: 2, z: height };
    const shaded = {
      x: roof.x - (SUN_DIRECTION.x / SUN_DIRECTION.z) * height,
      y: roof.y - (SUN_DIRECTION.y / SUN_DIRECTION.z) * height,
      z: 0,
    };
    const a = project(vp, roof);
    const b = project(vp, shaded);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
    // The roof is nearer the sun, so it wins the depth comparison.
    expect(a.z).toBeLessThan(b.z);
  });

  it('holds the texel grid still while the car creeps', () => {
    // A tenth of a texel of movement must not shift the grid at all, or every
    // shadow edge in the scene shimmers at parking speeds.
    const texel = shadowTexelMetres();
    const probe = { x: 2, y: 1, z: 0.5 };
    const still = project(shadowViewProjection({ x: 0, y: 0 }), probe);
    const crept = project(shadowViewProjection({ x: texel / 10, y: 0 }), probe);
    // The sampling plane is what must not move; depth along the light may.
    expect(crept.x).toBe(still.x);
    expect(crept.y).toBe(still.y);

    // Several texels of movement does move it — the map follows the car.
    const moved = project(shadowViewProjection({ x: 4 * texel, y: 4 * texel }), probe);
    expect(moved.x).not.toBe(still.x);
  });
});
