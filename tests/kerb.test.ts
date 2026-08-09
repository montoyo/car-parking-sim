/**
 * Kerbing, asserted in the player's language: scraping a wheel along the kerb is
 * a RIM STRIKE on a named wheel, riding up over the kerb is worse than rubbing
 * along it, and bodywork hanging over a high kerb is a scrape, not a rim.
 *
 * All of it through the core's seam — `createWorld`, `step` (via the shared drive
 * helper), the emitted `SimEvent`s, and `world.contacts` for the coalesced peak.
 */

import { describe, expect, it } from 'vitest';
import type { ContactEvent, Severity, WheelId } from '../src/core/index';
import { VEHICLE, bodyOutline, createWorld, severityFor } from '../src/core/index';
import { eventsOfKind, hold } from './helpers/drive';

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { graze: 0, knock: 1, impact: 2 };

/** Local x of the front bumper — taken from the same outline collision uses. */
const NOSE_X = Math.max(...bodyOutline().map((p) => p.x));

/** A kerb height above the sill, so bodywork can reach it. Bodywork-scrape territory. */
const HIGH_KERB = 0.2;

function kerbContacts(events: readonly { kind: string }[]): readonly ContactEvent[] {
  return eventsOfKind(events as never, 'contact').filter((e) => e.surface === 'kerb');
}

function wheelsNamed(events: readonly ContactEvent[]): readonly (WheelId | null)[] {
  return events.filter((e) => e.part === 'wheel').map((e) => e.wheel);
}

/**
 * Square to the kerb (which is the y = 0 line), inside the gap, with the
 * right-hand tyres just overlapping the kerb line — the classic rub while
 * creeping forward alongside it.
 */
function rubbingAlongKerb(parameters: Readonly<Record<string, number>> = {}) {
  const tyreEdgeFromCentreline = VEHICLE.trackRear / 2 + VEHICLE.wheelWidth / 2;
  return createWorld('parallel-park', {
    parameters,
    // 2.75 cm of tyre over the kerb line: rubbing, but both right-hand wheel
    // centres still comfortably on the road.
    spawn: { x: -0.5, y: tyreEdgeFromCentreline - 0.0275, yaw: 0 },
  });
}

describe('the roadway border', () => {
  it('is a polyline with a height, held separately from the body obstacles', () => {
    const kerb = createWorld('parallel-park').scenario.kerb;
    expect(kerb).not.toBeNull();
    expect(kerb!.polyline.length).toBeGreaterThanOrEqual(2);
    expect(kerb!.height).toBeGreaterThan(0);
    expect(kerb!.pavementWidth).toBeGreaterThan(0);

    // The kerb is NOT one of the obstacles the bodywork is resolved against.
    const obstacles = createWorld('parallel-park').scenario.obstacles;
    expect(obstacles.some((o) => o.id.includes('kerb'))).toBe(false);
  });
});

describe('rim strikes', () => {
  it('a wheel grazing the kerb emits a rim strike naming the correct wheel', () => {
    const result = hold(rubbingAlongKerb(), 2, { gear: 'forward', throttle: 0.15 });
    const contacts = kerbContacts(result.events);

    expect(contacts.length).toBeGreaterThan(0);
    for (const contact of contacts) {
      expect(contact.surface).toBe('kerb');
      expect(contact.part).toBe('wheel');
      expect(contact.severity).toBe('graze');
    }

    const named = wheelsNamed(contacts);
    expect(named).toContain('frontRight');
    expect(named).toContain('rearRight');
    // The kerb is on the right: the left-hand tyres are nowhere near it.
    expect(named).not.toContain('frontLeft');
    expect(named).not.toContain('rearLeft');
  });

  it('reports one coalesced event per wheel for a sustained scrape, not one per tick', () => {
    const result = hold(rubbingAlongKerb(), 3, { gear: 'forward', throttle: 0.15 });
    const contacts = kerbContacts(result.events);

    expect(wheelsNamed(contacts).filter((w) => w === 'frontRight').length).toBe(1);
    expect(wheelsNamed(contacts).filter((w) => w === 'rearRight').length).toBe(1);
    // Three seconds of scrape is hundreds of ticks; the player calls it one rub.
    expect(contacts.length).toBe(2);
  });

  it('a graze at a low kerb never reports bodywork — the sill clears it', () => {
    const result = hold(rubbingAlongKerb(), 2, { gear: 'forward', throttle: 0.15 });
    expect(kerbContacts(result.events).some((c) => c.part === 'body')).toBe(false);
  });
});

