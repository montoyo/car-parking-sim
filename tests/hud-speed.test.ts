/**
 * The speedometer readout, which is the one bit of HUD that is a function rather
 * than a layout: the whole game happens under 10 km/h, so a creep and a lurch must
 * not print as the same number.
 */

import { describe, expect, it } from 'vitest';
import { formatSpeed, speedBarFraction } from '../src/ui/hud';

describe('the speedometer at parking pace', () => {
  it('distinguishes a creep from a lurch', () => {
    // 0.1 m/s is a creep, 0.5 m/s is a lurch: they must read differently.
    expect(formatSpeed(0.1)).not.toBe(formatSpeed(0.5));
    expect(formatSpeed(0.1)).toMatch(/0\.36 km\/h/);
    expect(formatSpeed(0.1)).toContain('creep');
    expect(formatSpeed(0.5)).toMatch(/1\.80 km\/h/);
  });

  it('resolves two speeds a tenth of a km/h apart', () => {
    // 0.30 and 0.36 km/h — one decimal would print both as "0.3".
    expect(formatSpeed(0.0833)).not.toBe(formatSpeed(0.1));
  });

  it('says stopped rather than showing a rounding artefact', () => {
    expect(formatSpeed(0)).toBe('stopped');
    expect(formatSpeed(0.001)).toBe('stopped');
  });

  it('reads the same forwards and in reverse — direction is the gear, not the speed', () => {
    expect(formatSpeed(-0.4)).toBe(formatSpeed(0.4));
  });

  it('drops decimals once the speed no longer needs them', () => {
    expect(formatSpeed(2)).toBe('7.2 km/h');
    expect(formatSpeed(10)).toBe('36 km/h');
  });

  it('gives the bar real travel at crawl speed and never overflows it', () => {
    const creep = speedBarFraction(0.1);
    expect(creep).toBeGreaterThan(0.15);
    expect(creep).toBeLessThan(0.4);
    expect(speedBarFraction(0)).toBe(0);
    expect(speedBarFraction(50)).toBe(1);
    expect(speedBarFraction(0.5)).toBeGreaterThan(creep);
  });
});
