/**
 * Injected clock and id source (AGENTS.md §4: "Time via injected `Clock`;
 * ids via `core`").
 *
 * Nothing in the pure packages may call `Date.now()` or `Math.random()`
 * directly — they take a `Clock` / `IdSource` so that tests are
 * deterministic and the dependency rule stays enforceable.
 */

export interface Clock {
  now(): Date;
  nowIso(): string;
}

export interface IdSource {
  next(): string;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowIso: () => new Date().toISOString(),
};

/** A clock frozen at `at` — used by every deterministic test. */
export const fixedClock = (at: Date): Clock => ({
  now: () => at,
  nowIso: () => at.toISOString(),
});

/** A monotonically increasing id source — deterministic, for tests. */
export const sequentialIds = (prefix: string): IdSource => {
  let n = 0;
  return {
    next: () => {
      n += 1;
      return `${prefix}-${String(n).padStart(6, '0')}`;
    },
  };
};
