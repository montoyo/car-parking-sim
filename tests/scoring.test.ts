/**
 * Scoring, through the core's public surface only: `createWorld` places the car,
 * `scoreAttempt` scores it, and every event log fed in is either one a run
 * actually produced or a literal of the same `SimEvent` shape the live cues read.
 *
 * The parallel park's tolerances (scenario data, not numbers invented here) are
 * what the assertions are stated against: centring 0 +/- 0.25 m, alignment
 * 0 +/- 5 deg, kerb distance 0.3 +/- 0.2 m, fore-aft 0 +/- 0.4 m, contacts
 * 0 + 3 counts, shunts 2 + 4, time 45 + 45 s.
 */

import { describe, expect, it } from 'vitest';
import type { ContactEvent, CriterionId, Scorecard, SimEvent } from '../src/core/index';
import {
  CONTACT_SEVERITY_WEIGHT,
  PARALLEL_PARK_PARAMETERS,
  createWorld,
  scoreAttempt,
} from '../src/core/index';
import { drive, eventsOfKind, score } from './helpers/drive';

const BAY_CENTRE_Y = PARALLEL_PARK_PARAMETERS.bayWidth / 2;
/**
 * The pose whose BODYWORK centre sits exactly on the bay centre. The pose origin
 * is the wheelbase midpoint, and the overhangs differ by 8 cm, so the two are
 * 4 cm apart — which is precisely the sort of thing a scoring test must not fudge.
 */
const PERFECT = { x: 0.04, y: BAY_CENTRE_Y, yaw: 0 };

/** Score a car parked at a pose, with an event log, without driving it there. */
function scoreAtPose(
  pose: { x: number; y: number; yaw: number },
  events: readonly SimEvent[] = [],
): Scorecard {
  return scoreAttempt(createWorld('parallel-park', { spawn: pose }), events);
}

function criterion(card: Scorecard, id: CriterionId): number {
  return row(card, id).subScore;
}

/** What a criterion actually measured, in its own unit. */
function measured(card: Scorecard, id: CriterionId): number {
  return row(card, id).value;
}

function row(card: Scorecard, id: CriterionId) {
  const found = card.criteria.find((c) => c.criterion === id);
  if (found === undefined) throw new Error(`no ${id} criterion`);
  return found;
}

function contactEvent(
  key: string,
  severity: ContactEvent['severity'],
  tick = 10,
): ContactEvent {
  return {
    kind: 'contact',
    tick,
    key,
    surface: 'vehicle',
    part: 'body',
    severity,
    closingSpeed: 0.4,
    position: { x: 3.15, y: 1.92 },
    wheel: null,
  };
}

describe('scoring', () => {
  it('gives full marks for centring and alignment to a perfectly parked car', () => {
    const card = scoreAtPose(PERFECT);
    expect(criterion(card, 'centring')).toBeCloseTo(1, 6);
    expect(criterion(card, 'alignment')).toBeCloseTo(1, 6);
  });

  it('degrades the centring sub-score monotonically with lateral offset', () => {
    const offsets = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.4];
    const subScores = offsets.map((d) =>
      criterion(scoreAtPose({ ...PERFECT, y: BAY_CENTRE_Y + d }), 'centring'),
    );
    for (let i = 1; i < subScores.length; i++) {
      expect(subScores[i] as number).toBeLessThanOrEqual(subScores[i - 1] as number);
    }
    // 10 cm out of a 25 cm tolerance is 60% of the marks, and the tolerance itself
    // is the zero point.
    expect(subScores[2] as number).toBeCloseTo(0.6, 6);
    expect(subScores[5] as number).toBeCloseTo(0, 6);
    expect(subScores[6] as number).toBe(0);
    // Offsetting the other way costs exactly the same.
    expect(criterion(scoreAtPose({ ...PERFECT, y: BAY_CENTRE_Y - 0.1 }), 'centring')).toBeCloseTo(
      0.6,
      6,
    );
  });

  it('fails a car left half outside the bay however well it scores otherwise', () => {
    // Perfectly centred between the bay lines and perfectly square to them, but
    // hanging 1.5 m out of the end of the bay.
    const card = scoreAtPose({ ...PERFECT, x: 2.5 });
    expect(criterion(card, 'centring')).toBeCloseTo(1, 6);
    expect(criterion(card, 'alignment')).toBeCloseTo(1, 6);
    expect(card.gates.fullyInsideBay).toBe(false);
    expect(card.passed).toBe(false);
    expect(card.grade).toBe('F');
    expect(card.stars).toBe(0);
    // And the gate is independent of the weighted total, which is still decent.
    expect(card.total).toBeGreaterThan(0.5);
  });

  it('reduces the total by each contact event, weighted by its severity', () => {
    const clean = scoreAtPose(PERFECT);
    const contactWeight = clean.criteria.find((c) => c.criterion === 'contacts')?.weight ?? 0;
    const tolerance = clean.criteria.find((c) => c.criterion === 'contacts')?.tolerance ?? 1;
    const perCount = contactWeight / tolerance;

    for (const severity of ['graze', 'knock', 'impact'] as const) {
      const card = scoreAtPose(PERFECT, [contactEvent('body:parked-car-front', severity)]);
      expect(clean.total - card.total).toBeCloseTo(
        perCount * CONTACT_SEVERITY_WEIGHT[severity],
        6,
      );
    }

    // Two distinct contacts cost the sum of their severities.
    const two = scoreAtPose(PERFECT, [
      contactEvent('body:parked-car-front', 'graze'),
      contactEvent('body:parked-car-rear', 'graze'),
    ]);
    expect(clean.total - two.total).toBeCloseTo(2 * perCount * CONTACT_SEVERITY_WEIGHT.graze, 6);
    // A contact limit of zero is a hard gate, quite apart from the weighting.
    expect(two.gates.withinContactLimit).toBe(false);
    expect(two.passed).toBe(false);
  });

  it('counts one sustained scrape once, at its worst severity', () => {
    // A live contact re-reports when it gets strictly worse: same key, two events.
    const card = scoreAtPose(PERFECT, [
      contactEvent('body:parked-car-front', 'graze', 10),
      contactEvent('body:parked-car-front', 'knock', 40),
    ]);
    expect(card.contacts).toHaveLength(1);
    expect(card.contacts[0]?.severity).toBe('knock');
  });

  it('counts a shunt each time the car goes the other way', () => {
    const result = drive(createWorld('parallel-park'), [
      { seconds: 0.5, input: { gear: 'forward' } },
      { seconds: 0.5, input: { gear: 'reverse' } },
      { seconds: 0.5, input: { gear: 'forward' } },
      { seconds: 0.5, input: { gear: 'neutral', brake: 1 } },
    ]);
    expect(eventsOfKind(result.events, 'gearChange')).toHaveLength(4);
    // Four gear changes, but only two reversals: neutral is not a shunt.
    expect(score(result).shunts).toBe(2);
  });

  it('does not count passing through neutral as a shunt', () => {
    // Which is what EV mode does every time the player lifts off the key.
    const result = drive(createWorld('parallel-park'), [
      { seconds: 0.4, input: { gear: 'forward' } },
      { seconds: 0.4, input: { gear: 'neutral', brake: 1 } },
      { seconds: 0.4, input: { gear: 'forward' } },
      { seconds: 0.4, input: { gear: 'neutral', brake: 1 } },
    ]);
    expect(score(result).shunts).toBe(0);
  });

  it("sums the breakdown's parts to the total", () => {
    const card = scoreAtPose({ x: 0.3, y: BAY_CENTRE_Y - 0.12, yaw: 0.03 }, [
      contactEvent('kerb:rearRight', 'graze'),
    ]);
    const sum = card.criteria.reduce((total, c) => total + c.points, 0);
    expect(sum).toBeCloseTo(card.total, 10);
    // Every criterion the scenario declares is present, and the weights add to 1.
    expect(card.criteria).toHaveLength(7);
    expect(card.criteria.reduce((total, c) => total + c.weight, 0)).toBeCloseTo(1, 10);
    expect(card.points).toBe(Math.round(card.total * 100));
  });

  it('scores a scenario with no bay on the criteria that still apply', () => {
    // The debug plane declares no criteria at all, so there is nothing to score
    // and nothing to gate on — and no crash from asking.
    const card = scoreAttempt(createWorld('debug-plane'), []);
    expect(card.criteria).toHaveLength(0);
    expect(card.gates.fullyInsideBay).toBe(null);
  });
});

