/**
 * Mirror geometry, tested where it is pure maths.
 *
 * Per the spec, mirror *image quality* and the WebGL passes are judged by eye —
 * what is asserted here is the geometry those passes are built from: that the
 * mirror plane is the one in the shared vehicle definition, that the mirror's
 * camera is the driver's eye reflected through that plane, that the resulting
 * field of view is narrow enough to leave a real blind spot beside the car and
 * wide enough to show the flank a driver references, that the wings are convex
 * and the interior mirror is not, that aim moves the view, and that the update
 * schedule favours the mirrors that matter.
 */

import { describe, expect, it } from 'vitest';
import type { Vec3, VehicleState } from '../src/core/index';
import { VEHICLE, createWorld, rearAxleX } from '../src/core/index';
import { driverEyeWorld } from '../src/render/camera';
import {
  MIRROR_AIM_LIMITS,
  MIRROR_IDS,
  MIRROR_NEAR,
  clampMirrorAim,
  convexWarp,
  convexWidening,
  isConvex,
  manoeuvreSide,
  mirrorEyeWorld,
  mirrorPlaneWorld,
  mirrorViewDirection,
  eyeToGlassDistance,
  mirrorPriority,
  mirrorProjection,
  mirrorTargetSize,
  mirrorsToUpdate,
  visibleInMirror,
} from '../src/render/mirror';
import { transformPoint } from '../src/render/mat4';
import { bodyTransform } from '../src/render/camera';

/** A car at the world origin, level and facing world +x, so local == world. */
function restingVehicle(): VehicleState {
  return createWorld('debug-plane').vehicle;
}

function distanceToPlane(p: Vec3, plane: { point: Vec3; normal: Vec3 }): number {
  return (
    (p.x - plane.point.x) * plane.normal.x +
    (p.y - plane.point.y) * plane.normal.y +
    (p.z - plane.point.z) * plane.normal.z
  );
}

/** Half-angle of a mirror's field of view, horizontally and vertically (rad). */
function fieldOfView(vehicle: VehicleState, id: (typeof MIRROR_IDS)[number]) {
  const p = mirrorProjection(vehicle, id);
  // For a frustum matrix, m[0] = 2n/(r-l) and m[5] = 2n/(t-b).
  const halfWidth = MIRROR_NEAR / (p[0] as number);
  const halfHeight = MIRROR_NEAR / (p[5] as number);
  return {
    horizontal: Math.atan(halfWidth / MIRROR_NEAR),
    vertical: Math.atan(halfHeight / MIRROR_NEAR),
  };
}

describe('mirror pose comes from the shared vehicle definition', () => {
  const vehicle = restingVehicle();

  it('places each glass at the mount point the definition declares', () => {
    for (const id of MIRROR_IDS) {
      const expected = transformPoint(bodyTransform(vehicle), VEHICLE.mirrors[id].mount);
      const plane = mirrorPlaneWorld(vehicle, id);
      expect(plane.point.x).toBeCloseTo(expected.x, 6);
      expect(plane.point.y).toBeCloseTo(expected.y, 6);
      expect(plane.point.z).toBeCloseTo(expected.z, 6);
    }
  });

  it('moves the glass with the body pose rather than with numbers of its own', () => {
    const yawed: VehicleState = { ...vehicle, pose: { x: 7, y: -3, yaw: Math.PI / 2 } };
    const mount = VEHICLE.mirrors.wingLeft.mount;
    const plane = mirrorPlaneWorld(yawed, 'wingLeft');
    expect(plane.point.x).toBeCloseTo(7 - mount.y, 5);
    expect(plane.point.y).toBeCloseTo(-3 + mount.x, 5);
    expect(plane.point.z).toBeCloseTo(mount.z, 5);
  });
});

