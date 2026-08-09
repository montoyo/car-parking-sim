/**
 * The vehicle dynamics solve for one fixed timestep.
 *
 * Planar rigid body: longitudinal velocity, lateral velocity, yaw rate, plus one
 * integrated angular speed per wheel. Forces come from `tyre.ts`, torques from
 * `drivetrain.ts`; this module owns the state and the integration, and nothing
 * else in the project may.
 *
 * TWO THINGS HERE ARE LOAD-BEARING AND EASY TO BREAK:
 *
 * 1. The wheel-spin update is IMPLICIT in the tyre's longitudinal stiffness. The
 *    linear region of a tyre is stiff enough (thousands of N per unit of slip)
 *    that an explicit 120 Hz update oscillates and then diverges. Linearising
 *    the road reaction about the current slip and solving for the new spin rate
 *    makes the update unconditionally stable at any dt.
 *
 * 2. Below `kinematicBlendSpeed` the lateral/yaw solution blends continuously
 *    toward the KINEMATIC rear-axle-pivot bicycle. At crawl speed slip angles
 *    are the ratio of two near-zero numbers, so a purely force-based model
 *    jitters, wanders, and refuses to settle — and crawl speed is the entire
 *    game. The blend weight is a smoothstep of speed (value AND slope continuous
 *    at both ends), so yaw rate never steps as the car accelerates through the
 *    threshold.
 *
 * Longitudinal velocity is ALWAYS force-based, at every speed: the drivetrain,
 * the brakes and the handbrake have to keep their authority over a crawl, and
 * scrub drag from cranked-over front wheels has to keep limiting speed at lock.
 */

import type { ControlInput } from './input';
import { clamp } from './input';
import { brakeTorques, rearWheelDriveTorque } from './drivetrain';
import { longitudinalStiffness, tyreForce, wheelLoads } from './tyre';
import type { VehicleDefinition, WheelId } from './vehicle';
import {
  VEHICLE,
  WHEEL_IDS,
  ackermannSteerAngles,
  referenceSteerAngle,
  wheelPosition,
} from './vehicle';
import type { WheelMotion } from './world';

/**
 * The subset of the vehicle's state the dynamics reads. `VehicleState` satisfies
 * it, and so does a `DynamicsSolution` — which is what lets `step` feed one
 * solve straight into the next when it substeps.
 */
export interface DynamicsState {
  readonly longitudinalVelocity: number;
  readonly lateralVelocity: number;
  readonly yawRate: number;
  readonly longitudinalAcceleration: number;
  readonly lateralAcceleration: number;
  readonly pitch: number;
  readonly roll: number;
  readonly wheels: Readonly<Record<WheelId, WheelMotion>>;
}

export interface DynamicsSolution extends DynamicsState {
  readonly kinematicBlend: number;
}

/** Body speed below which longitudinal motion is snapped to rest when held. */
const REST_SPEED = 0.02;

/**
 * Weight of the kinematic solution at a given speed: 1 at a standstill, 0 at and
 * above `kinematicBlendSpeed`, smoothstep in between so both the value and its
 * slope are continuous — no discontinuity in yaw rate through the threshold.
 */
export function kinematicWeight(speed: number, v: VehicleDefinition = VEHICLE): number {
  const u = clamp(Math.abs(speed) / v.kinematicBlendSpeed, 0, 1);
  return 1 - u * u * (3 - 2 * u);
}

/**
 * Advance the vehicle's motion by `dt`. `rack` is the rack position AFTER this
 * tick's rack update (the rack is not part of the dynamics — it is an input to
 * it). Pure.
 */
