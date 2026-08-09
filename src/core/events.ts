/**
 * `SimEvent` is the core's only output channel besides `WorldState`. It does
 * triple duty: live HUD/audio cues, scoring penalties, and replay markers — one
 * mechanism, three consumers, so they cannot disagree. It is also the primary
 * assertion target for tests.
 *
 * Only `gearChange` is emitted in the walking skeleton; the remaining variants
 * are declared now so later tickets extend the union rather than inventing a
 * parallel channel.
 */

import type { Gear } from './input';
import type { WheelId, Vec2 } from './vehicle';

export type ContactSurface = 'vehicle' | 'wall' | 'kerb';
export type ContactPart = 'body' | 'wheel';
/** A small vocabulary so scoring and audio key off buckets, not raw floats. */
export type Severity = 'graze' | 'knock' | 'impact';

interface SimEventBase {
  /** Fixed-timestep tick index at which the event was emitted. */
  readonly tick: number;
}

export interface ContactEvent extends SimEventBase {
  readonly kind: 'contact';
  /**
   * Identity of the contact this event belongs to — the coalescing key of the
   * `ContactRecord` behind it (`body:<obstacle id>`, `kerb:<wheel>`, ...). A
   * sustained scrape reports once, but it reports AGAIN if it gets strictly
   * worse, and both reports carry the same key. That is what lets scoring
   * penalise one scrape once and the replay draw one marker for it, from the
   * event log alone.
   */
  readonly key: string;
  readonly surface: ContactSurface;
  readonly part: ContactPart;
  readonly severity: Severity;
  /** Closing speed normal to the contact surface (m/s). */
  readonly closingSpeed: number;
  /** Contact point in world coordinates (m). */
  readonly position: Vec2;
  /** The wheel involved when `part` is `'wheel'`, else null. */
  readonly wheel: WheelId | null;
}

export interface GearChangeEvent extends SimEventBase {
  readonly kind: 'gearChange';
  readonly from: Gear;
  readonly to: Gear;
}

export interface ScenarioCompleteEvent extends SimEventBase {
  readonly kind: 'scenarioComplete';
}

export interface ScenarioFailedEvent extends SimEventBase {
  readonly kind: 'scenarioFailed';
  readonly reason: string;
}

export type SimEvent =
  | ContactEvent
  | GearChangeEvent
  | ScenarioCompleteEvent
  | ScenarioFailedEvent;
