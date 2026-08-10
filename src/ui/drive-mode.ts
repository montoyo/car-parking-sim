/**
 * Which drive mode the player is in, remembered between sessions.
 *
 * The mode itself is the keyboard adapter's (see `input/keyboard.ts`); this is
 * only the preference, kept beside the other persisted settings so the adapter
 * can be handed a getter and pick a change up on the next key press rather than
 * on the next reload.
 */

import type { DriveMode } from '../input/keyboard';
import { DEFAULT_DRIVE_MODE } from '../input/keyboard';

const STORAGE_KEY = 'car-parking-sim:drive-mode';

export interface DriveModeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** How a mode reads on screen. */
export const DRIVE_MODE_LABELS: Readonly<Record<DriveMode, string>> = {
  ev: 'EV (hold W / S)',
  gearbox: 'gearbox (F / N / R)',
};

export class DriveModeSetting {
  private current: DriveMode = DEFAULT_DRIVE_MODE;
  private readonly listeners = new Set<(mode: DriveMode) => void>();

  constructor(private readonly store: DriveModeStore | null = safeLocalStorage()) {
    const raw = this.store?.getItem(STORAGE_KEY) ?? null;
    if (raw === 'ev' || raw === 'gearbox') this.current = raw;
  }

  get mode(): DriveMode {
    return this.current;
  }

  get label(): string {
    return DRIVE_MODE_LABELS[this.current];
  }

  set(mode: DriveMode): void {
    if (mode === this.current) return;
    this.current = mode;
    try {
      this.store?.setItem(STORAGE_KEY, mode);
    } catch {
      // Blocked storage just means the preference does not persist.
    }
    for (const listener of this.listeners) listener(mode);
  }

  toggle(): void {
    this.set(this.current === 'ev' ? 'gearbox' : 'ev');
  }

  onChange(listener: (mode: DriveMode) => void): void {
    this.listeners.add(listener);
  }
}

function safeLocalStorage(): DriveModeStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
