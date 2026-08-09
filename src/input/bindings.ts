/**
 * The one registry of key bindings.
 *
 * EVERY key the game listens for lives here — the ones that become part of
 * `ControlInput` (steering, pedals, gear) and equally the ones that do not (look,
 * mirror aim, restart, view toggle, menu, audio, this panel itself). They are in
 * one place for one reason: `KeyR` was once bound to BOTH gear-reverse and instant
 * restart, and nothing in the code could have noticed. Now a duplicate code is a
 * data error the registry itself reports, and `assertNoDuplicateBindings` runs at
 * startup and in the test suite.
 *
 * Two actions only conflict if their scopes can be live at the same time: the
 * replay screen's Space is not the handbrake's Space, because the car is not being
 * driven while the replay owns the screen. `global` overlaps everything.
 *
 * The registry is also what makes remapping and the on-screen control reference
 * fall out for free: the panel renders this list, and rebinding writes back into
 * it, so the reference can never drift from what the adapters actually read.
 */

import type { KeyBindings } from './keyboard';
import type { LookBindings } from './look';
import type { MirrorAimBindings } from './mirror-aim';

/**
 * When an action's keys are listened for. Actions in scopes that can be live
 * simultaneously may not share a key code.
 */
export type BindingScope = 'global' | 'drive' | 'replay' | 'menu';

export interface ActionSpec {
  readonly id: string;
  readonly scope: BindingScope;
  /** Heading the on-screen reference files this action under. */
  readonly group: string;
  readonly label: string;
  /** Fixed keys (menu and replay chrome) are shown but not rebindable. */
  readonly remappable: boolean;
  readonly defaults: readonly string[];
}

/**
 * Every action, in the order the control reference should list them.
 *
 * The ids of the driving, look and mirror actions are deliberately the field names
 * of `KeyBindings`, `LookBindings` and `MirrorAimBindings`, so the slices below are
 * a lookup rather than a translation table.
 */
