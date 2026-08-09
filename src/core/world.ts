/**
 * `WorldState` is the entire simulation state: immutable, plain data, JSON-safe.
 * `step()` returns a new one rather than mutating, which is what makes
 * determinism tests and interpolated rendering both straightforward.
 */

import type { Gear } from './input';
import type { WheelId, Vec2 } from './vehicle';
import { WHEEL_IDS, VEHICLE, ackermannSteerAngles, wheelPosition } from './vehicle';
import { wheelLoads } from './tyre';

/** Planar pose of the vehicle origin (midway along the wheelbase). */
export interface BodyPose {
  /** World position, metres. */
  readonly x: number;
  readonly y: number;
  /** Heading, radians, 0 = +x, positive counter-clockwise. */
  readonly yaw: number;
}

/**
 * Everything about a wheel that the dynamics solve owns. Split out from
 * `WheelState` because the solve produces exactly this and the world adds only
 * the placement (which is pure geometry).
 */
export interface WheelMotion {
  /** Rotation about the axle (rad), accumulated — drives wheel spin rendering. */
  readonly spin: number;
  /** Angular speed about the axle (rad/s). The integrated wheel-spin state. */
  readonly spinRate: number;
  /** Longitudinal slip ratio; 0 is free rolling, negative is locked/braking. */
  readonly slipRatio: number;
  /** Slip angle (rad); positive means the patch slides toward the wheel's left. */
  readonly slipAngle: number;
  /** Vertical load (N) including weight transfer. */
  readonly load: number;
  /** Tyre forces in the wheel's own frame (N). */
  readonly longitudinalForce: number;
  readonly lateralForce: number;
  /** Fraction of the friction circle in use; 1 means at the limit of grip. */
  readonly gripUtilisation: number;
}

export interface WheelState extends WheelMotion {
  /** Hub centre in world coordinates (m). */
  readonly position: Vec2;
  /** Road-wheel steer angle relative to the body (rad); rear wheels are 0. */
  readonly steerAngle: number;
}

export interface VehicleState {
  readonly pose: BodyPose;
  /** Longitudinal velocity in the body frame (m/s); negative = reversing. */
  readonly longitudinalVelocity: number;
  /** Lateral velocity of the body origin in the body frame (m/s). */
  readonly lateralVelocity: number;
  /** Yaw rate (rad/s). */
  readonly yawRate: number;
  /** Body-frame accelerations (m/s^2) from the tyre forces — drive weight transfer. */
  readonly longitudinalAcceleration: number;
  readonly lateralAcceleration: number;
  /**
   * Cosmetic body attitude (rad), DERIVED from the accelerations above rather
   * than simulated as degrees of freedom. Pitch is positive nose-up; roll is
   * positive with the left-hand side dropping.
   */
  readonly pitch: number;
  readonly roll: number;
  /**
   * How much of the solution came from the kinematic rear-axle-pivot bicycle, in
   * [0, 1]: 1 at a standstill, 0 at and above `kinematicBlendSpeed`. Exposed
   * because it is the single most important thing to be able to see when the
   * crawl regime misbehaves.
   */
  readonly kinematicBlend: number;
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
  motion: Readonly<Record<WheelId, WheelMotion>>,
): Readonly<Record<WheelId, WheelState>> {
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  const steer = ackermannSteerAngles(rack, VEHICLE);
  const out = {} as Record<WheelId, WheelState>;
  for (const id of WHEEL_IDS) {
    const local = wheelPosition(id, VEHICLE);
    out[id] = {
      ...motion[id],
      position: {
        x: pose.x + local.x * cos - local.y * sin,
        y: pose.y + local.x * sin + local.y * cos,
      },
      steerAngle:
        id === 'frontLeft' ? steer.frontLeft : id === 'frontRight' ? steer.frontRight : 0,
    };
  }
  return out;
}

/** Wheels at rest: no rotation, no slip, static loads with no weight transfer. */
function restingWheelMotion(): Readonly<Record<WheelId, WheelMotion>> {
  const loads = wheelLoads(0, 0, VEHICLE);
  const out = {} as Record<WheelId, WheelMotion>;
  for (const id of WHEEL_IDS) {
    out[id] = {
      spin: 0,
      spinRate: 0,
      slipRatio: 0,
      slipAngle: 0,
      load: loads[id],
      longitudinalForce: 0,
      lateralForce: 0,
      gripUtilisation: 0,
    };
  }
  return out;
}

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
      longitudinalAcceleration: 0,
      lateralAcceleration: 0,
      pitch: 0,
      roll: 0,
      // At a standstill the solution is entirely the kinematic one.
      kinematicBlend: 1,
      rack: 0,
      gear: 'neutral',
      wheels: wheelStatesFor(pose, 0, restingWheelMotion()),
    },
  };
}
