/**
 * Structural guard, not a gameplay test: the simulation core must stay pure. If
 * this fails, the project's one seam has been breached.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_DIR = new URL('../src/core', import.meta.url).pathname;

function coreFiles(): string[] {
  return readdirSync(CORE_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(CORE_DIR, f));
}

describe('simulation core purity', () => {
  it('has core source files to check', () => {
    expect(coreFiles().length).toBeGreaterThan(0);
  });

  it('imports nothing from outside src/core', () => {
    for (const file of coreFiles()) {
      const source = readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1] as string);
      for (const spec of specifiers) {
        expect(spec.startsWith('./'), `${file} imports ${spec}`).toBe(true);
      }
    }
  });

  it('uses no DOM, timers, or unseeded randomness', () => {
    const forbidden = [
      /\bdocument\b/,
      /\bwindow\b/,
      /\bWebGL/,
      /\bsetTimeout\b/,
      /\bsetInterval\b/,
      /requestAnimationFrame/,
      /Math\.random/,
      /Date\.now/,
      /performance\.now/,
    ];
    for (const file of coreFiles()) {
      const source = readFileSync(file, 'utf8');
      // Strip comments so prose about the renderer does not trip the guard.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const pattern of forbidden) {
        expect(pattern.test(code), `${file} matches ${pattern}`).toBe(false);
      }
    }
  });
});
