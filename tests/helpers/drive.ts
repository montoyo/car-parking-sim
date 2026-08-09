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

import type {
  ControlInput,
  Recording,
  Scorecard,
  SimEvent,
  Vec2,
  WheelId,
  WorldState,
} from '../../src/core/index';
import { FIXED_DT, NEUTRAL_INPUT, Recorder, scoreAttempt, step } from '../../src/core/index';

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
  /**
   * A recorder fed every tick, exactly as the fixed-timestep loop feeds it. Tests
   * about the replay use this rather than assembling a `Recording` by hand, so
   * what they assert on is the recording a real attempt would produce.
   */
  readonly recorder?: Recorder;
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
      options.recorder?.record(world, result.events);
    }
  }

  return { world, events, history };
}

/**
 * Drive a script AND record it, the way the real loop does: one frame per tick,
 * the tick's events handed to the recorder as they are emitted.
 */
export function driveRecorded(
  initial: WorldState,
  script: readonly DriveSegment[],
  options: DriveOptions = {},
): { readonly result: DriveResult; readonly recording: Recording } {
  const recorder = new Recorder(initial);
  const result = drive(initial, script, { ...options, recorder });
  return { result, recording: recorder.snapshot() };
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

/**
 * Score a driven attempt. Scoring is the third member of the core's public
 * surface, and this is how tests reach it: over the world a run ended in and the
 * event log that run produced — never a hand-built log.
 */
export function score(result: DriveResult): Scorecard {
  return scoreAttempt(result.world, result.events);
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

/** The world-space path traced by one wheel hub over a driven history. */
export function wheelPath(history: readonly WorldState[], id: WheelId): readonly Vec2[] {
  return history.map((w) => w.vehicle.wheels[id].position);
}

/**
 * Read one quantity out of every tick of a driven history — the way to ask a
 * question about the SHAPE of a manoeuvre rather than about its end state.
 */
export function track<T>(history: readonly WorldState[], pick: (world: WorldState) => T): T[] {
  return history.map(pick);
}

/**
 * The largest change between consecutive samples. This is how smoothness gets
 * measured here: jitter, a discontinuity at a model's blend threshold, and a
 * numerical instability all show up as one outsized step.
 */
export function largestStep(values: readonly number[]): number {
  let largest = 0;
  for (let i = 1; i < values.length; i++) {
    const step = Math.abs((values[i] as number) - (values[i - 1] as number));
    if (step > largest) largest = step;
  }
  return largest;
}

export interface FittedCircle {
  readonly centre: Vec2;
  readonly radius: number;
}

/**
 * Least-squares circle through a traced path (Kåsa's algebraic fit). Used to
 * measure a turning circle from the outside — from poses only, never from the
 * integrator's internals.
 */
export function fitCircle(points: readonly Vec2[]): FittedCircle {
  if (points.length < 3) throw new Error('fitCircle needs at least 3 points');
  // Fit x^2 + y^2 = a*x + b*y + c, then centre = (a/2, b/2).
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sz = 0;
  let sxz = 0;
  let syz = 0;
  const n = points.length;
  for (const p of points) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    syy += p.y * p.y;
    sxy += p.x * p.y;
    sz += z;
    sxz += p.x * z;
    syz += p.y * z;
  }
  // Solve the 3x3 normal equations by Cramer's rule.
  //   [sxx sxy sx][a]   [sxz]
  //   [sxy syy sy][b] = [syz]
  //   [sx  sy  n ][c]   [sz ]
  const det = det3(sxx, sxy, sx, sxy, syy, sy, sx, sy, n);
  if (Math.abs(det) < 1e-12) {
    throw new Error('fitCircle: degenerate path (collinear or stationary points?)');
  }
  const a = det3(sxz, sxy, sx, syz, syy, sy, sz, sy, n) / det;
  const b = det3(sxx, sxz, sx, sxy, syz, sy, sx, sz, n) / det;
  const c = det3(sxx, sxy, sxz, sxy, syy, syz, sx, sy, sz) / det;

  const centre = { x: a / 2, y: b / 2 };
  const radius = Math.sqrt(Math.max(0, c + centre.x * centre.x + centre.y * centre.y));
  return { centre, radius };
}

function det3(
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
  g: number,
  h: number,
  i: number,
): number {
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

/**
 * Seconds from the start of a driven segment until the rack first reaches
 * `target` (signed rack position, e.g. 1 for full left lock). `null` if it never
 * got there within the history.
 */
export function rackTravelSeconds(
  history: readonly WorldState[],
  target: number,
  tolerance = 1e-6,
): number | null {
  const first = history[0];
  const second = history[1];
  if (first === undefined || second === undefined) return null;
  const dt = second.time - first.time;
  const segmentStart = first.time - dt;
  for (const w of history) {
    if (Math.abs(w.vehicle.rack - target) <= tolerance) return w.time - segmentStart;
  }
  return null;
}