/**
 * The known-good manoeuvre. A textbook reverse parallel park, written as a
 * scripted input sequence — dry-steer to lock, swing the tail in, straighten,
 * swing the nose in, then pull forward to sit centrally in the gap — driven
 * through the same `drive` helper as every other gameplay test.
 *
 * This is the scenario-reachability test: if a shipping scenario cannot be
 * completed cleanly by a competent manoeuvre, the layout is wrong.
 */
const KNOWN_GOOD_PARALLEL_PARK = [
  // Wind on full right lock against the brake, as a driver does before moving.
  { seconds: 1.2, input: { gear: 'reverse' as const, brake: 1, steer: -1 } },
  // Reverse on full lock until the car sits at about 38 degrees to the kerb.
  { seconds: 2.9, input: { gear: 'reverse' as const, steer: -1 } },
  // Straighten the wheel, then reverse straight to bring the tail into the gap.
  { seconds: 1.2, input: { gear: 'reverse' as const, brake: 1, steer: 0 } },
  { seconds: 2, input: { gear: 'reverse' as const, steer: 0 } },
  // Full left lock, and reverse again to bring the nose in past the car ahead.
  { seconds: 1.2, input: { gear: 'reverse' as const, brake: 1, steer: 1 } },
  { seconds: 2.9, input: { gear: 'reverse' as const, steer: 1 } },
  // Straighten up and creep forward to sit centrally between the two cars.
  { seconds: 1.2, input: { gear: 'reverse' as const, brake: 1, steer: 0 } },
  { seconds: 1.42, input: { gear: 'forward' as const, steer: 0 } },
  // Stopped, then the player pressing finish: the declaration they are done.
  { seconds: 1, input: { gear: 'forward' as const, brake: 1 } },
  { seconds: 0.1, input: { gear: 'forward' as const, brake: 1, finishRequested: true } },
];

describe('the parallel park is completable', () => {
  it('completes with zero contacts and passes on a known-good manoeuvre', () => {
    const result = drive(createWorld('parallel-park'), KNOWN_GOOD_PARALLEL_PARK);

    expect(eventsOfKind(result.events, 'contact')).toHaveLength(0);
    expect(eventsOfKind(result.events, 'scenarioComplete')).toHaveLength(1);
    expect(result.world.completion.status).toBe('complete');

    const card = score(result);
    expect(card.contacts).toHaveLength(0);
    expect(card.gates.fullyInsideBay).toBe(true);
    expect(card.passed).toBe(true);
    // Square to the kerb to within a degree, and inside the bay's own tolerances
    // on centring and fore-aft position.
    expect(Math.abs(measured(card, 'alignment'))).toBeLessThan(1);
    expect(criterion(card, 'centring')).toBeGreaterThan(0.4);
    expect(criterion(card, 'foreAft')).toBeGreaterThan(0.5);
  });
});
