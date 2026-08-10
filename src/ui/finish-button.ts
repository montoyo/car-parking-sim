/**
 * The "finish attempt" button — the player declaring the manoeuvre over.
 *
 * It exists because nothing else should end an attempt: the car stopping is not a
 * statement, and a simulator that scored you the moment you paused to think took
 * the decision off the person making it. So the end of an attempt is one explicit
 * act, available in two forms of the same action — this button and the key bound
 * to `finishAttempt` — both of which raise the SAME `finishRequested` flag on the
 * control input.
 *
 * The button greys out when the core would refuse the request (`canFinish`), so
 * what it offers and what the core accepts stay one rule rather than two.
 */

export interface FinishButtonState {
  /** Whether the attempt is still being driven (the button is only up then). */
  readonly driving: boolean;
  /** Whether the core would accept a finish request right now. */
  readonly ready: boolean;
  /** How the bound key reads, e.g. `Enter`. */
  readonly key: string;
}

export class FinishButton {
  private readonly button: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private shown = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly onFinish: () => void,
  ) {
    root.innerHTML =
      '<button class="finish-button" type="button">finish attempt</button>' +
      '<div class="finish-hint"></div>';
    const button = root.querySelector('.finish-button');
    const hint = root.querySelector('.finish-hint');
    if (!(button instanceof HTMLButtonElement) || !(hint instanceof HTMLElement)) {
      throw new Error('Finish button is missing its elements.');
    }
    this.button = button;
    this.hint = hint;
    this.button.addEventListener('click', () => {
      if (!this.button.disabled) this.onFinish();
    });
  }

  update(state: FinishButtonState): void {
    const visible = state.driving;
    if (visible !== this.shown) {
      this.shown = visible;
      this.root.style.display = visible ? 'flex' : 'none';
    }
    if (!visible) return;
    this.button.disabled = !state.ready;
    this.hint.textContent = state.ready
      ? `or press ${state.key}`
      : 'stop the car to finish';
  }
}
