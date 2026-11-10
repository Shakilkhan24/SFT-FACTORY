/**
 * `api/idempotency` — the `Idempotency-Key` store (T-1.14).
 *
 * ## What the pack requires
 *
 * pack `04` §3: "`Idempotency-Key` required on creating POSTs."
 *
 * So every creating POST — AP-1's intent, AP-2's decision, AP-3's
 * decision, AP-5's interventions, AP-6's apply — must carry the header,
 * and a **repeat** of the same key must not repeat the effect.
 *
 * ## Why this matters more than it looks
 *
 * A human clicks a button. The network is slow. The browser retries.
 * Without an idempotency key the factory records **two intents** for one
 * click — and the second one starts a second run of a workflow, which
 * spends money, opens a pull request, and can merge something. That is
 * not a rare edge case; it is what happens on every flaky connection.
 *
 * So the key is **required**, not optional, and a repeat returns the
 * **recorded result** rather than performing the action again.
 *
 * ## The key is scoped to the caller and the route
 *
 * A key is a *client's* name for a request. Two different callers, or
 * two different routes, may legitimately use the same string. So the
 * record's identity is `(login, method, path, key)` — and a key reused
 * on a **different** route is **not** a replay, it is a mistake, and it
 * is refused with `conflict` rather than silently returning the other
 * route's result.
 */

import { sha256 } from '@factory/core';

/**
 * The header name.
 */
export const IDEMPOTENCY_HEADER_NAME = 'idempotency-key';

/**
 * What a completed request recorded.
 */
export interface IdempotentRecord {
  /** The status that was returned. */
  readonly status: number;
  /** The body that was returned. */
  readonly body: unknown;
  /** The request id that produced it. */
  readonly requestId: string;
}

/**
 * The identity of a recorded request.
 */
export interface IdempotencyKey {
  /** The caller's login. */
  readonly login: string;
  /** The HTTP method. */
  readonly method: string;
  /** The path. */
  readonly path: string;
  /** The key itself. */
  readonly key: string;
}

/**
 * The record's **lookup** identity — the caller and the key.
 *
 * The route is **not** part of it, and that is the whole point.
 *
 * A key is a *client's* name for a request. If the route were part of
 * the lookup identity, then reusing a key on a different route would
 * simply **miss** — the store would find nothing and treat the call as
 * new. The clash would go unnoticed, and the caller would get two
 * actions from one key.
 *
 * So the lookup is by `(login, key)`, and the route is compared
 * **after** the lookup. A hit on a different route is a *conflict* — the
 * caller made a mistake — rather than a silent new action.
 */
export const recordId = (k: IdempotencyKey): string =>
  sha256(
    [k.login, k.key].join(' '),
  );

/**
 * The idempotency store.
 */
export interface IdempotencyStore {
  /**
   * The record for a key, if there is one.
   *
   * The store returns the record *and* whether the key was first used on
   * this route — because a key used on a different route is a conflict,
   * not a replay.
   */
  get(
    k: IdempotencyKey,
  ): Promise<
    | { readonly found: true; readonly record: IdempotentRecord; readonly sameRoute: boolean }
    | { readonly found: false }
  >;
  /** Record the result of a request. */
  put(k: IdempotencyKey, record: IdempotentRecord): Promise<void>;
}

/**
 * The in-memory store.
 *
 * A double, because the durable store is Postgres and `migrations/**` is
 * R4. The semantics are the real ones: the record is written **after**
 * the action succeeds, so a request that failed is not recorded and may
 * be retried.
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly #records = new Map<
    string,
    { readonly record: IdempotentRecord; readonly method: string; readonly path: string }
  >();

  public get(
    k: IdempotencyKey,
  ): Promise<
    | { readonly found: true; readonly record: IdempotentRecord; readonly sameRoute: boolean }
    | { readonly found: false }
  > {
    const entry = this.#records.get(recordId(k));
    if (entry === undefined) {
      return Promise.resolve({ found: false });
    }
    return Promise.resolve({
      found: true,
      record: entry.record,
      sameRoute: entry.method === k.method && entry.path === k.path,
    });
  }

  public put(k: IdempotencyKey, record: IdempotentRecord): Promise<void> {
    this.#records.set(recordId(k), {
      record,
      method: k.method,
      path: k.path,
    });
    return Promise.resolve();
  }

  /** How many records are held — for a test to inspect. */
  public get size(): number {
    return this.#records.size;
  }
}
