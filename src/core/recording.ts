/**
 * The recording: what the replay plays back.
 *
 * A frame is appended every fixed tick, holding exactly what the top-down replay
 * and its readout need — body pose, per-wheel pose and ground contact patch, rack
 * position, gear and signed speed — alongside the attempt's `SimEvent` log, whose
 * events already carry the tick they happened on.
 *
 * The replay is PLAYBACK of these frames and never a re-simulation. A re-simulated
 * replay that diverged even slightly would show the player a collision that did
 * not happen, at precisely the moment they came to the replay to study it. So
 * nothing here steps the world: `Recorder` copies, `frameAt` indexes, and the
 * markers are derived from the same event log scoring reads — via `scoredContacts`
 * itself, so the number of markers on the trace cannot disagree with the number of
 * contacts the player was penalised for.
 */

import type { Gear } from './input';
import type { ContactEvent, GearChangeEvent, Severity, SimEvent } from './events';
import type { Scenario, ScenarioId } from './scenario';
import { bodyCentre } from './collision';
import { scoredContacts } from './scoring';
import type { Vec2, WheelId } from './vehicle';
import { WHEEL_IDS } from './vehicle';
import type { BodyPose, WorldState } from './world';

/** One wheel at one recorded instant. */
export interface RecordedWheel {
  /**
   * Where the tyre meets the road, in world coordinates. This is also the hub's
   * plan position — the hub is directly above it at `wheelRadius` — which is why
   * one polyline serves as both the wheel's path and its contact patch's.
   */
  readonly contactPatch: Vec2;
  /** Road-wheel steer angle relative to the body (rad); 0 for the rears. */
  readonly steerAngle: number;
  /** Accumulated rotation about the axle (rad). */
  readonly spin: number;
}

/** One fixed tick of the attempt, as the replay reads it. */
export interface Frame {
  readonly tick: number;
  /** Simulated time at this tick (s). */
  readonly time: number;
  readonly pose: BodyPose;
  /** Bodywork centre — the point the body trace is drawn through. */
  readonly centre: Vec2;
  readonly wheels: Readonly<Record<WheelId, RecordedWheel>>;
  /** Steering rack position in [-1, 1], shown for the scrubbed frame. */
  readonly rack: number;
  readonly gear: Gear;
  /**
   * Longitudinal speed (m/s), SIGNED: negative is reversing. The sign is what
   * gives the trace its direction of travel.
   */
  readonly speed: number;
}

export interface Recording {
  readonly scenarioId: ScenarioId;
  /** The layout the attempt was driven in, so the replay draws the same world. */
  readonly scenario: Scenario;
  readonly frames: readonly Frame[];
  /** The whole attempt's event log, each event carrying its tick index. */
  readonly events: readonly SimEvent[];
}

/** The frame for a world state. Pure: a copy, never a step. */
export function frameOf(world: WorldState): Frame {
  const v = world.vehicle;
  const wheels = {} as Record<WheelId, RecordedWheel>;
  for (const id of WHEEL_IDS) {
    const wheel = v.wheels[id];
    wheels[id] = {
      contactPatch: { x: wheel.position.x, y: wheel.position.y },
      steerAngle: wheel.steerAngle,
      spin: wheel.spin,
    };
  }
  return {
    tick: world.tick,
    time: world.time,
    pose: { x: v.pose.x, y: v.pose.y, yaw: v.pose.yaw },
    centre: bodyCentre(v.pose),
    wheels,
    rack: v.rack,
    gear: v.gear,
    speed: v.longitudinalVelocity,
  };
}

/**
 * Accumulates a recording tick by tick — what the fixed-timestep loop drives.
 * Append-only and incremental, because an attempt is thousands of ticks long and
 * rebuilding an immutable recording each one would cost the frame rate the whole
 * project spends its budget on.
 */
export class Recorder {
  private readonly frames: Frame[] = [];
  private readonly events: SimEvent[] = [];
  private readonly scenario: Scenario;
  private readonly scenarioId: ScenarioId;

  /** Starts with the initial world, so frame 0 is the approach pose. */
  constructor(initial: WorldState) {
    this.scenario = initial.scenario;
    this.scenarioId = initial.scenarioId;
    this.frames.push(frameOf(initial));
  }

  /** Append the tick just stepped, plus whatever it emitted. */
  record(world: WorldState, events: readonly SimEvent[] = []): void {
    this.frames.push(frameOf(world));
    this.events.push(...events);
  }

  /** The recording so far. */
  snapshot(): Recording {
    return {
      scenarioId: this.scenarioId,
      scenario: this.scenario,
      frames: [...this.frames],
      events: [...this.events],
    };
  }

  get frameCount(): number {
    return this.frames.length;
  }
}

/**
 * Below this the car is standing still and the rack has not moved: the attempt
 * has not begun. Loose enough to ignore numerical drift in a stationary car,
 * tight enough that the first deliberate touch of a pedal or the wheel trips it.
 */
const IDLE_EPSILON = 1e-3;

/**
 * The first frame on which the player did something — moved, turned the wheel, or
 * selected a gear. The frames before it are the car sitting in the approach pose
 * while the player reads the scenario, and they are dead air at the head of every
 * replay: a scrub bar mostly spent on a stationary car, and a clock whose zero is
 * some arbitrary moment before the manoeuvre.
 *
 * Returns 0 for a recording in which nothing ever happened, so a trim is always a
 * valid recording rather than an empty one.
 */
