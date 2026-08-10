/**
 * Every shipping scenario is reachable, and every one gates a car left half out.
 *
 * These are the reachability tests the spec asks for: a scripted "known good"
 * manoeuvre completes each scenario with zero contacts. They go through the core's
 * public surface only — `createWorld`, `step` (via the shared `drive` helper) and
 * `scoreAttempt` — so they read as a description of the manoeuvre rather than of
 * the physics, and if a shipping layout cannot be parked in cleanly by a competent
 * manoeuvre, the LAYOUT is wrong and one of these fails.
 *
 * Each script is the same shape a driver's hands make: wind the rack on against
 * the brake (a real driver dry-steers before moving), travel, straighten, travel.
 * Only the durations differ between scenarios.
 */

import { describe, expect, it } from 'vitest';
import type { ScenarioId, Scenario, Vec2 } from '../src/core/index';
import {
  PLAYABLE_SCENARIO_IDS,
  SCENARIO_TEMPLATES,
  createWorld,
  fullyInsideBay,
  parkedPose,
  resolveScenario,
  vehicleLength,
  VEHICLE,
} from '../src/core/index';
import type { DriveSegment } from './helpers/drive';
import { drive, eventsOfKind, score } from './helpers/drive';

/** The player declaring they are done: stopped, then finish pressed. */
const DECLARE_DONE: DriveSegment = {
  seconds: 1.4,
  input: { gear: 'neutral', brake: 1, finishRequested: true },
};

/**
 * A known-good manoeuvre per scenario. Each was found by driving the scenario and
 * is the shape the scenario is meant to teach:
 *
 *  - forward bay: run up the aisle, one right-hand arc into the bay, straighten.
 *  - reverse bay: from just past the bay, one long reverse arc in, straighten.
 *  - angled bay: run up the lane, a shallow arc onto the 45° axis, straight in.
 *  - tight kerb: the textbook reverse parallel park, done to tighter bands.
 */
const KNOWN_GOOD: Readonly<Record<string, readonly DriveSegment[]>> = {
  'forward-bay': [
    // Roll up the aisle square, as you would while looking into the bay, until
    // the bay mouth is about one turning radius abeam.
    { seconds: 2.5, input: { gear: 'forward' } },
    // One arc at full lock swings the nose through the right angle.
    { seconds: 4.15, input: { gear: 'forward', steer: -1 } },
    // Catch the swing and straighten as the car lines up with the bay.
    { seconds: 0.8, input: { gear: 'forward', steer: 1 } },
    { seconds: 0.6, input: { gear: 'forward' } },
    { seconds: 2, input: { gear: 'forward', brake: 1 } },
    DECLARE_DONE,
  ],
  'reverse-bay': [
    // Full right lock all the way round: reversing, that swings the tail into the
    // bay mouth and the nose out into the aisle.
    { seconds: 6.05, input: { gear: 'reverse', steer: -1 } },
    // Ease the lock off to run the last of it straight down the bay.
    { seconds: 2.7, input: { gear: 'reverse', steer: 0.2 } },
    { seconds: 1.9, input: { gear: 'reverse', brake: 0.3 } },
    DECLARE_DONE,
  ],
  'angled-echelon': [
    { seconds: 3, input: { gear: 'forward' } },
    // Only 45° to turn through, so three quarters of lock is plenty.
    { seconds: 3.1, input: { gear: 'forward', steer: -0.75 } },
    { seconds: 0.7, input: { gear: 'forward', steer: 0.8 } },
    { seconds: 1.85, input: { gear: 'forward' } },
    { seconds: 2, input: { gear: 'forward', brake: 1 } },
    DECLARE_DONE,
  ],
  'tight-kerb': [
    // Wind on full right lock against the brake before moving an inch.
    { seconds: 1.2, input: { gear: 'reverse', brake: 1, steer: -1 } },
    { seconds: 2.9, input: { gear: 'reverse', steer: -0.95 } },
    // Straighten the wheel, then reverse straight to bring the tail in.
    { seconds: 1.2, input: { gear: 'reverse', brake: 1, steer: 0 } },
    { seconds: 2.2, input: { gear: 'reverse', steer: 0 } },
    // Full left lock to swing the nose in past the car ahead.
    { seconds: 1.2, input: { gear: 'reverse', brake: 1, steer: 0.95 } },
    { seconds: 2.7, input: { gear: 'reverse', steer: 1 } },
    // Straighten up and creep forward to sit centrally in the gap.
    { seconds: 1.2, input: { gear: 'reverse', brake: 1, steer: 0 } },
    { seconds: 1.37, input: { gear: 'forward', steer: 0 } },
    DECLARE_DONE,
  ],
};

/** The parallel park's own known-good manoeuvre lives in `scoring.test.ts`. */
const REACHABLE_IDS = Object.keys(KNOWN_GOOD) as ScenarioId[];

function crossOf(polygon: readonly Vec2[], i: number): number {
  const p = polygon[i] as Vec2;
  const q = polygon[(i + 1) % polygon.length] as Vec2;
  const r = polygon[(i + 2) % polygon.length] as Vec2;
  return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
}

