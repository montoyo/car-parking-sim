/**
 * Best scores are keyed by scenario id AND its tunable parameters: a wider bay or
 * a lower kerb is a different challenge, so it is a different leaderboard entry.
 *
 * `BestScores` takes an injected key-value store, so this needs no browser — and
 * the scorecards it is fed come from the real scoring function over a real driven
 * attempt, never from a hand-built object.
 */

import { describe, expect, it } from 'vitest';
import { createWorld, scoreAttempt } from '../src/core/index';
import type { KeyValueStore } from '../src/ui/bests';
import { BestScores, bestKey } from '../src/ui/bests';
import { drive } from './helpers/drive';

class MemoryStore implements KeyValueStore {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

/** An attempt at a scenario, at a given tuning — scored the way the game scores it. */
function attempt(parameters: Record<string, number>): ReturnType<typeof scoreAttempt> {
  const world = createWorld('tight-kerb', { parameters });
  const result = drive(world, [
    { seconds: 1.5, input: { gear: 'reverse' } },
    { seconds: 2, input: { gear: 'neutral', brake: 1, handbrake: true } },
  ]);
  return scoreAttempt(result.world, result.events);
}

describe('best scores', () => {
  it('keys an entry by the scenario id and the parameter set', () => {
    const narrow = attempt({ bayWidth: 2.2 });
    const wide = attempt({ bayWidth: 3 });
    expect(bestKey(narrow.scenarioId, narrow.parameters)).not.toBe(
      bestKey(wide.scenarioId, wide.parameters),
    );
    // Not the id alone, and not order-dependent within the parameters.
    expect(bestKey('tight-kerb', { a: 1, b: 2 })).toBe(bestKey('tight-kerb', { b: 2, a: 1 }));
    expect(bestKey('forward-bay', { bayWidth: 2.5 })).not.toBe(
      bestKey('reverse-bay', { bayWidth: 2.5 }),
    );
  });

  it('keeps a separate best per parameter set rather than one per scenario', () => {
    const store = new MemoryStore();
    const bests = new BestScores(store);
    const narrow = attempt({ bayWidth: 2.2 });
    bests.submit(narrow);

    // A different tuning of the same scenario starts with no best at all.
    const wide = attempt({ bayWidth: 3 });
    expect(bests.read(wide.scenarioId, wide.parameters)).toBeNull();
    expect(bests.read(narrow.scenarioId, narrow.parameters)?.points).toBe(narrow.points);
    expect(bests.submit(wide).isNewBest).toBe(true);
    expect(store.items.size).toBe(2);
  });

  it('reports whether an attempt beat the previous best at that setting', () => {
    const store = new MemoryStore();
    const bests = new BestScores(store);
    const card = attempt({ bayWidth: 2.4 });
    expect(bests.submit(card).isNewBest).toBe(true);
    // The same attempt again ties rather than beats, and the entry is unchanged.
    const again = bests.submit(card);
    expect(again.isNewBest).toBe(false);
    expect(again.previous?.points).toBe(card.points);
  });
});