export function firstActionFrame(recording: Recording): number {
  const frames = recording.frames;
  const first = frames[0];
  if (first === undefined) return 0;
  for (let i = 1; i < frames.length; i++) {
    const frame = frames[i] as Frame;
    if (
      Math.abs(frame.speed) > IDLE_EPSILON ||
      Math.abs(frame.rack - first.rack) > IDLE_EPSILON ||
      frame.gear !== first.gear
    ) {
      // The frame BEFORE the change is the last moment of the approach pose, so
      // t = 0 shows the car as it was when the player took hold of it.
      return i - 1;
    }
  }
  return 0;
}

/**
 * The same recording with the dead air at the head cut off and `time` rebased so
 * t = 0 is the player's first action.
 *
 * `tick` is deliberately NOT rebased: it is the identity every event in the log
 * carries, and renumbering it would break the correspondence between a contact
 * and the frame it happened on that `frameIndexForTick` depends on. The events
 * survive whole for the same reason — nothing can happen before the first action,
 * so nothing is discarded by cutting there.
 */
export function trimLeadingIdle(recording: Recording): Recording {
  const start = firstActionFrame(recording);
  if (start <= 0) return recording;
  const origin = (recording.frames[start] as Frame).time;
  return {
    ...recording,
    frames: recording.frames.slice(start).map((frame) => ({ ...frame, time: frame.time - origin })),
  };
}

/** The frame at an index, clamped into the recording. */
export function frameAt(recording: Recording, index: number): Frame {
  const frames = recording.frames;
  if (frames.length === 0) throw new Error('Recording has no frames.');
  const i = index < 0 ? 0 : index >= frames.length ? frames.length - 1 : Math.floor(index);
  return frames[i] as Frame;
}

/**
 * The frame index an event's tick landed on — the whole of "jump to this event"
 * and, with a scrub, the whole of seeking: every replay control reduces to setting
 * a frame index.
 */
export function frameIndexForTick(recording: Recording, tick: number): number {
  const frames = recording.frames;
  let found = 0;
  for (let i = 0; i < frames.length; i++) {
    if ((frames[i] as Frame).tick <= tick) found = i;
    else break;
  }
  return found;
}

interface MarkerBase {
  /** Frame the marker sits on: the index a jump-to-event sets. */
  readonly frameIndex: number;
  readonly tick: number;
  /** Where on the trace to pin it, in world coordinates. */
  readonly position: Vec2;
  /** Short text for the timeline button. */
  readonly label: string;
}

/** One coalesced contact, pinned at the exact spot it happened. */
export interface ContactMarker extends MarkerBase {
  readonly kind: 'contact';
  /** The contact's coalescing key — the same identity scoring penalises once. */
  readonly key: string;
  readonly surface: ContactEvent['surface'];
  readonly part: ContactEvent['part'];
  readonly wheel: WheelId | null;
  readonly severity: Severity;
}

/** A gear change: one shunt, at the point on the trace the player changed. */
export interface GearChangeMarker extends MarkerBase {
  readonly kind: 'gearChange';
  readonly from: Gear;
  readonly to: Gear;
}

export type ReplayMarker = ContactMarker | GearChangeMarker;

/**
 * Contact markers for the trace — one per contact SCORING counted, because they
 * come from `scoredContacts` over the very same log. One sustained scrape is one
 * marker, at the worst severity it reached.
 */
export function contactMarkers(recording: Recording): readonly ContactMarker[] {
  return scoredContacts(recording.events)
    .map((c) => ({
      kind: 'contact' as const,
      key: c.key,
      frameIndex: frameIndexForTick(recording, c.tick),
      tick: c.tick,
      position: c.position,
      surface: c.surface,
      part: c.part,
      wheel: c.wheel,
      severity: c.severity,
      label: `${c.severity} ${c.part === 'wheel' ? (c.wheel ?? 'wheel') : 'body'} / ${c.surface}`,
    }))
    .sort((a, b) => a.tick - b.tick);
}

/**
 * Gear-change markers: where each SHUNT was made — the same reversals scoring
 * counts, not every gear change. Selecting neutral is not a shunt, and in EV mode
 * (where lifting off the key IS neutral) marking them all would bury the two or
 * three moments worth scrubbing to under a marker per lift-off.
 */
export function gearChangeMarkers(recording: Recording): readonly GearChangeMarker[] {
  const out: GearChangeMarker[] = [];
  let previous: 'forward' | 'reverse' | null = null;
  for (const event of recording.events) {
    if (event.kind !== 'gearChange') continue;
    const change = event as GearChangeEvent;
    if (change.to === 'neutral') continue;
    const reversal = previous !== null && previous !== change.to;
    previous = change.to;
    if (!reversal) continue;
    const frameIndex = frameIndexForTick(recording, change.tick);
    out.push({
      kind: 'gearChange',
      frameIndex,
      tick: change.tick,
      position: frameAt(recording, frameIndex).centre,
      from: change.from,
      to: change.to,
      label: `${change.from} -> ${change.to}`,
    });
  }
  return out;
}

/** Every marker on the timeline, in the order they happened. */
export function replayMarkers(recording: Recording): readonly ReplayMarker[] {
  return [...contactMarkers(recording), ...gearChangeMarkers(recording)].sort(
    (a, b) => a.tick - b.tick,
  );
}

/** The path a wheel's contact patch traced, for the per-wheel trace. */
export function wheelTrace(recording: Recording, id: WheelId): readonly Vec2[] {
  return recording.frames.map((f) => f.wheels[id].contactPatch);
}

/** The path the bodywork centre traced. */
export function bodyTrace(recording: Recording): readonly Vec2[] {
  return recording.frames.map((f) => f.centre);
}
