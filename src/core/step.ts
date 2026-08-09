/**
 * The core's tick function — the project's single seam.
 *
 *   step(world, input, dt) -> { world, events }
 *
 * Pure: no DOM, no WebGL, no timers, no Math.random. Called at a FIXED dt by an
 * accumulator in the render loop, which is what makes it frame-rate independent
 * and deterministic.
 *
 * This function is deliberately thin: it advances the steering rack, hands the
 * body over to `dynamics.ts`, and integrates the pose from the resulting motion.
 * The vehicle model itself lives in `dynamics.ts` / `tyre.ts` / `drivetrain.ts`.
 */

import type { ControlInput } from './input';
import { clamp, sanitiseInput } from './input';
import type { SimEvent } from './events';
import { resolveBodyCollisions } from './collision';
import { resolveKerbCollisions } from './kerb';
import type { DynamicsState } from './dynamics';
import { solveDynamics } from './dynamics';
import { VEHICLE, rackRate } from './vehicle';
import type { BodyPose, WorldState } from './world';
import { wheelStatesFor } from './world';

export interface StepResult {
  readonly world: WorldState;
  readonly events: readonly SimEvent[];
}

/** The fixed timestep the accumulator feeds `step`. 120 Hz. */
export const FIXED_DT = 1 / 120;

/**
 * The dynamics are integrated this many times per `step`. The tyre and
 * drivetrain forces are velocity-dependent, so a single explicit update leaves a
 * truncation error proportional to dt — visible as a path that changes shape when
 * the timestep changes. Substepping buys that accuracy back for a few hundred
 * extra floating-point operations per tick, which is nothing next to a frame.
 */
export const DYNAMICS_SUBSTEPS = 4;

export function step(world: WorldState, rawInput: ControlInput, dt: number): StepResult {
  const input = sanitiseInput(rawInput);
  const v = world.vehicle;
  const events: SimEvent[] = [];
  const tick = world.tick + 1;

  if (input.gear !== v.gear) {
    events.push({ kind: 'gearChange', tick, from: v.gear, to: input.gear });
  }

  // --- Steering rack: bounded rate toward the target, hard finite lock. ---
  // The rate is speed-dependent (dry-steering is slower), so the player has to
  // wind the wheel rather than teleport to lock — most of all when parked.
  const rate = rackRate(v.longitudinalVelocity, VEHICLE);
  const rackStep = clamp(input.steer - v.rack, -rate * dt, rate * dt);
  const rack = clamp(v.rack + rackStep, -1, 1);

  // --- The vehicle model, integrated in substeps. ---
  const h = dt / DYNAMICS_SUBSTEPS;
  let state: DynamicsState = v;
  let pose: BodyPose = v.pose;
  let motion = solveDynamics(state, rack, input, h, VEHICLE);

  for (let i = 0; i < DYNAMICS_SUBSTEPS; i++) {
    if (i > 0) motion = solveDynamics(state, rack, input, h, VEHICLE);

    // Pose: trapezoidal integration about the midpoint heading. Averaging the
    // velocity over the substep and rotating by its mid heading is second order
    // in h; using the end-of-substep values instead leaves an error proportional
    // to acceleration * h, which shows up as a frame-rate dependent path — the
    // one thing the fixed timestep exists to prevent.
    const yawRate = (state.yawRate + motion.yawRate) / 2;
    const forward = (state.longitudinalVelocity + motion.longitudinalVelocity) / 2;
    const sideways = (state.lateralVelocity + motion.lateralVelocity) / 2;
    const mid = pose.yaw + 0.5 * yawRate * h;
    const cos = Math.cos(mid);
    const sin = Math.sin(mid);

    pose = {
      x: pose.x + (forward * cos - sideways * sin) * h,
      y: pose.y + (forward * sin + sideways * cos) * h,
      yaw: wrapAngle(pose.yaw + yawRate * h),
    };
    state = motion;
  }

  // --- Collision, after the pose has moved. -------------------------------
  // Bodywork against parked cars, walls and bollards: the car is pushed out of
  // the overlap and takes an impulse, so it is stopped or deflected rather than
  // driving through. The contact events go out on the same stream as everything
  // else — live cue, scoring penalty and replay marker, one mechanism.
  const time = world.time + dt;
  const collision = resolveBodyCollisions({
    pose,
    longitudinalVelocity: motion.longitudinalVelocity,
    lateralVelocity: motion.lateralVelocity,
    yawRate: motion.yawRate,
    contacts: world.contacts,
    scenario: world.scenario,
    tick,
    time,
  });
  events.push(...collision.events);
  pose = collision.pose;

  // The roadway border, tested after the body has been pushed out of anything
  // solid so the wheels are reported where they finally are. Kerbing is its own
  // class of mistake — a rim strike on a named wheel, or an overhang scrape — and
  // it threads through the SAME contacts list so the two passes cannot prune each
  // other's records.
  const kerb = resolveKerbCollisions({
    pose,
    longitudinalVelocity: collision.longitudinalVelocity,
    lateralVelocity: collision.lateralVelocity,
    yawRate: collision.yawRate,
    rack,
    contacts: collision.contacts,
    scenario: world.scenario,
    tick,
    time,
  });
  events.push(...kerb.events);

  return {
    world: {
      ...world,
      tick,
      time,
      contacts: kerb.contacts,
      vehicle: {
        pose,
        longitudinalVelocity: collision.longitudinalVelocity,
        lateralVelocity: collision.lateralVelocity,
        yawRate: collision.yawRate,
        longitudinalAcceleration: motion.longitudinalAcceleration,
        lateralAcceleration: motion.lateralAcceleration,
        pitch: motion.pitch,
        roll: motion.roll,
        kinematicBlend: motion.kinematicBlend,
        rack,
        gear: input.gear,
        wheels: wheelStatesFor(pose, rack, motion.wheels),
      },
    },
    events,
  };
}

/** Wrap to (-pi, pi]. */
export function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
