/**
 * The scenario selection menu.
 *
 * The player picks the manoeuvre they are actually bad at, sees its difficulty and
 * its pass criteria BEFORE the attempt starts, and dials the scenario's tunable
 * parameters up or down — easier while learning, harder once confident.
 *
 * Everything on screen is read out of scenario DATA: the list is
 * `PLAYABLE_SCENARIO_IDS`, each row's text is the template's own `name`,
 * `difficulty`, `summary` and `passSummary`, and the sliders are built from the
 * template's `ParameterSpec`s. There is no per-scenario branch anywhere in this
 * file — adding a scenario adds a row.
 *
 * The best score shown beside each row is keyed by the scenario id AND the
 * parameter values currently dialled in, because that is what `BestScores` keys on:
 * a wider bay is a different challenge and so a different entry, and the number
 * under the sliders changes as they move.
 *
 * Presentation only, verified by eye per the spec. Starting an attempt is one call
 * back out to the loop with an id and a parameter set — the core is what turns
 * those into a world.
 */

import type { ParameterSpec, ScenarioId, ScenarioTemplate } from '../core/index';
import {
  PLAYABLE_SCENARIO_IDS,
  defaultParameters,
  resolveParameters,
  scenarioTemplate,
} from '../core/index';
import type { BestScores } from './bests';

/** What the loop needs to start an attempt: which scenario, tuned how. */
export interface ScenarioChoice {
  readonly id: ScenarioId;
  readonly parameters: Readonly<Record<string, number>>;
}

const DIFFICULTY_ORDER: readonly string[] = ['tutorial', 'easy', 'moderate', 'hard', 'challenge'];

export class ScenarioSelect {
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  /** The tuning the player has dialled in, per scenario, kept across visits. */
  private readonly tuning = new Map<ScenarioId, Record<string, number>>();
  private selected: ScenarioId = PLAYABLE_SCENARIO_IDS[0] as ScenarioId;
  private shown = false;

