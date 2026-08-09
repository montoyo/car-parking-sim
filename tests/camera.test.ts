/**
 * The first-person camera's geometry, tested where it is pure maths.
 *
 * Per the spec, WebGL rendering, cockpit shell appearance and mouse plumbing are
 * verified by eye — what IS tested here is the arithmetic those passes depend
 * on: that the eye point comes from the shared vehicle definition and lands on
 * the driver's side at a driver's height, that the view matrix really puts the
 * eye at the origin looking down -z, that look angles are clamped and the
 * one-button snaps point where a shoulder check would, and that the cosmetic
 * pitch/roll from ticket 03 actually reaches the camera.
 */

import { describe, expect, it } from 'vitest';
import { VEHICLE, createWorld, frontAxleX, rearAxleX } from '../src/core/index';
import type { LookState } from '../src/render/camera';
import {
  LOOK_LIMITS,
  SNAP_LOOK,
  approachLook,
  clampLook,
  driverEyeWorld,
  firstPersonGazeDirection,
  firstPersonViewMatrix,
} from '../src/render/camera';
import { transformPoint } from '../src/render/mat4';

const DEG = Math.PI / 180;
const AHEAD: LookState = { yaw: 0, pitch: 0 };

function restingVehicle() {
  return createWorld('debug-plane').vehicle;
}

describe('driver eye point', () => {
  it('sits on the driver side of a left-hand-drive car, at a realistic height', () => {
    const eye = VEHICLE.driverEyePoint;
    // +y is left; a left-hand-drive driver sits left of centre by 20-60 cm.
    expect(eye.y).toBeGreaterThan(0.2);
    expect(eye.y).toBeLessThan(VEHICLE.bodyWidth / 2);
    // Seated eye height in a saloon: around 1.1-1.3 m above the road.
    expect(eye.z).toBeGreaterThan(1.05);
    expect(eye.z).toBeLessThan(1.35);
    // Between the axles, behind the front axle — not out on the bonnet.
    expect(eye.x).toBeLessThan(frontAxleX(VEHICLE));
    expect(eye.x).toBeGreaterThan(rearAxleX(VEHICLE));
  });

  it('is placed in the world by the body pose, not by numbers of its own', () => {
    const vehicle = restingVehicle();
    const yawed = {
      ...vehicle,
      pose: { x: 10, y: -4, yaw: Math.PI / 2 },
      pitch: 0,
      roll: 0,
    };
    const eye = driverEyeWorld(yawed);
    // Yawed 90 deg: vehicle +x maps to world +y, vehicle +y maps to world -x.
    expect(eye.x).toBeCloseTo(10 - VEHICLE.driverEyePoint.y, 6);
    expect(eye.y).toBeCloseTo(-4 + VEHICLE.driverEyePoint.x, 6);
    expect(eye.z).toBeCloseTo(VEHICLE.driverEyePoint.z, 6);
  });
});

describe('look angles', () => {
  it('clamps free look to the limits of a human neck', () => {
    expect(clampLook({ yaw: 9, pitch: 9 })).toEqual({
      yaw: LOOK_LIMITS.maxYaw,
      pitch: LOOK_LIMITS.maxPitch,
    });
    expect(clampLook({ yaw: -9, pitch: -9 })).toEqual({
      yaw: -LOOK_LIMITS.maxYaw,
      pitch: -LOOK_LIMITS.maxPitch,
    });
    expect(clampLook({ yaw: 0.3, pitch: -0.2 })).toEqual({ yaw: 0.3, pitch: -0.2 });
  });

  it('can look far enough round to see over the shoulder', () => {
    expect(LOOK_LIMITS.maxYaw).toBeGreaterThan(140 * DEG);
  });

  it('snaps left, right and back to plausible shoulder-check angles', () => {
    // +yaw is left, matching the +y-is-left vehicle frame.
    expect(SNAP_LOOK.left).toBeGreaterThan(60 * DEG);
    expect(SNAP_LOOK.right).toBeLessThan(-60 * DEG);
    expect(SNAP_LOOK.ahead).toBe(0);
    // Looking back means turning most of the way round, over one shoulder.
    expect(Math.abs(SNAP_LOOK.back)).toBeGreaterThan(140 * DEG);
    // Every snap is reachable within the clamped range.
    for (const yaw of [SNAP_LOOK.left, SNAP_LOOK.right, SNAP_LOOK.back]) {
      expect(clampLook({ yaw, pitch: 0 }).yaw).toBeCloseTo(yaw, 9);
    }
  });

  it('eases toward a snap target without overshooting it', () => {
    const target: LookState = { yaw: SNAP_LOOK.left, pitch: 0 };
    let look: LookState = AHEAD;
    let previous = 0;
    for (let i = 0; i < 60; i++) {
      look = approachLook(look, target, 1 / 60, 0.12);
      expect(look.yaw).toBeGreaterThanOrEqual(previous);
      expect(look.yaw).toBeLessThanOrEqual(target.yaw + 1e-9);
      previous = look.yaw;
    }
    // A ~0.12 s response reaches the shoulder check within a second (0.1 deg).
    expect(target.yaw - look.yaw).toBeLessThan(0.002);
  });
});

