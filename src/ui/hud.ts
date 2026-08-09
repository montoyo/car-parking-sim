/**
 * Minimal debug HUD: gear, speed, elapsed simulated time, plus a steering rack
 * indicator so the player can see how much lock is applied (and that winding it
 * on takes time). Reads `WorldState` and the vehicle definition only — no
 * simulation logic lives here.
 */

import type { WorldState } from '../core/index';
import { referenceSteerAngle } from '../core/index';

export class Hud {
  private readonly readout: HTMLElement;
  private readonly needle: HTMLElement;
  private readonly lockLabel: HTMLElement;

  constructor(root: HTMLElement) {
    root.innerHTML =
      '<div class="hud-readout"></div>' +
      '<div class="hud-rack"><div class="hud-rack-centre"></div>' +
      '<div class="hud-rack-needle"></div></div>' +
      '<div class="hud-lock"></div>';
    this.readout = requireChild(root, '.hud-readout');
    this.needle = requireChild(root, '.hud-rack-needle');
    this.lockLabel = requireChild(root, '.hud-lock');
  }

  update(world: WorldState): void {
    const v = world.vehicle;
    const kph = Math.abs(v.longitudinalVelocity) * 3.6;
    const gearLabel = v.gear === 'forward' ? 'D' : v.gear === 'reverse' ? 'R' : 'N';
    this.readout.textContent = `gear ${gearLabel}   ${kph.toFixed(1)} km/h   t ${world.time.toFixed(1)}s`;

    // The needle sweeps the bar: +1 (full LEFT lock) sits at the left end.
    this.needle.style.left = `${(0.5 - v.rack * 0.5) * 100}%`;

    const side = v.rack > 0 ? 'L' : 'R';
    const roadWheelDegrees = Math.abs((referenceSteerAngle(v.rack) * 180) / Math.PI);
    this.lockLabel.textContent =
      v.rack === 0
        ? 'rack centred'
        : `rack ${Math.abs(v.rack) >= 0.999 ? 'FULL LOCK' : `${Math.round(Math.abs(v.rack) * 100)}%`}` +
          ` ${side}   ${roadWheelDegrees.toFixed(1)}°`;
  }
}

function requireChild(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`HUD is missing ${selector}`);
  return el;
}
