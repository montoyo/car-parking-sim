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
import { VEHICLE, WHEEL_IDS, rackRate, referenceSteerAngle } from './vehicle';
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
  // The rate is speed-dependent (dry-steering is slower), so the player has to
  // wind the wheel rather than teleport to lock — most of all when parked.
  const rate = rackRate(v.longitudinalVelocity, VEHICLE);
  const rackError = input.steer - v.rack;
  const rackStep = clamp(rackError, -rate * dt, rate * dt);
  const rack = clamp(v.rack + rackStep, -1, 1);
  const steerAngle = referenceSteerAngle(rack, VEHICLE);

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

  // --- Kinematic bicycle PIVOTING ABOUT THE REAR AXLE. ---
  // The rear axle centre is what travels along the heading; the body origin sits
  // half a wheelbase ahead of it and therefore swings, which is exactly why the
  // rear wheels cut inside the fronts through a turn. Integrate the rear axle
  // and place the origin from it.
  const halfBase = VEHICLE.wheelbase / 2;
  const yawRate = (speed / VEHICLE.wheelbase) * Math.tan(steerAngle);
  const yaw = wrapAngle(v.pose.yaw + yawRate * dt);
  const heading = wrapAngle(v.pose.yaw + 0.5 * yawRate * dt);

  const rearX = v.pose.x - halfBase * Math.cos(v.pose.yaw) + speed * Math.cos(heading) * dt;
  const rearY = v.pose.y - halfBase * Math.sin(v.pose.yaw) + speed * Math.sin(heading) * dt;
  const pose = {
    x: rearX + halfBase * Math.cos(yaw),
    y: rearY + halfBase * Math.sin(yaw),
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
        // The origin is ahead of the pivot, so it has a lateral component even
        // in this kinematic model. Ticket 03 replaces this with real slip.
        lateralVelocity: yawRate * halfBase,
        yawRate,
        rack,
        gear,
        wheels: wheelStatesFor(pose, rack, spin),
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
