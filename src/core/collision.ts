/**
 * Body collision: the car's body polygon against parked cars, walls and
 * bollards, resolved as an impulse with restitution and friction so the car is
 * stopped or deflected rather than driven through.
 *
 * Two things here are deliberate:
 *
 * 1. Every contact is reported through the `SimEvent` stream — the one mechanism
 *    that feeds live cues now, scoring penalties in 09 and replay markers in 10.
 *    Severity is bucketed into graze / knock / impact from the closing speed
 *    NORMAL to the contact surface, so those three consumers key off a small
 *    vocabulary rather than a raw float.
 *
 * 2. Contacts are COALESCED. A scrape lasts hundreds of ticks; the player calls
 *    that one mistake, so `ContactRecord`s live in `WorldState` and a touch that
 *    continues (or resumes within the debounce window) extends its record and
 *    updates its peak severity instead of emitting again.
 *
 * Kerb collision is NOT here: the roadway border is its own class of mistake and
 * lives in `kerb.ts`. What IS shared is the coalescing machinery below
 * (`ContactHit` / `coalesceContacts`), so the two classes speak one vocabulary
 * and write into one `contacts` list.
 */

import type { ContactEvent, ContactSurface, Severity } from './events';
import type { Obstacle, Scenario } from './scenario';
import type { VehicleDefinition, Vec2, WheelId } from './vehicle';
import { VEHICLE, bodyOutline, frontAxleX, rearAxleX } from './vehicle';
import type { BodyPose } from './world';

/**
 * Normal closing speeds (m/s) at which each bucket starts. Below `knock` a touch
 * is a graze; a shunt into a parked car at walking pace is a knock; anything
 * quicker is an impact.
 */
export const SEVERITY_THRESHOLDS: Readonly<Record<'knock' | 'impact', number>> = {
  knock: 0.35,
  impact: 1.1,
};

/** How much of the closing speed is given back. Sheet metal barely bounces. */
const RESTITUTION = 0.12;
/** Coulomb friction between bodywork and whatever it is rubbing along. */
const CONTACT_FRICTION = 0.55;
/**
 * Seconds a contact may lapse and still count as the same event. A scrape that
 * flickers in and out of overlap by a millimetre is one scrape.
 */
export const CONTACT_DEBOUNCE_SECONDS = 0.35;
/** Overlap resolution passes per tick — enough to settle a wedged corner. */
const RESOLUTION_PASSES = 4;

/**
 * A contact in progress. Part of `WorldState` because coalescing is stateful:
 * without it the same scrape would be reported once per tick.
 */
export interface ContactRecord {
  /** Identifies the thing being touched and how — the coalescing key. */
  readonly key: string;
  readonly surface: ContactSurface;
  readonly part: 'body' | 'wheel';
  /** Worst severity seen during this contact. */
  readonly peakSeverity: Severity;
  /** Highest normal closing speed seen during this contact (m/s). */
  readonly peakClosingSpeed: number;
  /** Simulated time (s) of the most recent touch. */
  readonly lastTouchTime: number;
}

/** The state body collision reads and writes. */
export interface CollisionInput {
  readonly pose: BodyPose;
  /** Body-frame velocities (m/s) and yaw rate (rad/s) after the dynamics solve. */
  readonly longitudinalVelocity: number;
  readonly lateralVelocity: number;
  readonly yawRate: number;
  readonly contacts: readonly ContactRecord[];
  readonly scenario: Scenario;
  /** Tick index and simulated time the resulting events are stamped with. */
  readonly tick: number;
  readonly time: number;
}

export interface CollisionOutcome {
  readonly pose: BodyPose;
  readonly longitudinalVelocity: number;
  readonly lateralVelocity: number;
  readonly yawRate: number;
  readonly contacts: readonly ContactRecord[];
  readonly events: readonly ContactEvent[];
}

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { graze: 0, knock: 1, impact: 2 };

/** The bucket a normal closing speed falls into. */
export function severityFor(closingSpeed: number): Severity {
  if (closingSpeed >= SEVERITY_THRESHOLDS.impact) return 'impact';
  if (closingSpeed >= SEVERITY_THRESHOLDS.knock) return 'knock';
  return 'graze';
}

