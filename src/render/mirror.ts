/**
 * Mirror geometry: interior rear-view (flat) and two convex wing mirrors.
 *
 * Everything here is derived by reflecting the driver's eye point through the
 * mirror plane declared in the shared vehicle definition — the same numbers the
 * physics reads. Nothing is a "second camera pointing backwards", and nothing is
 * hand-tuned to fake a blind spot: a mirror sees exactly the cone its glass
 * subtends from the reflected eye, so what falls outside that cone is invisible
 * as a consequence of the geometry.
 *
 * The maths, in order:
 *   1. The glass plane in vehicle-local coordinates, rotated by the player's aim.
 *   2. Its world pose, via the body transform the first-person camera also uses.
 *   3. The world reflection matrix R about that plane (a mirror, so det R = -1).
 *   4. The view matrix: a camera at the driver's eye aimed at the glass, times R.
 *      Rendering the unreflected scene through it gives the reflected image —
 *      with reversed triangle winding, which is why mirror passes cull the front
 *      faces instead of the back ones.
 *   5. An off-axis frustum whose sides pass exactly through the four glass
 *      corners. That frustum IS the mirror's field of view, and its narrowness
 *      is the blind spot.
 *   6. For a convex mirror, that frustum is widened by the spherical mirror's
 *      angular magnification and the image is radially warped on the way back
 *      out, so the centre keeps true scale and the edges compress.
 *
 * Pure maths on a `VehicleState`, so it is testable even though the WebGL passes
 * it feeds are judged by eye.
 */

import type { MirrorDefinition, Vec3, VehicleDefinition, VehicleState } from '../core/index';
import { VEHICLE } from '../core/index';
import type { Mat4 } from './mat4';
import {
  frustum,
  identity,
  invertRigid,
  multiply,
  rotationY,
  rotationZ,
  transformDirection,
  transformPoint,
} from './mat4';
import { bodyTransform, driverEyeWorld } from './camera';

const DEG = Math.PI / 180;

export const MIRROR_IDS = ['interior', 'wingLeft', 'wingRight'] as const;
export type MirrorId = (typeof MIRROR_IDS)[number];

/** Which flank a mirror looks down; the interior mirror looks at neither. */
export type MirrorSide = 'left' | 'right';

/**
 * How the player has aimed a mirror, as a rotation of the glass: +yaw swings the
 * glass toward the car's left, +pitch tips its top edge up. A real mirror turns
 * the reflected view by twice the angle of the glass, and that falls out of the
 * reflection rather than being applied here.
 */
export interface MirrorAim {
  readonly yaw: number;
  readonly pitch: number;
}

export const MIRROR_AIM_NEUTRAL: MirrorAim = { yaw: 0, pitch: 0 };

/**
 * Adjustment range. Small, because a mirror is trimmed rather than swung: past
 * this you would be looking at your own door or the sky, which no driver sets up.
 */
export const MIRROR_AIM_LIMITS = {
  maxYaw: 14 * DEG,
  maxPitch: 10 * DEG,
} as const;

export type MirrorAimSet = Readonly<Record<MirrorId, MirrorAim>>;

export const NEUTRAL_MIRROR_AIM: MirrorAimSet = {
  interior: MIRROR_AIM_NEUTRAL,
  wingLeft: MIRROR_AIM_NEUTRAL,
  wingRight: MIRROR_AIM_NEUTRAL,
};

export function clampMirrorAim(aim: MirrorAim): MirrorAim {
  return {
    yaw: clampTo(aim.yaw, MIRROR_AIM_LIMITS.maxYaw),
    pitch: clampTo(aim.pitch, MIRROR_AIM_LIMITS.maxPitch),
  };
}

export function mirrorDefinition(id: MirrorId, v: VehicleDefinition = VEHICLE): MirrorDefinition {
  return v.mirrors[id];
}

/** Whether a mirror's glass is curved. Only the interior mirror is flat. */
export function isConvex(id: MirrorId, v: VehicleDefinition = VEHICLE): boolean {
  return mirrorDefinition(id, v).convexRadius !== null;
}

