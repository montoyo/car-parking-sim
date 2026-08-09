/**
 * Scoring: a PURE function over the finished world plus the event log.
 *
 *   scoreAttempt(world, events) -> Scorecard
 *
 * Two structural rules make this the whole of scoring, with no per-scenario code:
 *
 * 1. Every criterion reduces to one measured number plus the scenario's own
 *    `CriterionSpec` (target, tolerance, weight, unit). The sub-score is a
 *    normalised 0-1 ramp from target to tolerance, so scenario DIFFICULTY is
 *    expressed by tolerances in scenario data rather than by bespoke code here.
 *    A criterion a scenario does not list simply is not scored, and a criterion it
 *    lists but whose geometry is absent (kerb distance with no kerb) is dropped
 *    with the remaining weights renormalised, so the total is always 0-1.
 *
 * 2. Being fully inside the bay is a HARD GATE, never a weighted term. It sits in
 *    `gates` next to the contact limit and the minimum score, and `passed` is the
 *    conjunction of the gates alone — a car left half out of the bay fails no
 *    matter how well it scores on everything else.
 *
 * The measurements come from the same two places everything else in the project
 * reads: `WorldState` (final pose) and the `SimEvent` log (contacts and gear
 * changes — the very stream that drove the live cues).
 */

import type { ContactEvent, GearChangeEvent, Severity, SimEvent } from './events';
import type { Bay, CriterionId, CriterionSpec, Kerb, Scenario } from './scenario';
import { bodyCentre, bodyPolygon, pointInConvex } from './collision';
import type { VehicleDefinition, Vec2 } from './vehicle';
import { VEHICLE } from './vehicle';
import type { BodyPose, WorldState } from './world';

/**
 * How much a contact costs, in the `count` units the `contacts` criterion's
 * tolerance is stated in. A graze is half a mistake; an impact on its own is
 * enough to wipe out the criterion at the parallel park's tolerance of 3.
 */
export const CONTACT_SEVERITY_WEIGHT: Readonly<Record<Severity, number>> = {
  graze: 0.5,
  knock: 1.5,
  impact: 3,
};

/**
 * Whether a criterion is penalised for deviating either side of its target, or
 * only for exceeding it. Geometry is two-sided (a metre past the bay centre is as
 * wrong as a metre short); tallies and the clock are one-sided (parking in fewer
 * shunts than the target, or quicker, is not a mistake).
 */
export const CRITERION_DIRECTION: Readonly<Record<CriterionId, 'both' | 'above'>> = {
  centring: 'both',
  alignment: 'both',
  kerbDistance: 'both',
  foreAft: 'both',
  contacts: 'above',
  shunts: 'above',
  time: 'above',
};

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

/** Lower bound of the weighted total for each grade. */
const GRADE_BANDS: readonly { readonly grade: Grade; readonly from: number }[] = [
  { grade: 'A', from: 0.9 },
  { grade: 'B', from: 0.8 },
  { grade: 'C', from: 0.7 },
  { grade: 'D', from: 0.6 },
];

/** One criterion's result — a row of the breakdown screen. */
export interface CriterionScore {
  readonly criterion: CriterionId;
  /** Human-readable name of what was measured, for the breakdown screen. */
  readonly label: string;
  /** What was measured, in `unit`. */
  readonly value: number;
  readonly target: number;
  readonly tolerance: number;
  readonly unit: CriterionSpec['unit'];
  /** Normalised 0-1: 1 at the target, 0 at the tolerance. */
  readonly subScore: number;
  /** Share of the total this criterion carries, after renormalisation. */
  readonly weight: number;
  /** `weight * subScore` — the criteria's `points` sum to `total`. */
  readonly points: number;
}

/** The hard gates. Independent of the weighted total, and all of them must hold. */
export interface Gates {
  /** Whether the whole car is inside the bay polygon. Null when there is no bay. */
  readonly fullyInsideBay: boolean | null;
  /** Whether the contact count is within the scenario's limit. */
  readonly withinContactLimit: boolean;
  /** Whether the weighted total reaches the scenario's minimum. */
  readonly meetsMinimumScore: boolean;
}

