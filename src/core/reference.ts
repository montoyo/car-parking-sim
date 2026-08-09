/**
 * The reference line: one clean path through a scenario's manoeuvre.
 *
 * This is the ENTIRE extent of guidance in the game (the spec rules out a
 * coaching mode that tells the player where to steer next). It exists so that,
 * after an attempt, the replay can draw a tidy path beside the player's own trace
 * and let them see where their shape differed.
 *
 * It is derived from the scenario alone — spawn pose in, parked pose out — which
 * is why it lives in the pure core rather than in the replay UI: it is data about
 * the manoeuvre, not a drawing decision. What is verified by eye is only how the
 * replay renders it.
 *
 * Construction: a cubic Hermite between the spawn pose and the pose that sits the
 * bodywork centred in the bay, with end tangents along each pose's own heading
 * (reversed when the manoeuvre travels backwards at that end, as a parallel park
 * does), and a pull-forward lead-in inserted when the manoeuvre needs the room.
 * The tangent scale is then widened until the path is nowhere tighter than
 * the vehicle's own full-lock turning circle — a reference line the car could not
 * physically follow would be worse than no guidance at all.
 *
 * Deliberately NOT modelled: obstacle avoidance and the shunt-by-shunt structure
 * of a real manoeuvre. This is a shape to compare against, not a solution to
 * follow, and pretending otherwise would be the coaching mode the spec excludes.
 */

import type { Bay, Scenario } from './scenario';
import type { BodyPose } from './world';
import type { Vec2, VehicleDefinition } from './vehicle';
import { VEHICLE, frontAxleX, rearAxleX, turnRadius } from './vehicle';
import { bodyCentre } from './collision';
import { wrapAngle } from './step';

/** Samples along the reference path. Enough that the drawn line reads as smooth. */
const SAMPLES = 96;

/** One sampled instant of the clean manoeuvre. */
export interface ReferencePose {
  /** Fraction along the path, 0 at the spawn and 1 parked. */
  readonly s: number;
  readonly pose: BodyPose;
  /** Bodywork centre — the same point the recorded body trace is drawn through. */
  readonly centre: Vec2;
}

/**
 * The pose the car is aiming at: bodywork centred in the bay, square to its axis.
 * The pose origin sits midway along the WHEELBASE, so it is offset from the
 * bodywork centre by the overhang difference.
 */
export function parkedPose(bay: Bay, v: VehicleDefinition = VEHICLE): BodyPose {
  const localX = (frontAxleX(v) + v.frontOverhang + (rearAxleX(v) - v.rearOverhang)) / 2;
  return {
    x: bay.centre.x - localX * Math.cos(bay.axisYaw),
    y: bay.centre.y - localX * Math.sin(bay.axisYaw),
    yaw: bay.axisYaw,
  };
}

/**
 * The clean manoeuvre as poses. Empty for a scenario with no bay to park in.
 *
 * Two candidate shapes are considered, in the order a driver would think of them:
 * straight from the spawn into the bay, and — when that would demand more lock
 * than the car has — a lead-in first, pulling forward alongside the bay far enough
 * that the reverse into it fits inside the turning circle. A parallel park always
 * takes the second, because that is exactly why real drivers pull past the space
 * before reversing into it.
 */
export function referencePath(
  scenario: Scenario,
  v: VehicleDefinition = VEHICLE,
): readonly ReferencePose[] {
  const bay = scenario.bay;
  if (!bay) return [];
  const start: BodyPose = { x: scenario.spawn.x, y: scenario.spawn.y, yaw: scenario.spawn.yaw };
  const end = parkedPose(bay, v);
  const minRadius = turnRadius(1, v);

  const candidates: readonly (readonly BodyPose[])[] = [
    [start, end],
    [start, leadInPose(start, end, minRadius), end],
  ];

  let best: readonly ReferencePose[] = [];
  let bestRadius = -Infinity;
  for (const waypoints of candidates) {
    // Widen the tangents until the path is drivable at full lock. Straighter
    // (larger) tangents relax curvature; the first scale that clears the car's own
    // turning circle is the tightest — and so the most honest — clean path.
    for (let scale = 0.4; scale <= 3.0001; scale += 0.05) {
      const path = waypointPath(waypoints, scale, v);
      const radius = tightestRadius(path);
      if (radius > bestRadius) {
        bestRadius = radius;
        best = path;
      }
      if (radius >= minRadius) return path;
    }
  }
  return best;
}

/**
 * The pull-forward pose: level with the bay but far enough along its axis, on the
 * side the car arrives from, that a two-arc reverse into the bay at full lock
 * covers the lateral offset. The lane offset is the spawn's own, so the car does
 * not wander out of its lane to set the manoeuvre up.
 */