describe('the shipping scenarios', () => {
  it('offers the five parking manoeuvres in the selection list, and not the fixture', () => {
    expect(PLAYABLE_SCENARIO_IDS).toEqual([
      'parallel-park',
      'forward-bay',
      'reverse-bay',
      'angled-echelon',
      'tight-kerb',
    ]);
    expect(PLAYABLE_SCENARIO_IDS).not.toContain('debug-plane');
  });

  it.each(PLAYABLE_SCENARIO_IDS)('%s states its difficulty and pass criteria up front', (id) => {
    const template = SCENARIO_TEMPLATES[id];
    expect(template.name.length).toBeGreaterThan(0);
    expect(template.summary.length).toBeGreaterThan(20);
    expect(template.passSummary.length).toBeGreaterThan(20);
    expect(template.pass.fullyInsideBay).toBe(true);
  });

  it.each(PLAYABLE_SCENARIO_IDS)('%s keeps its difficulty in data: tolerances and weights', (id) => {
    const { criteria } = resolveScenario(id);
    expect(criteria.length).toBeGreaterThan(3);
    for (const criterion of criteria) {
      expect(criterion.tolerance, criterion.criterion).toBeGreaterThan(0);
      expect(criterion.weight, criterion.criterion).toBeGreaterThan(0);
    }
    // The weights are a partition of the score, on every scenario.
    expect(criteria.reduce((sum, c) => sum + c.weight, 0)).toBeCloseTo(1, 6);
  });

  it.each(PLAYABLE_SCENARIO_IDS)('%s declares a bay the car actually fits in', (id) => {
    const bay = resolveScenario(id).bay as Scenario['bay'];
    if (!bay) throw new Error(`${id} must have a bay`);
    expect(bay.length).toBeGreaterThan(vehicleLength());
    expect(bay.width).toBeGreaterThan(VEHICLE.bodyWidth);
    // Wound counter-clockwise and convex, which is what the inside-the-bay gate
    // and the completion check both assume.
    for (let i = 0; i < bay.polygon.length; i++) {
      expect(crossOf(bay.polygon, i), `${id} corner ${i}`).toBeGreaterThan(0);
    }
    // And a car parked dead centre in it is inside it.
    expect(fullyInsideBay(parkedPose(bay), bay)).toBe(true);
  });

  it.each(PLAYABLE_SCENARIO_IDS)('%s tunes its declared parameters and nothing else', (id) => {
    const template = SCENARIO_TEMPLATES[id];
    const names = Object.keys(template.parameters);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const spec = template.parameters[name];
      if (!spec) throw new Error('declared');
      expect(spec.min).toBeLessThan(spec.default);
      expect(spec.max).toBeGreaterThan(spec.default);
      expect(spec.step).toBeGreaterThan(0);
      // Widening the dial widens the layout, with no new code path: the resolver is
      // the only thing that turns a parameter into geometry.
      const wide = resolveScenario(id, { [name]: spec.max });
      const narrow = resolveScenario(id, { [name]: spec.min });
      expect(JSON.stringify(wide)).not.toBe(JSON.stringify(narrow));
      // Out of range is clamped rather than built into a broken world.
      expect(resolveScenario(id, { [name]: spec.max + 100 }).parameters[name]).toBe(spec.max);
    }
  });

  it('offers a reversing camera on the scenarios that declare one', () => {
    const offered = PLAYABLE_SCENARIO_IDS.filter((id) => resolveScenario(id).reversingCamera);
    // Reversing manoeuvres only, and not on the parallel park: the point is to be
    // able to compare mirrors-only against camera-assisted.
    expect(offered).toEqual(['reverse-bay', 'tight-kerb']);
    expect(resolveScenario('parallel-park').reversingCamera).toBe(false);
  });
});

describe.each(REACHABLE_IDS)('%s is completable', (id) => {
  const script = KNOWN_GOOD[id] as readonly DriveSegment[];

  it('completes with zero contacts and passes on a known-good manoeuvre', () => {
    const result = drive(createWorld(id), script);
    const card = score(result);

    expect(eventsOfKind(result.events, 'contact')).toHaveLength(0);
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(1);
    expect(result.world.completion.status).toBe('complete');
    expect(card.gates.fullyInsideBay).toBe(true);
    expect(card.passed).toBe(true);
    expect(card.points).toBeGreaterThan(60);
  });

  it('ends square in the bay: within 30 cm of centre and 10 degrees of the bay axis', () => {
    const result = drive(createWorld(id), script);
    const card = score(result);
    const centring = card.criteria.find((c) => c.criterion === 'centring');
    const alignment = card.criteria.find((c) => c.criterion === 'alignment');
    expect(centring).toBeDefined();
    expect(alignment).toBeDefined();
    expect(Math.abs(centring?.value ?? 99)).toBeLessThan(0.3);
    expect(Math.abs(alignment?.value ?? 99)).toBeLessThan(10);
  });

  it('fails the fully-inside-bay gate when the car is left half out', () => {
    // Same declaration of "I am done", made from a pose straddling the bay's edge:
    // half in, half out, which no other criterion is allowed to rescue.
    const bay = resolveScenario(id).bay;
    if (!bay) throw new Error('a playable scenario has a bay');
    const parked = parkedPose(bay);
    // Slide the car out across the bay axis by most of its own width.
    const halfOut = {
      x: parked.x - Math.sin(bay.axisYaw) * (VEHICLE.bodyWidth * 0.75),
      y: parked.y + Math.cos(bay.axisYaw) * (VEHICLE.bodyWidth * 0.75),
      yaw: parked.yaw,
    };
    const result = drive(createWorld(id, { spawn: halfOut }), [
      { seconds: 1.2, input: { gear: 'forward' } },
      { seconds: 1.6, input: { gear: 'forward', brake: 1, finishRequested: true } },
    ]);
    const card = score(result);

    expect(fullyInsideBay(result.world.vehicle.pose, bay)).toBe(false);
    expect(card.gates.fullyInsideBay).toBe(false);
    expect(card.passed).toBe(false);
    expect(card.grade).toBe('F');
  });
});