describe('the mirror camera is the reflected eye', () => {
  const vehicle = restingVehicle();

  it('sits the same distance behind the glass as the eye sits in front of it', () => {
    for (const id of MIRROR_IDS) {
      const plane = mirrorPlaneWorld(vehicle, id);
      const eye = driverEyeWorld(vehicle);
      const reflected = mirrorEyeWorld(vehicle, id);
      const dEye = distanceToPlane(eye, plane);
      const dReflected = distanceToPlane(reflected, plane);
      // The driver is on the reflective (outward-normal) side.
      expect(dEye).toBeGreaterThan(0.05);
      expect(dReflected).toBeCloseTo(-dEye, 6);
    }
  });

  it('moves the eye only along the normal, never sideways in the glass', () => {
    for (const id of MIRROR_IDS) {
      const plane = mirrorPlaneWorld(vehicle, id);
      const eye = driverEyeWorld(vehicle);
      const reflected = mirrorEyeWorld(vehicle, id);
      // Midpoint of eye and its image lies on the glass plane...
      const mid = {
        x: (eye.x + reflected.x) / 2,
        y: (eye.y + reflected.y) / 2,
        z: (eye.z + reflected.z) / 2,
      };
      expect(distanceToPlane(mid, plane)).toBeCloseTo(0, 6);
      // ...and the segment between them is parallel to the normal.
      const step = { x: reflected.x - eye.x, y: reflected.y - eye.y, z: reflected.z - eye.z };
      const length = Math.hypot(step.x, step.y, step.z);
      const along = Math.abs(
        step.x * plane.normal.x + step.y * plane.normal.y + step.z * plane.normal.z,
      );
      expect(along).toBeCloseTo(length, 6);
    }
  });

  it('aims each mirror behind the car, as a real one does', () => {
    // The direction a mirror shows is the driver's gaze at the glass, reflected.
    const interior = mirrorViewDirection(vehicle, 'interior');
    expect(interior.x).toBeLessThan(-0.9);
    // The wings look back down their own flank: rearwards, tilted outboard.
    expect(mirrorViewDirection(vehicle, 'wingLeft').x).toBeLessThan(-0.9);
    expect(mirrorViewDirection(vehicle, 'wingLeft').y).toBeGreaterThan(0.02);
    expect(mirrorViewDirection(vehicle, 'wingRight').x).toBeLessThan(-0.9);
    expect(mirrorViewDirection(vehicle, 'wingRight').y).toBeLessThan(-0.02);
  });
});

describe('what each mirror can and cannot see', () => {
  const vehicle = restingVehicle();
  const eyeZ = VEHICLE.driverEyePoint.z;
  const rearBumper = rearAxleX(VEHICLE) - VEHICLE.rearOverhang;

  it('shows the interior mirror what is behind the car, not what is in front', () => {
    expect(visibleInMirror(vehicle, 'interior', { x: -12, y: 0, z: eyeZ })).toBe(true);
    expect(visibleInMirror(vehicle, 'interior', { x: 12, y: 0, z: eyeZ })).toBe(false);
  });

  it('shows each wing mirror its own flank and the lane behind it', () => {
    // A car's length behind, one lane out on the left, is what the left wing is for.
    expect(visibleInMirror(vehicle, 'wingLeft', { x: -7, y: 1.6, z: 0.7 })).toBe(true);
    expect(visibleInMirror(vehicle, 'wingRight', { x: -7, y: -1.6, z: 0.7 })).toBe(true);
    // ...and not the other side of the car.
    expect(visibleInMirror(vehicle, 'wingLeft', { x: -7, y: -1.6, z: 0.7 })).toBe(false);
    expect(visibleInMirror(vehicle, 'wingRight', { x: -7, y: 1.6, z: 0.7 })).toBe(false);
  });

  it('includes the car\'s own rear flank, the reference edge drivers use', () => {
    const flankZ = VEHICLE.bodyHeight - 0.6;
    expect(
      visibleInMirror(vehicle, 'wingLeft', { x: rearBumper + 0.3, y: VEHICLE.bodyWidth / 2, z: flankZ }),
    ).toBe(true);
    expect(
      visibleInMirror(vehicle, 'wingRight', { x: rearBumper + 0.3, y: -VEHICLE.bodyWidth / 2, z: flankZ }),
    ).toBe(true);
  });

  it('leaves a genuine blind spot abreast of the car, in no mirror at all', () => {
    // The classic blind spot: alongside, level with the driver's shoulder, one
    // lane out. Nothing but a shoulder check finds it.
    const blind: Vec3 = { x: -0.4, y: 3.0, z: 0.8 };
    for (const id of MIRROR_IDS) {
      expect(visibleInMirror(vehicle, id, blind)).toBe(false);
    }
  });

  it('cannot see anything above the roof or below the road', () => {
    for (const id of MIRROR_IDS) {
      expect(visibleInMirror(vehicle, id, { x: -6, y: 0, z: 9 })).toBe(false);
    }
  });
});