function leadInPose(start: BodyPose, end: BodyPose, minRadius: number): BodyPose {
  const cos = Math.cos(end.yaw);
  const sin = Math.sin(end.yaw);
  const dx = start.x - end.x;
  const dy = start.y - end.y;
  const along = dx * cos + dy * sin;
  const across = -dx * sin + dy * cos;
  const direction = along >= 0 ? 1 : -1;
  // Longitudinal run of two opposing arcs of radius `minRadius` that between them
  // shift the car sideways by `|across|`, plus a little margin for the straights.
  const lateral = Math.abs(across);
  const half = Math.min(lateral / 2, minRadius);
  const run = 2 * Math.sqrt(Math.max(0, minRadius * minRadius - (minRadius - half) ** 2)) + 0.8;
  const distance = Math.max(Math.abs(along), run) * direction;
  return {
    x: end.x + cos * distance - sin * across,
    y: end.y + sin * distance + cos * across,
    yaw: end.yaw,
  };
}

/** Hermite through each consecutive pair of waypoints, joined end to end. */
function waypointPath(
  waypoints: readonly BodyPose[],
  scale: number,
  v: VehicleDefinition,
): readonly ReferencePose[] {
  const perSegment = Math.max(8, Math.round(SAMPLES / (waypoints.length - 1)));
  const out: ReferencePose[] = [];
  for (let i = 1; i < waypoints.length; i++) {
    const segment = hermitePath(
      waypoints[i - 1] as BodyPose,
      waypoints[i] as BodyPose,
      scale,
      v,
      perSegment,
    );
    // Drop the joint's duplicate sample.
    out.push(...(i === 1 ? segment : segment.slice(1)));
  }
  return out.map((p, i) => ({ ...p, s: i / Math.max(1, out.length - 1) }));
}

/** The clean manoeuvre as a polyline of bodywork-centre points, ready to draw. */
export function referenceLine(
  scenario: Scenario,
  v: VehicleDefinition = VEHICLE,
): readonly Vec2[] {
  return referencePath(scenario, v).map((p) => p.centre);
}

function hermitePath(
  start: BodyPose,
  end: BodyPose,
  scale: number,
  v: VehicleDefinition,
  samples: number = SAMPLES,
): readonly ReferencePose[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const span = Math.max(0.5, Math.hypot(dx, dy)) * scale;
  // A tangent points along the heading, or against it where the car is travelling
  // backwards at that end — which is what makes a parallel park come out as a
  // reverse-in S rather than a drive-through curve.
  const m0 = tangent(start.yaw, dx, dy, span);
  const m1 = tangent(end.yaw, dx, dy, span);
  const yawDelta = wrapAngle(end.yaw - start.yaw);

  const out: ReferencePose[] = [];
  for (let i = 0; i <= samples; i++) {
    const s = i / samples;
    const h = hermite(s);
    const pose: BodyPose = {
      x: h.p0 * start.x + h.p1 * end.x + h.m0 * m0.x + h.m1 * m1.x,
      y: h.p0 * start.y + h.p1 * end.y + h.m0 * m0.y + h.m1 * m1.y,
      // Smoothstep in yaw, so both ends match their pose's heading exactly and
      // the body swings through the middle rather than snapping at either end.
      yaw: wrapAngle(start.yaw + yawDelta * smoothstep(s)),
    };
    out.push({ s, pose, centre: bodyCentre(pose, v) });
  }
  return out;
}

function tangent(yaw: number, dx: number, dy: number, span: number): Vec2 {
  const forward = Math.cos(yaw) * dx + Math.sin(yaw) * dy >= 0 ? 1 : -1;
  return { x: Math.cos(yaw) * span * forward, y: Math.sin(yaw) * span * forward };
}

/** Cubic Hermite basis at `s`. */
function hermite(s: number): { p0: number; p1: number; m0: number; m1: number } {
  const s2 = s * s;
  const s3 = s2 * s;
  return {
    p0: 2 * s3 - 3 * s2 + 1,
    p1: -2 * s3 + 3 * s2,
    m0: s3 - 2 * s2 + s,
    m1: s3 - s2,
  };
}

function smoothstep(s: number): number {
  return s * s * (3 - 2 * s);
}

/** The tightest turn anywhere along the drawn line, as a radius in metres. */
function tightestRadius(path: readonly ReferencePose[]): number {
  let tightest = Infinity;
  for (let i = 1; i < path.length - 1; i++) {
    const a = (path[i - 1] as ReferencePose).centre;
    const b = (path[i] as ReferencePose).centre;
    const c = (path[i + 1] as ReferencePose).centre;
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    if (area < 1e-12) continue;
    tightest = Math.min(tightest, (ab * bc * ca) / (4 * area));
  }
  return tightest;
}
