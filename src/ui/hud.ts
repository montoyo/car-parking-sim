/**
 * Minimal debug HUD: gear, speed, elapsed simulated time, plus a steering rack
 * indicator so the player can see how much lock is applied (and that winding it
 * on takes time). Reads `WorldState` and the vehicle definition only — no
 * simulation logic lives here.
 */

import type { WorldState } from '../core/index';
import { referenceSteerAngle } from '../core/index';
import type { MirrorAimSet, MirrorId } from '../render/mirror';

/** Presentation-only readouts the HUD shows alongside the world state. */
export interface HudFrameInfo {
  readonly fps: number;
  readonly pointerLocked: boolean;
  /** Which mirror the player is currently trimming, if any. */
  readonly adjustingMirror?: MirrorId | null;
  readonly mirrorAim?: MirrorAimSet;
  /** Audio setting as it should read, e.g. `70%` or `muted`. */
  readonly audio?: string;
  /** The key that opens the control reference, so nobody has to guess. */
  readonly controlsKey?: string;
  readonly gamepad?: boolean;
}

/**
 * Speed as the player needs it at parking pace: the whole game happens under
 * 10 km/h, so a single decimal turns a 0.3 km/h creep and a 0.9 km/h lurch into
 * "0.3" and "0.9" with nothing in between. Two decimals below 2 km/h — and the word
 * "creep" — make the distinction legible without a needle.
 */
export function formatSpeed(longitudinalVelocity: number): string {
  const kph = Math.abs(longitudinalVelocity) * 3.6;
  if (kph < 0.02) return 'stopped';
  if (kph < 2) return `${kph.toFixed(2)} km/h ${kph < 0.9 ? 'creep' : 'crawl'}`;
  if (kph < 20) return `${kph.toFixed(1)} km/h`;
  return `${kph.toFixed(0)} km/h`;
}

/**
 * Where the speed bar's needle sits. Square-root scaled over a 12 km/h span, so the
 * first km/h takes nearly a third of the bar: creep is where the resolution is
 * wanted, and 12 km/h is already far too fast for a car park.
 */
export function speedBarFraction(longitudinalVelocity: number): number {
  const kph = Math.abs(longitudinalVelocity) * 3.6;
  return Math.min(1, Math.sqrt(Math.min(kph, 12) / 12));
}

export class Hud {
  private readonly scenario: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly needle: HTMLElement;
  private readonly speedFill: HTMLElement;
  private readonly lockLabel: HTMLElement;
  private readonly mirrorLabel: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML =
      '<div class="hud-scenario"></div>' +
      '<div class="hud-readout"></div>' +
      '<div class="hud-rack"><div class="hud-rack-centre"></div>' +
      '<div class="hud-rack-needle"></div></div>' +
      '<div class="hud-speed"><div class="hud-speed-fill"></div></div>' +
      '<div class="hud-lock"></div>' +
      '<div class="hud-mirror"></div>';
    this.scenario = requireChild(root, '.hud-scenario');
    this.readout = requireChild(root, '.hud-readout');
    this.needle = requireChild(root, '.hud-rack-needle');
    this.speedFill = requireChild(root, '.hud-speed-fill');
    this.lockLabel = requireChild(root, '.hud-lock');
    this.mirrorLabel = requireChild(root, '.hud-mirror');
  }

  update(world: WorldState, frame?: HudFrameInfo): void {
    const v = world.vehicle;

    // Name, difficulty and what the attempt is judged on — stated up front, and
    // still on screen mid-manoeuvre because it is what the player is aiming at.
    const scenario = world.scenario;
    this.scenario.textContent =
      // The restart key is listed in the on-screen control reference; repeating it
      // here only pushed this line off the edge of the screen.
      `${scenario.name}   [${scenario.difficulty}]   to pass: ${scenario.passSummary}`;

    const gearLabel = v.gear === 'forward' ? 'D' : v.gear === 'reverse' ? 'R' : 'N';
    const fps = frame && frame.fps > 0 ? `   ${Math.round(frame.fps)} fps` : '';
    const mouse = frame && !frame.pointerLocked ? '   [click to look around]' : '';
    const audio = frame?.audio ? `   audio ${frame.audio}` : '';
    const pad = frame?.gamepad ? '   pad' : '';
    const help = frame?.controlsKey ? `   [${frame.controlsKey} controls]` : '';
    this.readout.textContent =
      `gear ${gearLabel}   ${formatSpeed(v.longitudinalVelocity)}   t ${world.time.toFixed(1)}s` +
      `${fps}${pad}${audio}${mouse}${help}`;
    this.speedFill.style.width = `${speedBarFraction(v.longitudinalVelocity) * 100}%`;

    // The needle sweeps the bar: +1 (full LEFT lock) sits at the left end.
    this.needle.style.left = `${(0.5 - v.rack * 0.5) * 100}%`;

    const side = v.rack > 0 ? 'L' : 'R';
    const roadWheelDegrees = Math.abs((referenceSteerAngle(v.rack) * 180) / Math.PI);
    this.lockLabel.textContent =
      v.rack === 0
        ? 'rack centred'
        : `rack ${Math.abs(v.rack) >= 0.999 ? 'FULL LOCK' : `${Math.round(Math.abs(v.rack) * 100)}%`}` +
          ` ${side}   ${roadWheelDegrees.toFixed(1)}°`;

    // Mirror trim: only on screen while a mirror is selected, so it stays out of
    // the way of driving.
    const adjusting = frame?.adjustingMirror ?? null;
    if (adjusting === null || !frame?.mirrorAim) {
      this.mirrorLabel.textContent = '';
    } else {
      const aim = frame.mirrorAim[adjusting];
      const degrees = (rad: number) => `${((rad * 180) / Math.PI).toFixed(1)}°`;
      this.mirrorLabel.textContent =
        `adjusting ${MIRROR_LABELS[adjusting]} mirror   ` +
        `yaw ${degrees(aim.yaw)}  pitch ${degrees(aim.pitch)}   [IJKL aim, O reset, M next]`;
    }
  }
}

const MIRROR_LABELS: Readonly<Record<MirrorId, string>> = {
  interior: 'interior',
  wingLeft: 'left wing',
  wingRight: 'right wing',
};

function requireChild(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`HUD is missing ${selector}`);
  return el;
}