/**
 * An orthonormal frame for the glass in vehicle-local coordinates: `normal` is
 * the outward (driver-facing) normal after aim, `tangent` runs across the glass
 * width and `up` along its height.
 */
export interface MirrorFrame {
  readonly centre: Vec3;
  readonly normal: Vec3;
  readonly tangent: Vec3;
  readonly up: Vec3;
}

export function mirrorFrame(
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): MirrorFrame {
  const mirror = mirrorDefinition(id, v);
  const clamped = clampMirrorAim(aim);
  // The declared normal points away from the driver, so a rotation that raises
  // the glass' far edge is the one that raises the reflected view: +pitch up.
  const rotate = multiply(rotationZ(clamped.yaw), rotationY(clamped.pitch));
  // The declared normal's sign is arbitrary (a plane reflects the same either
  // way); orient it toward the driver so the glass frame is the face they see.
  const normal = towardDriver(
    normalise(transformDirection(rotate, normalise(mirror.normal))),
    mirror.mount,
    v,
  );
  // Glass "up" is world up projected onto the plane, so the image is never rolled.
  const up = normalise(reject({ x: 0, y: 0, z: 1 }, normal));
  const tangent = normalise(cross(up, normal));
  return { centre: mirror.mount, normal, tangent, up };
}

/** The four corners of the glass, vehicle-local, counter-clockwise from bottom-left. */
export function mirrorCorners(
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): readonly Vec3[] {
  const mirror = mirrorDefinition(id, v);
  const frame = mirrorFrame(id, aim, v);
  const hw = mirror.width / 2;
  const hh = mirror.height / 2;
  return [
    corner(frame, -hw, -hh),
    corner(frame, hw, -hh),
    corner(frame, hw, hh),
    corner(frame, -hw, hh),
  ];
}

/**
 * The glass frame in world space as a rigid transform: columns are tangent, up,
 * normal, and the translation is the glass centre. The renderer scales this to
 * place the glass quad and its housing.
 */
export function mirrorFrameWorld(
  vehicle: VehicleState,
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): Mat4 {
  const body = bodyTransform(vehicle);
  const frame = mirrorFrame(id, aim, v);
  const t = transformDirection(body, frame.tangent);
  const u = transformDirection(body, frame.up);
  const n = transformDirection(body, frame.normal);
  const c = transformPoint(body, frame.centre);
  const m = identity();
  m[0] = t.x;
  m[1] = t.y;
  m[2] = t.z;
  m[4] = u.x;
  m[5] = u.y;
  m[6] = u.z;
  m[8] = n.x;
  m[9] = n.y;
  m[10] = n.z;
  m[12] = c.x;
  m[13] = c.y;
  m[14] = c.z;
  return m;
}

/** The glass plane in world coordinates. */
export function mirrorPlaneWorld(
  vehicle: VehicleState,
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): { readonly point: Vec3; readonly normal: Vec3 } {
  const body = bodyTransform(vehicle);
  const frame = mirrorFrame(id, aim, v);
  return {
    point: transformPoint(body, frame.centre),
    normal: normalise(transformDirection(body, frame.normal)),
  };
}

/** Reflect a point through a plane. The one piece of arithmetic mirrors are. */
export function reflectPoint(
  p: Vec3,
  plane: { readonly point: Vec3; readonly normal: Vec3 },
): Vec3 {
  const n = plane.normal;
  const d = (p.x - plane.point.x) * n.x + (p.y - plane.point.y) * n.y + (p.z - plane.point.z) * n.z;
  return { x: p.x - 2 * d * n.x, y: p.y - 2 * d * n.y, z: p.z - 2 * d * n.z };
}

/**
 * The virtual eye: the driver's eye reflected through the glass. This is where
 * the mirror's camera actually sits, and it is why the visible cone is the one a
 * real driver gets.
 */
