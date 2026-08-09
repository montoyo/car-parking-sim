/**
 * Entry point: the fixed-timestep accumulator loop.
 *
 * The core is stepped at exactly `FIXED_DT` however fast the display runs; the
 * renderer draws an interpolation between the two most recent states. This is
 * what makes the physics frame-rate independent and the picture smooth.
 */

import type { SimEvent, WorldState } from './core/index';
import { FIXED_DT, createWorld, step } from './core/index';
import { KeyboardAdapter } from './input/keyboard';
import { LookController } from './input/look';
import { Renderer } from './render/renderer';
import { interpolateVehicle } from './render/interpolate';
import { Hud } from './ui/hud';

const MAX_CATCHUP_SECONDS = 0.25;

function main(): void {
  const canvas = document.getElementById('viewport');
  const hudRoot = document.getElementById('hud');
  if (!(canvas instanceof HTMLCanvasElement) || !hudRoot) {
    throw new Error('Expected #viewport canvas and #hud element in the document.');
  }

  const renderer = new Renderer(canvas);
  const hud = new Hud(hudRoot);
  const keyboard = new KeyboardAdapter();
  keyboard.attach(window);
  // The head is a device adapter like any other: mouse look plus one-button
  // shoulder checks in, two angles out.
  const look = new LookController();
  look.attach(canvas, window);

  // V swaps between the driver's seat and the top-down debug camera.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyV') {
      renderer.setViewMode(renderer.mode === 'first-person' ? 'top-down' : 'first-person');
    }
  });

  let previous: WorldState = createWorld('debug-plane');
  let current: WorldState = previous;
  let accumulator = 0;
  let lastFrameMs: number | null = null;
  let paused = false;
  const fps = new FrameRateMeter();

  // The tab losing focus must not let time (or physics) run away.
  window.addEventListener('blur', () => {
    paused = true;
  });
  window.addEventListener('focus', () => {
    paused = false;
    lastFrameMs = null;
  });
  document.addEventListener('visibilitychange', () => {
    paused = document.hidden;
    lastFrameMs = null;
  });

  const frame = (nowMs: number): void => {
    requestAnimationFrame(frame);

    const elapsed = lastFrameMs === null ? 0 : (nowMs - lastFrameMs) / 1000;
    lastFrameMs = nowMs;

    if (!paused) {
      accumulator = Math.min(accumulator + elapsed, MAX_CATCHUP_SECONDS);
      while (accumulator >= FIXED_DT) {
        const input = keyboard.sample(FIXED_DT);
        const result = step(current, input, FIXED_DT);
        previous = current;
        current = result.world;
        accumulator -= FIXED_DT;
        report(result.events);
      }
    }

    const t = accumulator / FIXED_DT;
    // The head advances on the display clock, not the fixed timestep: it is a
    // camera, not simulation state, so it must never feed back into the core.
    const gaze = look.sample(paused ? 0 : elapsed);
    renderer.render(interpolateVehicle(previous.vehicle, current.vehicle, t), gaze);
    hud.update(current, { fps: fps.sample(elapsed), pointerLocked: look.locked });
  };

  requestAnimationFrame(frame);
}

/**
 * Smoothed frames per second, shown in the HUD. The first-person pass has to
 * hold the refresh rate on a laptop, and a number on screen is how that gets
 * checked by eye.
 */
class FrameRateMeter {
  private smoothed = 0;

  sample(elapsedSeconds: number): number {
    if (elapsedSeconds <= 0) return this.smoothed;
    const instant = 1 / elapsedSeconds;
    this.smoothed = this.smoothed === 0 ? instant : this.smoothed + (instant - this.smoothed) * 0.1;
    return this.smoothed;
  }
}

function report(events: readonly SimEvent[]): void {
  for (const event of events) {
    if (event.kind === 'gearChange') {
      console.info(`[sim] gear ${event.from} -> ${event.to} at tick ${event.tick}`);
    }
  }
}

main();
