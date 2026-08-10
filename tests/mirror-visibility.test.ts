/**
 * Can the driver actually SEE the mirrors?
 *
 * `mirrors.test.ts` asks what each mirror shows. This asks the question that
 * comes first and had gone unasked: whether the glass is in front of the driver's
 * eyes at all. The wing mirrors were once mounted ahead of the windscreen base,
 * where the sight line from the eye ran straight through the A-pillar box — a
 * geometrically immaculate mirror that was, from the seat, a piece of trim.
 *
 * So this ray-casts the eye-to-glass sight line against the cockpit shell (the
 * same boxes the renderer draws, from the same vehicle definition) and checks the
 * glass is within the head's look range. Both are what "usable" means, and both
 * are properties of numbers in `vehicle.ts` and `cockpit.ts` that nothing else
 * would catch if they drifted apart again.
 */

import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../src/core/index';
import { VEHICLE, createWorld } from '../src/core/index';
import { LOOK_LIMITS } from '../src/render/camera';
import type { CockpitPiece } from '../src/render/cockpit';
import { cockpitShell } from '../src/render/cockpit';
import { MIRROR_IDS, mirrorCorners } from '../src/render/mirror';

const EYE = VEHICLE.driverEyePoint;

/**
 * Whether the segment from the eye to `target` passes through a cockpit piece.
 * Slab test in the piece's own frame, which is the box's frame rotated by its
 * slant about +y — the A-pillars are the only slanted pieces and the only ones
 * this was ever going to catch.
 */
function occluded(piece: CockpitPiece, target: Vec3): boolean {
  const toLocal = (p: Vec3): Vec3 => {
    const dx = p.x - piece.centre.x;
    const dy = p.y - piece.centre.y;
    const dz = p.z - piece.centre.z;
    // Undo a rotation about +y that takes local +x to (cos, 0, -sin).
    const cos = Math.cos(piece.slant);
    const sin = Math.sin(piece.slant);
    return { x: dx * cos - dz * sin, y: dy, z: dx * sin + dz * cos };
  };

  const from = toLocal(EYE);
  const to = toLocal(target);
  const half = piece.half;

  let enter = 0;
  let exit = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const start = from[axis];
    const delta = to[axis] - start;
    const limit = half[axis];
    if (Math.abs(delta) < 1e-9) {
      if (Math.abs(start) > limit) return false;
      continue;
    }
    const t1 = (-limit - start) / delta;
    const t2 = (limit - start) / delta;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter > exit) return false;
  }
  // A sliver of overlap at the very end of the segment is the glass touching its
  // own housing, not the pillar standing in the way.
  return exit - enter > 0.01;
}

/** Body-relative yaw and pitch the driver must turn their head to, in radians. */
function headAngles(target: Vec3): { yaw: number; pitch: number } {
  const dx = target.x - EYE.x;
  const dy = target.y - EYE.y;
  const dz = target.z - EYE.z;
  return { yaw: Math.atan2(dy, dx), pitch: Math.atan2(dz, Math.hypot(dx, dy)) };
}

describe('every mirror is visible from the driver’s seat', () => {
  const shell = cockpitShell(VEHICLE);
  const vehicle = createWorld('debug-plane').vehicle;

  for (const id of MIRROR_IDS) {
    it(`gives the ${id} mirror a clear sight line past the cockpit`, () => {
      // The centre AND the corners: a mirror whose bottom half is behind the door
      // sill is half a mirror.
      const glass = VEHICLE.mirrors[id].mount;
      const points: Vec3[] = [glass, ...mirrorCorners(id)];
      for (const point of points) {
        const blocking = shell
          .filter((piece) => occluded(piece, point))
          .map((piece) => `box at ${JSON.stringify(piece.centre)} half ${JSON.stringify(piece.half)}`);
        expect(blocking).toEqual([]);
      }
      expect(vehicle.pose.yaw).toBe(0); // the shell is vehicle-local; so is this
    });

    it(`puts the ${id} mirror within reach of the driver’s head`, () => {
      const angles = headAngles(VEHICLE.mirrors[id].mount);
      expect(Math.abs(angles.yaw)).toBeLessThan(LOOK_LIMITS.maxYaw);
      expect(Math.abs(angles.pitch)).toBeLessThan(LOOK_LIMITS.maxPitch);
    });
  }

  it('keeps the wing mirrors a glance away rather than dead ahead', () => {
    // They should need a look, but a look a seated driver makes without thinking:
    // the door mirror is not a shoulder check.
    for (const id of ['wingLeft', 'wingRight'] as const) {
      const yaw = Math.abs(headAngles(VEHICLE.mirrors[id].mount).yaw);
      expect(yaw).toBeGreaterThan((20 * Math.PI) / 180);
      expect(yaw).toBeLessThan((90 * Math.PI) / 180);
    }
  });
});
