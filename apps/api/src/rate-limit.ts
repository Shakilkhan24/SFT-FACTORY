/**
 * `api/rate-limit` — the rate limiter (T-1.14).
 *
 * ## Why the API needs one
 *
 * The factory's access points are the factory's **write** path. An
 * approval decision merges code; a kill-switch call stops the fleet; an
 * intent starts a workflow that spends money. So the surface that
 * decides those things must not be reachable at whatever rate a client
 * chooses.
 *
 * The limit is **per caller**, not per IP: the CLI tokens are shared by
 * a team, and a limit keyed on an address would let one noisy machine
 * exhaust the whole team's budget.
 *
 * ## The refusal is a `kill_switch`-free refusal
 *
 * When the limit is exceeded the caller gets a `429` with
 * `code: 'policy_denied'` — the pack's code set has no `rate_limited`
 * code, and the refusal *is* a policy refusal: the caller's rate does
 * not permit the call. The `Retry-After` header says when to come back.
 *
 * ## Fail-closed
 *
 * HR-8: "Deny by default. Fail closed." So the limiter **denies** when it
 * cannot decide — it never fails open. A limiter that fails open is a
 * limiter that does not exist.
 */

import { refusal } from './problem.js';
import type { Refusal } from './problem.js';

/**
 * The default number of calls in the window.
 */
export const DEFAULT_RATE_LIMIT = 100;

/**
 * The default window, in milliseconds.
 */
export const DEFAULT_RATE_WINDOW_MS = 60_000;

/**
 * The rate limiter.
 */
export interface RateLimiter {
  /**
   * Consume one call for a caller.
   *
   * @returns how many calls remain in the window, or a refusal when the
   *   limit is reached.
   */
  consume(caller: string): Promise<{ readonly allowed: true; readonly remaining: number } | { readonly allowed: false; readonly refusal: Refusal; readonly retryAfterSeconds: number }>;
}

/**
 * The fixed-window limiter.
 *
 * A **fixed** window, not a sliding one: the window boundary resets
 * abruptly, which is a slight inaccuracy, and the inaccuracy is the
 * cheaper mistake. A sliding window needs per-caller history and buys
 * precision the factory does not need.
 */
export class FixedWindowRateLimiter implements RateLimiter {
  readonly #windows = new Map<string, { startedAt: number; count: number }>();

  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;

  /**
   * @param limit the calls allowed per window
   * @param windowMs the window's length
   * @param now the millisecond clock — injected (AGENTS.md §4)
   */
  public constructor(
    limit: number = DEFAULT_RATE_LIMIT,
    windowMs: number = DEFAULT_RATE_WINDOW_MS,
    now: () => number = () => Date.now(),
  ) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  public consume(
    caller: string,
  ): Promise<
    | { readonly allowed: true; readonly remaining: number }
    | { readonly allowed: false; readonly refusal: Refusal; readonly retryAfterSeconds: number }
  > {
    const now = this.#now();
    const window = this.#windows.get(caller);

    if (window === undefined || now - window.startedAt >= this.#windowMs) {
      this.#windows.set(caller, { startedAt: now, count: 1 });
      return Promise.resolve({ allowed: true, remaining: this.#limit - 1 });
    }

    if (window.count >= this.#limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((this.#windowMs - (now - window.startedAt)) / 1000),
      );
      return Promise.resolve({
        allowed: false,
        refusal: refusal(
          'policy_denied',
          `the rate limit of ${String(this.#limit)} calls per ${String(
            Math.round(this.#windowMs / 1000),
          )} seconds has been reached`,
          429,
        ),
        retryAfterSeconds,
      });
    }

    window.count += 1;
    return Promise.resolve({ allowed: true, remaining: this.#limit - window.count });
  }

  /** Forget a caller's window — for a test. */
  public reset(caller: string): void {
    this.#windows.delete(caller);
  }
}