export function mirrorEyeWorld(
  vehicle: VehicleState,
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): Vec3 {
  const plane = mirrorPlaneWorld(vehicle, id, aim, v);
  return reflectPoint(driverEyeWorld(vehicle, v), plane);
}

/**
 * The direction the mirror shows the driver, in world coordinates: their line of
 * sight to the glass, reflected. This is the mirror's aim in one vector — and
 * because it is a reflection, turning the glass by an angle turns it by two.
 */
export function mirrorViewDirection(
  vehicle: VehicleState,
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): Vec3 {
  const plane = mirrorPlaneWorld(vehicle, id, aim, v);
  const eye = driverEyeWorld(vehicle, v);
  const gaze = normalise({
    x: plane.point.x - eye.x,
    y: plane.point.y - eye.y,
    z: plane.point.z - eye.z,
  });
  const n = plane.normal;
  const d = gaze.x * n.x + gaze.y * n.y + gaze.z * n.z;
  return { x: gaze.x - 2 * d * n.x, y: gaze.y - 2 * d * n.y, z: gaze.z - 2 * d * n.z };
}

/** Distance from the driver's eye to the glass (m) — sets convex magnification. */
export function eyeToGlassDistance(
  vehicle: VehicleState,
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): number {
  const eye = driverEyeWorld(vehicle, v);
  const glass = mirrorPlaneWorld(vehicle, id, aim, v).point;
  return Math.hypot(eye.x - glass.x, eye.y - glass.y, eye.z - glass.z);
}

/**
 * Angular field widening of a convex spherical mirror relative to a flat one of
 * the same size: with focal length f = R/2 and the eye d away, the virtual image
 * is demagnified by f / (d + f), so the same glass subtends (d + f) / f as much
 * of the world. 1 for a flat mirror — no special case anywhere else.
 */
export function convexWidening(
  vehicle: VehicleState,
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): number {
  const radius = mirrorDefinition(id, v).convexRadius;
  if (radius === null) return 1;
  const f = radius / 2;
  return (eyeToGlassDistance(vehicle, id, aim, v) + f) / f;
}

/**
 * Strength of the radial warp applied when the widened render is put back on the
 * glass, in [0, 1). Chosen so the glass centre ends up at the scale a flat
 * mirror would give and the extra field is squeezed into the edges — the reason a
 * convex mirror makes cars look further away than they are.
 */
export function convexWarp(
  vehicle: VehicleState,
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): number {
  const widening = convexWidening(vehicle, id, aim, v);
  return widening <= 1 ? 0 : 1 - 1 / widening;
}

/** Near and far planes for every mirror pass. */
export const MIRROR_NEAR = 0.05;
export const MIRROR_FAR = 150;

/**
 * View matrix for a mirror pass: a camera at the driver's eye aimed at the glass,
 * composed with the reflection about the glass plane. `invertRigid` is applied to
 * the (rigid) camera only — the reflection is its own inverse.
 */
export function mirrorViewMatrix(
  vehicle: VehicleState,
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): Mat4 {
  const plane = mirrorPlaneWorld(vehicle, id, aim, v);
  const eye = driverEyeWorld(vehicle, v);
  return multiply(invertRigid(eyeCamera(eye, plane.point)), reflectionMatrix(plane));
}

/**
 * Off-axis projection whose frustum sides pass through the glass corners (scaled
 * out by the convex widening). This clipping to the outline is what produces the
 * blind spots.
 */
