/**
 * Minimal debug HUD: gear, speed, elapsed simulated time, plus a steering wheel
 * that turns with the rack so the player can see how much lock is applied (and
 * that winding it on takes time). Reads `WorldState` and the vehicle definition
 * only — no simulation logic lives here.
 *
 * The wheel is a wheel rather than a slider because that is the instrument being
 * modelled: a bar tells you a number, a wheel tells you where your hands are. The
 * two keycaps beside it are the keys that turn it, lit while they are winding the
 * rack on, so the control and its indicator are one thing on screen.
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
  /** EV mode has no gear to report, so the readout says what it is doing instead. */
  readonly evMode?: boolean;
  /** The steering TARGET the player is asking for, in [-1, 1]; +1 is full left. */
  readonly steerInput?: number;
  /** How the steer-left and steer-right keys read, for the caps by the wheel. */
  readonly steerKeys?: { readonly left: string; readonly right: string };
}

/**
 * How far the rim turns at full lock (degrees). A real rack is well over a turn
 * each way, but a graphic that can wrap past vertical stops reading as an angle,
 * so this is the largest rotation that is still unambiguous at a glance.
 */
export const WHEEL_DEGREES_AT_FULL_LOCK = 220;

/** Rim rotation (degrees, clockwise-positive) for a rack position. */
export function wheelRotationDegrees(rack: number): number {
  // +1 rack is full LEFT lock, and left is anticlockwise on screen.
  return -rack * WHEEL_DEGREES_AT_FULL_LOCK;
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
  private readonly wheelFace: HTMLElement;
  private readonly keyLeft: HTMLElement;
  private readonly keyRight: HTMLElement;
  private readonly speedFill: HTMLElement;
  private readonly lockLabel: HTMLElement;
  private readonly mirrorLabel: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML =
      '<div class="hud-scenario"></div>' +
      '<div class="hud-readout"></div>' +
      '<div class="hud-wheel">' +
      '<div class="hud-wheel-key hud-wheel-key-left"></div>' +
      `<div class="hud-wheel-face">${STEERING_WHEEL_SVG}</div>` +
      '<div class="hud-wheel-key hud-wheel-key-right"></div>' +
      '</div>' +
      '<div class="hud-speed"><div class="hud-speed-fill"></div></div>' +
      '<div class="hud-lock"></div>' +
      '<div class="hud-mirror"></div>';
    this.scenario = requireChild(root, '.hud-scenario');
    this.readout = requireChild(root, '.hud-readout');
    this.wheelFace = requireChild(root, '.hud-wheel-face');
    this.keyLeft = requireChild(root, '.hud-wheel-key-left');
    this.keyRight = requireChild(root, '.hud-wheel-key-right');
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

    // EV mode has no selector: what to show is the direction being driven, and
    // "hold" for the auto-brake that a lifted-off EV applies.
    const gearLabel = frame?.evMode
      ? v.gear === 'forward'
        ? 'EV \u25b2 forward'
        : v.gear === 'reverse'
          ? 'EV \u25bc backward'
          : 'EV hold'
      : `gear ${v.gear === 'forward' ? 'D' : v.gear === 'reverse' ? 'R' : 'N'}`;
    const fps = frame && frame.fps > 0 ? `   ${Math.round(frame.fps)} fps` : '';
    const mouse = frame && !frame.pointerLocked ? '   [click to look around]' : '';
    const audio = frame?.audio ? `   audio ${frame.audio}` : '';
    const pad = frame?.gamepad ? '   pad' : '';
    const help = frame?.controlsKey ? `   [${frame.controlsKey} controls]` : '';
    this.readout.textContent =
      `${gearLabel}   ${formatSpeed(v.longitudinalVelocity)}   t ${world.time.toFixed(1)}s` +
      `${fps}${pad}${audio}${mouse}${help}`;
    this.speedFill.style.width = `${speedBarFraction(v.longitudinalVelocity) * 100}%`;

    // The rim turns with the rack, so the indicator IS the control.
    this.wheelFace.style.transform = `rotate(${wheelRotationDegrees(v.rack).toFixed(1)}deg)`;

    // The keycaps light while their key is actually winding the rack on.
    const steerInput = frame?.steerInput ?? 0;
    this.keyLeft.textContent = frame?.steerKeys?.left ?? '\u2190';
    this.keyRight.textContent = frame?.steerKeys?.right ?? '\u2192';
    this.keyLeft.classList.toggle('hud-wheel-key-on', steerInput > v.rack + 1e-6);
    this.keyRight.classList.toggle('hud-wheel-key-on', steerInput < v.rack - 1e-6);

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

/**
 * The rim, spokes and hub. Inline so it rotates as one element with no asset to
 * load, and in `currentColor` so it inherits the HUD's palette.
 */
const STEERING_WHEEL_SVG =
  '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">' +
  '<circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="8" />' +
  '<circle cx="50" cy="50" r="11" fill="currentColor" />' +
  '<path d="M8 50 H39 M61 50 H92 M50 61 V90" stroke="currentColor" stroke-width="8" ' +
  'stroke-linecap="round" />' +
  '<path d="M50 4 v10" stroke="#ff5252" stroke-width="6" stroke-linecap="round" />' +
  '</svg>';

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
