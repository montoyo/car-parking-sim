/**
 * The on-screen control reference — and, because it is the same list, the remapping
 * screen and the audio controls.
 *
 * Every row is generated from `ACTION_SPECS` and the live `Bindings`, so the
 * reference cannot drift from what the adapters actually listen for: rebinding a key
 * rewrites the registry and redraws this list from it. Rebinding takes the key away
 * from anything that could have been listening at the same time, which is the
 * invariant that stopped one key meaning two things.
 *
 * Presentation only, verified by eye per the spec.
 */

import type { ActionSpec } from '../input/bindings';
import { ACTION_SPECS, keyLabel } from '../input/bindings';
import type { Bindings } from '../input/bindings';
import type { AudioSettings } from './audio';

/** The pad layout, stated in the reference because a pad has no labels on screen. */
const PAD_REFERENCE: readonly string[] = [
  'left stick — steering (analogue: stick position IS rack position)',
  'right trigger — throttle, left trigger — brake (both analogue)',
  'A — handbrake   ·   RB — drive   ·   B — neutral   ·   LB — reverse',
];

export class ControlsPanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private shown = false;
  /** The action waiting for a key press, if the player is mid-rebind. */
  private capturing: string | null = null;
  private padStatus = 'no gamepad detected';

  constructor(
    root: HTMLElement,
    private readonly bindings: Bindings,
    private readonly audio: AudioSettings,
  ) {
    this.root = root;
    root.innerHTML =
      '<div class="controls-head">Controls' +
      `<span class="controls-hint">${keyLabel(
        bindings.codes('controlsToggle')[0] ?? 'KeyH',
      )} closes  ·  click a key to rebind it</span></div>` +
      '<div class="controls-body"></div>';
    this.body = requireElement(root, '.controls-body');

    root.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const rebind = target.closest('[data-rebind]');
      if (rebind instanceof HTMLElement && rebind.dataset.rebind) {
        this.capturing = rebind.dataset.rebind;
        this.draw();
        return;
      }
      if (target.dataset.act === 'reset-bindings') {
        this.bindings.reset();
        this.capturing = null;
        this.draw();
      }
      if (target.dataset.act === 'mute') {
        this.audio.toggleMuted();
        this.draw();
      }
    });
    root.addEventListener('input', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.act === 'volume') {
        this.audio.setVolume(Number(target.value) / 100);
        this.draw();
      }
    });

    this.bindings.onChange(() => {
      if (this.shown) this.draw();
    });
    this.audio.onChange(() => {
      if (this.shown) this.draw();
    });

    this.draw();
    this.hide();
  }

  /**
   * The rebind capture has to run BEFORE the adapters see the key, otherwise
   * pressing "R" to rebind something would also select reverse. Hence capture phase
   * plus `stopPropagation`.
   */
  attach(target: Window): void {
    target.addEventListener(
      'keydown',
      (e) => {
        const event = e as KeyboardEvent;
        if (this.capturing === null) return;
        e.preventDefault();
        e.stopPropagation();
        if (event.code === 'Escape') {
          this.capturing = null;
        } else {
          this.bindings.rebind(this.capturing, event.code);
          this.capturing = null;
        }
        this.draw();
      },
      true,
    );
  }

  get visible(): boolean {
    return this.shown;
  }

  toggle(): void {
    if (this.shown) this.hide();
    else this.show();
  }

  show(): void {
    this.shown = true;
    this.root.style.display = 'block';
    this.draw();
  }

  hide(): void {
    this.shown = false;
    this.capturing = null;
    this.root.style.display = 'none';
  }

  /** Told once per frame whether a pad is plugged in, so the panel can say so. */
  setPadStatus(connected: boolean, inUse: boolean): void {
    const next = connected
      ? inUse
        ? 'gamepad connected and in use'
        : 'gamepad connected (idle — keyboard still live)'
      : 'no gamepad detected';
    if (next === this.padStatus) return;
    this.padStatus = next;
    if (this.shown) this.draw();
  }

  private draw(): void {
    const groups = new Map<string, ActionSpec[]>();
    for (const spec of ACTION_SPECS) {
      const list = groups.get(spec.group) ?? [];
      list.push(spec);
      groups.set(spec.group, list);
    }

    const columns = [...groups.entries()]
      .map(([group, specs]) => {
        const rows = specs.map((spec) => this.row(spec)).join('');
        return `<div class="controls-group"><div class="controls-group-name">${escapeHtml(
          group,
        )}</div>${rows}</div>`;
      })
      .join('');

    this.body.innerHTML =
      `<div class="controls-columns">${columns}</div>` +
      '<div class="controls-group controls-pad"><div class="controls-group-name">Gamepad</div>' +
      `<div class="controls-pad-status">${escapeHtml(this.padStatus)}</div>` +
      PAD_REFERENCE.map((line) => `<div class="controls-pad-line">${escapeHtml(line)}</div>`).join('') +
      '</div>' +
      '<div class="controls-group"><div class="controls-group-name">Audio</div>' +
      `<div class="controls-audio"><button data-act="mute">${
        this.audio.muted ? 'unmute' : 'mute'
      }</button>` +
      `<input type="range" data-act="volume" min="0" max="100" step="5" value="${Math.round(
        this.audio.volume * 100,
      )}" />` +
      `<span class="controls-audio-value">${escapeHtml(this.audio.describe())}</span></div></div>` +
      '<div class="controls-actions"><button data-act="reset-bindings">reset all keys</button>' +
      '<span class="controls-note">Esc cancels a rebind. Fixed keys (menu, replay) are shown greyed.</span></div>';
  }

  private row(spec: ActionSpec): string {
    const capturing = this.capturing === spec.id;
    const keys = capturing
      ? '<span class="controls-key controls-capturing">press a key…</span>'
      : this.bindings
          .codes(spec.id)
          .map((code) => `<span class="controls-key">${escapeHtml(keyLabel(code))}</span>`)
          .join('');
    const inner = `<span class="controls-label">${escapeHtml(spec.label)}</span>${keys}`;
    return spec.remappable
      ? `<button class="controls-row" data-rebind="${spec.id}">${inner}</button>`
      : `<div class="controls-row controls-fixed">${inner}</div>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function requireElement(root: HTMLElement, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`Controls panel is missing its ${selector} element.`);
  }
  return found;
}
