/**
 * The single vehicle definition. Source of truth for BOTH the simulation core
 * (collision shapes, dynamics) and the renderer (body mesh, camera, mirror
 * poses). The mirrors are only "accurate" if they read the same numbers the
 * physics does — so nobody re-declares these dimensions anywhere else.
 *
 * Coordinate convention (vehicle local frame, right-handed, metres):
 *   +x forward (nose)
 *   +y left
 *   +z up, z = 0 at the ground plane
 * The origin sits on the ground midway along the wheelbase. World poses
 * (`BodyPose.x`, `.y`, `.yaw`) place this origin.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Which corner of the car a wheel is at. Ordering is stable and load-bearing. */
export const WHEEL_IDS = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'] as const;
export type WheelId = (typeof WHEEL_IDS)[number];

export interface MirrorDefinition {
  /** Mirror centre in vehicle local coordinates (metres). */
  readonly mount: Vec3;
  /**
   * Outward normal of the reflective surface in vehicle local coordinates,
   * unit length. The renderer reflects the driver eye point through this plane.
   */
  readonly normal: Vec3;
  /** Reflective surface size (width x height, metres). */
  readonly width: number;
  readonly height: number;
  /**
   * Radius of curvature in metres for a convex (spherical) mirror.
   * `null` means a flat mirror (the interior rear-view mirror).
   */
  readonly convexRadius: number | null;
}

/**
 * Simplified Pacejka-style tyre. One curve serves both slip ratio and slip
 * angle: the two slips are normalised by their peak values into a single
 * combined-slip magnitude, the curve is evaluated once, and the resulting force
 * is split back along the slip direction. That IS the friction circle — a wheel
 * cannot deliver full cornering and full drive at once because both draw on the
 * same `peakFrictionCoefficient * load`.
 */
export interface TyreDefinition {
  /** Peak friction coefficient (dry tarmac). */
  readonly peakFrictionCoefficient: number;
  /** Slip ratio at which longitudinal force peaks. */
  readonly peakSlipRatio: number;
  /** Slip angle (rad) at which lateral force peaks. */
  readonly peakSlipAngle: number;
  /** Magic-formula shape factor; > 1 gives a peak followed by a mild falloff. */
  readonly curveShape: number;
  /** Rotational inertia of one wheel + hub + brake disc (kg m^2). */
  readonly rotationalInertia: number;
  /** Rolling resistance coefficient (fraction of vertical load). */
  readonly rollingResistance: number;
  /**
   * Floor (m/s) on the reference speed used to normalise slip. Without it slip
   * ratio and slip angle are singular at a standstill — which is exactly the
   * numerical cliff the low-speed kinematic blend exists to avoid.
   */
  readonly slipReferenceSpeed: number;
}

/**
 * Rear-wheel drive: torque curve -> fixed final drive -> open differential ->
 * rear wheels only. `ratioForward` / `ratioReverse` are the COMBINED gear and
 * final-drive ratios (the car is an automatic with one forward ratio); reverse
 * is geared lower, i.e. numerically higher, so it is torquier and slower.
 */
export interface DrivetrainDefinition {
  readonly peakTorque: number;
  /** Engine speed (rad/s) at which `peakTorque` is produced. */
  readonly peakTorqueSpeed: number;
  readonly idleSpeed: number;
  readonly maxSpeed: number;
  /** Engine torque fed through the converter at idle — this is the creep. */
  readonly idleTorque: number;
  /**
   * Road speed (m/s) at which the torque converter has stopped multiplying and
   * idle creep has faded to nothing. Sets the speed a car in gear creeps to.
   */
  readonly creepFadeSpeed: number;
  readonly ratioForward: number;
  readonly ratioReverse: number;
  readonly efficiency: number;
}

export interface BrakeDefinition {
  /** Total brake torque at full pedal, summed over all four wheels (Nm). */
  readonly maxTorque: number;
  /** Fraction of `maxTorque` going to the front axle. */
  readonly frontBias: number;
  /** Handbrake torque per REAR wheel (Nm). The handbrake locks the rears only. */
  readonly handbrakeTorque: number;
}

/**
 * Pitch and roll are NOT degrees of freedom — they are derived from the body's
 * longitudinal / lateral acceleration purely so the camera and body mesh lean
 * convincingly. These gains and the lag are that derivation's only tuning.
 */
export interface ChassisAttitudeDefinition {
  /** Radians of nose-up pitch per m/s^2 of forward acceleration. */
  readonly pitchPerLongitudinalAccel: number;
  /** Radians of roll per m/s^2 of lateral acceleration. */
  readonly rollPerLateralAccel: number;
  /** First-order lag (s) so attitude does not snap with the force. */
  readonly responseTime: number;
}

export interface VehicleDefinition {
  readonly name: string;

  /** Distance between front and rear axle centres (m). */
  readonly wheelbase: number;
  /** Lateral distance between the front wheel centres (m). */
  readonly trackFront: number;
  /** Lateral distance between the rear wheel centres (m). */
  readonly trackRear: number;

