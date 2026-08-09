/**
 * The simulation core's public surface — the project's single seam.
 * Everything above the core (renderer, input adapters, UI, tests) imports from
 * here and nothing else inside `src/core`.
 */

export type {
  ControlInput,
  Gear,
} from './input';
export { NEUTRAL_INPUT, sanitiseInput, clamp } from './input';

export type {
  SimEvent,
  ContactEvent,
  GearChangeEvent,
  ScenarioCompleteEvent,
  ScenarioFailedEvent,
  ContactSurface,
  ContactPart,
  Severity,
} from './events';

export type {
  WorldState,
  VehicleState,
  BodyPose,
  WheelState,
  WheelMotion,
  CreateWorldOptions,
} from './world';
export { createWorld, resetWorld } from './world';

export type {
  Scenario,
  ScenarioId,
  ScenarioTemplate,
  ScenarioPose,
  Bay,
  BayType,
  Kerb,
  KerbSide,
  Obstacle,
  ObstacleKind,
  ObstacleSpec,
  BaySpec,
  KerbSpec,
  CriterionId,
  CriterionSpec,
  PassCriteriaSpec,
  ParameterSpec,
  Difficulty,
  Length,
  Measure,
} from './scenario';
export {
  SCENARIO_IDS,
  SCENARIO_TEMPLATES,
  PARALLEL_PARK_PARAMETERS,
  scenarioTemplate,
  defaultParameters,
  resolveParameters,
  resolveScenario,
} from './scenario';

export type { ContactRecord, ContactHit, CollisionInput, CollisionOutcome } from './collision';
export {
  SEVERITY_THRESHOLDS,
  CONTACT_DEBOUNCE_SECONDS,
  severityFor,
  worstSeverity,
  escalateSeverity,
  coalesceContacts,
  surfaceOf,
  bodyPolygon,
  bodyCentre,
  obstaclePolygon,
  collidesWithBody,
  polygonOverlap,
  pointInConvex,
  resolveBodyCollisions,
} from './collision';

export type { KerbCollisionInput, KerbCollisionOutcome, KerbStrip } from './kerb';
export { kerbStrips, catchesBodywork, wheelFootprint, resolveKerbCollisions } from './kerb';

export type { CompletionState, AttemptStatus } from './completion';
export {
  INITIAL_COMPLETION,
  STATIONARY_SPEED,
  STATIONARY_YAW_RATE,
  COMPLETION_DWELL_SECONDS,
  UNDER_WAY_SPEED,
  isStationary,
  updateCompletion,
} from './completion';

export type { Scorecard, CriterionScore, ScoredContact, Gates, Grade } from './scoring';
export {
  CONTACT_SEVERITY_WEIGHT,
  CRITERION_DIRECTION,
  scoreAttempt,
  scoredContacts,
  shuntCount,
  subScoreFor,
  gradeFor,
  bayOffsets,
  alignmentDegrees,
  kerbDistance,
  fullyInsideBay,
} from './scoring';

export type { StepResult } from './step';
export { step, FIXED_DT, wrapAngle } from './step';

export type {
  VehicleDefinition,
  MirrorDefinition,
  TyreDefinition,
  DrivetrainDefinition,
  BrakeDefinition,
  ChassisAttitudeDefinition,
  WheelId,
  Vec2,
  Vec3,
} from './vehicle';
export {
  VEHICLE,
  GRAVITY,
  WHEEL_IDS,
  vehicleLength,
  bodyOutline,
  wheelPosition,
  frontAxleX,
  rearAxleX,
  ackermannSteerAngles,
  referenceSteerAngle,
  turnRadius,
  rackRate,
} from './vehicle';

export type { TyreForce } from './tyre';
export { tyreForce, tyreCurve, wheelLoads } from './tyre';

export {
  gearDirection,
  gearRatio,
  engineTorqueCurve,
  rearWheelDriveTorque,
  brakeTorques,
} from './drivetrain';

export type { DynamicsSolution } from './dynamics';
export { kinematicWeight } from './dynamics';
