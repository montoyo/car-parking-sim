/**
 * Scenarios are DATA, not code.
 *
 * Every scenario in this project is one `ScenarioTemplate` literal: the bay
 * polygon and its type, the parked-car / wall / bollard placements, the kerb
 * polyline and its height, the spawn pose, the tunable parameters, the pass
 * criteria and the scoring tolerances. Adding a scenario (ticket 12) means
 * adding another literal to `SCENARIO_TEMPLATES` — there is no per-scenario code
 * path anywhere in the project, and nothing outside this file is allowed to
 * hardcode a layout number or a tolerance.
 *
 * The one thing a literal cannot express directly is "this parked car sits half
 * the (tunable) gap plus half a car length along the road". So every length in a
 * template is a `Length`: either a plain number or a `Measure` — a reference to
 * a declared parameter with an optional scale and offset. `resolveScenario`
 * evaluates them, which is the single generic code path that turns a template
 * plus a set of parameter values into a `Scenario` of plain numbers.
 *
 * Coordinate convention matches the vehicle definition: +x along the road, +y
 * left, metres, angles in radians. Angles in TEMPLATES are in DEGREES because
 * that is how a layout is legible on the page; `resolveScenario` converts them.
 */

import type { Vec2 } from './vehicle';
import { VEHICLE, vehicleLength } from './vehicle';