export interface Scorecard {
  readonly scenarioId: Scenario['id'];
  /** The tuned parameters this attempt was run with — part of its identity. */
  readonly parameters: Readonly<Record<string, number>>;
  readonly criteria: readonly CriterionScore[];
  /** Weighted total in [0, 1]. The criteria's `points` sum to exactly this. */
  readonly total: number;
  /** `total` as a 0-100 score, for display. */
  readonly points: number;
  readonly grade: Grade;
  /** 0-5 stars, so progress is legible at a glance without reading the rows. */
  readonly stars: number;
  readonly gates: Gates;
  /** True only if every gate holds. */
  readonly passed: boolean;
  /** Coalesced contacts, worst severity per contact. */
  readonly contacts: readonly ScoredContact[];
  readonly shunts: number;
  readonly elapsedSeconds: number;
  /** Why the attempt failed outright, if it did (hard mode severe impact). */
  readonly failureReason: string | null;
}

/** One distinct contact, as scoring counts it: one scrape, its worst severity. */
export interface ScoredContact {
  readonly key: string;
  readonly surface: ContactEvent['surface'];
  readonly part: ContactEvent['part'];
  readonly wheel: ContactEvent['wheel'];
  readonly severity: Severity;
  readonly position: Vec2;
  readonly tick: number;
}

const CRITERION_LABELS: Readonly<Record<CriterionId, string>> = {
  centring: 'Centring between the bay lines',
  alignment: 'Alignment to the bay',
  kerbDistance: 'Distance from the kerb',
  foreAft: 'Fore-and-aft position in the bay',
  contacts: 'Contact penalties',
  shunts: 'Shunts',
  time: 'Time taken',
};

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Distinct contacts from the event log. A sustained scrape emits once and then
 * re-emits only if it gets strictly worse, so grouping by the event's `key` and
 * keeping the worst severity is exactly "one penalty per mistake".
 */
export function scoredContacts(events: readonly SimEvent[]): readonly ScoredContact[] {
  const byKey = new Map<string, ScoredContact>();
  for (const event of events) {
    if (event.kind !== 'contact') continue;
    const existing = byKey.get(event.key);
    if (
      existing === undefined ||
      CONTACT_SEVERITY_WEIGHT[event.severity] > CONTACT_SEVERITY_WEIGHT[existing.severity]
    ) {
      byKey.set(event.key, {
        key: event.key,
        surface: event.surface,
        part: event.part,
        wheel: event.wheel,
        severity: event.severity,
        position: event.position,
        tick: existing?.tick ?? event.tick,
      });
    }
  }
  return [...byKey.values()];
}

/** Gear changes are shunts: the number of times the player changed direction. */
export function shuntCount(events: readonly SimEvent[]): number {
  return events.filter((e): e is GearChangeEvent => e.kind === 'gearChange').length;
}

/** Offsets of the car's centre from the bay's centre, in the BAY's own frame (m). */
export function bayOffsets(
  pose: BodyPose,
  bay: Bay,
  v: VehicleDefinition = VEHICLE,
): { readonly along: number; readonly across: number } {
  const centre = bodyCentre(pose, v);
  const dx = centre.x - bay.centre.x;
  const dy = centre.y - bay.centre.y;
  const cos = Math.cos(bay.axisYaw);
  const sin = Math.sin(bay.axisYaw);
  return { along: dx * cos + dy * sin, across: -dx * sin + dy * cos };
}

/**
 * Heading error against the bay axis, in degrees, folded into [-90, 90]: a car
 * parked nose-first and one reversed in are both square to the bay, which is what
 * "parallel" means to a driver.
 */
export function alignmentDegrees(pose: BodyPose, bay: Bay): number {
  let a = (pose.yaw - bay.axisYaw) * RAD_TO_DEG;
  a = ((a % 360) + 360) % 360;
  if (a > 180) a -= 360;
  if (a > 90) a -= 180;
  if (a < -90) a += 180;
  return a;
}

/** Distance from the nearest bodywork to the kerb line (m); 0 if it is over it. */
export function kerbDistance(pose: BodyPose, kerb: Kerb, v: VehicleDefinition = VEHICLE): number {
  const polygon = bodyPolygon(pose, v);
  let best = Infinity;
  for (const p of polygon) {
    for (let i = 0; i + 1 < kerb.polyline.length; i++) {
      const a = kerb.polyline[i] as Vec2;
      const b = kerb.polyline[i + 1] as Vec2;
      const d = distanceToSegment(p, a, b);
      if (d < best) best = d;
    }
  }
  return Number.isFinite(best) ? best : 0;
}

function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Whether every corner of the bodywork is inside the bay polygon. */
export function fullyInsideBay(
  pose: BodyPose,
  bay: Bay,
  v: VehicleDefinition = VEHICLE,
): boolean {
  return bodyPolygon(pose, v).every((p) => pointInConvex(p, bay.polygon));
}

