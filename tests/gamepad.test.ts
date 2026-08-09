/**
 * The gamepad adapter, asserted where it is a pure mapping: a pad snapshot in, a
 * normalised `ControlInput` out — the SAME shape the keyboard produces, which is the
 * property that keeps the core device-agnostic.
 *
 * Pad plumbing (connection events, browser polling) is verified by eye per the spec.
 */

import { describe, expect, it } from 'vitest';
import type { PadSnapshot } from '../src/input/gamepad';
import {
  GamepadAdapter,
  STICK_DEADZONE,
  padControlInput,
  padGearRequest,
  padSteer,
} from '../src/input/gamepad';
import { combineInputs } from '../src/input/combine';
import { NEUTRAL_INPUT } from '../src/core/index';

function pad(overrides: { axes?: number[]; buttons?: Record<number, number> } = {}): PadSnapshot {
  const buttons = Array.from({ length: 16 }, (_, i) => {
    const value = overrides.buttons?.[i] ?? 0;
    return { pressed: value > 0.5, value };
  });
  return { axes: overrides.axes ?? [0, 0, 0, 0], buttons };
}

describe('analogue steering', () => {
  it('maps stick position directly to rack target — half a stick is half a rack', () => {
    // Stick left is negative axis, and +1 rack target is full LEFT lock.
    expect(padSteer(-1)).toBeCloseTo(1, 6);
    expect(padSteer(1)).toBeCloseTo(-1, 6);
    expect(padSteer(0)).toBe(0);
    // Proportional, not switched: mid-travel gives roughly mid rack.
    const half = padSteer(-0.5);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
    // Monotonic across the travel.
    expect(padSteer(-0.9)).toBeGreaterThan(padSteer(-0.6));
  });

  it('ignores stick slop and rescales the rest, so the first movement is small', () => {
    expect(padSteer(-STICK_DEADZONE * 0.9)).toBe(0);
    expect(padSteer(-(STICK_DEADZONE + 0.01))).toBeGreaterThan(0);
    expect(padSteer(-(STICK_DEADZONE + 0.01))).toBeLessThan(0.05);
  });
});

describe('analogue pedals', () => {
  it('reads trigger travel rather than an on/off press', () => {
    const light = padControlInput(pad({ buttons: { 7: 0.3 } }), 'forward');
    const heavy = padControlInput(pad({ buttons: { 7: 0.9 } }), 'forward');
    expect(light.throttle).toBeGreaterThan(0);
    expect(heavy.throttle).toBeGreaterThan(light.throttle);
    expect(heavy.throttle).toBeLessThanOrEqual(1);
  });

  it('puts the left trigger on the brake and A on the handbrake', () => {
    const input = padControlInput(pad({ buttons: { 6: 0.7, 0: 1 } }), 'neutral');
    expect(input.brake).toBeGreaterThan(0.6);
    expect(input.throttle).toBe(0);
    expect(input.handbrake).toBe(true);
  });
});

describe('the shape the core sees', () => {
  it('produces exactly the normalised ControlInput shape, in range', () => {
    const input = padControlInput(pad({ axes: [-3], buttons: { 7: 4, 6: -2 } }), 'reverse');
    expect(Object.keys(input).sort()).toEqual(Object.keys(NEUTRAL_INPUT).sort());
    expect(input.steer).toBeLessThanOrEqual(1);
    expect(input.steer).toBeGreaterThanOrEqual(-1);
    expect(input.throttle).toBeLessThanOrEqual(1);
    expect(input.brake).toBeGreaterThanOrEqual(0);
    expect(input.gear).toBe('reverse');
  });

  it('selects a gear from the shoulder buttons, once per press', () => {
    expect(padGearRequest(pad({ buttons: { 5: 1 } }))).toBe('forward');
    expect(padGearRequest(pad({ buttons: { 4: 1 } }))).toBe('reverse');
    expect(padGearRequest(pad({ buttons: { 1: 1 } }))).toBe('neutral');
    expect(padGearRequest(pad())).toBeNull();

    let snapshot = pad({ buttons: { 4: 1 } });
    const adapter = new GamepadAdapter(() => [snapshot]);
    expect(adapter.sample()?.gear).toBe('reverse');
    const afterFirst = adapter.gearRequest;
    // Still holding it: the latch stays, but it is not re-requested.
    expect(adapter.sample()?.gear).toBe('reverse');
    expect(adapter.gearRequest).toBe(afterFirst);
    snapshot = pad();
    expect(adapter.sample()?.gear).toBe('reverse');
  });

  it('reports no input at all when nothing is plugged in', () => {
    const adapter = new GamepadAdapter(() => [null]);
    expect(adapter.sample()).toBeNull();
    expect(adapter.connected).toBe(false);
  });
});

describe('combining the two devices', () => {
  const keys = { input: { ...NEUTRAL_INPUT, steer: 0.4, throttle: 0.2 }, gearRequest: 1 };

  it('is the keyboard alone when no pad is present', () => {
    expect(combineInputs(keys, null)).toEqual(keys.input);
  });

  it('lets a held stick win over the keyboard ramp, and takes the harder pedal', () => {
    const pad = { input: { ...NEUTRAL_INPUT, steer: -0.9, throttle: 0.7 }, gearRequest: 2 };
    const combined = combineInputs(keys, pad);
    expect(combined.steer).toBeCloseTo(-0.9, 6);
    expect(combined.throttle).toBeCloseTo(0.7, 6);
  });

  it('keeps the keyboard steering when the stick is at rest', () => {
    const pad = { input: { ...NEUTRAL_INPUT, steer: 0 }, gearRequest: 0 };
    expect(combineInputs(keys, pad).steer).toBeCloseTo(0.4, 6);
  });

  it('gives the gear to whichever device asked most recently', () => {
    const padFirst = { input: { ...NEUTRAL_INPUT, gear: 'reverse' as const }, gearRequest: 0 };
    expect(combineInputs({ ...keys, gearRequest: 5 }, padFirst).gear).toBe('neutral');
    expect(combineInputs({ ...keys, gearRequest: 1 }, { ...padFirst, gearRequest: 9 }).gear).toBe(
      'reverse',
    );
  });
});