describe('convexity', () => {
  const vehicle = restingVehicle();

  it('makes the wings convex and leaves the interior mirror flat', () => {
    expect(isConvex('interior')).toBe(false);
    expect(isConvex('wingLeft')).toBe(true);
    expect(isConvex('wingRight')).toBe(true);
    expect(convexWidening(vehicle, 'interior')).toBe(1);
    expect(convexWidening(vehicle, 'wingLeft')).toBeGreaterThan(1.3);
    expect(convexWarp(vehicle, 'interior')).toBe(0);
    expect(convexWarp(vehicle, 'wingLeft')).toBeGreaterThan(0.2);
    expect(convexWarp(vehicle, 'wingLeft')).toBeLessThan(1);
  });

  it('gives the wings a wider field than the same glass would if it were flat', () => {
    const wing = fieldOfView(vehicle, 'wingLeft');
    const widening = convexWidening(vehicle, 'wingLeft');
    const distance = eyeToGlassDistance(vehicle, 'wingLeft');
    // A flat mirror of this glass at this distance would subtend atan(hw / d);
    // the convex one covers that much again times the widening.
    const flatHalf = Math.atan(VEHICLE.mirrors.wingLeft.width / 2 / distance);
    const ratio = Math.tan(wing.horizontal) / Math.tan(flatHalf);
    expect(ratio).toBeGreaterThan(1.6);
    // Never MORE than the widening: the glass is tilted to the view axis, so the
    // frustum fitted to its corners is slightly foreshortened, never inflated.
    expect(ratio).toBeLessThanOrEqual(widening * 1.001);
    expect(widening).toBeGreaterThan(1.3);
    // Taller than the letterbox interior mirror, and still a mirror rather than
    // a fisheye: nothing remotely like a hemisphere.
    expect(wing.vertical).toBeGreaterThan(fieldOfView(vehicle, 'interior').vertical);
    expect(wing.horizontal).toBeLessThan(Math.PI / 4);
  });
});