/** The normalised 0-1 ramp: 1 at the target, 0 once `tolerance` away from it. */
export function subScoreFor(spec: CriterionSpec, value: number): number {
  const deviation =
    CRITERION_DIRECTION[spec.criterion] === 'both'
      ? Math.abs(value - spec.target)
      : Math.max(0, value - spec.target);
  if (spec.tolerance <= 0) return deviation === 0 ? 1 : 0;
  const sub = 1 - deviation / spec.tolerance;
  return sub < 0 ? 0 : sub > 1 ? 1 : sub;
}

/**
 * Score a finished attempt. `events` is the whole event log of the attempt — the
 * same log the live cues consumed and the replay markers will.
 */
export function scoreAttempt(
  world: WorldState,
  events: readonly SimEvent[],
  v: VehicleDefinition = VEHICLE,
): Scorecard {
  const scenario = world.scenario;
  const bay = scenario.bay;
  const kerb = scenario.kerb;
  const pose = world.vehicle.pose;
  const contacts = scoredContacts(events);
  const shunts = shuntCount(events);
  const elapsedSeconds = world.completion.endedTime ?? world.time;
  const contactCost = contacts.reduce((sum, c) => sum + CONTACT_SEVERITY_WEIGHT[c.severity], 0);

  // Measure each criterion the scenario asks for. `null` means the geometry it
  // needs is absent, so it is dropped and its weight redistributed.
  const measured = scenario.criteria.map((spec) => ({
    spec,
    value: measure(spec.criterion, {
      pose,
      bay,
      kerb,
      contactCost,
      shunts,
      elapsedSeconds,
      vehicle: v,
    }),
  }));
  const applicable = measured.filter(
    (m): m is { spec: CriterionSpec; value: number } => m.value !== null,
  );
  const weightSum = applicable.reduce((sum, m) => sum + m.spec.weight, 0);

  const criteria: CriterionScore[] = applicable.map((m) => {
    const weight = weightSum > 0 ? m.spec.weight / weightSum : 0;
    const subScore = subScoreFor(m.spec, m.value);
    return {
      criterion: m.spec.criterion,
      label: CRITERION_LABELS[m.spec.criterion],
      value: m.value,
      target: m.spec.target,
      tolerance: m.spec.tolerance,
      unit: m.spec.unit,
      subScore,
      weight,
      points: weight * subScore,
    };
  });

  const total = criteria.reduce((sum, c) => sum + c.points, 0);
  const inside = bay === null ? null : fullyInsideBay(pose, bay, v);
  const limit = scenario.pass.maxContacts;
  const gates: Gates = {
    fullyInsideBay: scenario.pass.fullyInsideBay ? inside : null,
    withinContactLimit: limit === null || contacts.length <= limit,
    meetsMinimumScore: total >= scenario.pass.minScore,
  };
  const failed = world.completion.status === 'failed';
  const passed =
    !failed &&
    gates.fullyInsideBay !== false &&
    gates.withinContactLimit &&
    gates.meetsMinimumScore;

  return {
    scenarioId: scenario.id,
    parameters: scenario.parameters,
    criteria,
    total,
    points: Math.round(total * 100),
    grade: passed ? gradeFor(total) : 'F',
    stars: passed ? Math.max(1, Math.round(total * 5)) : 0,
    gates,
    passed,
    contacts,
    shunts,
    elapsedSeconds,
    failureReason: world.completion.reason,
  };
}

interface Measurements {
  readonly pose: BodyPose;
  readonly bay: Bay | null;
  readonly kerb: Kerb | null;
  readonly contactCost: number;
  readonly shunts: number;
  readonly elapsedSeconds: number;
  readonly vehicle: VehicleDefinition;
}

/** The one measurement each criterion is; `null` when its geometry is absent. */
function measure(criterion: CriterionId, m: Measurements): number | null {
  switch (criterion) {
    case 'centring':
      return m.bay === null ? null : bayOffsets(m.pose, m.bay, m.vehicle).across;
    case 'foreAft':
      return m.bay === null ? null : bayOffsets(m.pose, m.bay, m.vehicle).along;
    case 'alignment':
      return m.bay === null ? null : alignmentDegrees(m.pose, m.bay);
    case 'kerbDistance':
      return m.kerb === null ? null : kerbDistance(m.pose, m.kerb, m.vehicle);
    case 'contacts':
      return m.contactCost;
    case 'shunts':
      return m.shunts;
    case 'time':
      return m.elapsedSeconds;
  }
}

export function gradeFor(total: number): Grade {
  for (const band of GRADE_BANDS) {
    if (total >= band.from) return band.grade;
  }
  return 'F';
}