/** Bodywork contact with a parked car is a different mistake from hitting a wall. */
export function surfaceOf(obstacle: Obstacle): ContactSurface {
  return obstacle.kind === 'parked-car' ? 'vehicle' : 'wall';
}

/** The car's body outline in world coordinates for a pose. */
export function bodyPolygon(pose: BodyPose, v: VehicleDefinition = VEHICLE): readonly Vec2[] {
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  return bodyOutline(v).map((p) => ({
    x: pose.x + p.x * cos - p.y * sin,
    y: pose.y + p.x * sin + p.y * cos,
  }));
}

/**
 * The geometric centre of the bodywork in world coordinates. NOT the pose
 * origin, which sits midway along the WHEELBASE — the overhangs differ, so the
 * two are a few centimetres apart, and it is the metal a player looks at when
 * they judge whether the car is centred in a bay.
 */
export function bodyCentre(pose: BodyPose, v: VehicleDefinition = VEHICLE): Vec2 {
  const localX = (frontAxleX(v) + v.frontOverhang + (rearAxleX(v) - v.rearOverhang)) / 2;
  return {
    x: pose.x + localX * Math.cos(pose.yaw),
    y: pose.y + localX * Math.sin(pose.yaw),
  };
}

/** An obstacle's box in world coordinates, counter-clockwise. */
export function obstaclePolygon(o: Obstacle): readonly Vec2[] {
  const cos = Math.cos(o.yaw);
  const sin = Math.sin(o.yaw);
  const corners: readonly Vec2[] = [
    { x: o.halfLength, y: o.halfWidth },
    { x: -o.halfLength, y: o.halfWidth },
    { x: -o.halfLength, y: -o.halfWidth },
    { x: o.halfLength, y: -o.halfWidth },
  ];
  return corners.map((p) => ({
    x: o.centre.x + p.x * cos - p.y * sin,
    y: o.centre.y + p.x * sin + p.y * cos,
  }));
}

/**
 * Whether an obstacle is tall enough for the BODY to hit it. Anything shorter
 * than the sill passes under the car — that is kerb territory (ticket 08), not
 * bodywork, and calling it a body contact would be a lie to the player.
 */
export function collidesWithBody(o: Obstacle, v: VehicleDefinition = VEHICLE): boolean {
  return o.height > v.sillHeight;
}

interface Manifold {
  /** Unit normal pointing OUT of the obstacle, i.e. the way the car must move. */
  readonly normal: Vec2;
  /** Overlap along the normal (m). */
  readonly depth: number;
  /** Contact point in world coordinates (m). */
  readonly point: Vec2;
}

/**
 * Separating-axis test between two convex polygons. Returns the minimum
 * translation that pushes `a` out of `b`, or null if they are apart.
 */
export function polygonOverlap(a: readonly Vec2[], b: readonly Vec2[]): Manifold | null {
  let bestDepth = Infinity;
  let bestNormal: Vec2 | null = null;

  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i] as Vec2;
      const q = poly[(i + 1) % poly.length] as Vec2;
      const edge = { x: q.x - p.x, y: q.y - p.y };
      const length = Math.hypot(edge.x, edge.y);
      if (length < 1e-9) continue;
      // Outward normal of this edge, normalised.
      const axis = { x: edge.y / length, y: -edge.x / length };
      const spanA = project(a, axis);
      const spanB = project(b, axis);
      // Overlap on this axis; a gap on any axis means no contact at all.
      const overlap = Math.min(spanA.max, spanB.max) - Math.max(spanA.min, spanB.min);
      if (overlap <= 0) return null;
      if (overlap < bestDepth) {
        bestDepth = overlap;
        // Point the normal from b toward a, whichever polygon the axis came from.
        const centreA = (spanA.min + spanA.max) / 2;
        const centreB = (spanB.min + spanB.max) / 2;
        const sign = centreA >= centreB ? 1 : -1;
        bestNormal = { x: axis.x * sign, y: axis.y * sign };
      }
    }
  }

  if (bestNormal === null) return null;
  return { normal: bestNormal, depth: bestDepth, point: contactPoint(a, b) };
}

function project(poly: readonly Vec2[], axis: Vec2): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * Where the contact is reported. The vertices of each polygon that lie inside
 * the other are the metal actually in contact; their average is the point a
 * player would point at. With no vertex inside (edge-on overlap) the midpoint of
 * the two centroids is the honest answer.
 */
