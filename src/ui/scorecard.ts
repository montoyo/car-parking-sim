/**
 * The breakdown screen shown when an attempt ends: every criterion with what it
 * measured, its tolerance and its sub-score; the hard gates; a letter grade and a
 * star rating; and whether this attempt beat the stored best.
 *
 * Presentation only. It reads a `Scorecard` — the pure output of `scoreAttempt` —
 * and a `BestOutcome`, and renders them. No scoring logic lives here, so what the
 * player reads cannot disagree with what they were scored.
 */

import type { CriterionScore, Scorecard } from '../core/index';
import type { BestOutcome } from './bests';

const UNIT_DECIMALS: Readonly<Record<CriterionScore['unit'], number>> = {
  m: 2,
  deg: 1,
  count: 1,
  s: 1,
};

export class ScorecardScreen {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.hide();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.root.innerHTML = '';
  }

  show(card: Scorecard, best: BestOutcome): void {
    const verdict = card.passed ? 'PASSED' : 'FAILED';
    const rows = card.criteria.map((c) => this.row(c)).join('');
    // Stars are drawn with filled and empty glyphs, and the grade is a letter:
    // the summary is readable without relying on colour.
    const stars = '*'.repeat(card.stars) + '.'.repeat(5 - card.stars);

    this.root.innerHTML =
      `<div class="card-head"><span class="card-grade">${card.grade}</span>` +
      `<span class="card-points">${card.points}/100</span>` +
      `<span class="card-stars">${stars}</span>` +
      `<span class="card-verdict">${verdict}</span></div>` +
      `<div class="card-gates">${this.gates(card)}</div>` +
      `<table class="card-rows"><tbody>${rows}</tbody></table>` +
      `<div class="card-best">${this.best(card, best)}</div>` +
      '<div class="card-hint">Backspace to try again</div>';
    this.root.style.display = 'block';
  }

  private row(c: CriterionScore): string {
    const dp = UNIT_DECIMALS[c.unit];
    const unit = c.unit === 'count' ? '' : ` ${c.unit}`;
    const measured = `${c.value.toFixed(dp)}${unit}`;
    const band = `target ${c.target.toFixed(dp)}${unit} ± ${c.tolerance.toFixed(dp)}${unit}`;
    const percent = Math.round(c.subScore * 100);
    // A bar as well as a number, and the number as well as the bar.
    const bar = '#'.repeat(Math.round(c.subScore * 10)).padEnd(10, '-');
    return (
      `<tr><td>${c.label}</td><td class="card-value">${measured}</td>` +
      `<td class="card-band">${band}</td>` +
      `<td class="card-bar">${bar}</td><td class="card-sub">${percent}%</td>` +
      `<td class="card-weight">of ${Math.round(c.weight * 100)}</td></tr>`
    );
  }

  private gates(card: Scorecard): string {
    const parts: string[] = [];
    if (card.gates.fullyInsideBay !== null) {
      parts.push(mark(card.gates.fullyInsideBay, 'whole car inside the bay'));
    }
    parts.push(mark(card.gates.withinContactLimit, `contacts: ${card.contacts.length}`));
    parts.push(mark(card.gates.meetsMinimumScore, 'minimum score'));
    if (card.failureReason !== null) parts.push(`x ended: ${card.failureReason}`);
    return parts.join('   ');
  }

  private best(card: Scorecard, best: BestOutcome): string {
    if (best.isNewBest) {
      const previous = best.previous === null ? 'first completed attempt' : `beat ${best.previous.points}`;
      return `NEW BEST — ${card.points}/100 (${previous})`;
    }
    return `best for this setup: ${best.best.points}/100 (${best.best.grade})`;
  }
}

function mark(ok: boolean, label: string): string {
  return `${ok ? 'ok' : 'x'} ${label}`;
}