export function mirrorProjection(
  vehicle: VehicleState,
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): Mat4 {
  const view = mirrorViewMatrix(vehicle, id, aim, v);
  const body = bodyTransform(vehicle);
  let left = Infinity;
  let right = -Infinity;
  let bottom = Infinity;
  let top = -Infinity;
  for (const local of mirrorCorners(id, aim, v)) {
    const p = transformPoint(view, transformPoint(body, local));
    // The glass is in front of the camera, so eye-space z is negative.
    const depth = Math.max(1e-4, -p.z);
    const scale = MIRROR_NEAR / depth;
    const x = p.x * scale;
    const y = p.y * scale;
    if (x < left) left = x;
    if (x > right) right = x;
    if (y < bottom) bottom = y;
    if (y > top) top = y;
  }
  const widening = convexWidening(vehicle, id, aim, v);
  const cx = (left + right) / 2;
  const cy = (bottom + top) / 2;
  const hx = ((right - left) / 2) * widening;
  const hy = ((top - bottom) / 2) * widening;
  return frustum(cx - hx, cx + hx, cy - hy, cy + hy, MIRROR_NEAR, MIRROR_FAR);
}

export function mirrorViewProjection(
  vehicle: VehicleState,
  id: MirrorId,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): Mat4 {
  return multiply(
    mirrorProjection(vehicle, id, aim, v),
    mirrorViewMatrix(vehicle, id, aim, v),
  );
}

/**
 * Whether a world point falls inside a mirror's view — i.e. whether the driver
 * can see it in that mirror at all. Blind spots are simply the points for which
 * this is false, and tests assert on them rather than on pixels.
 */
export function visibleInMirror(
  vehicle: VehicleState,
  id: MirrorId,
  point: Vec3,
  aim: MirrorAim = MIRROR_AIM_NEUTRAL,
  v: VehicleDefinition = VEHICLE,
): boolean {
  const clip = transformPoint4(mirrorViewProjection(vehicle, id, aim, v), point);
  if (clip.w <= 0) return false;
  return (
    Math.abs(clip.x) <= clip.w && Math.abs(clip.y) <= clip.w && clip.z >= -clip.w && clip.z <= clip.w
  );
}

/* ------------------------------------------------------------------ budgeting */

/**
 * Which flank the manoeuvre is happening on, so that mirror keeps priority. The
 * inside of the turn is what you clip: turning (or reversing) toward the left
 * means the left mirror matters. With the rack centred the default is the kerb
 * side, which for a left-hand-drive car is the right.
 */
export function manoeuvreSide(vehicle: VehicleState): MirrorSide {
  if (vehicle.rack > 0.05) return 'left';
  if (vehicle.rack < -0.05) return 'right';
  return 'right';
}

export function wingMirrorFor(side: MirrorSide): MirrorId {
  return side === 'left' ? 'wingLeft' : 'wingRight';
}

/**
 * How often each mirror is re-rendered, in frames. Mirror targets are small and
 * cheap, but three extra passes a frame is still three extra passes: the interior
 * mirror and the wing mirror on the manoeuvre-relevant side keep the highest
 * rate, and the far wing mirror is the first thing to be starved.
 */
export const MIRROR_UPDATE_INTERVALS = {
  priority: 1,
  secondary: 3,
  priorityOverBudget: 2,
  secondaryOverBudget: 6,
} as const;

export function mirrorPriority(id: MirrorId, side: MirrorSide): 'priority' | 'secondary' {
  if (id === 'interior' || id === wingMirrorFor(side)) return 'priority';
  return 'secondary';
}

/**
 * The mirrors to re-render on a given frame. `overBudget` is set by the caller
 * when the frame rate has dropped; it stretches both intervals rather than
 * dropping a mirror entirely, so no mirror ever goes black.
 */
export function mirrorsToUpdate(
  frame: number,
  side: MirrorSide,
  overBudget = false,
): readonly MirrorId[] {
  return MIRROR_IDS.filter((id) => {
    const priority = mirrorPriority(id, side);
    const interval =
      priority === 'priority'
        ? overBudget
          ? MIRROR_UPDATE_INTERVALS.priorityOverBudget
          : MIRROR_UPDATE_INTERVALS.priority
        : overBudget
          ? MIRROR_UPDATE_INTERVALS.secondaryOverBudget
          : MIRROR_UPDATE_INTERVALS.secondary;
    return frame % interval === 0;
  });
}