function contactPoint(a: readonly Vec2[], b: readonly Vec2[]): Vec2 {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const p of a) {
    if (pointInConvex(p, b)) {
      sumX += p.x;
      sumY += p.y;
      count++;
    }
  }
  for (const p of b) {
    if (pointInConvex(p, a)) {
      sumX += p.x;
      sumY += p.y;
      count++;
    }
  }
  if (count > 0) return { x: sumX / count, y: sumY / count };
  const ca = centroid(a);
  const cb = centroid(b);
  return { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
}

function centroid(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/**
 * One touch detected on one tick, before coalescing decides whether it is news.
 * `record` carries this tick's severity and closing speed; `position` and `wheel`
 * are what the event needs and the record does not keep.
 */
export interface ContactHit {
  readonly record: ContactRecord;
  readonly position: Vec2;
  readonly wheel: WheelId | null;
}

/** The worse of two severity buckets. */
export function worstSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

/** One bucket worse — how a distinct escalation (mounting a kerb) is expressed. */
export function escalateSeverity(severity: Severity): Severity {
  return severity === 'graze' ? 'knock' : 'impact';
}

/**
 * Turn this tick's touches into surviving `ContactRecord`s plus the events worth
 * reporting. Shared by the body pass and the kerb pass so both coalesce the same
 * way and cannot drift apart.
 *
 * A touch that continues an existing record is silent — a scrape lasting hundreds
 * of ticks is one mistake — EXCEPT when it makes the contact strictly worse: a
 * graze that becomes an impact is news the player, the score and the replay all
 * need, so the escalation is reported with the new severity.
 */
export function coalesceContacts(
  previous: readonly ContactRecord[],
  hits: ReadonlyMap<string, ContactHit>,
  tick: number,
  time: number,
): { readonly contacts: readonly ContactRecord[]; readonly events: readonly ContactEvent[] } {
  const events: ContactEvent[] = [];
  const kept: ContactRecord[] = [];
  const live = new Map(prune(previous, time).map((c) => [c.key, c]));

  for (const [key, hit] of hits) {
    const before = live.get(key);
    live.delete(key);
    if (before === undefined) {
      kept.push(hit.record);
      events.push(eventFor(hit, hit.record.peakSeverity, hit.record.peakClosingSpeed, tick));
      continue;
    }
    const peakSeverity = worstSeverity(before.peakSeverity, hit.record.peakSeverity);
    const peakClosingSpeed = Math.max(before.peakClosingSpeed, hit.record.peakClosingSpeed);
    kept.push({ ...before, peakSeverity, peakClosingSpeed, lastTouchTime: time });
    if (SEVERITY_ORDER[peakSeverity] > SEVERITY_ORDER[before.peakSeverity]) {
      events.push(eventFor(hit, peakSeverity, peakClosingSpeed, tick));
    }
  }
  // Records still inside the debounce window but not touched this tick survive,
  // so a scrape that flickers in and out of overlap stays one event.
  for (const record of live.values()) kept.push(record);

  return { contacts: kept, events };
}

function eventFor(
  hit: ContactHit,
  severity: Severity,
  closingSpeed: number,
  tick: number,
): ContactEvent {
  return {
    kind: 'contact',
    tick,
    key: hit.record.key,
    surface: hit.record.surface,
    part: hit.record.part,
    severity,
    closingSpeed,
    position: hit.position,
    wheel: hit.wheel,
  };
}

/** Inside test for a counter-clockwise convex polygon (boundary counts as in). */
export function pointInConvex(point: Vec2, poly: readonly Vec2[]): boolean {
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vec2;
    const q = poly[(i + 1) % poly.length] as Vec2;
    const cross = (q.x - p.x) * (point.y - p.y) - (q.y - p.y) * (point.x - p.x);
    if (cross < -1e-9) return false;
  }
  return true;
}

/**
 * Resolve every body overlap for this tick: push the car out, apply a normal
 * impulse with restitution plus a friction impulse along the surface, and report
 * the contacts (coalesced).
 */