export const ACTION_SPECS: readonly ActionSpec[] = [
  { id: 'throttle', scope: 'drive', group: 'Driving', label: 'throttle', remappable: true, defaults: ['ArrowUp', 'KeyW'] },
  { id: 'brake', scope: 'drive', group: 'Driving', label: 'brake', remappable: true, defaults: ['ArrowDown', 'KeyS'] },
  { id: 'steerLeft', scope: 'drive', group: 'Driving', label: 'steer left', remappable: true, defaults: ['ArrowLeft', 'KeyA'] },
  { id: 'steerRight', scope: 'drive', group: 'Driving', label: 'steer right', remappable: true, defaults: ['ArrowRight', 'KeyD'] },
  { id: 'handbrake', scope: 'drive', group: 'Driving', label: 'handbrake', remappable: true, defaults: ['Space'] },
  { id: 'gearForward', scope: 'drive', group: 'Driving', label: 'gear: drive', remappable: true, defaults: ['KeyF', 'Digit1'] },
  { id: 'gearNeutral', scope: 'drive', group: 'Driving', label: 'gear: neutral', remappable: true, defaults: ['KeyN', 'Digit2'] },
  { id: 'gearReverse', scope: 'drive', group: 'Driving', label: 'gear: reverse', remappable: true, defaults: ['KeyR', 'Digit3'] },

  { id: 'lookLeft', scope: 'drive', group: 'Head', label: 'shoulder check left', remappable: true, defaults: ['KeyQ'] },
  { id: 'lookRight', scope: 'drive', group: 'Head', label: 'shoulder check right', remappable: true, defaults: ['KeyE'] },
  { id: 'lookBack', scope: 'drive', group: 'Head', label: 'look back', remappable: true, defaults: ['KeyC'] },
  { id: 'lookAhead', scope: 'drive', group: 'Head', label: 'recentre view', remappable: true, defaults: ['KeyZ'] },
  { id: 'viewToggle', scope: 'drive', group: 'Head', label: 'driver seat / top-down', remappable: true, defaults: ['KeyV'] },

  { id: 'mirrorSelect', scope: 'drive', group: 'Mirrors', label: 'next mirror', remappable: true, defaults: ['KeyM'] },
  { id: 'aimUp', scope: 'drive', group: 'Mirrors', label: 'aim up', remappable: true, defaults: ['KeyI'] },
  { id: 'aimDown', scope: 'drive', group: 'Mirrors', label: 'aim down', remappable: true, defaults: ['KeyK'] },
  { id: 'aimLeft', scope: 'drive', group: 'Mirrors', label: 'aim left', remappable: true, defaults: ['KeyJ'] },
  { id: 'aimRight', scope: 'drive', group: 'Mirrors', label: 'aim right', remappable: true, defaults: ['KeyL'] },
  { id: 'mirrorReset', scope: 'drive', group: 'Mirrors', label: 'reset aim', remappable: true, defaults: ['KeyO'] },

  { id: 'restart', scope: 'global', group: 'Session', label: 'restart scenario', remappable: true, defaults: ['Backspace'] },
  { id: 'menuToggle', scope: 'global', group: 'Session', label: 'scenario menu', remappable: true, defaults: ['KeyP'] },
  { id: 'controlsToggle', scope: 'global', group: 'Session', label: 'this control reference', remappable: true, defaults: ['KeyH'] },
  { id: 'audioMute', scope: 'global', group: 'Session', label: 'mute / unmute audio', remappable: true, defaults: ['KeyX'] },
  { id: 'volumeDown', scope: 'global', group: 'Session', label: 'volume down', remappable: true, defaults: ['Minus'] },
  { id: 'volumeUp', scope: 'global', group: 'Session', label: 'volume up', remappable: true, defaults: ['Equal'] },

  { id: 'replayPlay', scope: 'replay', group: 'Replay', label: 'play / pause', remappable: false, defaults: ['Space'] },
  { id: 'replayStepBack', scope: 'replay', group: 'Replay', label: 'step back a frame', remappable: false, defaults: ['Comma', 'ArrowLeft'] },
  { id: 'replayStepForward', scope: 'replay', group: 'Replay', label: 'step on a frame', remappable: false, defaults: ['Period', 'ArrowRight'] },
  { id: 'replaySlower', scope: 'replay', group: 'Replay', label: 'slower playback', remappable: false, defaults: ['BracketLeft'] },
  { id: 'replayFaster', scope: 'replay', group: 'Replay', label: 'faster playback', remappable: false, defaults: ['BracketRight'] },
  { id: 'replayView', scope: 'replay', group: 'Replay', label: 'top-down / driver seat', remappable: false, defaults: ['KeyT'] },
  { id: 'replayReference', scope: 'replay', group: 'Replay', label: 'reference line overlay', remappable: false, defaults: ['KeyG'] },

  { id: 'menuPick', scope: 'menu', group: 'Menu', label: 'pick a scenario', remappable: false, defaults: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'] },
  { id: 'menuStart', scope: 'menu', group: 'Menu', label: 'start the attempt', remappable: false, defaults: ['Enter'] },
  { id: 'menuClose', scope: 'menu', group: 'Menu', label: 'close the menu', remappable: false, defaults: ['Escape'] },
];

export type BindingSet = Readonly<Record<string, readonly string[]>>;

export const ACTION_IDS: readonly string[] = ACTION_SPECS.map((spec) => spec.id);

export function actionSpec(id: string): ActionSpec {
  const found = ACTION_SPECS.find((spec) => spec.id === id);
  if (!found) throw new Error(`Unknown input action "${id}".`);
  return found;
}

export const DEFAULT_BINDING_SET: BindingSet = Object.freeze(
  Object.fromEntries(ACTION_SPECS.map((spec) => [spec.id, spec.defaults])),
);

/** Whether two scopes can be listening at the same moment. */
export function scopesOverlap(a: BindingScope, b: BindingScope): boolean {
  return a === b || a === 'global' || b === 'global';
}

export interface BindingConflict {
  readonly code: string;
  readonly actions: readonly [string, string];
}

/**
 * Every pair of actions that claim the same key in overlapping scopes. An empty
 * array is the invariant the whole registry exists to keep.
 */
export function bindingConflicts(set: BindingSet): readonly BindingConflict[] {
  const conflicts: BindingConflict[] = [];
  for (let i = 0; i < ACTION_SPECS.length; i++) {
    const a = ACTION_SPECS[i] as ActionSpec;
    for (let j = i + 1; j < ACTION_SPECS.length; j++) {
      const b = ACTION_SPECS[j] as ActionSpec;
      if (!scopesOverlap(a.scope, b.scope)) continue;
      for (const code of set[a.id] ?? []) {
        if ((set[b.id] ?? []).includes(code)) {
          conflicts.push({ code, actions: [a.id, b.id] });
        }
      }
    }
  }
  return conflicts;
}

/** Startup guard: a binding set with a double-claimed key must not reach the game. */
export function assertNoDuplicateBindings(set: BindingSet): void {
  const conflicts = bindingConflicts(set);
  if (conflicts.length === 0) return;
  const detail = conflicts
    .map((c) => `${c.code} is bound to both ${c.actions[0]} and ${c.actions[1]}`)
    .join('; ');
  throw new Error(`Duplicate key bindings: ${detail}.`);
}

/** The slice of `Storage` remapping needs, so a test can hand it a fake. */
export interface BindingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'car-parking-sim:bindings';

/**
 * The live binding set: what the adapters read, what the panel edits, and what
 * persists between sessions.
 *
 * Rebinding a key TAKES it from whichever overlapping action held it, so the
 * no-duplicates invariant holds by construction rather than by hoping the player
 * picked a free key.
 */
export class Bindings {
  private set: Record<string, readonly string[]>;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly store: BindingStore | null = safeLocalStorage()) {
    this.set = { ...DEFAULT_BINDING_SET };
    this.load();
  }

  codes(id: string): readonly string[] {
    return this.set[id] ?? actionSpec(id).defaults;
  }

  /** Whether a key event's `code` triggers an action. */
  matches(id: string, code: string): boolean {
    return this.codes(id).includes(code);
  }

  snapshot(): BindingSet {
    return { ...this.set };
  }

  /**
   * Bind `code` to `id`, replacing that action's keys and removing the code from
   * any action that could have been listening for it at the same time.
   */
  rebind(id: string, code: string): void {
    const spec = actionSpec(id);
    if (!spec.remappable) return;
    const next: Record<string, readonly string[]> = { ...this.set };
    for (const other of ACTION_SPECS) {
      if (other.id === id || !scopesOverlap(spec.scope, other.scope)) continue;
      const kept = (next[other.id] ?? []).filter((c) => c !== code);
      if (kept.length !== (next[other.id] ?? []).length) next[other.id] = kept;
    }
    next[id] = [code];
    this.commit(next);
  }

  /** Put one action, or the whole set, back to the shipped keys. */
  reset(id?: string): void {
    if (id === undefined) {
      this.commit({ ...DEFAULT_BINDING_SET });
      return;
    }
    const next: Record<string, readonly string[]> = { ...this.set };
    next[id] = actionSpec(id).defaults;
    // Restoring a default can re-collide; whatever else held those codes loses them.
    for (const other of ACTION_SPECS) {
      if (other.id === id || !scopesOverlap(actionSpec(id).scope, other.scope)) continue;
      next[other.id] = (next[other.id] ?? []).filter((c) => !next[id]?.includes(c));
    }
    this.commit(next);
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private commit(next: Record<string, readonly string[]>): void {
    assertNoDuplicateBindings(next);
    this.set = next;
    this.save();
    for (const listener of this.listeners) listener();
  }

  private load(): void {
    if (this.store === null) return;
    const raw = this.store.getItem(STORAGE_KEY);
    if (raw === null) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const next: Record<string, readonly string[]> = { ...DEFAULT_BINDING_SET };
      for (const spec of ACTION_SPECS) {
        if (!spec.remappable) continue;
        const codes = parsed[spec.id];
        if (Array.isArray(codes) && codes.every((c) => typeof c === 'string') && codes.length > 0) {
          next[spec.id] = codes as string[];
        }
      }
      // A stored set that double-claims a key (hand-edited, or written by an older
      // build) is discarded rather than allowed to reintroduce the bug.
      assertNoDuplicateBindings(next);
      this.set = next;
    } catch {
      this.set = { ...DEFAULT_BINDING_SET };
    }
  }

  private save(): void {
    if (this.store === null) return;
    const remappable = Object.fromEntries(
      ACTION_SPECS.filter((s) => s.remappable).map((s) => [s.id, this.set[s.id] ?? s.defaults]),
    );
    try {
      this.store.setItem(STORAGE_KEY, JSON.stringify(remappable));
    } catch {
      // Storage full or blocked: the mapping simply does not persist.
    }
  }

  /** The driving slice, in the shape `KeyboardAdapter` wants. */
  keyBindings(): KeyBindings {
    return keyBindingsFrom(this.set);
  }

  lookBindings(): LookBindings {
    return lookBindingsFrom(this.set);
  }

  mirrorAimBindings(): MirrorAimBindings {
    return mirrorAimBindingsFrom(this.set);
  }
}

