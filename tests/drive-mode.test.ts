/**
 * The two drive modes, at the seam they actually meet the game: the
 * `ControlInput` the keyboard adapter hands the core.
 *
 * EV mode is the default and has no gear selector — W and S are the directions
 * and letting go brakes — so what is asserted here is that the same key presses
 * produce a genuinely different input in each mode, and that asking to go the way
 * the car is already moving AGAINST brakes rather than slamming into a shunt.
 */

import { describe, expect, it } from 'vitest';
import type { ControlInput } from '../src/core/index';
import { DEFAULT_BINDINGS, EV_AUTO_BRAKE, KeyboardAdapter } from '../src/input/keyboard';
import type { DriveMode } from '../src/input/keyboard';

/** A stand-in for the DOM target the adapter attaches to. */
class FakeTarget {
  private readonly handlers = new Map<string, ((e: unknown) => void)[]>();

  addEventListener(type: string, handler: (e: unknown) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  removeEventListener(): void {
    // The adapter's detach is not what these tests are about.
  }

  press(code: string): void {
    for (const h of this.handlers.get('keydown') ?? []) h({ code, preventDefault() {} });
  }

  release(code: string): void {
    for (const h of this.handlers.get('keyup') ?? []) h({ code, preventDefault() {} });
  }
}

interface Rig {
  readonly keys: FakeTarget;
  readonly adapter: KeyboardAdapter;
  /** Sample for `seconds` at 120 Hz and return the input the last tick produced. */
  settle(seconds: number, roadSpeed?: number): ControlInput;
}

function rig(mode: DriveMode): Rig {
  const keys = new FakeTarget();
  const adapter = new KeyboardAdapter(DEFAULT_BINDINGS, mode);
  adapter.attach(keys as unknown as Window);
  return {
    keys,
    adapter,
    settle(seconds, roadSpeed = 0) {
      const dt = 1 / 120;
      let input = adapter.sample(dt, roadSpeed);
      for (let i = 1; i < Math.round(seconds / dt); i++) input = adapter.sample(dt, roadSpeed);
      return input;
    },
  };
}

describe('EV mode', () => {
  it('drives forward on W alone, with no gear to select first', () => {
    const r = rig('ev');
    r.keys.press('KeyW');
    const input = r.settle(1);
    expect(input.gear).toBe('forward');
    expect(input.throttle).toBeGreaterThan(0.9);
    expect(input.brake).toBe(0);
  });

  it('drives backward on S alone', () => {
    const r = rig('ev');
    r.keys.press('KeyS');
    const input = r.settle(1);
    expect(input.gear).toBe('reverse');
    expect(input.throttle).toBeGreaterThan(0.9);
    expect(input.brake).toBe(0);
  });

  it('brakes itself the moment both keys are up', () => {
    const r = rig('ev');
    r.keys.press('KeyW');
    r.settle(1);
    r.keys.release('KeyW');
    const input = r.settle(1);
    expect(input.throttle).toBe(0);
    expect(input.brake).toBeCloseTo(EV_AUTO_BRAKE, 5);
    expect(input.gear).toBe('neutral');
  });

  it('brakes rather than engaging when asked for the direction it is moving against', () => {
    // Rolling forward at 1 m/s and the player presses S: a real EV slows to a
    // stop first. Engaging reverse here would be a shunt, not a manoeuvre.
    const r = rig('ev');
    r.keys.press('KeyS');
    const braking = r.settle(0.5, 1.0);
    expect(braking.gear).toBe('neutral');
    expect(braking.throttle).toBe(0);
    expect(braking.brake).toBeGreaterThan(0);

    // Once it is as good as stopped, the same held key takes it the other way.
    const away = r.settle(0.5, 0.05);
    expect(away.gear).toBe('reverse');
    expect(away.throttle).toBeGreaterThan(0.9);
  });

  it('treats both keys down as a request to stop', () => {
    const r = rig('ev');
    r.keys.press('KeyW');
    r.keys.press('KeyS');
    const input = r.settle(1);
    expect(input.gear).toBe('neutral');
    expect(input.throttle).toBe(0);
  });

  it('ignores the gear keys entirely', () => {
    const r = rig('ev');
    r.keys.press('KeyR');
    expect(r.settle(0.5).gear).toBe('neutral');
    expect(r.adapter.gearRequest).toBe(0);
  });
});

describe('gearbox mode', () => {
  it('needs a gear before the throttle does anything to the direction', () => {
    const r = rig('gearbox');
    r.keys.press('KeyW');
    const rolling = r.settle(1);
    expect(rolling.gear).toBe('neutral');
    expect(rolling.throttle).toBeGreaterThan(0.9);

    r.keys.press('KeyR');
    expect(r.settle(0.1).gear).toBe('reverse');
  });

  it('keeps S as the brake pedal rather than a direction', () => {
    const r = rig('gearbox');
    r.keys.press('KeyF');
    r.keys.press('KeyS');
    const input = r.settle(1);
    expect(input.gear).toBe('forward');
    expect(input.brake).toBeGreaterThan(0.9);
  });
});

describe('reset', () => {
  it('puts the adapter back in neutral, so a restart does not drive itself away', () => {
    // The world resets into neutral; an adapter still holding "reverse" would
    // pull the car straight back out of the reset pose.
    const r = rig('gearbox');
    r.keys.press('KeyR');
    r.keys.press('KeyW');
    expect(r.settle(1).gear).toBe('reverse');

    r.adapter.reset();
    const after = r.adapter.sample(1 / 120, 0);
    expect(after.gear).toBe('neutral');
    expect(after.throttle).toBeLessThan(0.05);
  });
});