describe('mounting the kerb', () => {
  /**
   * Nose swung out of the bay toward the kerb, creeping at it: the front wheels
   * ride up over the border rather than rubbing along it.
   */
  function creepingOverKerb() {
    return createWorld('parallel-park', {
      spawn: { x: 0, y: 1.5, yaw: -Math.PI / 2 },
    });
  }
  /** Long enough for the front wheels to ride over, short of the building wall. */
  const CREEP_SECONDS = 0.8;

  it('reports a higher severity than grazing', () => {
    const mounted = hold(creepingOverKerb(), CREEP_SECONDS, { gear: 'forward', throttle: 0 });
    const grazed = hold(rubbingAlongKerb(), 2, { gear: 'forward', throttle: 0.15 });

    const front = mounted.world.contacts.find((c) => c.key === 'kerb:frontRight');
    expect(front, 'the front wheel never reached the kerb').toBeDefined();
    // The wheel really is over the border, not beside it.
    expect(mounted.world.vehicle.wheels.frontRight.position.y).toBeLessThan(0);

    const grazeSeverity = kerbContacts(grazed.events)[0]!.severity;
    expect(SEVERITY_RANK[front!.peakSeverity]).toBeGreaterThan(SEVERITY_RANK[grazeSeverity]);
    // ... and worse than the closing speed ALONE would call it: riding up over the
    // border is its own escalation, not just a faster rub.
    expect(SEVERITY_RANK[front!.peakSeverity]).toBeGreaterThan(
      SEVERITY_RANK[severityFor(front!.peakClosingSpeed)],
    );
  });

  it('is reported as a rim strike on the wheels that crossed', () => {
    const result = hold(creepingOverKerb(), CREEP_SECONDS, { gear: 'forward', throttle: 0 });
    const named = wheelsNamed(kerbContacts(result.events));
    expect(named).toContain('frontRight');
    expect(named).toContain('frontLeft');
  });
});

describe('bodywork over a high kerb', () => {
  /**
   * Angled out of the bay with a high kerb: the front corner hangs over the
   * pavement while both right-hand tyres are still on the road. That is a
   * bodywork scrape, and calling it a rim strike would be a lie to the player.
   */
  function overhangingHighKerb() {
    return createWorld('parallel-park', {
      parameters: { kerbHeight: HIGH_KERB },
      spawn: { x: -0.2, y: 1.15, yaw: (-10 * Math.PI) / 180 },
    });
  }

  it('emits an overhang scrape reported as a body contact, not a rim strike', () => {
    expect(HIGH_KERB).toBeGreaterThan(VEHICLE.sillHeight);
    const result = hold(overhangingHighKerb(), 1, { brake: 1 });
    const contacts = kerbContacts(result.events);

    expect(contacts.length).toBe(1);
    const scrape = contacts[0]!;
    expect(scrape.part).toBe('body');
    expect(scrape.wheel).toBeNull();
    // Reported out at the overhanging corner, over the pavement.
    expect(scrape.position.y).toBeLessThanOrEqual(0);
    expect(scrape.position.x).toBeGreaterThan(result.world.vehicle.pose.x);
    expect(scrape.position.x).toBeLessThan(result.world.vehicle.pose.x + NOSE_X + 0.01);
  });

  it('does not report bodywork when the kerb is lower than the sill', () => {
    const low = createWorld('parallel-park', {
      parameters: { kerbHeight: 0.06 },
      spawn: { x: -0.2, y: 1.15, yaw: (-10 * Math.PI) / 180 },
    });
    expect(kerbContacts(hold(low, 1, { brake: 1 }).events).length).toBe(0);
  });
});