/** Every scenario that exists. */
export const SCENARIO_IDS = [
  'debug-plane',
  'parallel-park',
  'forward-bay',
  'reverse-bay',
  'angled-echelon',
  'tight-kerb',
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

export type BayType = 'parallel' | 'forward' | 'reverse' | 'angled';
export type Difficulty = 'tutorial' | 'easy' | 'moderate' | 'hard' | 'challenge';
/** Static obstacle classes. All obstacles are static — there is no traffic. */
export type ObstacleKind = 'parked-car' | 'wall' | 'bollard';
/** Which side of a kerb polyline the pavement is raised on, walking along it. */
export type KerbSide = 'left' | 'right';

/**
 * The scoring criteria a scenario opts into. Ticket 09 implements them; the
 * scenario says WHICH apply and with what tolerance, so scenario difficulty is
 * expressed as data rather than as bespoke scoring code.
 */
export type CriterionId =
  | 'centring'
  | 'alignment'
  | 'kerbDistance'
  | 'foreAft'
  | 'contacts'
  | 'shunts'
  | 'time';

/** A reference to a tunable parameter: `value * scale + offset`. */
export interface Measure {
  readonly param: string;
  readonly scale?: number;
  readonly offset?: number;
}

/** A length (or angle) in a template: a constant, or derived from a parameter. */
export type Length = number | Measure;

/** A tunable parameter: what the player may adjust, and within what range. */
export interface ParameterSpec {
  readonly label: string;
  readonly unit: 'm' | 'deg';
  readonly default: number;
  readonly min: number;
  readonly max: number;
  /** Adjustment granularity for the scenario-select UI. */
  readonly step: number;
}

export interface PointSpec {
  readonly x: Length;
  readonly y: Length;
}

export interface PoseSpec extends PointSpec {
  /** Heading in DEGREES (templates are written in degrees). */
  readonly yaw: Length;
}

/**
 * A static obstacle as a box in the ground plane with a height: enough for the
 * renderer to draw it and for ticket 07 to collide against it.
 */
export interface ObstacleSpec {
  readonly id: string;
  readonly kind: ObstacleKind;
  readonly centre: PointSpec;
  /** Heading in DEGREES. */
  readonly yaw: Length;
  /** Half-extent along the obstacle's own x (its length), metres. */
  readonly halfLength: Length;
  readonly halfWidth: Length;
  /** Top of the obstacle above the ground plane, metres. */
  readonly height: Length;
}

/**
 * The roadway border: a polyline with a height, tracked separately from every
 * other obstacle because kerbing is its own class of mistake (ticket 08).
 */
export interface KerbSpec {
  readonly height: Length;
  /** Which side of the polyline the pavement is on. */
  readonly raisedSide: KerbSide;
  /** How far the raised pavement extends back from the kerb line, metres. */
  readonly pavementWidth: Length;
  readonly polyline: readonly PointSpec[];
}

/** The target bay. The polygon is the marked outline the player must end inside. */
export interface BaySpec {
  readonly type: BayType;
  /** Counter-clockwise; edge 0 defines the bay's long axis. */
  readonly polygon: readonly PointSpec[];
}

/** One scoring criterion's tolerance band — the scenario's difficulty dial. */
export interface CriterionSpec {
  readonly criterion: CriterionId;
  /** Share of the total score. The weights of a scenario sum to 1. */
  readonly weight: number;
  /** The value that scores full marks. */
  readonly target: number;
  /** Deviation from `target` at which the sub-score reaches zero. */
  readonly tolerance: number;
  readonly unit: 'm' | 'deg' | 'count' | 's';
}

/** Hard gates, as opposed to the weighted criteria above. */
export interface PassCriteriaSpec {
  /** The whole car inside the bay — unambiguous, and never a weighted term. */
  readonly fullyInsideBay: boolean;
  /** Contacts tolerated by a pass; `null` means no limit. */
  readonly maxContacts: number | null;
  /** Whether a severe impact ends the attempt immediately (hard mode). */
  readonly endOnSevereImpact: boolean;
  /** Minimum weighted score for a pass, in [0, 1]. */
  readonly minScore: number;
}

export interface ScenarioTemplate {
  readonly id: ScenarioId;
  readonly name: string;
  readonly difficulty: Difficulty;
  /** Shown before the attempt starts, with `passSummary`. */
  readonly summary: string;
  readonly passSummary: string;
  readonly parameters: Readonly<Record<string, ParameterSpec>>;
  readonly bay: BaySpec | null;
  readonly kerb: KerbSpec | null;
  readonly obstacles: readonly ObstacleSpec[];
  readonly spawn: PoseSpec;
  readonly criteria: readonly CriterionSpec[];
  readonly pass: PassCriteriaSpec;
  /**
   * Whether this scenario offers a reversing camera. Data, not a code path: the
   * renderer draws the extra pass for a scenario that declares one and does not
   * for one that does not, so the player can compare mirror-only parking with
   * camera-assisted parking by picking a different scenario.
   */
  readonly reversingCamera: boolean;
}

// --- Resolved forms: the same data with every `Length` evaluated. ------------

export interface Obstacle {
  readonly id: string;
  readonly kind: ObstacleKind;
  readonly centre: Vec2;
  /** Heading in RADIANS. */
  readonly yaw: number;
  readonly halfLength: number;
  readonly halfWidth: number;
  readonly height: number;
}

export interface Kerb {
  readonly height: number;
  readonly raisedSide: KerbSide;
  readonly pavementWidth: number;
  readonly polyline: readonly Vec2[];
}

export interface Bay {
  readonly type: BayType;
  readonly polygon: readonly Vec2[];
  /** Centroid of the polygon. */
  readonly centre: Vec2;
  /** Heading of edge 0 in RADIANS — the direction a parked car should face. */
  readonly axisYaw: number;
  /** Extent along `axisYaw` (m). */
  readonly length: number;
  /** Extent across `axisYaw` (m). */
  readonly width: number;
}

export interface ScenarioPose {
  readonly x: number;
  readonly y: number;
  /** RADIANS. */
  readonly yaw: number;
}

export interface Scenario {
  readonly id: ScenarioId;
  readonly name: string;
  readonly difficulty: Difficulty;
  readonly summary: string;
  readonly passSummary: string;
  /** The parameter values this instance was built with, already clamped. */
  readonly parameters: Readonly<Record<string, number>>;
  readonly bay: Bay | null;
  readonly kerb: Kerb | null;
  readonly obstacles: readonly Obstacle[];
  readonly spawn: ScenarioPose;
  readonly criteria: readonly CriterionSpec[];
  readonly pass: PassCriteriaSpec;
  readonly reversingCamera: boolean;
}

// --- The layout data --------------------------------------------------------

/**
 * A parked car is the same metal as the player's car, so its box comes from the
 * shared vehicle definition rather than from numbers typed in here.
 */
const PARKED_CAR_HALF_LENGTH = vehicleLength() / 2;
const PARKED_CAR_HALF_WIDTH = VEHICLE.bodyWidth / 2;
const PARKED_CAR_HEIGHT = VEHICLE.bodyHeight;
/** Parked cars sit this far off the kerb line — near, as real ones are. */
const PARKED_CAR_KERB_OFFSET = 0.1;

const PARALLEL_PARK: ScenarioTemplate = {
  id: 'parallel-park',
  name: 'Parallel park',
  difficulty: 'hard',
  summary:
    'A gap between two parked cars with a kerb along the right-hand side. ' +
    'Reverse in from the lane and finish square to the kerb.',
  passSummary:
    'The whole car inside the bay, no contact with anything, square to the kerb ' +
    'within 5° and about 30 cm off it.',

  parameters: {
    gapLength: {
      label: 'Gap length',
      unit: 'm',
      // 1.4 car lengths: tight enough to need the geometry, not a trick.
      default: 6.3,
      min: 5.2,
      max: 9,
      step: 0.1,
    },
    bayWidth: { label: 'Bay width', unit: 'm', default: 2.3, min: 2, max: 3.2, step: 0.1 },
    kerbHeight: { label: 'Kerb height', unit: 'm', default: 0.12, min: 0.06, max: 0.2, step: 0.01 },
  },

  // The bay is the gap itself: kerb line at y = 0, bay extending into the road.
  // Counter-clockwise from the kerb-side rear corner, so edge 0 runs along +x
  // and `axisYaw` is the heading a correctly parked car ends up with.
  bay: {
    type: 'parallel',
    polygon: [
      { x: { param: 'gapLength', scale: -0.5 }, y: 0 },
      { x: { param: 'gapLength', scale: 0.5 }, y: 0 },
      { x: { param: 'gapLength', scale: 0.5 }, y: { param: 'bayWidth' } },
      { x: { param: 'gapLength', scale: -0.5 }, y: { param: 'bayWidth' } },
    ],
  },

  // The kerb IS the bay's y = 0 edge, so kerb distance and bay centring are
  // measured against one piece of geometry. Walking along +x, the pavement is on
  // the right (-y).
  kerb: {
    height: { param: 'kerbHeight' },
    raisedSide: 'right',
    pavementWidth: 3,
    polyline: [
      { x: -40, y: 0 },
      { x: 40, y: 0 },
    ],
  },

  obstacles: [
    {
      id: 'parked-car-rear',
      kind: 'parked-car',
      centre: {
        x: { param: 'gapLength', scale: -0.5, offset: -PARKED_CAR_HALF_LENGTH },
        y: PARKED_CAR_KERB_OFFSET + PARKED_CAR_HALF_WIDTH,
      },
      yaw: 0,
      halfLength: PARKED_CAR_HALF_LENGTH,
      halfWidth: PARKED_CAR_HALF_WIDTH,
      height: PARKED_CAR_HEIGHT,
    },
    {
      id: 'parked-car-front',
      kind: 'parked-car',
      centre: {
        x: { param: 'gapLength', scale: 0.5, offset: PARKED_CAR_HALF_LENGTH },
        y: PARKED_CAR_KERB_OFFSET + PARKED_CAR_HALF_WIDTH,
      },
      yaw: 0,
      halfLength: PARKED_CAR_HALF_LENGTH,
      halfWidth: PARKED_CAR_HALF_WIDTH,
      height: PARKED_CAR_HEIGHT,
    },
    // The building line behind the pavement: what a rear overhang swings into if
    // the car is reversed in far too eagerly.
    {
      id: 'wall-building',
      kind: 'wall',
      centre: { x: 0, y: -3.15 },
      yaw: 0,
      halfLength: 24,
      halfWidth: 0.15,
      height: 2.4,
    },
    // A low wall on the far side of the road, so the lane is bounded.
    {
      id: 'wall-far-side',
      kind: 'wall',
      centre: { x: 0, y: 8.2 },
      yaw: 0,
      halfLength: 24,
      halfWidth: 0.15,
      height: 0.5,
    },
    // A bollard on the pavement level with the front car — visible in the right
    // wing mirror, and a reason not to swing the nose over the kerb.
    {
      id: 'bollard-pavement',
      kind: 'bollard',
      centre: {
        x: { param: 'gapLength', scale: 0.5, offset: 3.2 },
        y: -1.2,
      },
      yaw: 0,
      halfLength: 0.07,
      halfWidth: 0.07,
      height: 0.95,
    },
  ],

  // The consistent approach pose: stopped in the lane, level with the front
  // parked car, square to the kerb — the position a driver sets up from, and the
  // same one every attempt, so repeated attempts are comparable.
  spawn: {
    x: { param: 'gapLength', scale: 0.5, offset: PARKED_CAR_HALF_LENGTH },
    y: 3.7,
    yaw: 0,
  },

  criteria: [
    { criterion: 'centring', weight: 0.2, target: 0, tolerance: 0.25, unit: 'm' },
    { criterion: 'alignment', weight: 0.2, target: 0, tolerance: 5, unit: 'deg' },
    { criterion: 'kerbDistance', weight: 0.2, target: 0.3, tolerance: 0.2, unit: 'm' },
    { criterion: 'foreAft', weight: 0.15, target: 0, tolerance: 0.4, unit: 'm' },
    { criterion: 'contacts', weight: 0.15, target: 0, tolerance: 3, unit: 'count' },
    { criterion: 'shunts', weight: 0.05, target: 2, tolerance: 4, unit: 'count' },
    { criterion: 'time', weight: 0.05, target: 45, tolerance: 45, unit: 's' },
  ],

  pass: {
    fullyInsideBay: true,
    maxContacts: 0,
    endOnSevereImpact: false,
    minScore: 0.6,
  },

  // Mirrors only: the manoeuvre this scenario teaches is a mirror manoeuvre, and a
  // camera would do the judging the player came here to learn.
  reversingCamera: false,
};

/**
 * The empty plane the walking skeleton drove on. Kept because it is the fixture
 * every vehicle-model test is written against: no obstacles, no bay, no kerb, so
 * a test about steering geometry never trips over scenery.
 */
const DEBUG_PLANE: ScenarioTemplate = {
  id: 'debug-plane',
  name: 'Debug plane',
  difficulty: 'tutorial',
  summary: 'An empty plane with nothing on it. The fixture for vehicle-model tests.',
  passSummary: 'Nothing to pass — there is no bay.',
  parameters: {},
  bay: null,
  kerb: null,
  obstacles: [],
  spawn: { x: 0, y: 0, yaw: 0 },
  criteria: [],
  pass: { fullyInsideBay: false, maxContacts: null, endOnSevereImpact: false, minScore: 0 },
  reversingCamera: false,
};

// --- The bay car park: forward bay, reverse bay -----------------------------
//
// Both perpendicular-bay scenarios share ONE layout — a row of bays off an aisle,
// the target bay in the middle with a neighbour either side. They differ only in
// where the player starts and therefore which way they go in, which is exactly the
// difference between the two manoeuvres and nothing more.

/** Depth of a perpendicular bay along its axis (m). */
const BAY_DEPTH = 5.2;
/** Width of the aisle in front of the bays (m). */
const AISLE_WIDTH = 6.6;
/** How far a neighbour's tail sits inside its bay mouth (m). */
const NEIGHBOUR_SETBACK = 0.35;

/**
 * The bay mouth is the line y = 0 and the bay runs back to y = -BAY_DEPTH, so the
 * axis (the heading a parked car faces, nose out of the bay) is +y. Wound
 * counter-clockwise with edge 0 along that axis, as `bayFrom` requires.
 */
const PERPENDICULAR_BAY: BaySpec = {
  type: 'forward',
  polygon: [
    { x: { param: 'bayWidth', scale: 0.5 }, y: -BAY_DEPTH },
    { x: { param: 'bayWidth', scale: 0.5 }, y: 0 },
    { x: { param: 'bayWidth', scale: -0.5 }, y: 0 },
    { x: { param: 'bayWidth', scale: -0.5 }, y: -BAY_DEPTH },
  ],
};

/** A car parked in the bay `side` bays along from the target one. */
function neighbourCar(side: -1 | 1): ObstacleSpec {
  return {
    id: side < 0 ? 'parked-car-left' : 'parked-car-right',
    kind: 'parked-car',
    // One bay width along the row; centred in its bay's depth by its own setback.
    centre: {
      x: { param: 'bayWidth', scale: side },
      y: -(NEIGHBOUR_SETBACK + PARKED_CAR_HALF_LENGTH),
    },
    // Nose out of the bay, i.e. along +y.
    yaw: 90,
    halfLength: PARKED_CAR_HALF_LENGTH,
    halfWidth: PARKED_CAR_HALF_WIDTH,
    height: PARKED_CAR_HEIGHT,
  };
}

const PERPENDICULAR_OBSTACLES: readonly ObstacleSpec[] = [
  neighbourCar(-1),
  neighbourCar(1),
  // The wall at the head of the bays: what the nose meets if a forward park is
  // driven in too far, and what the boot meets on the way in backwards.
  {
    id: 'wall-bay-head',
    kind: 'wall',
    centre: { x: 0, y: -(BAY_DEPTH + 0.15) },
    yaw: 0,
    halfLength: 20,
    halfWidth: 0.15,
    height: 1.3,
  },
  // The far side of the aisle, so the aisle is a corridor rather than open ground.
  {
    id: 'wall-aisle-far',
    kind: 'wall',
    centre: { x: 0, y: AISLE_WIDTH + 0.15 },
    yaw: 0,
    halfLength: 20,
    halfWidth: 0.15,
    height: 0.6,
  },
  // A bollard on the corner of the bay row, level with the right-hand neighbour.
  {
    id: 'bollard-row-end',
    kind: 'bollard',
    centre: { x: { param: 'bayWidth', scale: 2.5 }, y: -0.25 },
    yaw: 0,
    halfLength: 0.07,
    halfWidth: 0.07,
    height: 0.95,
  },
];

const BAY_WIDTH_PARAMETER: ParameterSpec = {
  label: 'Bay width',
  unit: 'm',
  default: 2.5,
  min: 2.2,
  max: 3.2,
  step: 0.1,
};

/** The criteria a perpendicular or angled bay is judged on. Weights sum to 1. */
const BAY_CRITERIA: readonly CriterionSpec[] = [
  { criterion: 'centring', weight: 0.25, target: 0, tolerance: 0.3, unit: 'm' },
  { criterion: 'alignment', weight: 0.2, target: 0, tolerance: 6, unit: 'deg' },
  { criterion: 'foreAft', weight: 0.25, target: 0, tolerance: 0.5, unit: 'm' },
  { criterion: 'contacts', weight: 0.15, target: 0, tolerance: 3, unit: 'count' },
  { criterion: 'shunts', weight: 0.1, target: 1, tolerance: 4, unit: 'count' },
  { criterion: 'time', weight: 0.05, target: 40, tolerance: 40, unit: 's' },
];

const FORWARD_BAY: ScenarioTemplate = {
  id: 'forward-bay',
  name: 'Forward bay park',
  difficulty: 'easy',
  summary:
    'A row of bays off an aisle, with a car parked either side of the empty one. ' +
    'Drive up the aisle and turn straight in, nose first.',
  passSummary:
    'The whole car inside the bay lines, no contact with anything, square to the bay ' +
    'within 6° and centred between the lines within 30 cm.',
  parameters: { bayWidth: BAY_WIDTH_PARAMETER },
  bay: PERPENDICULAR_BAY,
  kerb: null,
  obstacles: PERPENDICULAR_OBSTACLES,
  // Back down the aisle from the bay by about a turning circle, out at the far
  // side of the aisle: the room a driver gives themselves to swing the nose in.
  spawn: { x: -5.4, y: 4.3, yaw: 0 },
  criteria: BAY_CRITERIA,
  pass: { fullyInsideBay: true, maxContacts: 0, endOnSevereImpact: false, minScore: 0.55 },
  // Nothing to see behind you on the way in.
  reversingCamera: false,
};

const REVERSE_BAY: ScenarioTemplate = {
  id: 'reverse-bay',
  name: 'Reverse bay park',
  difficulty: 'moderate',
  summary:
    'The same row of bays, approached from the other end: pull up past the empty ' +
    'bay and reverse in between the two parked cars.',
  passSummary:
    'The whole car inside the bay lines, no contact with anything, square to the bay ' +
    'within 6° and centred between the lines within 30 cm.',
  parameters: { bayWidth: BAY_WIDTH_PARAMETER },
  bay: { ...PERPENDICULAR_BAY, type: 'reverse' },
  kerb: null,
  obstacles: PERPENDICULAR_OBSTACLES,
  // Stopped just past the bay, out in the aisle: reversing on full lock from here
  // swings the tail into the mouth of the bay.
  spawn: { x: 5.7, y: 4.5, yaw: 0 },
  criteria: BAY_CRITERIA,
  pass: { fullyInsideBay: true, maxContacts: 0, endOnSevereImpact: false, minScore: 0.55 },
  // The case for a reversing camera, and the one the spec asks the player to be
  // able to compare against mirrors alone.
  reversingCamera: true,
};

// --- Angled / echelon bays --------------------------------------------------
//
// The bays are sheared 45° off the lane, so the marked bay is a PARALLELOGRAM: its
// sides run along the bay axis and its mouth lies on the lane edge, which is how
// echelon bays are actually painted. The angle is a constant rather than a tunable
// because a `Measure` is linear in its parameter and a rotation is not — the bay
// width stays tunable, which is the dial the player wants.

/** Cosine of the bay angle: the bay axis is 45° off the lane. */
const ECHELON_COS = Math.SQRT1_2;
/** Depth of an angled bay along its axis (m). */
const ECHELON_DEPTH = 5.4;
/** Reach of the bay's own depth into each of x and y (m). */
const ECHELON_REACH = ECHELON_DEPTH * ECHELON_COS;
/**
 * Where the bay's across-axis lands in each of x and y, per metre of bay width:
 * half a bay width along the 45° across-direction.
 */
const ECHELON_HALF_WIDTH = ECHELON_COS / 2;
/**
 * Spacing of neighbouring bays along the lane, per metre of bay width. The bays
 * are rectangles staggered along the lane, so the lane edge reads as a sawtooth —
 * which is what an echelon row actually looks like, and what keeps a bay long
 * enough for the car (a parallelogram sheared onto the lane edge would not be).
 */
const ECHELON_PITCH = 1 / ECHELON_COS;

const ANGLED_ECHELON: ScenarioTemplate = {
  id: 'angled-echelon',
  name: 'Angled bay (echelon)',
  difficulty: 'moderate',
  summary:
    'Bays painted at 45° to the lane, with a car in the bay either side. Only a ' +
    'quarter of the turn a square bay needs — but the bay is not where it looks.',
  passSummary:
    'The whole car inside the bay lines, no contact with anything, in line with the ' +
    '45° bay axis within 6° and centred between the lines within 30 cm.',
  parameters: { bayWidth: { ...BAY_WIDTH_PARAMETER, default: 2.6 } },
  bay: {
    type: 'angled',
    // A rectangle rotated 45°: its axis (edge 0) runs from the mouth down into the
    // bay, and its across-direction is the 45° diagonal, so `axisYaw` comes out as
    // -45° and `length` / `width` are the bay's real depth and width. Wound
    // counter-clockwise, starting at the mouth's right-hand corner.
    polygon: [
      {
        x: { param: 'bayWidth', scale: -ECHELON_HALF_WIDTH },
        y: { param: 'bayWidth', scale: -ECHELON_HALF_WIDTH },
      },
      {
        x: { param: 'bayWidth', scale: -ECHELON_HALF_WIDTH, offset: ECHELON_REACH },
        y: { param: 'bayWidth', scale: -ECHELON_HALF_WIDTH, offset: -ECHELON_REACH },
      },
      {
        x: { param: 'bayWidth', scale: ECHELON_HALF_WIDTH, offset: ECHELON_REACH },
        y: { param: 'bayWidth', scale: ECHELON_HALF_WIDTH, offset: -ECHELON_REACH },
      },
      {
        x: { param: 'bayWidth', scale: ECHELON_HALF_WIDTH },
        y: { param: 'bayWidth', scale: ECHELON_HALF_WIDTH },
      },
    ],
  },
  kerb: null,
  obstacles: [
    // One bay's pitch along the lane either side, each car sitting centred along
    // its own bay axis.
    {
      id: 'parked-car-left',
      kind: 'parked-car',
      centre: {
        x: { param: 'bayWidth', scale: -ECHELON_PITCH, offset: ECHELON_REACH / 2 },
        y: -ECHELON_REACH / 2,
      },
      yaw: -45,
      halfLength: PARKED_CAR_HALF_LENGTH,
      halfWidth: PARKED_CAR_HALF_WIDTH,
      height: PARKED_CAR_HEIGHT,
    },
    {
      id: 'parked-car-right',
      kind: 'parked-car',
      centre: {
        x: { param: 'bayWidth', scale: ECHELON_PITCH, offset: ECHELON_REACH / 2 },
        y: -ECHELON_REACH / 2,
      },
      yaw: -45,
      halfLength: PARKED_CAR_HALF_LENGTH,
      halfWidth: PARKED_CAR_HALF_WIDTH,
      height: PARKED_CAR_HEIGHT,
    },
    {
      id: 'wall-bay-head',
      kind: 'wall',
      centre: { x: 0, y: -(ECHELON_REACH + 1.6) },
      yaw: 0,
      halfLength: 24,
      halfWidth: 0.15,
      height: 1.1,
    },
    {
      id: 'wall-lane-far',
      kind: 'wall',
      centre: { x: 0, y: 6.15 },
      yaw: 0,
      halfLength: 24,
      halfWidth: 0.15,
      height: 0.6,
    },
  ],
  // Up the lane from the bay, in the near half of the lane: the 45° turn in is
  // shallow enough that a driver does not need to swing across.
  spawn: { x: -7, y: 2.6, yaw: 0 },
  criteria: BAY_CRITERIA,
  pass: { fullyInsideBay: true, maxContacts: 0, endOnSevereImpact: false, minScore: 0.55 },
  reversingCamera: false,
};

// --- The tight-kerb challenge ------------------------------------------------

const TIGHT_KERB: ScenarioTemplate = {
  id: 'tight-kerb',
  name: 'Tight kerb challenge',
  difficulty: 'challenge',
  summary:
    'A narrow parallel space against a high kerb that will take your rims off, with ' +
    'a garden wall right behind the pavement. Hard mode: a heavy impact ends the ' +
    'attempt on the spot. Shorten the gap once you can do it clean.',
  passSummary:
    'The whole car inside a 2.4 m bay, no contact of any kind — kerb included — ' +
    'square to the kerb within 4° and 25 cm off it, scoring at least 65%.',

  parameters: {
    gapLength: {
      label: 'Gap length',
      unit: 'm',
      // The parallel park's gap. The challenge here is the kerb and the bands, not
      // the length — and the player can wind this down to 5.4 m once they can do it
      // clean, which is exactly what the dial is for.
      default: 6.3,
      min: 5.4,
      max: 7.5,
      step: 0.1,
    },
    bayWidth: { label: 'Bay width', unit: 'm', default: 2.4, min: 2.1, max: 3, step: 0.1 },
    kerbHeight: {
      label: 'Kerb height',
      unit: 'm',
      // Above the car's sill, so the bodywork overhang scrapes as well as the rims.
      default: 0.19,
      min: 0.12,
      max: 0.28,
      step: 0.01,
    },
  },

  bay: {
    type: 'parallel',
    polygon: [
      { x: { param: 'gapLength', scale: -0.5 }, y: 0 },
      { x: { param: 'gapLength', scale: 0.5 }, y: 0 },
      { x: { param: 'gapLength', scale: 0.5 }, y: { param: 'bayWidth' } },
      { x: { param: 'gapLength', scale: -0.5 }, y: { param: 'bayWidth' } },
    ],
  },

  kerb: {
    height: { param: 'kerbHeight' },
    raisedSide: 'right',
    pavementWidth: 2.4,
    polyline: [
      { x: -40, y: 0 },
      { x: 40, y: 0 },
    ],
  },

  obstacles: [
    {
      id: 'parked-car-rear',
      kind: 'parked-car',
      centre: {
        x: { param: 'gapLength', scale: -0.5, offset: -PARKED_CAR_HALF_LENGTH },
        y: PARKED_CAR_KERB_OFFSET + PARKED_CAR_HALF_WIDTH,
      },
      yaw: 0,
      halfLength: PARKED_CAR_HALF_LENGTH,
      halfWidth: PARKED_CAR_HALF_WIDTH,
      height: PARKED_CAR_HEIGHT,
    },
    {
      id: 'parked-car-front',
      kind: 'parked-car',
      centre: {
        x: { param: 'gapLength', scale: 0.5, offset: PARKED_CAR_HALF_LENGTH },
        y: PARKED_CAR_KERB_OFFSET + PARKED_CAR_HALF_WIDTH,
      },
      yaw: 0,
      halfLength: PARKED_CAR_HALF_LENGTH,
      halfWidth: PARKED_CAR_HALF_WIDTH,
      height: PARKED_CAR_HEIGHT,
    },
    // A garden wall right behind the narrow pavement: the rear overhang has
    // nowhere to swing.
    {
      id: 'wall-building',
      kind: 'wall',
      centre: { x: 0, y: -2.55 },
      yaw: 0,
      halfLength: 24,
      halfWidth: 0.15,
      height: 1.8,
    },
    {
      id: 'wall-far-side',
      kind: 'wall',
      centre: { x: 0, y: 7.2 },
      yaw: 0,
      halfLength: 24,
      halfWidth: 0.15,
      height: 0.5,
    },
    {
      id: 'bollard-pavement',
      kind: 'bollard',
      centre: { x: { param: 'gapLength', scale: 0.5, offset: 2.4 }, y: -1.1 },
      yaw: 0,
      halfLength: 0.07,
      halfWidth: 0.07,
      height: 0.95,
    },
  ],

  spawn: {
    x: { param: 'gapLength', scale: 0.5, offset: PARKED_CAR_HALF_LENGTH },
    y: 3.6,
    yaw: 0,
  },

  // Tighter bands than the parallel park all round: same criteria, harder dials.
  criteria: [
    { criterion: 'centring', weight: 0.2, target: 0, tolerance: 0.18, unit: 'm' },
    { criterion: 'alignment', weight: 0.2, target: 0, tolerance: 4, unit: 'deg' },
    { criterion: 'kerbDistance', weight: 0.2, target: 0.25, tolerance: 0.15, unit: 'm' },
    { criterion: 'foreAft', weight: 0.15, target: 0, tolerance: 0.3, unit: 'm' },
    { criterion: 'contacts', weight: 0.15, target: 0, tolerance: 2, unit: 'count' },
    { criterion: 'shunts', weight: 0.05, target: 2, tolerance: 3, unit: 'count' },
    { criterion: 'time', weight: 0.05, target: 60, tolerance: 60, unit: 's' },
  ],

  pass: {
    fullyInsideBay: true,
    maxContacts: 0,
    // Hard mode has real stakes: bury it into the car in front and it is over.
    endOnSevereImpact: true,
    minScore: 0.65,
  },

  // Offered here so the player can compare kerbing on mirrors with kerbing on a
  // camera — the comparison the spec asks for, on the scenario where it matters.
  reversingCamera: true,
};

export const SCENARIO_TEMPLATES: Readonly<Record<ScenarioId, ScenarioTemplate>> = {
  'debug-plane': DEBUG_PLANE,
  'parallel-park': PARALLEL_PARK,
  'forward-bay': FORWARD_BAY,
  'reverse-bay': REVERSE_BAY,
  'angled-echelon': ANGLED_ECHELON,
  'tight-kerb': TIGHT_KERB,
};

/**
 * The scenarios the player can choose from — everything with a bay to park in,
 * which excludes the debug plane. The selection menu is a list of these, in the
 * order they are declared above.
 */
export const PLAYABLE_SCENARIO_IDS: readonly ScenarioId[] = SCENARIO_IDS.filter(
  (id) => SCENARIO_TEMPLATES[id].bay !== null,
);

export function scenarioTemplate(id: ScenarioId): ScenarioTemplate {
  return SCENARIO_TEMPLATES[id];
}

/** The default value of every parameter of a scenario. */
export function defaultParameters(id: ScenarioId): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, spec] of Object.entries(scenarioTemplate(id).parameters)) {
    out[name] = spec.default;
  }
  return out;
}