export function solveDynamics(
  state: DynamicsState,
  rack: number,
  input: ControlInput,
  dt: number,
  v: VehicleDefinition = VEHICLE,
): DynamicsSolution {
  const t = v.tyre;
  const radius = v.wheelRadius;
  const inertia = t.rotationalInertia;

  const vx = state.longitudinalVelocity;
  const vy = state.lateralVelocity;
  const yawRate = state.yawRate;

  const steer = ackermannSteerAngles(rack, v);
  // Loads use the previous tick's accelerations: weight transfer lags the forces
  // it comes from by one step, which at 120 Hz is imperceptible and keeps the
  // solve non-circular.
  const loads = wheelLoads(state.longitudinalAcceleration, state.lateralAcceleration, v);
  const braking = brakeTorques(input.brake, input.handbrake, v);

  const meanRearSpin = (state.wheels.rearLeft.spinRate + state.wheels.rearRight.spinRate) / 2;
  const driveTorque = rearWheelDriveTorque(input.gear, input.throttle, meanRearSpin, vx, v);

  let forceX = 0;
  let forceY = 0;
  let moment = 0;
  const wheels = {} as Record<WheelId, WheelMotion>;

  for (const id of WHEEL_IDS) {
    const local = wheelPosition(id, v);
    const delta =
      id === 'frontLeft' ? steer.frontLeft : id === 'frontRight' ? steer.frontRight : 0;
    const cos = Math.cos(delta);
    const sin = Math.sin(delta);

    // Contact-patch velocity in the body frame, then rotated into the wheel's.
    const patchX = vx - yawRate * local.y;
    const patchY = vy + yawRate * local.x;
    const rollSpeed = patchX * cos + patchY * sin;
    const slideSpeed = -patchX * sin + patchY * cos;

    const reference = Math.max(Math.abs(rollSpeed), t.slipReferenceSpeed);
    const slipAngle = Math.atan(slideSpeed / reference);
    const load = loads[id];

    const spinRate = state.wheels[id].spinRate;
    const slip0 = (spinRate * radius - rollSpeed) / reference;
    const force0 = tyreForce(slip0, slipAngle, load, t);

    const drive = id === 'rearLeft' || id === 'rearRight' ? driveTorque : 0;
    const rolling = t.rollingResistance * load * radius;
    const resistance = braking[id] + rolling;

    // Resistance opposes rotation; if the wheel is stopped, it opposes the
    // direction the car is trying to roll it. Capping it at what could bring the
    // wheel to rest this step is what stops locked wheels chattering.
    const direction = spinRate !== 0 ? Math.sign(spinRate) : Math.sign(rollSpeed);
    const cap =
      Math.abs((inertia * spinRate) / dt) + Math.abs(drive) + Math.abs(force0.longitudinal * radius);
    const applied = Math.min(resistance, cap);
    const torque = drive - direction * applied;

    // Implicit in the tyre's longitudinal stiffness — see the note at the top.
    const stiffness = longitudinalStiffness(load, t);
    const damping = 1 + (dt * stiffness * radius * radius) / (inertia * reference);
    const spinDelta = ((dt / inertia) * (torque - force0.longitudinal * radius)) / damping;
    let spinRateNext = spinRate + spinDelta;
    if (resistance > 0 && spinRateNext * spinRate < 0) spinRateNext = 0;

    const slip = clamp((spinRateNext * radius - rollSpeed) / reference, -5, 5);
    const force = tyreForce(slip, slipAngle, load, t);

    const bodyX = force.longitudinal * cos - force.lateral * sin;
    const bodyY = force.longitudinal * sin + force.lateral * cos;
    forceX += bodyX;
    forceY += bodyY;
    moment += local.x * bodyY - local.y * bodyX;

    wheels[id] = {
      spin: state.wheels[id].spin + spinRateNext * dt,
      spinRate: spinRateNext,
      slipRatio: slip,
      slipAngle,
      load,
      longitudinalForce: force.longitudinal,
      lateralForce: force.lateral,
      gripUtilisation: force.gripUtilisation,
    };
  }

  const accelX = forceX / v.mass;
  const accelY = forceY / v.mass;

  // Body-frame velocity integration (the r x v terms are the rotating frame).
  let nextVx = vx + dt * (accelX + yawRate * vy);
  const dynamicVy = vy + dt * (accelY - yawRate * vx);
  const dynamicYawRate = yawRate + (dt * moment) / v.yawInertia;

  // Nothing is driving the car forward: let it come properly to rest instead of
  // creeping on numerical dust or reversing under its own brakes.
  const held = input.brake > 0 || input.handbrake || input.gear === 'neutral';
  if (held && (nextVx * vx < 0 || Math.abs(nextVx) < REST_SPEED)) nextVx = 0;

  const blend = kinematicWeight(nextVx, v);
  const kinematicYawRate = (nextVx / v.wheelbase) * Math.tan(referenceSteerAngle(rack, v));
  // The rear axle is the pivot, so the body origin — half a wheelbase ahead of
  // it — necessarily has a lateral velocity. That is the same geometry that
  // makes the rear wheels cut inside the fronts.
  const kinematicVy = (kinematicYawRate * v.wheelbase) / 2;

  const nextVy = (1 - blend) * dynamicVy + blend * kinematicVy;
  const nextYawRate = (1 - blend) * dynamicYawRate + blend * kinematicYawRate;

  // Pitch and roll are cosmetic: a lagged reading of the accelerations, never a
  // degree of freedom. Nothing in the solve above reads them back.
  const lag = dt / (v.attitude.responseTime + dt);
  const pitchTarget = v.attitude.pitchPerLongitudinalAccel * accelX;
  const rollTarget = -v.attitude.rollPerLateralAccel * accelY;

  return {
    longitudinalVelocity: nextVx,
    lateralVelocity: nextVy,
    yawRate: nextYawRate,
    longitudinalAcceleration: accelX,
    lateralAcceleration: accelY,
    pitch: state.pitch + (pitchTarget - state.pitch) * lag,
    roll: state.roll + (rollTarget - state.roll) * lag,
    kinematicBlend: blend,
    wheels,
  };
}
