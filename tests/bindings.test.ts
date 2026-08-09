/**
 * The binding registry's one invariant: no two actions that could be listening at
 * the same moment claim the same key.
 *
 * This is here because the bug it prevents actually happened — `KeyR` was bound to
 * both gear-reverse and instant restart, and the only way it surfaced was a player
 * selecting reverse and having the scenario reset under them. Everything else in
 * this file is data hygiene on the same registry.
 */

import { describe, expect, it } from 'vitest';
import {
  ACTION_SPECS,
  Bindings,
  DEFAULT_BINDING_SET,
  assertNoDuplicateBindings,
  bindingConflicts,
  keyBindingsFrom,
  keyLabel,
  lookBindingsFrom,
  mirrorAimBindingsFrom,
  scopesOverlap,
} from '../src/input/bindings';
import type { BindingStore } from '../src/input/bindings';
import { DEFAULT_BINDINGS } from '../src/input/keyboard';
import { DEFAULT_LOOK_BINDINGS } from '../src/input/look';
import { DEFAULT_MIRROR_AIM_BINDINGS } from '../src/input/mirror-aim';

/** A localStorage stand-in, so persistence is testable without a browser. */
function fakeStore(seed: Record<string, string> = {}): BindingStore & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('the key binding registry', () => {
  it('ships without a single key claimed by two overlapping actions', () => {
    expect(bindingConflicts(DEFAULT_BINDING_SET)).toEqual([]);
  });

  it('reports the collision that shipped as a bug: one key, two actions', () => {
    // The historical bug, reconstructed: restart on the gear-reverse key.
    const broken = { ...DEFAULT_BINDING_SET, restart: ['KeyR'] };
    const conflicts = bindingConflicts(broken);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts.some((c) => c.code === 'KeyR')).toBe(true);
    expect(() => assertNoDuplicateBindings(broken)).toThrow(/KeyR/);
  });

  it('lets modal scopes reuse a key, because they are never live together', () => {
    // Space is the handbrake while driving and play/pause on the replay screen.
    expect(scopesOverlap('drive', 'replay')).toBe(false);
    expect(scopesOverlap('global', 'replay')).toBe(true);
  });

  it('gives every action at least one key and a unique id', () => {
    const ids = ACTION_SPECS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of ACTION_SPECS) expect(spec.defaults.length).toBeGreaterThan(0);
  });

  it('is the single source of the adapters own default bindings', () => {
    expect(DEFAULT_BINDINGS).toEqual(keyBindingsFrom(DEFAULT_BINDING_SET));
    expect(DEFAULT_LOOK_BINDINGS).toEqual(lookBindingsFrom(DEFAULT_BINDING_SET));
    expect(DEFAULT_MIRROR_AIM_BINDINGS).toEqual(mirrorAimBindingsFrom(DEFAULT_BINDING_SET));
  });
});

describe('remapping', () => {
  it('takes the key away from whatever held it, so no duplicate can be created', () => {
    const bindings = new Bindings(fakeStore());
    bindings.rebind('restart', 'KeyR');
    expect(bindings.codes('restart')).toEqual(['KeyR']);
    expect(bindings.codes('gearReverse')).not.toContain('KeyR');
    expect(bindingConflicts(bindings.snapshot())).toEqual([]);
  });

  it('leaves a key alone when the other claimant is in a scope that cannot be live', () => {
    const bindings = new Bindings(fakeStore());
    // Handbrake onto the replay's play/pause key: different scopes, both keep it.
    bindings.rebind('handbrake', 'Space');
    expect(bindings.codes('handbrake')).toEqual(['Space']);
    expect(bindings.codes('replayPlay')).toEqual(['Space']);
  });

  it('persists the mapping between sessions and restores it', () => {
    const store = fakeStore();
    const first = new Bindings(store);
    first.rebind('throttle', 'KeyT');
    const second = new Bindings(store);
    expect(second.codes('throttle')).toEqual(['KeyT']);
    expect(second.keyBindings().throttle).toEqual(['KeyT']);
  });

  it('discards a stored mapping that double-claims a key', () => {
    const store = fakeStore({
      'car-parking-sim:bindings': JSON.stringify({ restart: ['KeyR'], gearReverse: ['KeyR'] }),
    });
    const bindings = new Bindings(store);
    expect(bindings.snapshot()).toEqual(DEFAULT_BINDING_SET);
  });

  it('refuses to rebind the fixed menu and replay keys', () => {
    const bindings = new Bindings(fakeStore());
    bindings.rebind('replayPlay', 'KeyY');
    expect(bindings.codes('replayPlay')).toEqual(['Space']);
  });

  it('resets back to the shipped keys', () => {
    const bindings = new Bindings(fakeStore());
    bindings.rebind('brake', 'KeyY');
    bindings.reset();
    expect(bindings.snapshot()).toEqual(DEFAULT_BINDING_SET);
  });

  it('prints keys the way they read on the keyboard', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('Minus')).toBe('-');
  });
});
