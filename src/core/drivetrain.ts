/**
 * The RWD drivetrain and the brakes.
 *
 *   engine torque curve -> single automatic ratio + final drive -> open
 *   differential -> REAR wheels only
 *
 * An open differential delivers EQUAL TORQUE to both output shafts (it is the
 * speeds that differ), which is why the split here is a plain halving and why a
 * rear wheel that runs out of grip takes its partner's tractive effort with it.
 *
 * Idle creep is the torque converter: at idle, in gear, the engine still feeds
 * torque to the wheels, fading out as road speed rises. That is what makes the
 * car crawl like a real automatic instead of behaving like an on/off toy.
 */

import type { Gear } from './input';
import type { VehicleDefinition, WheelId } from './vehicle';
import { VEHICLE } from './vehicle';

/** Direction the drivetrain drives in for a gear: +1 forward, -1 reverse, 0 neutral. */
export function gearDirection(gear: Gear): number {
  return gear === 'forward' ? 1 : gear === 'reverse' ? -1 : 0;
}

/** Combined gearbox + final drive ratio for a gear. Reverse is geared lower. */
export function gearRatio(gear: Gear, v: VehicleDefinition = VEHICLE): number {
  return gear === 'reverse' ? v.drivetrain.ratioReverse : v.drivetrain.ratioForward;
}

/**
 * Engine torque (Nm) at wide-open throttle for an engine speed in rad/s,
 * including the rev limiter — without it the single ratio would happily spin the
 * engine past its maximum and the car would have no top speed at all.
 */
export function engineTorqueCurve(engineSpeed: number, v: VehicleDefinition = VEHICLE): number {
  const d = v.drivetrain;
  const speed = clampRange(engineSpeed, d.idleSpeed, d.maxSpeed);
  const offset = (speed - d.peakTorqueSpeed) / d.peakTorqueSpeed;
  const shape = 1 - 0.55 * offset * offset;
  const limiter = clampRange((d.maxSpeed - engineSpeed) / (0.05 * d.maxSpeed), 0, 1);
  return d.peakTorque * clampRange(shape, 0.15, 1) * limiter;
}

/**
 * Drive torque (Nm) applied at EACH rear wheel. `rearWheelSpeed` is the mean of
 * the two rear wheel angular speeds (what an open diff presents to the engine)
 * and `roadSpeed` is the body's longitudinal velocity, which governs the creep
 * fade. Signed: negative torque in reverse.
 */
export function rearWheelDriveTorque(
  gear: Gear,
  throttle: number,
  rearWheelSpeed: number,
  roadSpeed: number,
  v: VehicleDefinition = VEHICLE,
): number {
  const direction = gearDirection(gear);
  if (direction === 0) return 0;

  const d = v.drivetrain;
  const ratio = gearRatio(gear, v);
  const engineSpeed = clampRange(Math.abs(rearWheelSpeed) * ratio, d.idleSpeed, d.maxSpeed);

  const creep = d.idleTorque * clampRange(1 - Math.abs(roadSpeed) / d.creepFadeSpeed, 0, 1);
  const wideOpen = engineTorqueCurve(engineSpeed, v);
  const engineTorque = creep + clampRange(throttle, 0, 1) * (wideOpen - creep);

  const atAxle = Math.max(0, engineTorque) * ratio * d.efficiency * direction;
  return atAxle / 2; // open differential: equal torque to each rear wheel
}

/**
 * Brake torque MAGNITUDE (Nm) at each wheel. The foot brake acts on all four
 * with a front bias; the handbrake adds torque to the REAR wheels only.
 */
export function brakeTorques(
  brake: number,
  handbrake: boolean,
  v: VehicleDefinition = VEHICLE,
): Readonly<Record<WheelId, number>> {
  const b = v.brakes;
  const pedal = clampRange(brake, 0, 1);
  const front = (pedal * b.maxTorque * b.frontBias) / 2;
  const rear = (pedal * b.maxTorque * (1 - b.frontBias)) / 2 + (handbrake ? b.handbrakeTorque : 0);
  return { frontLeft: front, frontRight: front, rearLeft: rear, rearRight: rear };
}

function clampRange(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
