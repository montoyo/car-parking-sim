/**
 * Rendering interpolates between the two most recent core states, so the picture
 * is smooth at any refresh rate while the core still runs at a fixed timestep.
 * Pure so it can be reasoned about (and, later, reused by the replay).
 */

import type { VehicleState, WheelId } from '../core/index';
import { WHEEL_IDS, wrapAngle } from '../core/index';

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate along the shortest arc between two angles. */
export function lerpAngle(a: number, b: number, t: number): number {
  return wrapAngle(a + wrapAngle(b - a) * t);
}

/** `t` in [0, 1] between the previous state and the current one. */
export function interpolateVehicle(
  previous: VehicleState,
  current: VehicleState,
  t: number,
): VehicleState {
  const wheels = {} as Record<WheelId, VehicleState['wheels'][WheelId]>;
  for (const id of WHEEL_IDS) {
    const p = previous.wheels[id];
    const c = current.wheels[id];
    wheels[id] = {
      // Interpolate what is drawn; carry the rest straight through, since the
      // renderer only ever reads it for debug overlays.
      ...c,
      position: { x: lerp(p.position.x, c.position.x, t), y: lerp(p.position.y, c.position.y, t) },
      steerAngle: lerp(p.steerAngle, c.steerAngle, t),
      spin: lerp(p.spin, c.spin, t),
    };
  }
  return {
    ...current,
    pose: {
      x: lerp(previous.pose.x, current.pose.x, t),
      y: lerp(previous.pose.y, current.pose.y, t),
      yaw: lerpAngle(previous.pose.yaw, current.pose.yaw, t),
    },
    longitudinalVelocity: lerp(previous.longitudinalVelocity, current.longitudinalVelocity, t),
    lateralVelocity: lerp(previous.lateralVelocity, current.lateralVelocity, t),
    yawRate: lerp(previous.yawRate, current.yawRate, t),
    rack: lerp(previous.rack, current.rack, t),
    // Cosmetic attitude is smoothed already, but interpolating it keeps the
    // camera from stepping at low frame rates.
    pitch: lerp(previous.pitch, current.pitch, t),
    roll: lerp(previous.roll, current.roll, t),
    gear: current.gear,
    wheels,
  };
}
