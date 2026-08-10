/**
 * The recording, through the core's seam only: a run driven with `drive` while a
 * `Recorder` is fed every tick — exactly what the fixed-timestep loop does — then
 * asked what the replay would draw.
 *
 * The load-bearing test is the last one: the number of contact markers the replay
 * pins on the trace equals the number of coalesced contacts scoring counted. Both
 * come from the one event log, which is the whole point of the event stream doing
 * triple duty.
 */

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../src/core/index';
import {
  PARALLEL_PARK_PARAMETERS,
  VEHICLE,
  WHEEL_IDS,
  bodyOutline,
  bodyTrace,
  contactMarkers,
  createWorld,
  FIXED_DT,
  firstActionFrame,
  frameAt,
  frameIndexForTick,
  gearChangeMarkers,
  replayMarkers,
  shuntCount,
  trimLeadingIdle,
  wheelTrace,
} from '../src/core/index';
import { driveRecorded, eventsOfKind, score } from './helpers/drive';

const GAP = PARALLEL_PARK_PARAMETERS.gapLength;
const NOSE_X = Math.max(...bodyOutline().map((p) => p.x));
const PARKED_CAR_Y = 0.1 + VEHICLE.bodyWidth / 2;

/** In the gap, square to the kerb, nose 1.5 m short of the car in front. */
function inTheGap() {
  return createWorld('parallel-park', {
    spawn: { x: GAP / 2 - NOSE_X - 1.5, y: PARKED_CAR_Y, yaw: 0 },
  });
}

/** A botched attempt: shunt about and drive into the car in front. */
const BOTCHED = [
  { seconds: 1.2, input: { gear: 'reverse' as const, throttle: 0.4, steer: -1 } },
  { seconds: 0.6, input: { gear: 'neutral' as const, brake: 1 } },
  { seconds: 3, input: { gear: 'forward' as const, throttle: 0.7, steer: 0.6 } },
  { seconds: 1.5, input: { gear: 'forward' as const, throttle: 0.7, steer: -1 } },
  { seconds: 1, input: { gear: 'neutral' as const, brake: 1 } },
];

/** The known-good reverse parallel park, in the shape the drive helper wants. */
const CLEAN_PARK = [
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
  { seconds: 1, input: { gear: 'forward' as const, brake: 1, finishRequested: true } },
];

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('recording an attempt', () => {
  it('appends one frame per fixed tick, plus the initial pose', () => {
    const initial = createWorld('parallel-park');
    const { result, recording } = driveRecorded(initial, CLEAN_PARK);

    expect(recording.frames).toHaveLength(result.history.length + 1);
    expect(frameAt(recording, 0).tick).toBe(0);
    expect(frameAt(recording, 0).pose).toEqual(initial.vehicle.pose);
    // Ticks are consecutive, so a tick index IS a frame index.
    recording.frames.forEach((f, i) => expect(f.tick).toBe(i));
    expect(recording.events).toEqual(result.events);
    expect(recording.scenario).toEqual(initial.scenario);
  });

  it('records the pose, wheels, rack, gear and signed speed of every tick', () => {
    const { result, recording } = driveRecorded(createWorld('parallel-park'), CLEAN_PARK);

    // Playback, not re-simulation: every frame is a copy of the tick it came from,
    // so the replay cannot show the player something the sim did not do.
    result.history.forEach((world, i) => {
      const frame = frameAt(recording, i + 1);
      expect(frame.pose).toEqual(world.vehicle.pose);
      expect(frame.rack).toBe(world.vehicle.rack);
      expect(frame.gear).toBe(world.vehicle.gear);
      expect(frame.speed).toBe(world.vehicle.longitudinalVelocity);
      expect(frame.time).toBe(world.time);
      for (const id of WHEEL_IDS) {
        expect(frame.wheels[id].contactPatch).toEqual({
          x: world.vehicle.wheels[id].position.x,
          y: world.vehicle.wheels[id].position.y,
        });
        expect(frame.wheels[id].steerAngle).toBe(world.vehicle.wheels[id].steerAngle);
      }
    });

    // Reversing is recorded as negative speed — that is the direction of travel
    // the trace's arrows read.
    expect(Math.min(...recording.frames.map((f) => f.speed))).toBeLessThan(-0.2);
  });

  it('traces the body centre and each wheel over the whole attempt', () => {
    const { recording } = driveRecorded(createWorld('parallel-park'), CLEAN_PARK);

    expect(bodyTrace(recording)).toHaveLength(recording.frames.length);
    for (const id of WHEEL_IDS) {
      expect(wheelTrace(recording, id)).toHaveLength(recording.frames.length);
    }
    // The traces are distinct paths — the whole reason for drawing four of them is
    // that the rear wheels do not follow the fronts.
    const front = wheelTrace(recording, 'frontLeft');
    const rear = wheelTrace(recording, 'rearLeft');
    const apart = front.map((p, i) => distance(p, rear[i] as Vec2));
    expect(Math.min(...apart)).toBeGreaterThan(VEHICLE.wheelbase - 0.01);
  });

  it('marks each shunt at the point on the trace it was made', () => {
    const { result, recording } = driveRecorded(createWorld('parallel-park'), CLEAN_PARK);
    const markers = gearChangeMarkers(recording);

    // The reversals, not every gear change: selecting neutral is not a shunt.
    expect(markers).toHaveLength(shuntCount(result.events));
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers) {
      // The marker sits on the frame of its own tick, and at that frame's centre.
      expect(frameAt(recording, marker.frameIndex).tick).toBe(marker.tick);
      expect(marker.position).toEqual(frameAt(recording, marker.frameIndex).centre);
    }
  });

  it('seeks by frame index, and every marker names the frame of its tick', () => {
    const { recording } = driveRecorded(inTheGap(), BOTCHED);

    expect(frameIndexForTick(recording, 0)).toBe(0);
    expect(frameIndexForTick(recording, 37)).toBe(37);
    // Out of range clamps rather than throwing: scrubbing must not be able to
    // leave the recording.
    expect(frameIndexForTick(recording, 1e6)).toBe(recording.frames.length - 1);
    expect(frameAt(recording, -5)).toBe(frameAt(recording, 0));
    expect(frameAt(recording, 1e6)).toBe(frameAt(recording, recording.frames.length - 1));

    for (const marker of replayMarkers(recording)) {
      expect(marker.frameIndex).toBeGreaterThanOrEqual(0);
      expect(marker.frameIndex).toBeLessThan(recording.frames.length);
      expect(frameAt(recording, marker.frameIndex).tick).toBe(marker.tick);
    }
  });

  it('pins one contact marker per contact scoring counted, where it happened', () => {
    const { result, recording } = driveRecorded(inTheGap(), BOTCHED);
    const card = score(result);
    const markers = contactMarkers(recording);

    // The point of the test: the trace's markers and the scorecard's penalties are
    // the same set of mistakes, counted once each.
    expect(markers.length).toBe(card.contacts.length);
    expect(markers.length).toBeGreaterThan(0);
    // And there were more raw contact events than markers — a sustained scrape is
    // one marker, not twenty.
    expect(eventsOfKind(result.events, 'contact').length).toBeGreaterThanOrEqual(markers.length);
    expect(new Set(markers.map((m) => m.key)).size).toBe(markers.length);
    for (const marker of markers) {
      const scored = card.contacts.find((c) => c.key === marker.key);
      expect(scored).toBeDefined();
      expect(marker.severity).toBe(scored?.severity);
      expect(marker.position).toEqual(scored?.position);
    }
  });

  it('pins no contact markers on a clean attempt', () => {
    const { result, recording } = driveRecorded(createWorld('parallel-park'), CLEAN_PARK);
    expect(contactMarkers(recording)).toHaveLength(0);
    expect(score(result).contacts).toHaveLength(0);
  });
});

