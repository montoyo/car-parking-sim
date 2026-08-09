/**
 * The optional reversing camera.
 *
 * A real reversing camera is a wide-angle lens in the tailgate, aimed down and
 * back, whose picture is shown to the driver on a screen. So this is one more
 * camera pass, posed from the SHARED vehicle definition exactly as the mirrors
 * are: the lens sits on the centreline at the back of the bodywork, at boot-lid
 * height, looking backwards and tilted down so the kerb behind the car is in
 * shot. Nothing here is tuned to make the picture flattering — the geometry is
 * the geometry, which is what makes comparing camera-assisted parking against
 * mirror-only parking a fair comparison.
 *
 * Which scenarios offer it is DATA (`Scenario.reversingCamera`), not a code path.
 *
 * Pure maths on a `VehicleState`, like `camera.ts` and `mirror.ts`; the picture it
 * produces is judged by eye.
 */

import type { VehicleDefinition, VehicleState, Vec3 } from '../core/index';
import { VEHICLE, rearAxleX } from '../core/index';
import type { Mat4 } from './mat4';
import { invertRigid, multiply, perspective, translation } from './mat4';
import { bodyTransform } from './camera';

const DEG = Math.PI / 180;

/** Vertical field of view of the lens (radians). Wide, as reversing lenses are. */
export const REVERSE_CAMERA_FOV = 95 * DEG;
/** How far below the horizontal the lens is aimed (radians). */
export const REVERSE_CAMERA_TILT = 28 * DEG;
export const REVERSE_CAMERA_NEAR = 0.08;
export const REVERSE_CAMERA_FAR = 60;
/** Pixels of the off-screen target the camera pass renders into. */
export const REVERSE_CAMERA_TARGET = { width: 320, height: 200 } as const;

/**
 * Where the lens sits in vehicle-local coordinates: on the centreline, at the
 * very back of the bodywork, at the height of the boot lid's trailing edge.
 */
export function reverseCameraMount(v: VehicleDefinition = VEHICLE): Vec3 {
  return {
    x: rearAxleX(v) - v.rearOverhang + 0.02,
    y: 0,
    z: v.bodyHeight * 0.62,
  };
}

/**
 * The lens' world transform. Eye space is the WebGL convention (+x right, +y up,
 * looking down -z), so the basis is the first-person one rotated 180° about the
 * body's up axis (looking backwards) and then tipped down by the lens' tilt.
 */
export function reverseCameraTransform(
  vehicle: VehicleState,
  v: VehicleDefinition = VEHICLE,
): Mat4 {
  const mount = reverseCameraMount(v);
  const c = Math.cos(REVERSE_CAMERA_TILT);
  const s = Math.sin(REVERSE_CAMERA_TILT);
  // The lens' eye axes written as columns in the VEHICLE frame. Looking backwards
  // means the eye's forward (-z) is the body's -x; the tilt then rotates the up
  // and back axes about the eye's own +x (the body's +y) so the lens points down.
  //   eye +x (right)          = body +y
  //   eye +y (up)             = (-sin, 0, cos)
  //   eye +z (behind the lens)= ( cos, 0, sin)
  const basis: Mat4 = new Float32Array([
    0, 1, 0, 0,
    -s, 0, c, 0,
    c, 0, s, 0,
    0, 0, 0, 1,
  ]);
  return multiply(
    multiply(bodyTransform(vehicle), translation(mount.x, mount.y, mount.z)),
    basis,
  );
}

export function reverseCameraViewMatrix(
  vehicle: VehicleState,
  v: VehicleDefinition = VEHICLE,
): Mat4 {
  return invertRigid(reverseCameraTransform(vehicle, v));
}

/** View-projection for the reversing-camera pass, for a target of given aspect. */
export function reverseCameraViewProjection(
  vehicle: VehicleState,
  aspect: number = REVERSE_CAMERA_TARGET.width / REVERSE_CAMERA_TARGET.height,
  v: VehicleDefinition = VEHICLE,
): Mat4 {
  return multiply(
    perspective(REVERSE_CAMERA_FOV, aspect, REVERSE_CAMERA_NEAR, REVERSE_CAMERA_FAR),
    reverseCameraViewMatrix(vehicle, v),
  );
}

/**
 * Whether the camera's picture should be on screen: the scenario has to offer one
 * and the car has to be in reverse, which is exactly when a real one switches on.
 */
export function reverseCameraActive(
  vehicle: VehicleState,
  offered: boolean,
): boolean {
  return offered && vehicle.gear === 'reverse';
}