/** Convenience for tests and the UI: the parallel park's parameter defaults. */
export const PARALLEL_PARK_PARAMETERS = defaultParameters('parallel-park') as {
  readonly gapLength: number;
  readonly bayWidth: number;
  readonly kerbHeight: number;
};

// --- The one generic resolver ------------------------------------------------

const DEG = Math.PI / 180;

function clampToRange(value: number, spec: ParameterSpec): number {
  if (!Number.isFinite(value)) return spec.default;
  return value < spec.min ? spec.min : value > spec.max ? spec.max : value;
}

/** Clamp supplied overrides into the declared ranges, defaulting the rest. */
export function resolveParameters(
  id: ScenarioId,
  overrides: Readonly<Record<string, number>> = {},
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, spec] of Object.entries(scenarioTemplate(id).parameters)) {
    const supplied = overrides[name];
    out[name] = supplied === undefined ? spec.default : clampToRange(supplied, spec);
  }
  return out;
}

function measure(value: Length, parameters: Readonly<Record<string, number>>): number {
  if (typeof value === 'number') return value;
  const base = parameters[value.param];
  if (base === undefined) {
    throw new Error(`Scenario references undeclared parameter '${value.param}'.`);
  }
  return base * (value.scale ?? 1) + (value.offset ?? 0);
}

