/**
 * Best score per scenario, persisted between sessions.
 *
 * The key is the scenario id AND its tunable parameters: a wider bay or a lower
 * kerb is a different challenge, so it is a different leaderboard entry. That is
 * the whole reason the key is built from the parameter values rather than from the
 * id alone.
 *
 * Presentation-layer code: the core never reads or writes storage, and scoring
 * stays a pure function over a world and an event log.
 */

import type { Scorecard } from '../core/index';

const PREFIX = 'car-parking-sim:best:';

/** What is remembered about a best attempt — enough to show it, not to replay it. */
export interface BestEntry {
  readonly points: number;
  readonly grade: Scorecard['grade'];
  readonly stars: number;
  readonly elapsedSeconds: number;
  readonly shunts: number;
  readonly contacts: number;
}

export interface BestOutcome {
  /** The best entry for this scenario and parameter set after this attempt. */
  readonly best: BestEntry;
  /** The entry this attempt beat, if any. */
  readonly previous: BestEntry | null;
  readonly isNewBest: boolean;
}

/** The subset of `Storage` this needs — so it can be handed a fake in a test. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Storage key for a scenario instance. Parameters are sorted so the key does not
 * depend on object property order.
 */
export function bestKey(scenarioId: string, parameters: Readonly<Record<string, number>>): string {
  const tuning = Object.keys(parameters)
    .sort()
    .map((name) => `${name}=${(parameters[name] as number).toFixed(3)}`)
    .join(',');
  return `${PREFIX}${scenarioId}|${tuning}`;
}

function entryOf(card: Scorecard): BestEntry {
  return {
    points: card.points,
    grade: card.grade,
    stars: card.stars,
    elapsedSeconds: card.elapsedSeconds,
    shunts: card.shunts,
    contacts: card.contacts.length,
  };
}

export class BestScores {
  private readonly store: KeyValueStore | null;

  constructor(store: KeyValueStore | null = safeLocalStorage()) {
    this.store = store;
  }

  read(scenarioId: string, parameters: Readonly<Record<string, number>>): BestEntry | null {
    if (this.store === null) return null;
    const raw = this.store.getItem(bestKey(scenarioId, parameters));
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<BestEntry>;
      if (typeof parsed.points !== 'number') return null;
      return {
        points: parsed.points,
        grade: parsed.grade ?? 'F',
        stars: parsed.stars ?? 0,
        elapsedSeconds: parsed.elapsedSeconds ?? 0,
        shunts: parsed.shunts ?? 0,
        contacts: parsed.contacts ?? 0,
      };
    } catch {
      // A corrupt entry is not worth failing an attempt over.
      return null;
    }
  }

  /** Record an attempt, keeping it only if it beats what was there. */
  submit(card: Scorecard): BestOutcome {
    const entry = entryOf(card);
    const previous = this.read(card.scenarioId, card.parameters);
    const isNewBest = previous === null || entry.points > previous.points;
    if (isNewBest && this.store !== null) {
      this.store.setItem(bestKey(card.scenarioId, card.parameters), JSON.stringify(entry));
    }
    return { best: isNewBest ? entry : previous, previous, isNewBest };
  }
}

/** Private-browsing modes throw on access; a missing store simply means no bests. */
function safeLocalStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
