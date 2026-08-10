/**
 * The steering seam, driven the way the real loop drives it: the keyboard
 * adapter produces a rack TARGET, the core's rate limiter moves the rack toward
 * it, and the rack it reached is fed back into the next sample.
 *
 * What is asserted here is the FEEL the player reports on, not the geometry
 * (that is `steering.test.ts`): the wheel moves on the tick the key goes down,
 * and it stops on the tick the key comes up. A target that is allowed to sprint
 * ahead of the rack passes every geometry test and still feels like input lag,
 * because the rack goes on chasing a target the player has already let go of.
 */

import { describe, expect, it } from 'vitest';
import { FIXED_DT, VEHICLE, rackRate } from '../src/core/index';
import { DEFAULT_BINDINGS, KeyboardAdapter } from '../src/input/keyboard';

/** A stand-in for the DOM target the adapter attaches to. */
class FakeTarget {
  private readonly handlers = new Map<string, ((e: unknown) => void)[]>();

  addEventListener(type: string, handler: (e: unknown) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  removeEventListener(): void {}

  press(code: string): void {
    for (const h of this.handlers.get('keydown') ?? []) h({ code, preventDefault() {} });
  }

  release(code: string): void {
    for (const h of this.handlers.get('keyup') ?? []) h({ code, preventDefault() {} });
  }
}

const STEER_LEFT = DEFAULT_BINDINGS.steerLeft[0] as string;

/** The main loop's steering path: sample -> rate-limited rack -> sample again. */
function rig() {
  const keys = new FakeTarget();
  const adapter = new KeyboardAdapter(DEFAULT_BINDINGS);
  adapter.attach(keys as unknown as Window);
  let rack = 0;
  return {
    keys,
    get rack() {
      return rack;
    },
    /** Advance one tick and return how far the rack moved during it. */
    tick(): number {
      const target = adapter.sample(FIXED_DT, 0, rack).steer;
      const limit = rackRate(0) * FIXED_DT;
      const step = Math.max(-limit, Math.min(limit, target - rack));
      rack += step;
      return step;
    },
  };
}

describe('the steering wheel follows the key, tick for tick', () => {
  it('starts turning on the first tick the key is held', () => {
    const r = rig();
    expect(r.tick()).toBe(0);
    r.keys.press(STEER_LEFT);
    expect(r.tick()).toBeCloseTo(rackRate(0) * FIXED_DT, 12);
  });

  it('stops on the first tick after the key is released, wherever it got to', () => {
    const r = rig();
    r.keys.press(STEER_LEFT);
    for (let i = 0; i < 30; i++) r.tick();
    const held = r.rack;
    expect(held).toBeGreaterThan(0.05);
    expect(held).toBeLessThan(1);

    r.keys.release(STEER_LEFT);
    // Not "settles back to the target over the next few ticks" — stops dead.
    expect(r.tick()).toBe(0);
    for (let i = 0; i < 200; i++) r.tick();
    expect(r.rack).toBe(held);
  });

  it('reaches full lock in the rack lock-to-lock time and no faster', () => {
    const r = rig();
    r.keys.press(STEER_LEFT);
    const halfLock = VEHICLE.rackLockToLockSecondsStationary / 2;
    for (let t = 0; t < halfLock - 2 * FIXED_DT; t += FIXED_DT) r.tick();
    expect(r.rack).toBeLessThan(1);
    for (let t = 0; t < 4 * FIXED_DT; t += FIXED_DT) r.tick();
    expect(r.rack).toBe(1);
  });
});
