/**
 * Rendering interpolates between the two most recent core states, so the picture
 * is smooth at any refresh rate while the core still runs at a fixed timestep.
 * Pure so it can be reasoned about (and, later, reused by the replay).
 */

import type { Frame, VehicleState, WheelId } from '../core/index';
import { VEHICLE, WHEEL_IDS, wheelLoads, wrapAngle } from '../core/index';

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

/**
 * A recorded frame as a `VehicleState`, so the replay can be drawn through the
 * SAME first-person camera and mirror passes the live game uses — which is the
 * whole of the FPV/top-down replay toggle: playback of recorded frames, not a
 * re-simulation.
 *
 * A `Frame` holds exactly what a picture of the car needs (pose, per-wheel plan
 * position, steer angle and spin, rack, gear, signed speed). The remaining fields
 * of `VehicleState` are solver internals that nothing in the renderer reads, and
 * they are filled with rest values rather than guessed at — in particular the
 * cosmetic pitch and roll are zero, so a replayed frame does not invent a lean the
 * recording never captured.
 */
export function vehicleFromFrame(frame: Frame): VehicleState {
  const loads = wheelLoads(0, 0, VEHICLE);
  const wheels = {} as Record<WheelId, VehicleState['wheels'][WheelId]>;
  for (const id of WHEEL_IDS) {
    const recorded = frame.wheels[id];
    wheels[id] = {
      // The contact patch is directly below the hub, so it is also the hub's plan
      // position — one recorded point serves both.
      position: { x: recorded.contactPatch.x, y: recorded.contactPatch.y },
      steerAngle: recorded.steerAngle,
      spin: recorded.spin,
      spinRate: 0,
      slipRatio: 0,
      slipAngle: 0,
      load: loads[id],
      longitudinalForce: 0,
      lateralForce: 0,
      gripUtilisation: 0,
    };
  }
  return {
    pose: { x: frame.pose.x, y: frame.pose.y, yaw: frame.pose.yaw },
    longitudinalVelocity: frame.speed,
    lateralVelocity: 0,
    yawRate: 0,
    longitudinalAcceleration: 0,
    lateralAcceleration: 0,
    pitch: 0,
    roll: 0,
    kinematicBlend: 1,
    rack: frame.rack,
    gear: frame.gear,
    wheels,
  };
}

/**
 * The vehicle state for a FRACTIONAL replay index: the two frames either side,
 * interpolated exactly as the live loop interpolates two core states. Without it,
 * playing a replay back through the driver's camera would step at the fixed
 * timestep instead of running smooth at the display rate.
 */
export function interpolateFrames(previous: Frame, current: Frame, t: number): VehicleState {
  return interpolateVehicle(vehicleFromFrame(previous), vehicleFromFrame(current), t);
}