  constructor(
    root: HTMLElement,
    private readonly bests: BestScores,
    private readonly onStart: (choice: ScenarioChoice) => void,
  ) {
    this.root = root;
    root.innerHTML =
      '<div class="select-head">Choose a manoeuvre' +
      '<span class="select-hint">P closes  ·  1-5 picks  ·  Enter starts</span></div>' +
      '<div class="select-body"><div class="select-list"></div><div class="select-detail"></div></div>';
    this.list = requireElement(root, '.select-list');
    this.detail = requireElement(root, '.select-detail');

    for (const id of PLAYABLE_SCENARIO_IDS) {
      this.tuning.set(id, { ...defaultParameters(id) });
    }

    root.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const pick = target.closest('[data-scenario]');
      if (pick instanceof HTMLElement && pick.dataset.scenario) {
        this.select(pick.dataset.scenario as ScenarioId);
      }
      if (target.dataset.act === 'start') this.start();
      if (target.dataset.act === 'defaults') this.resetTuning();
    });
    root.addEventListener('input', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      const name = target.dataset.param;
      if (name === undefined) return;
      const parameters = this.parametersFor(this.selected);
      parameters[name] = Number(target.value);
      this.drawDetail();
    });

    this.hide();
  }

  /** Menu keys, live only while the menu is on screen — except the one that opens it. */
  attach(target: Window): void {
    target.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' && !e.repeat) {
        e.preventDefault();
        if (this.shown) this.hide();
        else this.show();
        return;
      }
      if (!this.shown) return;
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        const index = Number(digit[1]) - 1;
        const id = PLAYABLE_SCENARIO_IDS[index];
        if (id) this.select(id);
      }
      if (e.code === 'Enter') this.start();
      if (e.code === 'Escape') this.hide();
    });
  }

  get visible(): boolean {
    return this.shown;
  }

  show(): void {
    // The menu is clicked, so the mouse has to belong to the page again.
    if (document.pointerLockElement) document.exitPointerLock();
    this.shown = true;
    this.root.style.display = 'block';
    this.draw();
  }

  hide(): void {
    this.shown = false;
    this.root.style.display = 'none';
  }

  /** The choice currently dialled in, for the loop's initial world. */
  choice(): ScenarioChoice {
    return {
      id: this.selected,
      parameters: resolveParameters(this.selected, this.parametersFor(this.selected)),
    };
  }

  private parametersFor(id: ScenarioId): Record<string, number> {
    const existing = this.tuning.get(id);
    if (existing) return existing;
    const fresh = { ...defaultParameters(id) };
    this.tuning.set(id, fresh);
    return fresh;
  }

  private select(id: ScenarioId): void {
    this.selected = id;
    this.draw();
  }

  private resetTuning(): void {
    this.tuning.set(this.selected, { ...defaultParameters(this.selected) });
    this.drawDetail();
  }

  private start(): void {
    const choice = this.choice();
    this.hide();
    this.onStart(choice);
  }

  private draw(): void {
    this.list.innerHTML = PLAYABLE_SCENARIO_IDS.map((id, index) => {
      const template = scenarioTemplate(id);
      const on = id === this.selected ? ' select-on' : '';
      return (
        `<button class="select-row${on}" data-scenario="${id}">` +
        `<span class="select-key">${index + 1}</span>` +
        `<span class="select-name">${escapeHtml(template.name)}</span>` +
        `<span class="select-difficulty diff-${template.difficulty}">${stars(template)}</span>` +
        '</button>'
      );
    }).join('');
    this.drawDetail();
  }

  private drawDetail(): void {
    const template = scenarioTemplate(this.selected);
    const parameters = this.parametersFor(this.selected);
    const best = this.bests.read(this.selected, resolveParameters(this.selected, parameters));

    this.detail.innerHTML =
      `<div class="select-title">${escapeHtml(template.name)}` +
      `<span class="select-difficulty diff-${template.difficulty}">` +
      `${escapeHtml(template.difficulty)}</span></div>` +
      `<p class="select-summary">${escapeHtml(template.summary)}</p>` +
      `<div class="select-pass"><strong>To pass:</strong> ${escapeHtml(template.passSummary)}</div>` +
      `<div class="select-criteria">Judged on: ${template.criteria
        .map((c) => `${escapeHtml(c.criterion)} (±${c.tolerance}${unitSuffix(c.unit)})`)
        .join(', ')}</div>` +
      `<div class="select-gates">${gateSummary(template)}</div>` +
      (template.reversingCamera
        ? '<div class="select-camera">Reversing camera available (shown in reverse).</div>'
        : '<div class="select-camera select-off">Mirrors only — no reversing camera.</div>') +
      this.parameterRows(template, parameters) +
      `<div class="select-best">${
        best
          ? `Your best here: ${best.points} pts, grade ${best.grade}, ` +
            `${best.elapsedSeconds.toFixed(1)}s, ${best.shunts} shunts, ${best.contacts} contacts`
          : 'No best score at this setting yet.'
      }</div>` +
      '<div class="select-actions">' +
      '<button data-act="start">start attempt</button>' +
      '<button data-act="defaults">reset settings</button>' +
      '</div>';
  }

  private parameterRows(
    template: ScenarioTemplate,
    parameters: Readonly<Record<string, number>>,
  ): string {
    const names = Object.keys(template.parameters);
    if (names.length === 0) return '';
    return (
      '<div class="select-params">' +
      names
        .map((name) => {
          const spec = template.parameters[name] as ParameterSpec;
          const value = parameters[name] ?? spec.default;
          return (
            '<label class="select-param">' +
            `<span class="select-param-name">${escapeHtml(spec.label)}</span>` +
            `<input type="range" data-param="${name}" min="${spec.min}" max="${spec.max}" ` +
            `step="${spec.step}" value="${value}" />` +
            `<span class="select-param-value">${value.toFixed(spec.step < 0.1 ? 2 : 1)} ${
              spec.unit
            }</span>` +
            '</label>'
          );
        })
        .join('') +
      '</div>'
    );
  }
}

function gateSummary(template: ScenarioTemplate): string {
  const parts = [
    template.pass.fullyInsideBay ? 'whole car inside the bay' : null,
    template.pass.maxContacts === null
      ? null
      : template.pass.maxContacts === 0
        ? 'no contact of any kind'
        : `at most ${template.pass.maxContacts} contacts`,
    `at least ${Math.round(template.pass.minScore * 100)} points`,
    template.pass.endOnSevereImpact ? 'a heavy impact ends the attempt' : null,
  ].filter((p): p is string => p !== null);
  return `Hard requirements: ${escapeHtml(parts.join('; '))}.`;
}

/** Difficulty as filled pips, so it reads at a glance as well as in words. */
function stars(template: ScenarioTemplate): string {
  const level = DIFFICULTY_ORDER.indexOf(template.difficulty) + 1;
  return '●'.repeat(level) + '○'.repeat(Math.max(0, DIFFICULTY_ORDER.length - level));
}

function unitSuffix(unit: string): string {
  return unit === 'count' ? '' : unit === 's' ? ' s' : unit === 'deg' ? '°' : ' m';
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
    throw new Error(`Scenario select is missing its ${selector} element.`);
  }
  return found;
}
