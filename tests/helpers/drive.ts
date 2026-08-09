/**
 * THE shared test vocabulary. Every gameplay test in this repo drives the core
 * through this helper — `createWorld`, `step`, and (later) scoring are the only
 * surface tests touch. Later tickets EXTEND this helper rather than introducing
 * a new seam.
 *
 * Usage reads in the player's language:
 *
 *   const r = drive(createWorld('debug-plane'), [
 *     { seconds: 3, input: { gear: 'reverse', throttle: 0.3, steer: -1 } },
 *   ]);
 *   expect(r.world.vehicle.pose.x).toBeLessThan(-0.5);
 */

import type { ControlInput, SimEvent, WorldState } from '../../src/core/index';
import { FIXED_DT, NEUTRAL_INPUT, step } from '../../src/core/index';

/** A held input, applied for a duration. Unspecified channels are neutral. */
export interface DriveSegment {
  readonly seconds: number;
  readonly input?: Partial<ControlInput>;
}

export interface DriveResult {
  readonly world: WorldState;
  readonly events: readonly SimEvent[];
  /** One world per tick, in order, EXCLUDING the initial world. */
  readonly history: readonly WorldState[];
}

export interface DriveOptions {
  /** Fixed timestep to use. Defaults to the core's `FIXED_DT`. */
  readonly dt?: number;
}

export function input(overrides: Partial<ControlInput> = {}): ControlInput {
  return { ...NEUTRAL_INPUT, ...overrides };
}

/** Drive a scripted sequence of held inputs from an initial world. */
export function drive(
  initial: WorldState,
  script: readonly DriveSegment[],
  options: DriveOptions = {},
): DriveResult {
  const dt = options.dt ?? FIXED_DT;
  let world = initial;
  const events: SimEvent[] = [];
  const history: WorldState[] = [];

  for (const segment of script) {
    const held = input(segment.input);
    const ticks = Math.round(segment.seconds / dt);
    for (let i = 0; i < ticks; i++) {
      const result = step(world, held, dt);
      world = result.world;
      events.push(...result.events);
      history.push(world);
    }
  }

  return { world, events, history };
}

/** Drive a single held input for N seconds — the common case. */
export function hold(
  initial: WorldState,
  seconds: number,
  held: Partial<ControlInput>,
  options: DriveOptions = {},
): DriveResult {
  return drive(initial, [{ seconds, input: held }], options);
}

/** Events of one kind, narrowed. */
export function eventsOfKind<K extends SimEvent['kind']>(
  events: readonly SimEvent[],
  kind: K,
): readonly Extract<SimEvent, { kind: K }>[] {
  return events.filter((e): e is Extract<SimEvent, { kind: K }> => e.kind === kind);
}

/** Distance between two poses in metres — for tolerance assertions. */
export function poseDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}
