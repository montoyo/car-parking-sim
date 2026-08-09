/** Minimal debug HUD: gear, speed, rack position, elapsed simulated time. */

import type { WorldState } from '../core/index';

export class Hud {
  constructor(private readonly root: HTMLElement) {}

  update(world: WorldState): void {
    const v = world.vehicle;
    const kph = Math.abs(v.longitudinalVelocity) * 3.6;
    const gearLabel = v.gear === 'forward' ? 'D' : v.gear === 'reverse' ? 'R' : 'N';
    const lock = Math.round(v.rack * 100);
    this.root.textContent =
      `gear ${gearLabel}   ` +
      `${kph.toFixed(1)} km/h   ` +
      `rack ${lock > 0 ? `${lock}% L` : lock < 0 ? `${-lock}% R` : 'centred'}   ` +
      `t ${world.time.toFixed(1)}s`;
  }
}
