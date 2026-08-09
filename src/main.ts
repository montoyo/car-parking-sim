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

  let previous: WorldState = createWorld('debug-plane');
  let current: WorldState = previous;
  let accumulator = 0;
  let lastFrameMs: number | null = null;
  let paused = false;

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
    renderer.render(interpolateVehicle(previous.vehicle, current.vehicle, t));
    hud.update(current);
  };

  requestAnimationFrame(frame);
}

function report(events: readonly SimEvent[]): void {
  for (const event of events) {
    if (event.kind === 'gearChange') {
      console.info(`[sim] gear ${event.from} -> ${event.to} at tick ${event.tick}`);
    }
  }
}

main();