function point(spec: PointSpec, parameters: Readonly<Record<string, number>>): Vec2 {
  return { x: measure(spec.x, parameters), y: measure(spec.y, parameters) };
}

function bayFrom(spec: BaySpec, parameters: Readonly<Record<string, number>>): Bay {
  const polygon = spec.polygon.map((p) => point(p, parameters));
  const first = polygon[0];
  const second = polygon[1];
  if (first === undefined || second === undefined) {
    throw new Error('A bay polygon needs at least two corners.');
  }
  const axisYaw = Math.atan2(second.y - first.y, second.x - first.x);
  const cos = Math.cos(axisYaw);
  const sin = Math.sin(axisYaw);
  // Extents in the bay's own frame, which is what "length" and "width" mean for
  // an angled bay as much as for a square one.
  let minAlong = Infinity;
  let maxAlong = -Infinity;
  let minAcross = Infinity;
  let maxAcross = -Infinity;
  let sumX = 0;
  let sumY = 0;
  for (const p of polygon) {
    const along = p.x * cos + p.y * sin;
    const across = -p.x * sin + p.y * cos;
    if (along < minAlong) minAlong = along;
    if (along > maxAlong) maxAlong = along;
    if (across < minAcross) minAcross = across;
    if (across > maxAcross) maxAcross = across;
    sumX += p.x;
    sumY += p.y;
  }
  return {
    type: spec.type,
    polygon,
    centre: { x: sumX / polygon.length, y: sumY / polygon.length },
    axisYaw,
    length: maxAlong - minAlong,
    width: maxAcross - minAcross,
  };
}