  /** Bodywork beyond the front axle (m). */
  readonly frontOverhang: number;
  /** Bodywork beyond the rear axle (m). */
  readonly rearOverhang: number;

  /** Overall body width including mirrors folded in, i.e. bodywork only (m). */
  readonly bodyWidth: number;
  /** Roof height above ground (m). */
  readonly bodyHeight: number;
  /** Lowest bodywork height above ground — sill / bumper underside (m). */
  readonly sillHeight: number;

  readonly wheelRadius: number;
  readonly wheelWidth: number;

  /** Mass (kg) and yaw inertia (kg m^2). */
  readonly mass: number;
  readonly yawInertia: number;
  /** Centre of gravity height above ground (m) — drives weight transfer. */
  readonly cgHeight: number;
  /** Fraction of static weight on the front axle, in [0, 1]. */
  readonly frontWeightFraction: number;

  /** Maximum road-wheel steer angle at full rack lock (radians). */
  readonly maxSteerAngle: number;
  /** Seconds for the rack to travel lock-to-lock while rolling. */
  readonly rackLockToLockSeconds: number;
  /**
   * Seconds for the rack to travel lock-to-lock at a standstill. Dry-steering
   * scrubs the tyres against the road, so the wheel is heavier: this is longer
   * than `rackLockToLockSeconds`.
   */
  readonly rackLockToLockSecondsStationary: number;
  /**
   * Speed (m/s) at or above which the rack moves at its full rolling rate.
   * Between 0 and this the rate blends linearly, so there is no step in
   * steering feel as the car starts to roll.
   */
  readonly rackRollingSpeed: number;

  readonly tyre: TyreDefinition;
  readonly drivetrain: DrivetrainDefinition;
  readonly brakes: BrakeDefinition;
  readonly attitude: ChassisAttitudeDefinition;

  /**
   * Body speed (m/s) at or above which the vehicle is solved purely from tyre
   * forces. Below it the solution blends continuously toward the kinematic
   * rear-axle-pivot bicycle, because a force-based model degenerates into
   * jitter and slip-angle singularities at crawl speed — and crawl speed is the
   * entire game.
   */
  readonly kinematicBlendSpeed: number;

  /** Driver's eye point in vehicle local coordinates (left-hand drive: +y). */
  readonly driverEyePoint: Vec3;

  readonly mirrors: {
    readonly interior: MirrorDefinition;
    readonly wingLeft: MirrorDefinition;
    readonly wingRight: MirrorDefinition;
  };
}

/** The one shipping vehicle: a mid-size left-hand-drive RWD saloon. */
export const VEHICLE: VehicleDefinition = {
  name: 'Saloon',

  wheelbase: 2.7,
  trackFront: 1.55,
  trackRear: 1.56,

  frontOverhang: 0.86,
  rearOverhang: 0.94,

  bodyWidth: 1.82,
  bodyHeight: 1.45,
  sillHeight: 0.16,

  wheelRadius: 0.32,
  wheelWidth: 0.215,

  mass: 1450,
  yawInertia: 2100,
  cgHeight: 0.54,
  frontWeightFraction: 0.53,

  maxSteerAngle: 0.58,
  rackLockToLockSeconds: 2.4,
  rackLockToLockSecondsStationary: 4.6,
  rackRollingSpeed: 0.6,

  tyre: {
    peakFrictionCoefficient: 1.0,
    peakSlipRatio: 0.12,
    peakSlipAngle: 0.14,
    curveShape: 1.5,
    rotationalInertia: 1.1,
    rollingResistance: 0.014,
    slipReferenceSpeed: 0.6,
  },

  drivetrain: {
    peakTorque: 200,
    peakTorqueSpeed: 300,
    idleSpeed: 80,
    maxSpeed: 600,
    idleTorque: 45,
    creepFadeSpeed: 1.6,
    // Combined single-speed automatic + final drive. Reverse is geared lower.
    ratioForward: 12.5,
    ratioReverse: 14.5,
    efficiency: 0.92,
  },

  brakes: {
    maxTorque: 4800,
    frontBias: 0.62,
    handbrakeTorque: 1800,
  },

  attitude: {
    pitchPerLongitudinalAccel: 0.006,
    rollPerLateralAccel: 0.008,
    responseTime: 0.18,
  },

  kinematicBlendSpeed: 3.0,

  driverEyePoint: { x: 0.35, y: 0.37, z: 1.18 },

  mirrors: {
    interior: {
      mount: { x: 0.62, y: 0.0, z: 1.28 },
      normal: { x: 1, y: 0, z: 0 },
      width: 0.26,
      height: 0.08,
      convexRadius: null,
    },
    wingLeft: {
      mount: { x: 0.72, y: 0.95, z: 1.02 },
      normal: { x: 0.34, y: 0.94, z: 0 },
      width: 0.17,
      height: 0.1,
      convexRadius: 1.2,
    },
    wingRight: {
      mount: { x: 0.72, y: -0.95, z: 1.02 },
      normal: { x: 0.34, y: -0.94, z: 0 },
      width: 0.17,
      height: 0.1,
      convexRadius: 1.2,
    },
  },
};