/**
 * Render-target size for each mirror, in pixels. Deliberately tiny: a real
 * mirror gives you a coarse impression of distance, and the frame budget belongs
 * to holding the refresh rate. Aspect follows the glass so nothing is stretched.
 */
export function mirrorTargetSize(
  id: MirrorId,
  v: VehicleDefinition = VEHICLE,
): { readonly width: number; readonly height: number } {
  const mirror = mirrorDefinition(id, v);
  const height = 72;
  const width = Math.max(32, Math.round((height * mirror.width) / mirror.height));
  return { width, height };
}

/* ------------------------------------------------------------------- internals */

/**
 * A camera at `eye` looking at `target`, world up. Only its orientation matters —
 * it fixes the axes the off-axis frustum is expressed in.
 */
function eyeCamera(eye: Vec3, target: Vec3): Mat4 {
  const back = normalise({ x: eye.x - target.x, y: eye.y - target.y, z: eye.z - target.z });
  const worldUp: Vec3 = Math.abs(back.z) > 0.999 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 };
  const right = normalise(cross(worldUp, back));
  const up = cross(back, right);
  const m = identity();
  m[0] = right.x;
  m[1] = right.y;
  m[2] = right.z;
  m[4] = up.x;
  m[5] = up.y;
  m[6] = up.z;
  m[8] = back.x;
  m[9] = back.y;
  m[10] = back.z;
  m[12] = eye.x;
  m[13] = eye.y;
  m[14] = eye.z;
  return m;
}

/** Householder reflection about a plane: I - 2nn^T, translated onto the plane. */
function reflectionMatrix(plane: { readonly point: Vec3; readonly normal: Vec3 }): Mat4 {
  const n = plane.normal;
  const d = -(n.x * plane.point.x + n.y * plane.point.y + n.z * plane.point.z);
  const m = identity();
  m[0] = 1 - 2 * n.x * n.x;
  m[1] = -2 * n.x * n.y;
  m[2] = -2 * n.x * n.z;
  m[4] = -2 * n.y * n.x;
  m[5] = 1 - 2 * n.y * n.y;
  m[6] = -2 * n.y * n.z;
  m[8] = -2 * n.z * n.x;
  m[9] = -2 * n.z * n.y;
  m[10] = 1 - 2 * n.z * n.z;
  m[12] = -2 * n.x * d;
  m[13] = -2 * n.y * d;
  m[14] = -2 * n.z * d;
  return m;
}

function corner(frame: MirrorFrame, acrossM: number, upM: number): Vec3 {
  return {
    x: frame.centre.x + frame.tangent.x * acrossM + frame.up.x * upM,
    y: frame.centre.y + frame.tangent.y * acrossM + frame.up.y * upM,
    z: frame.centre.z + frame.tangent.z * acrossM + frame.up.z * upM,
  };
}

function transformPoint4(m: Mat4, p: Vec3): { x: number; y: number; z: number; w: number } {
  const q = transformPoint(m, p);
  const w =
    (m[3] as number) * p.x + (m[7] as number) * p.y + (m[11] as number) * p.z + (m[15] as number);
  return { x: q.x, y: q.y, z: q.z, w };
}

/** Flip a plane normal, if needed, so it points at the driver's eye. */
function towardDriver(n: Vec3, mount: Vec3, v: VehicleDefinition): Vec3 {
  const eye = v.driverEyePoint;
  const d = (eye.x - mount.x) * n.x + (eye.y - mount.y) * n.y + (eye.z - mount.z) * n.z;
  return d >= 0 ? n : { x: -n.x, y: -n.y, z: -n.z };
}

function normalise(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z);
  if (len === 0) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Component of `v` perpendicular to the unit vector `n`. */
function reject(v: Vec3, n: Vec3): Vec3 {
  const d = v.x * n.x + v.y * n.y + v.z * n.z;
  return { x: v.x - d * n.x, y: v.y - d * n.y, z: v.z - d * n.z };
}

function clampTo(value: number, limit: number): number {
  return value < -limit ? -limit : value > limit ? limit : value;
}