export function resolveBodyCollisions(
  state: CollisionInput,
  v: VehicleDefinition = VEHICLE,
): CollisionOutcome {
  const obstacles = state.scenario.obstacles.filter((o) => collidesWithBody(o, v));
  if (obstacles.length === 0) {
    return {
      pose: state.pose,
      longitudinalVelocity: state.longitudinalVelocity,
      lateralVelocity: state.lateralVelocity,
      yawRate: state.yawRate,
      contacts: prune(state.contacts, state.time),
      events: [],
    };
  }

  let pose = state.pose;
  let yawRate = state.yawRate;
  // Work in world velocities: an impulse is a world-frame quantity, and the body
  // frame is only where the dynamics happen to keep its state.
  const cos0 = Math.cos(pose.yaw);
  const sin0 = Math.sin(pose.yaw);
  let velocity: Vec2 = {
    x: state.longitudinalVelocity * cos0 - state.lateralVelocity * sin0,
    y: state.longitudinalVelocity * sin0 + state.lateralVelocity * cos0,
  };

  const touched = new Map<string, ContactHit>();

  for (let pass = 0; pass < RESOLUTION_PASSES; pass++) {
    const polygon = bodyPolygon(pose, v);
    let resolvedAny = false;

    for (const obstacle of obstacles) {
      const manifold = polygonOverlap(polygon, obstaclePolygon(obstacle));
      if (manifold === null) continue;
      resolvedAny = true;

      const n = manifold.normal;
      // Separate first, so the impulse below is computed at the touching pose
      // rather than from inside the obstacle.
      pose = {
        x: pose.x + n.x * manifold.depth,
        y: pose.y + n.y * manifold.depth,
        yaw: pose.yaw,
      };

      const r = { x: manifold.point.x - pose.x, y: manifold.point.y - pose.y };
      const pointVelocity = {
        x: velocity.x - yawRate * r.y,
        y: velocity.y + yawRate * r.x,
      };
      const approach = -(pointVelocity.x * n.x + pointVelocity.y * n.y);

      if (approach > 0) {
        const rn = r.x * n.y - r.y * n.x;
        const inverseMass = 1 / v.mass + (rn * rn) / v.yawInertia;
        const j = ((1 + RESTITUTION) * approach) / inverseMass;
        velocity = { x: velocity.x + (j * n.x) / v.mass, y: velocity.y + (j * n.y) / v.mass };
        yawRate += (j * rn) / v.yawInertia;

        // Friction along the surface, clamped to the Coulomb cone.
        const t = { x: -n.y, y: n.x };
        const slide =
          (velocity.x - yawRate * r.y) * t.x + (velocity.y + yawRate * r.x) * t.y;
        const rt = r.x * t.y - r.y * t.x;
        const inverseMassT = 1 / v.mass + (rt * rt) / v.yawInertia;
        const limit = CONTACT_FRICTION * j;
        const jt = clampTo(-slide / inverseMassT, -limit, limit);
        velocity = { x: velocity.x + (jt * t.x) / v.mass, y: velocity.y + (jt * t.y) / v.mass };
        yawRate += (jt * rt) / v.yawInertia;
      }

      // Only the first pass reports: later passes are the same touch, seen again
      // after the car was nudged out of a neighbouring obstacle.
      const closingSpeed = Math.max(approach, 0);
      const key = `body:${obstacle.id}`;
      const existing = touched.get(key);
      if (existing === undefined || closingSpeed > existing.record.peakClosingSpeed) {
        touched.set(key, {
          position: manifold.point,
          wheel: null,
          record: {
            key,
            surface: surfaceOf(obstacle),
            part: 'body',
            peakSeverity: severityFor(closingSpeed),
            peakClosingSpeed: closingSpeed,
            lastTouchTime: state.time,
          },
        });
      }
    }

    if (!resolvedAny) break;
  }

  // --- Coalescing: extend a live record, or open one and report it. ----------
  const coalesced = coalesceContacts(state.contacts, touched, state.tick, state.time);

  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  return {
    pose,
    longitudinalVelocity: velocity.x * cos + velocity.y * sin,
    lateralVelocity: -velocity.x * sin + velocity.y * cos,
    yawRate,
    contacts: coalesced.contacts,
    events: coalesced.events,
  };
}

/** Drop records whose contact has been over for longer than the debounce window. */
function prune(contacts: readonly ContactRecord[], time: number): readonly ContactRecord[] {
  return contacts.filter((c) => time - c.lastTouchTime <= CONTACT_DEBOUNCE_SECONDS);
}

function clampTo(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}
