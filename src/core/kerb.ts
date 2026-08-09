/**
 * Kerb / roadway-border collision — its own class of mistake, deliberately not
 * folded into `collision.ts`.
 *
 * The border is a POLYLINE WITH A HEIGHT. Each segment raises a strip of pavement
 * `pavementWidth` wide on its `raisedSide`, and that strip is tested against two
 * different pieces of the car:
 *
 * 1. each wheel's contact footprint — a RIM STRIKE, named on the specific wheel,
 *    because "you kerbed your front-right alloy" is the thing a driver learns
 *    from. A wheel whose CENTRE has crossed the border has MOUNTED the kerb,
 *    which is one severity bucket worse than rubbing along it: the escalation is
 *    the geometry, not the speed.
 * 2. the body outline, but only when the kerb stands taller than the sill — an
 *    OVERHANG SCRAPE, reported as a body contact. A 12 cm kerb passes under the
 *    bumper and must NOT be called bodywork damage; a 20 cm one catches it.
 *
 * This pass REPORTS; it does not resolve. Bodywork against solid obstacles is
 * pushed out and takes an impulse in `collision.ts` (the spec assigns impulse
 * resolution to that class only) — the pavement behind a kerb is bounded by real
 * obstacles (walls) which do that job, and a kerb's own consequence, the thing
 * the player came to learn, is the damage event.
 *
 * Coalescing, severity buckets and the `contacts` list are all `collision.ts`'s,
 * reused rather than re-invented: one vocabulary for every kind of contact.
 */

import type { ContactEvent } from './events';
import type { ContactHit, ContactRecord } from './collision';
import {
  bodyPolygon,
  coalesceContacts,
  escalateSeverity,
  pointInConvex,
  polygonOverlap,
  severityFor,
} from './collision';
import type { Kerb, Scenario } from './scenario';
import type { VehicleDefinition, Vec2, WheelId } from './vehicle';
import { VEHICLE, WHEEL_IDS, ackermannSteerAngles, wheelPosition } from './vehicle';
import type { BodyPose } from './world';

/**
 * Length of a tyre's contact patch as a fraction of the wheel's radius. The patch
 * is what touches the kerb, not the whole wheel, so a tyre beside a kerb is not
 * yet rubbing on it.
 */
const CONTACT_PATCH_LENGTH_FRACTION = 0.35;

/** The state the kerb pass reads. Velocities are BODY frame, as elsewhere. */
export interface KerbCollisionInput {
  readonly pose: BodyPose;
  readonly longitudinalVelocity: number;
  readonly lateralVelocity: number;
  readonly yawRate: number;
  /** Steering rack position, so the front footprints are steered correctly. */
  readonly rack: number;
  /** The contacts list AFTER the body pass — both passes share one list. */
  readonly contacts: readonly ContactRecord[];
  readonly scenario: Scenario;
  readonly tick: number;
  readonly time: number;
}

export interface KerbCollisionOutcome {
  readonly contacts: readonly ContactRecord[];
  readonly events: readonly ContactEvent[];
}

/** One segment of the border: the pavement it raises, and which way the road is. */
export interface KerbStrip {
  /** The raised pavement quad in world coordinates, counter-clockwise. */
  readonly pavement: readonly Vec2[];
  /** Unit normal of the kerb face pointing at the ROAD — the closing direction. */
  readonly roadNormal: Vec2;
}

/**
 * The raised pavement, one quad per polyline segment. Walking a segment from p to
 * q, `raisedSide: 'right'` puts the pavement on the right-hand side.
 */
export function kerbStrips(kerb: Kerb): readonly KerbStrip[] {
  const strips: KerbStrip[] = [];
  for (let i = 0; i + 1 < kerb.polyline.length; i++) {
    const p = kerb.polyline[i] as Vec2;
    const q = kerb.polyline[i + 1] as Vec2;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    // Right of travel is (dy, -dx) normalised; left is its negation.
    const sign = kerb.raisedSide === 'right' ? 1 : -1;
    const up = { x: (dy / length) * sign, y: (-dx / length) * sign };
    const w = kerb.pavementWidth;
    strips.push({
      pavement: counterClockwise([
        p,
        q,
        { x: q.x + up.x * w, y: q.y + up.y * w },
        { x: p.x + up.x * w, y: p.y + up.y * w },
      ]),
      roadNormal: { x: -up.x, y: -up.y },
    });
  }
  return strips;
}

/** Whether a kerb of this height is tall enough to catch the bodywork. */
export function catchesBodywork(kerb: Kerb, v: VehicleDefinition = VEHICLE): boolean {
  return kerb.height > v.sillHeight;
}

/**
 * A wheel's contact patch in world coordinates: the tyre's width across, the
 * patch length along the direction the wheel is pointing (steer included).
 */
