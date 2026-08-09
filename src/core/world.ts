/**
 * `WorldState` is the entire simulation state: immutable, plain data, JSON-safe.
 * `step()` returns a new one rather than mutating, which is what makes
 * determinism tests and interpolated rendering both straightforward.
 */

import type { Gear } from './input';
import type { WheelId, Vec2 } from './vehicle';
import { WHEEL_IDS, VEHICLE, ackermannSteerAngles, wheelPosition } from './vehicle';

/** Planar pose of the vehicle origin (midway along the wheelbase). */
export interface BodyPose {
  /** World position, metres. */
  readonly x: number;
  readonly y: number;
  /** Heading, radians, 0 = +x, positive counter-clockwise. */
  readonly yaw: number;
}

export interface WheelState {
  /** Hub centre in world coordinates (m). */
  readonly position: Vec2;
  /** Road-wheel steer angle relative to the body (rad); rear wheels are 0. */
  readonly steerAngle: number;
  /** Rotation about the axle (rad), accumulated — drives wheel spin rendering. */
  readonly spin: number;
}

export interface VehicleState {
  readonly pose: BodyPose;
  /** Longitudinal velocity in the body frame (m/s); negative = reversing. */
  readonly longitudinalVelocity: number;
  /** Lateral velocity in the body frame (m/s); 0 for the kinematic placeholder. */
  readonly lateralVelocity: number;
  /** Yaw rate (rad/s). */
  readonly yawRate: number;
  /**
   * Steering rack position in [-1, 1]. Explicitly part of the state because the
   * HUD and the replay both read it.
   */
  readonly rack: number;
  readonly gear: Gear;
  readonly wheels: Readonly<Record<WheelId, WheelState>>;
}

export interface WorldState {
  readonly scenarioId: ScenarioId;
  /** Number of fixed timesteps taken since `createWorld`. */
  readonly tick: number;
  /** Accumulated simulated time (s). */
  readonly time: number;
  /** Seed for any future stochastic behaviour — the core never uses Math.random. */
  readonly seed: number;
  readonly vehicle: VehicleState;
}

/**
 * Scenario ids. Only the debug plane exists in the walking skeleton; ticket 06
 * introduces the scenario data model and the real parking scenarios.
 */
export type ScenarioId = 'debug-plane';

export interface CreateWorldOptions {
  readonly seed?: number;
  /** Override the spawn pose (defaults to the scenario's own spawn). */
  readonly spawn?: BodyPose;
}

const SPAWN: Readonly<Record<ScenarioId, BodyPose>> = {
  'debug-plane': { x: 0, y: 0, yaw: 0 },
};

/**
 * Place the wheels in world space for a given pose and rack position. Front
 * steer angles come from Ackermann geometry — the two front wheels do NOT share
 * an angle — and the rears are always straight.
 */
export function wheelStatesFor(
  pose: BodyPose,
  rack: number,
  spin: Readonly<Record<WheelId, number>>,
): Readonly<Record<WheelId, WheelState>> {
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  const steer = ackermannSteerAngles(rack, VEHICLE);
  const out = {} as Record<WheelId, WheelState>;
  for (const id of WHEEL_IDS) {
    const local = wheelPosition(id, VEHICLE);
    out[id] = {
      position: {
        x: pose.x + local.x * cos - local.y * sin,
        y: pose.y + local.x * sin + local.y * cos,
      },
      steerAngle:
        id === 'frontLeft' ? steer.frontLeft : id === 'frontRight' ? steer.frontRight : 0,
      spin: spin[id],
    };
  }
  return out;
}

const ZERO_SPIN: Readonly<Record<WheelId, number>> = {
  frontLeft: 0,
  frontRight: 0,
  rearLeft: 0,
  rearRight: 0,
};

/** Construct the initial world for a scenario. Pure and deterministic. */
export function createWorld(scenarioId: ScenarioId, options: CreateWorldOptions = {}): WorldState {
  const pose = options.spawn ?? SPAWN[scenarioId];
  return {
    scenarioId,
    tick: 0,
    time: 0,
    seed: options.seed ?? 0,
    vehicle: {
      pose,
      longitudinalVelocity: 0,
      lateralVelocity: 0,
      yawRate: 0,
      rack: 0,
      gear: 'neutral',
      wheels: wheelStatesFor(pose, 0, ZERO_SPIN),
    },
  };
}