/** Gravitational acceleration (m/s^2). The one place it is written down. */
export const GRAVITY = 9.81;

/** Overall bumper-to-bumper length (m), derived — never stored twice. */
export function vehicleLength(v: VehicleDefinition = VEHICLE): number {
  return v.wheelbase + v.frontOverhang + v.rearOverhang;
}

/** Signed local x of the front axle (origin is midway along the wheelbase). */
export function frontAxleX(v: VehicleDefinition = VEHICLE): number {
  return v.wheelbase / 2;
}

export function rearAxleX(v: VehicleDefinition = VEHICLE): number {
  return -v.wheelbase / 2;
}

/**
 * Body outline in the ground plane, vehicle local coordinates, counter-clockwise
 * starting at the front-left corner. Used for collision AND for the body mesh.
 */
export function bodyOutline(v: VehicleDefinition = VEHICLE): readonly Vec2[] {
  const xf = frontAxleX(v) + v.frontOverhang;
  const xr = rearAxleX(v) - v.rearOverhang;
  const hw = v.bodyWidth / 2;
  return [
    { x: xf, y: hw },
    { x: xr, y: hw },
    { x: xr, y: -hw },
    { x: xf, y: -hw },
  ];
}

/**
 * Reference (virtual bicycle) road-wheel angle for a rack position, radians.
 * Positive = steering LEFT, matching `ControlInput.steer` and the +y-is-left
 * frame. This is the angle of the single front wheel of the equivalent bicycle,
 * sitting at the centre of the front axle.
 */
export function referenceSteerAngle(rack: number, v: VehicleDefinition = VEHICLE): number {
  const r = rack < -1 ? -1 : rack > 1 ? 1 : rack;
  return r * v.maxSteerAngle;
}

/**
 * Turn radius of the rear-axle centre about the instantaneous centre for a rack
 * position, metres. `Infinity` when the rack is centred (straight ahead).
 */
export function turnRadius(rack: number, v: VehicleDefinition = VEHICLE): number {
  const delta = referenceSteerAngle(rack, v);
  if (delta === 0) return Infinity;
  return v.wheelbase / Math.tan(Math.abs(delta));
}

/**
 * Ackermann front road-wheel angles for a rack position (radians, positive =
 * left). The inner wheel takes MORE lock than the outer because it runs on a
 * tighter circle about the same instantaneous centre — that is the whole point
 * of Ackermann geometry, and it comes straight out of the wheelbase and front
 * track in this definition. Nothing else in the project computes these.
 */
export function ackermannSteerAngles(
  rack: number,
  v: VehicleDefinition = VEHICLE,
): { readonly frontLeft: number; readonly frontRight: number } {
  const delta = referenceSteerAngle(rack, v);
  if (delta === 0) return { frontLeft: 0, frontRight: 0 };

  const radius = turnRadius(rack, v);
  const halfTrack = v.trackFront / 2;
  const sign = delta > 0 ? 1 : -1;

  // Distance from the instantaneous centre to each front wheel, along the axle.
  const innerArm = radius - halfTrack;
  const outerArm = radius + halfTrack;
  const inner = innerArm <= 0 ? Math.PI / 2 : Math.atan(v.wheelbase / innerArm);
  const outer = Math.atan(v.wheelbase / outerArm);

  // Turning left, the left wheel is the inner one.
  return sign > 0
    ? { frontLeft: inner, frontRight: outer }
    : { frontLeft: -outer, frontRight: -inner };
}

/**
 * How fast the rack can travel (rack units per second) at a given body speed.
 * Slower at a standstill than rolling; blends linearly so there is no step.
 */
export function rackRate(speed: number, v: VehicleDefinition = VEHICLE): number {
  const stationary = 2 / v.rackLockToLockSecondsStationary;
  const rolling = 2 / v.rackLockToLockSeconds;
  const raw = Math.abs(speed) / v.rackRollingSpeed;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  return stationary + (rolling - stationary) * t;
}

/** Wheel hub centre in vehicle local ground-plane coordinates. */
export function wheelPosition(id: WheelId, v: VehicleDefinition = VEHICLE): Vec2 {
  switch (id) {
    case 'frontLeft':
      return { x: frontAxleX(v), y: v.trackFront / 2 };
    case 'frontRight':
      return { x: frontAxleX(v), y: -v.trackFront / 2 };
    case 'rearLeft':
      return { x: rearAxleX(v), y: v.trackRear / 2 };
    case 'rearRight':
      return { x: rearAxleX(v), y: -v.trackRear / 2 };
  }
}