export function wheelFootprint(
  pose: BodyPose,
  id: WheelId,
  rack: number,
  v: VehicleDefinition = VEHICLE,
): readonly Vec2[] {
  const steer = ackermannSteerAngles(rack, v);
  const angle =
    pose.yaw + (id === 'frontLeft' ? steer.frontLeft : id === 'frontRight' ? steer.frontRight : 0);
  const centre = wheelWorldPosition(pose, id, v);
  const halfLength = (CONTACT_PATCH_LENGTH_FRACTION * v.wheelRadius) / 2;
  const halfWidth = v.wheelWidth / 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners: readonly Vec2[] = [
    { x: halfLength, y: halfWidth },
    { x: -halfLength, y: halfWidth },
    { x: -halfLength, y: -halfWidth },
    { x: halfLength, y: -halfWidth },
  ];
  return counterClockwise(
    corners.map((p) => ({
      x: centre.x + p.x * cos - p.y * sin,
      y: centre.y + p.x * sin + p.y * cos,
    })),
  );
}

/** Hub centre in world coordinates. */
function wheelWorldPosition(pose: BodyPose, id: WheelId, v: VehicleDefinition): Vec2 {
  const local = wheelPosition(id, v);
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  return {
    x: pose.x + local.x * cos - local.y * sin,
    y: pose.y + local.x * sin + local.y * cos,
  };
}

/**
 * Report every kerb contact for this tick: rim strikes per wheel, plus an
 * overhang scrape if the kerb is high enough to catch bodywork. Coalesced through
 * the same machinery as body contacts.
 */
export function resolveKerbCollisions(
  state: KerbCollisionInput,
  v: VehicleDefinition = VEHICLE,
): KerbCollisionOutcome {
  const kerb = state.scenario.kerb;
  const strips = kerb === null ? [] : kerbStrips(kerb);
  if (kerb === null || strips.length === 0) {
    // Nothing to touch, but the shared coalescer still prunes lapsed records.
    return coalesceContacts(state.contacts, new Map(), state.tick, state.time);
  }

  const pose = state.pose;
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  // World-frame velocity of the body origin; a closing speed is a world quantity.
  const velocity: Vec2 = {
    x: state.longitudinalVelocity * cos - state.lateralVelocity * sin,
    y: state.longitudinalVelocity * sin + state.lateralVelocity * cos,
  };
  /** Velocity of a point rigidly attached to the body: v + omega x r. */
  const velocityAt = (point: Vec2): Vec2 => ({
    x: velocity.x - state.yawRate * (point.y - pose.y),
    y: velocity.y + state.yawRate * (point.x - pose.x),
  });

  const hits = new Map<string, ContactHit>();

  // --- Rim strikes: the contact patch against the raised pavement. -----------
  for (const id of WHEEL_IDS) {
    const footprint = wheelFootprint(pose, id, state.rack, v);
    const centre = wheelWorldPosition(pose, id, v);
    for (const strip of strips) {
      const manifold = polygonOverlap(footprint, strip.pavement);
      if (manifold === null) continue;

      const point = manifold.point;
      const patchVelocity = velocityAt(point);
      const closingSpeed = Math.max(
        0,
        -(patchVelocity.x * strip.roadNormal.x + patchVelocity.y * strip.roadNormal.y),
      );
      // Crossing the border, not grazing it: the wheel is UP on the kerb.
      const mounted = pointInConvex(centre, strip.pavement);
      const severity = mounted
        ? escalateSeverity(severityFor(closingSpeed))
        : severityFor(closingSpeed);

      offer(hits, {
        position: point,
        wheel: id,
        record: {
          key: `kerb:${id}`,
          surface: 'kerb',
          part: 'wheel',
          peakSeverity: severity,
          peakClosingSpeed: closingSpeed,
          lastTouchTime: state.time,
        },
      });
    }
  }

  // --- Overhang scrape: bodywork against a kerb taller than the sill. --------
  if (catchesBodywork(kerb, v)) {
    const body = bodyPolygon(pose, v);
    for (const strip of strips) {
      const manifold = polygonOverlap(body, strip.pavement);
      if (manifold === null) continue;
      const point = manifold.point;
      const cornerVelocity = velocityAt(point);
      const closingSpeed = Math.max(
        0,
        -(cornerVelocity.x * strip.roadNormal.x + cornerVelocity.y * strip.roadNormal.y),
      );
      offer(hits, {
        position: point,
        wheel: null,
        record: {
          key: 'kerb:body',
          surface: 'kerb',
          part: 'body',
          peakSeverity: severityFor(closingSpeed),
          peakClosingSpeed: closingSpeed,
          lastTouchTime: state.time,
        },
      });
    }
  }

  return coalesceContacts(state.contacts, hits, state.tick, state.time);
}

/** Keep the worst touch per key — a wheel spanning two segments is one strike. */
function offer(hits: Map<string, ContactHit>, hit: ContactHit): void {
  const existing = hits.get(hit.record.key);
  if (existing === undefined || hit.record.peakClosingSpeed > existing.record.peakClosingSpeed) {
    hits.set(hit.record.key, hit);
  }
}

/** Reverse a polygon if it is wound clockwise; the SAT helpers assume CCW. */
function counterClockwise(poly: readonly Vec2[]): readonly Vec2[] {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vec2;
    const q = poly[(i + 1) % poly.length] as Vec2;
    area += p.x * q.y - q.x * p.y;
  }
  return area >= 0 ? poly : [...poly].reverse();
}