describe('first-person view matrix', () => {
  const vehicle = restingVehicle();

  it('puts the driver eye point at the eye-space origin', () => {
    const view = firstPersonViewMatrix(vehicle, AHEAD);
    const eye = driverEyeWorld(vehicle);
    const p = transformPoint(view, eye);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(0, 6);
  });

  it('looks along the car when looking ahead: what is in front is down -z', () => {
    const view = firstPersonViewMatrix(vehicle, AHEAD);
    const eye = driverEyeWorld(vehicle);
    const front = transformPoint(view, { x: eye.x + 5, y: eye.y, z: eye.z });
    expect(front.z).toBeCloseTo(-5, 6);
    expect(front.x).toBeCloseTo(0, 6);
    expect(front.y).toBeCloseTo(0, 6);

    // Something to the driver's left is off to eye-space -x, and something
    // above the eye line is at +y. That is the WebGL convention, unambiguously.
    const left = transformPoint(view, { x: eye.x, y: eye.y + 2, z: eye.z });
    expect(left.x).toBeCloseTo(-2, 6);
    const up = transformPoint(view, { x: eye.x, y: eye.y, z: eye.z + 1 });
    expect(up.y).toBeCloseTo(1, 6);
  });

  it('brings the kerb beside the car into view when snap-looking left', () => {
    const eye = driverEyeWorld(vehicle);
    const beside = { x: eye.x, y: eye.y + 3, z: eye.z };
    const ahead = transformPoint(firstPersonViewMatrix(vehicle, AHEAD), beside);
    // Straight ahead it is out sideways, not in front of the camera at all.
    expect(ahead.z).toBeCloseTo(0, 6);

    const snapped = transformPoint(
      firstPersonViewMatrix(vehicle, { yaw: SNAP_LOOK.left, pitch: 0 }),
      beside,
    );
    expect(snapped.z).toBeLessThan(0);
    expect(Math.abs(snapped.x)).toBeLessThan(Math.abs(snapped.z));
  });

  it('puts the car behind you in view when snap-looking back', () => {
    const eye = driverEyeWorld(vehicle);
    const behind = { x: eye.x - 6, y: eye.y, z: eye.z };
    const view = firstPersonViewMatrix(vehicle, { yaw: SNAP_LOOK.back, pitch: 0 });
    const p = transformPoint(view, behind);
    expect(p.z).toBeLessThan(0);
  });

  it('yaws with the car, so the view is always relative to the body', () => {
    const turned = { ...vehicle, pose: { x: 0, y: 0, yaw: Math.PI / 2 } };
    const eye = driverEyeWorld(turned);
    // The car now points along world +y, so that is what is in front.
    const front = transformPoint(firstPersonViewMatrix(turned, AHEAD), {
      x: eye.x,
      y: eye.y + 5,
      z: eye.z,
    });
    expect(front.z).toBeCloseTo(-5, 6);
  });
});

describe('cosmetic pitch and roll feed the camera', () => {
  const vehicle = restingVehicle();

  it('lifts the gaze when the body pitches nose-up', () => {
    const level = firstPersonGazeDirection(vehicle, AHEAD);
    expect(Math.abs(level.z)).toBeLessThan(1e-6);

    const noseUp = firstPersonGazeDirection({ ...vehicle, pitch: 0.05 }, AHEAD);
    expect(noseUp.z).toBeGreaterThan(0.02);
  });

  it('tilts the horizon when the body rolls', () => {
    const rolled = firstPersonViewMatrix({ ...vehicle, roll: 0.06 }, AHEAD);
    const eye = driverEyeWorld({ ...vehicle, roll: 0.06 });
    // World "up" no longer lands exactly on eye-space +y once the body rolls.
    const up = transformPoint(rolled, { x: eye.x, y: eye.y, z: eye.z + 1 });
    expect(Math.abs(up.x)).toBeGreaterThan(0.02);
    expect(up.y).toBeGreaterThan(0.9);
  });

  it('leaves the camera level when the attitude is zero', () => {
    const view = firstPersonViewMatrix(vehicle, AHEAD);
    const eye = driverEyeWorld(vehicle);
    const up = transformPoint(view, { x: eye.x, y: eye.y, z: eye.z + 1 });
    // float32 matrices: tolerances are 1e-6 rad, i.e. far below anything visible.
    expect(Math.abs(up.x)).toBeLessThan(1e-6);
    expect(up.y).toBeCloseTo(1, 6);
  });
});
