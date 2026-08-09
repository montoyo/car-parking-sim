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
  ScenarioId,
  CreateWorldOptions,
} from './world';
export { createWorld } from './world';

export type { StepResult } from './step';
export { step, FIXED_DT, wrapAngle } from './step';

export type {
  VehicleDefinition,
  MirrorDefinition,
  WheelId,
  Vec2,
  Vec3,
} from './vehicle';
export {
  VEHICLE,
  WHEEL_IDS,
  vehicleLength,
  bodyOutline,
  wheelPosition,
  frontAxleX,
  rearAxleX,
} from './vehicle';
