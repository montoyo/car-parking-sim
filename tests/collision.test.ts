/**
 * Body collision, asserted the way the player experiences it: you cannot drive
 * through a parked car, hitting something is reported, and a nudge is not scored
 * like a crash. Everything goes through the core's seam — `createWorld`, `step`
 * (via the shared drive helper) and the emitted `SimEvent`s.
 */

import { describe, expect, it } from 'vitest';
import type { Severity, SimEvent } from '../src/core/index';
import { PARALLEL_PARK_PARAMETERS, VEHICLE, bodyOutline, createWorld } from '../src/core/index';
import { eventsOfKind, hold } from './helpers/drive';

const GAP = PARALLEL_PARK_PARAMETERS.gapLength;
/**
 * Local x of the front bumper. NOT half the overall length: the pose origin sits
 * midway along the wheelbase and the overhangs differ, so the nose is asked for
 * from the same outline collision uses.
 */
const NOSE_X = Math.max(...bodyOutline().map((p) => p.x));
/** Rear face of the front parked car: the surface a car in the gap drives into. */
const FRONT_CAR_REAR_FACE = GAP / 2;
/** The parked cars sit level with the kerb-side line; this is their centreline. */
const PARKED_CAR_Y = 0.1 + VEHICLE.bodyWidth / 2;
/** Roadside face of the building wall behind the pavement. */
const BUILDING_WALL_FACE = -3.15 + 0.15;

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { graze: 0, knock: 1, impact: 2 };

/**
 * Bodywork-against-wall contacts only. The building wall sits behind the
 * pavement, so any run-up at it also drives over the kerb; those rim strikes are
 * a separate class of mistake and are asserted in `kerb.test.ts`.
 */
function wallContacts(events: readonly SimEvent[]) {
  return eventsOfKind(events, 'contact').filter((c) => c.surface === 'wall');
}

/** In the gap, square to the kerb, nose `runUp` metres short of the front car. */
function facingParkedCar(runUp = 1.5) {
  return createWorld('parallel-park', {
    spawn: { x: FRONT_CAR_REAR_FACE - NOSE_X - runUp, y: PARKED_CAR_Y, yaw: 0 },
  });
}

/** Road-side flank of a parked car — the face a car coming out of the lane meets. */
const PARKED_CAR_FLANK = PARKED_CAR_Y + 0.91;

/**
 * Out in the lane, nose swung round at the rear parked car's flank. The gap only
 * holds about a metre and a half of run-up; broadside from the lane is where the
 * scenario lets a player actually build speed at a parked car.
 */
function facingParkedCarFlank(runUp: number) {
  return createWorld('parallel-park', {
    spawn: { x: -5.4, y: PARKED_CAR_FLANK + NOSE_X + runUp, yaw: -Math.PI / 2 },
  });
}

/** In the lane, nose swung round to point at the building wall across the pavement. */
function facingWall(runUp: number) {
  return createWorld('parallel-park', {
    spawn: { x: 0, y: BUILDING_WALL_FACE + NOSE_X + runUp, yaw: -Math.PI / 2 },
  });
}

describe('body collision against a parked car', () => {
  it('driving into a parked car emits a contact with surface vehicle and stops the car', () => {
    const result = hold(facingParkedCar(), 4, { gear: 'forward', throttle: 0.6 });

    const contacts = eventsOfKind(result.events, 'contact');
    expect(contacts.length).toBeGreaterThan(0);
    const first = contacts[0]!;
    expect(first.surface).toBe('vehicle');
    expect(first.part).toBe('body');
    expect(first.wheel).toBeNull();
    expect(first.closingSpeed).toBeGreaterThan(0);
    // The contact is reported where the metal met: at the parked car's rear face.
    expect(Math.abs(first.position.x - FRONT_CAR_REAR_FACE)).toBeLessThan(0.1);

    // Stopped, and still holding against the throttle rather than grinding on.
    expect(Math.abs(result.world.vehicle.longitudinalVelocity)).toBeLessThan(0.05);
    expect(result.world.vehicle.pose.x + NOSE_X).toBeLessThan(FRONT_CAR_REAR_FACE + 0.02);
  });

  it('reports one coalesced event for a single sustained shove, not one per tick', () => {
    const result = hold(facingParkedCar(), 4, { gear: 'forward', throttle: 0.6 });
    expect(eventsOfKind(result.events, 'contact').length).toBe(1);
  });

  it('cannot be pushed through the parked car at any approach speed the scenario allows', () => {
    // Nose-on, from inside the gap.
    for (const seconds of [2, 4, 8]) {
      const result = hold(facingParkedCar(), seconds, { gear: 'forward', throttle: 1 });
      expect(
        result.world.vehicle.pose.x + NOSE_X,
        `in the gap, ${seconds}s of full throttle`,
      ).toBeLessThan(FRONT_CAR_REAR_FACE + 0.05);
    }

    // Broadside out of the lane, where a run-up is actually available.
    for (const runUp of [0.3, 0.5, 1.5]) {
      for (const seconds of [2, 4, 8]) {
        const result = hold(facingParkedCarFlank(runUp), seconds, {
          gear: 'forward',
          throttle: 1,
        });
        expect(
          result.world.vehicle.pose.y - NOSE_X,
          `${runUp} m run-up, ${seconds}s of full throttle`,
        ).toBeGreaterThan(PARKED_CAR_FLANK - 0.05);
      }
    }
  });
});

describe('body collision against a wall', () => {
  it('driving into a wall emits a contact with surface wall and stops the car', () => {
    const result = hold(facingWall(0.8), 4, { gear: 'forward', throttle: 0.6 });

    // Only the wall: this approach crosses the kerb on its way over the
    // pavement, and kerbing is its own class of mistake (see kerb.test.ts).
    const contacts = wallContacts(result.events);
    expect(contacts.length).toBe(1);
    expect(contacts[0]!.part).toBe('body');

    expect(Math.abs(result.world.vehicle.longitudinalVelocity)).toBeLessThan(0.05);
    expect(result.world.vehicle.pose.y - NOSE_X).toBeGreaterThan(BUILDING_WALL_FACE - 0.05);
  });
});

describe('impact severity', () => {
  /** Closing speed and severity of the first contact from a given run-up. */
  function firstImpact(runUp: number, throttle: number) {
    const result = hold(facingWall(runUp), 8, { gear: 'forward', throttle });
    const first = wallContacts(result.events)[0];
    expect(first, `no contact after ${runUp} m at throttle ${throttle}`).toBeDefined();
    return { closingSpeed: first!.closingSpeed, severity: first!.severity };
  }

  it('closing speed and severity increase monotonically with the run-up', () => {
    const runs = [0.15, 0.6, 2, 5].map((runUp) => firstImpact(runUp, 1));

    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]!.closingSpeed).toBeGreaterThan(runs[i - 1]!.closingSpeed);
      expect(SEVERITY_RANK[runs[i]!.severity]).toBeGreaterThanOrEqual(
        SEVERITY_RANK[runs[i - 1]!.severity],
      );
    }
  });

  it('uses the whole vocabulary: a creep grazes, a shunt knocks, a run-up is an impact', () => {
    // Rolling onto it from two centimetres away on idle creep alone.
    expect(firstImpact(0.02, 0).severity).toBe('graze');
    // A short stab of throttle — the classic misjudged shunt.
    expect(firstImpact(0.15, 1).severity).toBe('knock');
    // Five metres of run-up: no longer a parking mistake.
    expect(firstImpact(5, 1).severity).toBe('impact');
  });
});