/** Two seconds of the player reading the scenario before touching anything. */
const IDLE_HEAD = [{ seconds: 2, input: { gear: 'neutral' as const, brake: 1 } }];
const IDLE_FRAMES = Math.round(2 / FIXED_DT);

describe('trimming the dead air at the head of a recording', () => {
  it('finds the frame the player first acted on', () => {
    const { recording } = driveRecorded(createWorld('parallel-park'), [
      ...IDLE_HEAD,
      ...CLEAN_PARK,
    ]);

    // The frame BEFORE the first input, so t = 0 is the approach pose itself.
    expect(firstActionFrame(recording)).toBe(IDLE_FRAMES);
  });

  it('leaves a recording that starts with an action alone', () => {
    const { recording } = driveRecorded(createWorld('parallel-park'), CLEAN_PARK);
    expect(firstActionFrame(recording)).toBe(0);
    expect(trimLeadingIdle(recording)).toBe(recording);
  });

  it('leaves a recording in which nothing ever happened alone', () => {
    const { recording } = driveRecorded(createWorld('parallel-park'), IDLE_HEAD);
    expect(firstActionFrame(recording)).toBe(0);
    expect(trimLeadingIdle(recording)).toBe(recording);
  });

  it('drops the idle frames and rebases the clock to the first action', () => {
    const { recording } = driveRecorded(createWorld('parallel-park'), [
      ...IDLE_HEAD,
      ...CLEAN_PARK,
    ]);
    const trimmed = trimLeadingIdle(recording);

    expect(trimmed.frames).toHaveLength(recording.frames.length - IDLE_FRAMES);
    expect(frameAt(trimmed, 0).time).toBe(0);
    // The car has not moved at the new t = 0: the trim cut dead air, not driving.
    expect(frameAt(trimmed, 0).pose).toEqual(frameAt(recording, 0).pose);
    // Every frame keeps its pose and its ABSOLUTE tick — only `time` is rebased,
    // because the event log's ticks have to keep pointing at the right frames.
    trimmed.frames.forEach((frame, i) => {
      const original = frameAt(recording, i + IDLE_FRAMES);
      expect(frame.tick).toBe(original.tick);
      expect(frame.pose).toEqual(original.pose);
      expect(frame.time).toBeCloseTo(original.time - IDLE_FRAMES * FIXED_DT, 9);
    });
  });

  it('keeps every event pointing at the frame it happened on', () => {
    const { recording } = driveRecorded(inTheGap(), [...IDLE_HEAD, ...BOTCHED]);
    const trimmed = trimLeadingIdle(recording);

    expect(trimmed.events).toEqual(recording.events);
    const before = contactMarkers(recording);
    const after = contactMarkers(trimmed);
    expect(after).toHaveLength(before.length);
    expect(after.length).toBeGreaterThan(0);
    after.forEach((marker, i) => {
      // Same contact, same spot on the trace — just at an index shifted by the cut.
      expect(marker.key).toBe((before[i] as (typeof before)[number]).key);
      expect(marker.position).toEqual((before[i] as (typeof before)[number]).position);
      expect(marker.frameIndex).toBe(
        (before[i] as (typeof before)[number]).frameIndex - IDLE_FRAMES,
      );
      expect(frameAt(trimmed, marker.frameIndex).tick).toBe(marker.tick);
    });
  });
});
