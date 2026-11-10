/**
 * `projections/ports` — what the projector needs from the outside (T-1.15).
 *
 * ## Why ports, and not the packages
 *
 * pack `02` §3: apps wire packages together; packages never import apps.
 * And the ticket says the projector keeps **durable cursors** — a
 * durability concern, so the store is a port with a Postgres
 * implementation and an in-memory double.
 *
 * The `EventSource` port is deliberately **structural** — a subset of the
 * contracts' `EventLog` — so the projector does not depend on the
 * contracts' full Zod-inferred envelope type. The real
 * `packages/eventlog`'s `PostgresEventLog` satisfies it without an
 * adapter, exactly how `apps/api`'s `EventSink` was written.
 */

/**
 * One row of the log, as the projector sees it.
 */
export interface LogEvent {
  readonly seq: number;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly eventType: string;
  readonly aggregate: {
    readonly kind: string;
    readonly id: string;
    readonly version: number;
  };
  readonly correlationId: string;
  readonly actor: { readonly kind: string; readonly id: string };
  readonly authority: Readonly<Record<string, unknown>>;
  readonly subject: Readonly<Record<string, unknown>>;
  readonly payload: unknown;
  readonly context: Readonly<Record<string, unknown>>;
  readonly redaction: { readonly applied: readonly string[] };
  readonly costUsdMicros?: number;
  readonly durationMs?: number;
}

/**
 * The log the projector reads.
 *
 * The projector only **reads**. It never appends — the projector role has
 * `SELECT` on `events` and nothing else (pack `03` §2).
 */
export interface EventSource {
  /**
   * The events after a sequence number, in `seq` order.
   *
   * `afterSeq` is **exclusive**: the cursor's value is the last event the
   * projection has applied, so the next read starts *after* it.
   */
  read(afterSeq: number, limit: number): Promise<readonly LogEvent[]>;
}

/**
 * One projection's rows.
 */
export type ProjectionRows = Readonly<Record<string, unknown>>;

/**
 * One projection's **carried state**, keyed the same way as the rows.
 *
 * The carried state is the reducer's own bookkeeping — for
 * `cost_attribution`, the bucket's contributions, from which the totals
 * are derived. It is **not** a row: it is not read by a user, and it is
 * not part of the pack's column list.
 *
 * It lives beside the rows because it must survive a restart: a
 * projection that lost its carried state would compute a bucket's
 * totals from the events after the restart alone, and the totals would
 * be wrong. So the state is written in the **same** transaction as the
 * rows it belongs to.
 */
export type ProjectionStates = Readonly<Record<string, unknown>>;

/**
 * The store the projector's rows live in.
 *
 * The store is **durable** and the projector's writes are **absolute**:
 * an upsert sets the row, a remove deletes it. There is no "append" and
 * no "increment" — that is what makes a replay idempotent, and it is why
 * the store's interface has no accumulate operation.
 *
 * The store **owns a cursor store**, because the rows and the cursor must
 * commit together — see `commit`.
 */
export interface ProjectionStore {
  /** Every row of a projection, keyed. */
  read(name: string): Promise<ProjectionRows>;

  /** One row of a projection. */
  readOne(name: string, key: string): Promise<unknown>;

  /**
   * Every projection's **carried state**, keyed the same way as the
   * rows.
   *
   * The projector reads it before reducing an event, so the reducer
   * folds onto the state the *previous* events left.
   */
  readStates(): Promise<ProjectionStates>;

  /**
   * Write the rows **and** the cursor, in **one** transaction.
   *
   * This is the crash-safety requirement, and it is not optional. If the
   * rows were written and the cursor advanced in two transactions, a
   * crash between them would replay the events — and a replay that
   * accumulated would double every figure. One transaction means the
   * crash leaves either both or neither.
   *
   * checklist 02 trap 4: "Putting state changes and event appends in
   * separate transactions. They must be one. Otherwise I-3 ... is false
   * under crash."
   *
   * The keys are **namespaced** — `"<projection> <key>"` — so one
   * transaction can carry every projection's writes.
   *
   * `lastSeq` is the cursor's new position, and the store writes it
   * through **its own** cursor store, in the same transaction as the
   * rows. The projector therefore does not advance the cursor itself:
   * that would be a second write, outside the transaction, and the crash
   * window would reopen.
   */
  commit(input: {
    readonly name: string;
    readonly upserts: readonly { readonly key: string; readonly row: unknown }[];
    readonly removals: readonly string[];
    readonly states: Readonly<Record<string, unknown>>;
    readonly lastSeq: number;
  }): Promise<void>;

  /** Drop every row of a projection. */
  drop(name: string): Promise<void>;
}

/**
 * The cursor store.
 *
 * The cursor is the projector's position in the log. It is **durable**
 * (pack `02` §4.18: "a projector … tails `events` by `seq` with a
 * durable cursor"), so it lives in the database — `projection_cursors`,
 * which the pack already declares and grants to `factory_projector`.
 */
export interface CursorStore {
  /** The cursor's position, or `0` when the projector has never run. */
  lastSeq(name: string): Promise<number>;

  /**
   * Advance the cursor.
   *
   * The Postgres implementation writes it **inside** the store's
   * transaction, so the rows and the cursor commit together. This method
   * exists for the case where there is nothing to write — a batch that
   * changed no rows still moves the cursor forward.
   */
  advance(name: string, lastSeq: number): Promise<void>;

  /** Reset the cursor to zero. */
  reset(name: string): Promise<void>;
}
