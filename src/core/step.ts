/**
 * The core's tick function — the project's single seam.
 *
 *   step(world, input, dt) -> { world, events }
 *
 * Pure: no DOM, no WebGL, no timers, no Math.random. Called at a FIXED dt by an
 * accumulator in the render loop, which is what makes it frame-rate independent
 * and deterministic.
 *
 * The vehicle model here is a deliberate PLACEHOLDER kinematic bicycle. Tickets
 * 02/03 replace its internals (Ackermann rack, tyre forces, weight transfer,
 * low-speed blend) without changing this signature or the tests written against
 * it.
 */

import type { ControlInput } from './input';
import { clamp, sanitiseInput } from './input';
import type { SimEvent } from './events';
import type { WheelId } from './vehicle';
import { VEHICLE, WHEEL_IDS } from './vehicle';
import type { WorldState } from './world';
import { wheelStatesFor } from './world';

export interface StepResult {
  readonly world: WorldState;
  readonly events: readonly SimEvent[];
}

/** The fixed timestep the accumulator feeds `step`. 120 Hz. */
export const FIXED_DT = 1 / 120;

/** Placeholder longitudinal tuning — superseded by the drivetrain in ticket 03. */
const DRIVE_ACCEL = 2.2; // m/s^2 at full throttle
const BRAKE_ACCEL = 6.0; // m/s^2 at full brake
const IDLE_CREEP_SPEED = 0.7; // m/s the placeholder creeps to in gear
const COAST_DECEL = 0.6; // m/s^2 rolling resistance
const MAX_SPEED = 8.0; // m/s

export function step(world: WorldState, rawInput: ControlInput, dt: number): StepResult {
  const input = sanitiseInput(rawInput);
  const v = world.vehicle;
  const events: SimEvent[] = [];
  const tick = world.tick + 1;

  if (input.gear !== v.gear) {
    events.push({ kind: 'gearChange', tick, from: v.gear, to: input.gear });
  }
  const gear = input.gear;

  // --- Steering rack: bounded rate toward the target, hard finite lock. ---
  const rackRate = 2 / VEHICLE.rackLockToLockSeconds;
  const rackError = input.steer - v.rack;
  const rackStep = clamp(rackError, -rackRate * dt, rackRate * dt);
  const rack = clamp(v.rack + rackStep, -1, 1);
  const steerAngle = rack * VEHICLE.maxSteerAngle;

  // --- Longitudinal: signed speed along the body's forward axis. ---
  const direction = gear === 'forward' ? 1 : gear === 'reverse' ? -1 : 0;
  let speed = v.longitudinalVelocity;

  if (input.handbrake) {
    speed = approachZero(speed, BRAKE_ACCEL * dt);
  } else if (input.brake > 0) {
    speed = approachZero(speed, input.brake * BRAKE_ACCEL * dt);
  } else if (direction === 0) {
    speed = approachZero(speed, COAST_DECEL * dt);
  } else {
    // Drive torque plus idle creep, both acting in the selected direction.
    const target = direction * (IDLE_CREEP_SPEED + input.throttle * (MAX_SPEED - IDLE_CREEP_SPEED));
    const accel = DRIVE_ACCEL * (0.35 + 0.65 * input.throttle);
    speed = approach(speed, target, accel * dt);
  }
  speed = clamp(speed, -MAX_SPEED, MAX_SPEED);

  // --- Kinematic bicycle about the rear axle. ---
  const yawRate = (speed / VEHICLE.wheelbase) * Math.tan(steerAngle);
  const yaw = wrapAngle(v.pose.yaw + yawRate * dt);
  const heading = wrapAngle(v.pose.yaw + 0.5 * yawRate * dt);
  const pose = {
    x: v.pose.x + speed * Math.cos(heading) * dt,
    y: v.pose.y + speed * Math.sin(heading) * dt,
    yaw,
  };

  const spinDelta = (speed * dt) / VEHICLE.wheelRadius;
  const spin = {} as Record<WheelId, number>;
  for (const id of WHEEL_IDS) {
    spin[id] = v.wheels[id].spin + spinDelta;
  }

  return {
    world: {
      ...world,
      tick,
      time: world.time + dt,
      vehicle: {
        pose,
        longitudinalVelocity: speed,
        lateralVelocity: 0,
        yawRate,
        rack,
        gear,
        wheels: wheelStatesFor(pose, steerAngle, spin),
      },
    },
    events,
  };
}

function approach(value: number, target: number, maxDelta: number): number {
  return value + clamp(target - value, -maxDelta, maxDelta);
}

function approachZero(value: number, maxDelta: number): number {
  if (Math.abs(value) <= maxDelta) return 0;
  return value > 0 ? value - maxDelta : value + maxDelta;
}

/** Wrap to (-pi, pi]. */
export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
