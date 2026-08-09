/**
 * Audio preferences: mute and volume, remembered between sessions.
 *
 * The cues are synthesised, not sampled, so "volume" is simply a factor on the
 * envelope gain each cue asks for — severity still sets the relative loudness, and
 * this scales the lot. Kept out of `ContactCue` so anything else that ever makes a
 * noise reads the same setting.
 */

const STORAGE_KEY = 'car-parking-sim:audio';

/** Volume steps the up/down keys walk through, so a key press is a real change. */
export const VOLUME_STEP = 0.1;

export interface AudioStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface AudioState {
  readonly muted: boolean;
  /** 0..1 factor applied to every cue's gain. */
  readonly volume: number;
}

export class AudioSettings {
  private state: AudioState = { muted: false, volume: 0.8 };
  private readonly listeners = new Set<(state: AudioState) => void>();

  constructor(private readonly store: AudioStore | null = safeLocalStorage()) {
    this.load();
  }

  get muted(): boolean {
    return this.state.muted;
  }

  get volume(): number {
    return this.state.volume;
  }

  /** What a cue should actually multiply its gain by. */
  get effectiveGain(): number {
    return this.state.muted ? 0 : this.state.volume;
  }

  setMuted(muted: boolean): void {
    this.commit({ ...this.state, muted });
  }

  toggleMuted(): void {
    this.setMuted(!this.state.muted);
  }

  setVolume(volume: number): void {
    const clamped = volume < 0 ? 0 : volume > 1 ? 1 : volume;
    // Turning the volume up is also how you unmute — nobody expects a silent slider.
    this.commit({ muted: clamped === 0 ? this.state.muted : false, volume: clamped });
  }

  nudgeVolume(steps: number): void {
    this.setVolume(Math.round((this.state.volume + steps * VOLUME_STEP) * 100) / 100);
  }

  onChange(listener: (state: AudioState) => void): void {
    this.listeners.add(listener);
    listener(this.state);
  }

  /** How the setting reads on screen. */
  describe(): string {
    return this.state.muted ? 'muted' : `${Math.round(this.state.volume * 100)}%`;
  }

  private commit(state: AudioState): void {
    this.state = state;
    if (this.store !== null) {
      try {
        this.store.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // Blocked storage just means the preference does not persist.
      }
    }
    for (const listener of this.listeners) listener(state);
  }

  private load(): void {
    if (this.store === null) return;
    const raw = this.store.getItem(STORAGE_KEY);
    if (raw === null) return;
    try {
      const parsed = JSON.parse(raw) as Partial<AudioState>;
      this.state = {
        muted: parsed.muted === true,
        volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : 0.8,
      };
    } catch {
      // Leave the defaults.
    }
  }
}

function safeLocalStorage(): AudioStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