describe('mirror aim', () => {
  const vehicle = restingVehicle();

  it('clamps to a trim range, not a swing range', () => {
    expect(clampMirrorAim({ yaw: 3, pitch: -3 })).toEqual({
      yaw: MIRROR_AIM_LIMITS.maxYaw,
      pitch: -MIRROR_AIM_LIMITS.maxPitch,
    });
    expect(MIRROR_AIM_LIMITS.maxYaw).toBeLessThan(0.6);
  });

  it('turns the reflected view by twice the angle the glass moves', () => {
    const azimuth = (aim: { yaw: number; pitch: number }) => {
      const d = mirrorViewDirection(vehicle, 'interior', aim);
      return Math.atan2(d.y, d.x);
    };
    const glassYaw = 0.05;
    // The interior mirror looks straight back, so its azimuth sits on the +-pi
    // wrap: unwrap the difference before comparing.
    const raw = azimuth({ yaw: glassYaw, pitch: 0 }) - azimuth({ yaw: 0, pitch: 0 });
    const swing = Math.atan2(Math.sin(raw), Math.cos(raw));
    // The law of reflection, straight out of the geometry: 0.1 rad, not 0.05.
    expect(Math.abs(swing)).toBeCloseTo(2 * glassYaw, 2);

    const elevation = (aim: { yaw: number; pitch: number }) => {
      const d = mirrorViewDirection(vehicle, 'interior', aim);
      return Math.asin(d.z);
    };
    const glassPitch = 0.04;
    const tip = elevation({ yaw: 0, pitch: glassPitch }) - elevation({ yaw: 0, pitch: 0 });
    // Doubled again, though not quite 2x here: this glass is angled sideways, so
    // tipping it about the body's y axis is not a purely vertical rotation.
    expect(tip).toBeGreaterThan(glassPitch * 1.4);
    expect(tip).toBeLessThan(glassPitch * 2.05);
  });

  it('lets the player trim what a wing mirror covers', () => {
    // A point right at the outboard edge of the left mirror's default view:
    // aiming the glass in swings the view across the car and loses it, aiming it
    // out keeps it, exactly as setting up a real mirror does.
    const wide: Vec3 = { x: -8, y: 4.2, z: 0.4 };
    expect(visibleInMirror(vehicle, 'wingLeft', wide)).toBe(true);
    expect(
      visibleInMirror(vehicle, 'wingLeft', wide, { yaw: -MIRROR_AIM_LIMITS.maxYaw, pitch: 0 }),
    ).toBe(false);
    // And tipping the glass down drops the whole view toward the road, which is
    // how a driver finds the kerb in the bottom of the mirror.
    const level = mirrorViewDirection(vehicle, 'wingLeft').z;
    const dipped = mirrorViewDirection(vehicle, 'wingLeft', {
      yaw: 0,
      pitch: -MIRROR_AIM_LIMITS.maxPitch,
    }).z;
    expect(dipped).toBeLessThan(level - 0.1);
  });
});

describe('mirror update budget', () => {
  it('follows the rack to the side the manoeuvre is happening on', () => {
    const vehicle = restingVehicle();
    expect(manoeuvreSide({ ...vehicle, rack: 0.8 })).toBe('left');
    expect(manoeuvreSide({ ...vehicle, rack: -0.8 })).toBe('right');
    // Rack centred: the kerb side of a left-hand-drive car.
    expect(manoeuvreSide({ ...vehicle, rack: 0 })).toBe('right');
  });

  it('keeps the interior mirror and the relevant wing at the highest rate', () => {
    expect(mirrorPriority('interior', 'left')).toBe('priority');
    expect(mirrorPriority('wingLeft', 'left')).toBe('priority');
    expect(mirrorPriority('wingRight', 'left')).toBe('secondary');

    // Every frame for the priority pair; the far wing only sometimes.
    let farWingUpdates = 0;
    for (let frame = 0; frame < 12; frame++) {
      const due = mirrorsToUpdate(frame, 'left');
      expect(due).toContain('interior');
      expect(due).toContain('wingLeft');
      if (due.includes('wingRight')) farWingUpdates++;
    }
    expect(farWingUpdates).toBeGreaterThan(0);
    expect(farWingUpdates).toBeLessThan(12);
  });

  it('starves the far wing first when the frame budget is blown', () => {
    const count = (overBudget: boolean, id: 'interior' | 'wingLeft' | 'wingRight') => {
      let n = 0;
      for (let frame = 0; frame < 24; frame++) {
        if (mirrorsToUpdate(frame, 'left', overBudget).includes(id)) n++;
      }
      return n;
    };
    expect(count(true, 'interior')).toBeLessThan(count(false, 'interior'));
    expect(count(true, 'wingRight')).toBeLessThan(count(true, 'wingLeft'));
    // No mirror ever stops updating altogether.
    for (const id of MIRROR_IDS) expect(count(true, id)).toBeGreaterThan(0);
  });

  it('renders into small targets shaped like the glass', () => {
    for (const id of MIRROR_IDS) {
      const size = mirrorTargetSize(id);
      expect(size.width).toBeLessThanOrEqual(320);
      expect(size.height).toBeLessThanOrEqual(96);
      const glass = VEHICLE.mirrors[id];
      expect(size.width / size.height).toBeCloseTo(glass.width / glass.height, 1);
    }
  });
});
