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
