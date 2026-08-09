/**
 * The first-person driver's-seat camera.
 *
 * The eye point comes from the shared vehicle definition — the same numbers the
 * physics and (from ticket 05) the mirrors use — so the player's sense of the
 * car's extents is honest rather than tuned by hand here. Body yaw places the
 * camera; the cosmetic pitch and roll derived in ticket 03 lean it.
 *
 * Everything in this module is pure maths on a `VehicleState`, which is why it
 * can be tested even though the WebGL passes it feeds are verified by eye.
 *
 * Eye space follows the WebGL convention: +x right, +y up, looking down -z.
 * The vehicle frame is +x forward, +y left, +z up.
 */

import type { Vec3, VehicleState, VehicleDefinition } from '../core/index';
import { VEHICLE } from '../core/index';
import type { Mat4 } from './mat4';
import {
  identity,
  invertRigid,
  multiply,
  rotationX,
  rotationY,
  rotationZ,
  transformDirection,
  translation,
} from './mat4';

/** Where the driver is looking, relative to the body. +yaw is left, +pitch up. */
export interface LookState {
  readonly yaw: number;
  readonly pitch: number;
}

export const LOOK_AHEAD: LookState = { yaw: 0, pitch: 0 };

const DEG = Math.PI / 180;

/**
 * How far a seated driver can turn their head. Yaw reaches beyond a right angle
 * because a real shoulder check does: without it, reversing on mirrors alone
 * would be forced rather than chosen.
 */
export const LOOK_LIMITS = {
  maxYaw: 155 * DEG,
  maxPitch: 55 * DEG,
} as const;

/**
 * The one-button looks, as body-relative yaw angles. `back` goes over the RIGHT
 * shoulder because the driver sits on the left — turning the other way would put
 * the seat back in their face.
 */
export const SNAP_LOOK = {
  ahead: 0,
  left: 85 * DEG,
  right: -85 * DEG,
  back: -150 * DEG,
} as const;

/** Vertical field of view for the first-person pass (radians). */
export const FIRST_PERSON_FOV = 62 * DEG;

export function clampLook(look: LookState): LookState {
  return {
    yaw: clampTo(look.yaw, LOOK_LIMITS.maxYaw),
    pitch: clampTo(look.pitch, LOOK_LIMITS.maxPitch),
  };
}

/**
 * First-order ease toward a target look direction, so a snap-look swings the
 * head round rather than teleporting the view. `responseTime` is the time
 * constant in seconds.
 */
export function approachLook(
  current: LookState,
  target: LookState,
  dt: number,
  responseTime: number,
): LookState {
  if (responseTime <= 0 || dt <= 0) return target;
  const alpha = 1 - Math.exp(-dt / responseTime);
  return {
    yaw: current.yaw + (target.yaw - current.yaw) * alpha,
    pitch: current.pitch + (target.pitch - current.pitch) * alpha,
  };
}

/**
 * The body's own transform, including the cosmetic pitch and roll. Pitch is
 * nose-up positive and roll drops the left-hand side, matching `VehicleState`.
 */
export function bodyTransform(vehicle: VehicleState): Mat4 {
  return multiply(
    multiply(
      translation(vehicle.pose.x, vehicle.pose.y, 0),
      multiply(rotationZ(vehicle.pose.yaw), rotationY(-vehicle.pitch)),
    ),
    rotationX(-vehicle.roll),
  );
}

/** The driver's eye point in world coordinates for a given vehicle state. */
export function driverEyeWorld(
  vehicle: VehicleState,
  v: VehicleDefinition = VEHICLE,
): { x: number; y: number; z: number } {
  const eye = v.driverEyePoint;
  const m = bodyTransform(vehicle);
  return {
    x:
      (m[0] as number) * eye.x + (m[4] as number) * eye.y + (m[8] as number) * eye.z + (m[12] as number),
    y:
      (m[1] as number) * eye.x + (m[5] as number) * eye.y + (m[9] as number) * eye.z + (m[13] as number),
    z:
      (m[2] as number) * eye.x + (m[6] as number) * eye.y + (m[10] as number) * eye.z + (m[14] as number),
  };
}

/**
 * Maps eye-space axes (+x right, +y up, -z forward) onto the vehicle frame's
 * (+x forward, +y left, +z up). Constant, and the only place the two
 * conventions meet.
 */
function eyeAxisBasis(): Mat4 {
  const m = identity();
  // Column 0: eye +x (right) is vehicle -y.
  m[0] = 0;
  m[1] = -1;
  m[2] = 0;
  // Column 1: eye +y (up) is vehicle +z.
  m[4] = 0;
  m[5] = 0;
  m[6] = 1;
  // Column 2: eye +z (backward) is vehicle -x.
  m[8] = -1;
  m[9] = 0;
  m[10] = 0;
  return m;
}

/** The camera's world transform: eye position and orientation, not the view. */
export function firstPersonCameraTransform(
  vehicle: VehicleState,
  look: LookState,
  v: VehicleDefinition = VEHICLE,
): Mat4 {
  const clamped = clampLook(look);
  const head = multiply(rotationZ(clamped.yaw), rotationY(-clamped.pitch));
  const seat = translation(v.driverEyePoint.x, v.driverEyePoint.y, v.driverEyePoint.z);
  return multiply(multiply(bodyTransform(vehicle), seat), multiply(head, eyeAxisBasis()));
}

/** World-space unit vector the driver is looking along. */
export function firstPersonGazeDirection(
  vehicle: VehicleState,
  look: LookState,
  v: VehicleDefinition = VEHICLE,
): Vec3 {
  const camera = firstPersonCameraTransform(vehicle, look, v);
  // Eye space looks down -z, so the gaze is the negated third basis vector.
  const back = transformDirection(camera, { x: 0, y: 0, z: 1 });
  return { x: -back.x, y: -back.y, z: -back.z };
}

/** View matrix (world -> eye space) for the first-person pass. */
export function firstPersonViewMatrix(
  vehicle: VehicleState,
  look: LookState,
  v: VehicleDefinition = VEHICLE,
): Mat4 {
  return invertRigid(firstPersonCameraTransform(vehicle, look, v));
}

function clampTo(value: number, limit: number): number {
  return value < -limit ? -limit : value > limit ? limit : value;
}