/**
 * Turn a template plus parameter values into plain numbers. THE code path that
 * builds every scenario — there is no other, which is what keeps "adding a
 * scenario means adding data" true.
 */
export function resolveScenario(
  id: ScenarioId,
  overrides: Readonly<Record<string, number>> = {},
): Scenario {
  const template = scenarioTemplate(id);
  const parameters = resolveParameters(id, overrides);
  return {
    id: template.id,
    name: template.name,
    difficulty: template.difficulty,
    summary: template.summary,
    passSummary: template.passSummary,
    parameters,
    bay: template.bay === null ? null : bayFrom(template.bay, parameters),
    kerb:
      template.kerb === null
        ? null
        : {
            height: measure(template.kerb.height, parameters),
            raisedSide: template.kerb.raisedSide,
            pavementWidth: measure(template.kerb.pavementWidth, parameters),
            polyline: template.kerb.polyline.map((p) => point(p, parameters)),
          },
    obstacles: template.obstacles.map((o) => ({
      id: o.id,
      kind: o.kind,
      centre: point(o.centre, parameters),
      yaw: measure(o.yaw, parameters) * DEG,
      halfLength: measure(o.halfLength, parameters),
      halfWidth: measure(o.halfWidth, parameters),
      height: measure(o.height, parameters),
    })),
    spawn: {
      x: measure(template.spawn.x, parameters),
      y: measure(template.spawn.y, parameters),
      yaw: measure(template.spawn.yaw, parameters) * DEG,
    },
    criteria: template.criteria,
    pass: template.pass,
    reversingCamera: template.reversingCamera,
  };
}