/**
 * The per-adapter slices. Each adapter's own `DEFAULT_*_BINDINGS` is built by
 * running these over `DEFAULT_BINDING_SET`, so the registry is the only place the
 * shipped keys are written down.
 */
function codesOf(set: BindingSet, id: string): readonly string[] {
  return set[id] ?? actionSpec(id).defaults;
}

export function keyBindingsFrom(set: BindingSet): KeyBindings {
  return {
    steerLeft: codesOf(set, 'steerLeft'),
    steerRight: codesOf(set, 'steerRight'),
    throttle: codesOf(set, 'throttle'),
    brake: codesOf(set, 'brake'),
    handbrake: codesOf(set, 'handbrake'),
    gearForward: codesOf(set, 'gearForward'),
    gearNeutral: codesOf(set, 'gearNeutral'),
    gearReverse: codesOf(set, 'gearReverse'),
  };
}

export function lookBindingsFrom(set: BindingSet): LookBindings {
  return {
    lookLeft: codesOf(set, 'lookLeft'),
    lookRight: codesOf(set, 'lookRight'),
    lookBack: codesOf(set, 'lookBack'),
    lookAhead: codesOf(set, 'lookAhead'),
  };
}

export function mirrorAimBindingsFrom(set: BindingSet): MirrorAimBindings {
  return {
    select: codesOf(set, 'mirrorSelect'),
    aimUp: codesOf(set, 'aimUp'),
    aimDown: codesOf(set, 'aimDown'),
    aimLeft: codesOf(set, 'aimLeft'),
    aimRight: codesOf(set, 'aimRight'),
    reset: codesOf(set, 'mirrorReset'),
  };
}

/** How a key code reads on screen: `KeyW` is not what is printed on the key. */
export function keyLabel(code: string): string {
  const named: Readonly<Record<string, string>> = {
    Space: 'Space',
    Minus: '-',
    Equal: '=',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    BracketLeft: '[',
    BracketRight: ']',
    Backquote: '`',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Backspace: 'Backspace',
    Enter: 'Enter',
    Escape: 'Esc',
    Tab: 'Tab',
  };
  if (named[code]) return named[code] as string;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `num ${code.slice(6)}`;
  return code;
}

function safeLocalStorage(): BindingStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
