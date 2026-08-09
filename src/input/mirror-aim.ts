/**
 * Mirror-aim adapter: the player picks a mirror and trims it, the way you reach
 * up and nudge the interior mirror or hold the door-mirror switch.
 *
 * Like the keyboard and look adapters, this owns its own keys and its own ramp
 * and hands the renderer nothing but data — here a `MirrorAimSet`. The aim angles
 * themselves, their limits and the fact that the reflected view swings twice as
 * far as the glass all live in `render/mirror.ts`, because that is geometry.
 */

import type { MirrorAim, MirrorAimSet, MirrorId } from '../render/mirror';
import { MIRROR_IDS, NEUTRAL_MIRROR_AIM, clampMirrorAim } from '../render/mirror';

/** Radians per second of glass movement while an adjust key is held. */
const ADJUST_RATE = 0.14;

export interface MirrorAimBindings {
  /** Cycle which mirror is being adjusted (and off again). */
  readonly select: readonly string[];
  readonly aimUp: readonly string[];
  readonly aimDown: readonly string[];
  readonly aimLeft: readonly string[];
  readonly aimRight: readonly string[];
  /** Return the selected mirror to its factory aim. */
  readonly reset: readonly string[];
}

export const DEFAULT_MIRROR_AIM_BINDINGS: MirrorAimBindings = {
  select: ['KeyM'],
  aimUp: ['KeyI'],
  aimDown: ['KeyK'],
  aimLeft: ['KeyJ'],
  aimRight: ['KeyL'],
  reset: ['KeyO'],
};

export class MirrorAimController {
  private readonly held = new Set<string>();
  private aim: MirrorAimSet = NEUTRAL_MIRROR_AIM;
  /** Which mirror the adjust keys act on; `null` means none is selected. */
  private selection: MirrorId | null = null;

  constructor(private readonly bindings: MirrorAimBindings = DEFAULT_MIRROR_AIM_BINDINGS) {}

  /** Attach the adjust keys to a DOM target. Returns a detach function. */
  attach(target: Window | HTMLElement = window): () => void {
    const down = (e: Event): void => {
      const code = (e as KeyboardEvent).code;
      this.held.add(code);
      if (this.bindings.select.includes(code)) this.selection = nextSelection(this.selection);
      if (this.bindings.reset.includes(code) && this.selection !== null) {
        this.aim = { ...this.aim, [this.selection]: { yaw: 0, pitch: 0 } };
      }
    };
    const up = (e: Event): void => {
      this.held.delete((e as KeyboardEvent).code);
    };
    const blur = (): void => this.held.clear();

    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('blur', blur);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('blur', blur);
    };
  }

  /** Advance the adjustment by `dt` seconds and read every mirror's aim. */
  sample(dt: number): MirrorAimSet {
    const id = this.selection;
    if (id === null || dt <= 0) return this.aim;

    const yawDir = (this.any(this.bindings.aimLeft) ? 1 : 0) - (this.any(this.bindings.aimRight) ? 1 : 0);
    const pitchDir = (this.any(this.bindings.aimUp) ? 1 : 0) - (this.any(this.bindings.aimDown) ? 1 : 0);
    if (yawDir === 0 && pitchDir === 0) return this.aim;

    const current: MirrorAim = this.aim[id];
    const moved = clampMirrorAim({
      yaw: current.yaw + yawDir * ADJUST_RATE * dt,
      pitch: current.pitch + pitchDir * ADJUST_RATE * dt,
    });
    this.aim = { ...this.aim, [id]: moved };
    return this.aim;
  }

  /** The mirror currently being adjusted, for the HUD to name. */
  get selected(): MirrorId | null {
    return this.selection;
  }

  get current(): MirrorAimSet {
    return this.aim;
  }

  private any(codes: readonly string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }
}

function nextSelection(current: MirrorId | null): MirrorId | null {
  if (current === null) return MIRROR_IDS[0];
  const index = MIRROR_IDS.indexOf(current);
  return index + 1 < MIRROR_IDS.length ? (MIRROR_IDS[index + 1] as MirrorId) : null;
}
