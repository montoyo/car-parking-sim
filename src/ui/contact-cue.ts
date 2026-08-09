/**
 * Immediate cue on contact — the player must notice they hit something in the
 * moment, not discover it in the score afterwards.
 *
 * Both cues are driven by the SAME `contact` events that scoring and the replay
 * markers consume, so what the player hears can never disagree with what they
 * are penalised for.
 *
 * Presentation only: no simulation logic, no state the core cares about.
 */

import type { ContactEvent, Severity } from '../core/index';

/** Seconds the banner stays up after the last contact. */
const BANNER_SECONDS = 1.4;

/**
 * Per severity: how the banner reads, and how the thump sounds. Severity is
 * distinguished by GLYPH and text as well as colour, so the cue is readable
 * without colour vision.
 */
const CUES: Readonly<
  Record<Severity, { glyph: string; label: string; colour: string; gain: number; frequency: number }>
> = {
  graze: { glyph: '/', label: 'graze', colour: '#ffd166', gain: 0.09, frequency: 220 },
  knock: { glyph: '//', label: 'knock', colour: '#ff9f45', gain: 0.22, frequency: 130 },
  impact: { glyph: '///', label: 'IMPACT', colour: '#ff5566', gain: 0.5, frequency: 72 },
};

const SURFACE_LABELS: Readonly<Record<ContactEvent['surface'], string>> = {
  vehicle: 'parked car',
  wall: 'wall',
  kerb: 'kerb',
};

export class ContactCue {
  private readonly banner: HTMLElement;
  private remaining = 0;
  /** Created lazily: a browser only allows audio after the first user gesture. */
  private audio: AudioContext | null = null;
  private muted = false;

  constructor(root: HTMLElement) {
    root.innerHTML = '';
    this.banner = document.createElement('div');
    this.banner.className = 'contact-banner';
    this.banner.style.opacity = '0';
    root.appendChild(this.banner);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** Feed one tick's events. Non-contact events are ignored. */
  report(events: readonly { kind: string }[]): void {
    for (const event of events) {
      if (event.kind === 'contact') this.contact(event as ContactEvent);
    }
  }

  private contact(event: ContactEvent): void {
    const cue = CUES[event.severity];
    const part = event.part === 'wheel' ? `${event.wheel ?? 'wheel'} rim` : 'bodywork';
    this.banner.textContent =
      `${cue.glyph} ${cue.label} — ${part} on ${SURFACE_LABELS[event.surface]} ` +
      `at ${event.closingSpeed.toFixed(2)} m/s`;
    this.banner.style.color = cue.colour;
    this.banner.style.borderColor = cue.colour;
    this.remaining = BANNER_SECONDS;
    this.thump(cue.gain, cue.frequency);
  }

  /** Fade the banner on the display clock. Called once per rendered frame. */
  update(elapsedSeconds: number): void {
    if (this.remaining <= 0) return;
    this.remaining = Math.max(0, this.remaining - elapsedSeconds);
    // Hold at full for the first third, then fade — a flash that is seen, then
    // a readout that lingers long enough to read.
    const t = this.remaining / BANNER_SECONDS;
    this.banner.style.opacity = (t > 0.66 ? 1 : t / 0.66).toFixed(3);
  }

  /**
   * A short filtered thud whose pitch and loudness follow severity: a low bang
   * for an impact, a light tick for a graze. Synthesised rather than sampled so
   * there is no asset to load.
   */
  private thump(gain: number, frequency: number): void {
    if (this.muted) return;
    const context = this.ensureAudio();
    if (context === null) return;

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency * 2, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency, now + 0.06);

    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(gain, now + 0.005);
    envelope.gain.exponentialRampToValueAtTime(0.0005, now + 0.22);

    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.25);
  }

  private ensureAudio(): AudioContext | null {
    if (this.audio === null) {
      const Ctor = window.AudioContext;
      if (typeof Ctor !== 'function') return null;
      this.audio = new Ctor();
    }
    if (this.audio.state === 'suspended') void this.audio.resume();
    return this.audio;
  }
}
