/**
 * `projections/projector` — the loop (T-1.15).
 *
 * ## What this file is
 *
 * The projector: read the log from where the cursor is, reduce each
 * event into the projections' rows, write the rows **and** the cursor in
 * **one** transaction.
 *
 * pack `02` §4.18: "A **projector** (worker) tails `events` by `seq` with
 * a durable cursor (woken by `LISTEN`), maintaining: `task_current`,
 * `review_queue`, …"
 *
 * ## One cursor, not one per projection
 *
 * The pack says "**a** durable cursor" — singular. And the pack's
 * `projection_cursors` table is keyed by `name`, which lets several
 * projectors share the table without sharing a position.
 *
 * So the projector has **one** cursor, under one name, and it advances
 * past every event it reads. The projections are **views** over the same
 * log, and they are read at the same position — so they cannot disagree
 * about which events they have seen.
 *
 * ## The one rule that makes the rebuild work
 *
 * A0.6: "every projection can be dropped and rebuilt identically".
 *
 * The rebuild replays the whole log. So the projector must be a **fold**
 * over the log, and every write it makes must be an **absolute**
 * assignment — never an accumulation. That is why:
 *
 * * `ProjectionStore.commit` takes `upserts` and `removals`, not
 *   "increments";
 * * the reducers compute the row's whole content from the event and the
 *   previous row, and the `cost_attribution` reducer keys its
 *   contributions by the **event's id**, so a replayed event overwrites
 *   its own contribution instead of adding a second one.
 *
 * ## The cursor advances past every event **read**
 *
 * A read that returns events the projector then skips — because they
 * belong to no projection — still advances the cursor. If the cursor
 * stopped at the last *applied* event, the projector would re-read the
 * skipped events on every pass, forever.
 *
 * So the cursor tracks the log's position, and the projections' content
 * is a function of the events **up to** that position. A rebuild from
 * zero therefore reproduces the same content.
 *
 * ## The batch is committed whole
 *
 * The projector reads in batches. The batch size is a parameter, not a
 * constant, because a test wants a small one and the production loop
 * wants a large one. What is *not* a parameter is the guarantee: a batch
 * is committed in **one** transaction, together with the cursor, so the
 * cursor never points past an uncommitted event and a crash cannot leave
 * the rows written and the cursor behind.
 */

import type { EventEnvelope } from '@factory/contracts';

import type { CursorStore, EventSource, ProjectionStore } from './ports.js';
import { PROJECTIONS, reducerFor, type ProjectionEffect } from './reducers/index.js';
import type { ProjectionName } from './types.js';

/**
 * The default number of events a pass reads.
 */
export const DEFAULT_BATCH_SIZE = 500;

/**
 * The projector's cursor name.
 *
 * The cursor is the **projector's**, not a projection's — the projections
 * are views over the same position in the log.
 */
export const PROJECTOR_CURSOR = 'projector';

/**
 * The projector's dependencies.
 *
 * `cursors` **is** the store's cursor store. The projector reads the
 * cursor from it, and the store writes it — inside the same transaction
 * as the rows. So they must be one object: if they were two, the cursor
 * the projector reads and the cursor the store writes could be two
 * different positions, and the projector would loop over the same
 * events forever.
 *
 * The two are passed separately because the projector's *read* of the
 * cursor and the store's *write* of it are different operations, and
 * saying so in the signature is what stops the two from drifting.
 */
export interface ProjectorDeps {
  /** The log the projector reads. */
  readonly events: EventSource;
  /** The store the rows live in. */
  readonly store: ProjectionStore;
  /** The cursor store — the same one the store commits with. */
  readonly cursors: CursorStore;
}

/**
 * What one pass did.
 */
export interface ProjectorPass {
  /** How many events were read. */
  readonly read: number;
  /** The cursor's position after the pass. */
  readonly lastSeq: number;
  /** How many rows were written. */
  readonly upserts: number;
  /** How many rows were removed. */
  readonly removals: number;
  /** The projections that were advanced. */
  readonly projections: readonly ProjectionName[];
}

/**
 * The pending writes for one projection.
 */
interface Pending {
  readonly upserts: Map<string, unknown>;
  readonly removals: Set<string>;
}

/**
 * An empty pending set.
 */
const emptyPending = (): Pending => ({
  upserts: new Map<string, unknown>(),
  removals: new Set<string>(),
});

/**
 * The projector.
 */
export class Projector {
  private readonly deps: ProjectorDeps;

  private readonly batchSize: number;

  public constructor(deps: ProjectorDeps, batchSize: number = DEFAULT_BATCH_SIZE) {
    this.deps = deps;
    this.batchSize = batchSize;
  }

  /**
   * Run one pass — read a batch and apply it.
   *
   * A pass that reads nothing is a no-op: no transaction is opened, and
   * the cursor is left where it is.
   */
  public async pass(): Promise<ProjectorPass> {
    const lastSeq = await this.deps.cursors.lastSeq(PROJECTOR_CURSOR);

    const events = await this.deps.events.read(lastSeq, this.batchSize);
    if (events.length === 0) {
      return {
        read: 0,
        lastSeq,
        upserts: 0,
        removals: 0,
        projections: [],
      };
    }

    // The pending writes, per projection.
    const pending = new Map<ProjectionName, Pending>();
    for (const name of PROJECTIONS) {
      pending.set(name, emptyPending());
    }

    // The rows each projection currently holds, so a reducer can see the
    // row it is replacing. They are read **once** per pass and updated
    // in memory as the batch is applied, so each event in the batch is
    // reduced against the state the *previous* event in the batch left.
    const current = new Map<ProjectionName, Record<string, unknown>>();
    for (const name of PROJECTIONS) {
      current.set(name, { ...(await this.deps.store.read(name)) });
    }

    // The **carried state** — the reducer's own bookkeeping, which is not
    // a row. For `cost_attribution` it is the bucket's contributions,
    // from which the totals are derived. It is read from the store, so
    // a projector that restarts folds onto the state the previous run
    // left, rather than starting the bucket afresh.
    const states: Record<string, unknown> = { ...(await this.deps.store.readStates()) };

    let lastApplied = lastSeq;

    for (const event of events) {
      const envelope = toEnvelope(event);

      for (const name of PROJECTIONS) {
        const reducer = reducerFor(name);
        const key = reducer.keyOf(envelope);
        if (key === undefined) {
          // The event does not belong to this projection.
          continue;
        }

        const rows = current.get(name) ?? {};
        const carried = states[`${name} ${key}`];

        // The reducer folds onto the **carried state** when the
        // projection has one, and onto the row otherwise. A projection
        // whose state *is* its row uses the row.
        const base = carried === undefined ? rows[key] : carried;

        const effect: ProjectionEffect = reducer.reduce(base, envelope);
        const target = pending.get(name) ?? emptyPending();

        if (effect.kind === 'none') {
          continue;
        }

        if (effect.kind === 'upsert') {
          target.upserts.set(effect.key, effect.row);
          target.removals.delete(effect.key);
          rows[effect.key] = effect.row;
          states[`${name} ${effect.key}`] = effect.state;
        } else {
          target.removals.add(effect.key);
          target.upserts.delete(effect.key);
          delete rows[effect.key];
          delete states[`${name} ${effect.key}`];
        }

        pending.set(name, target);
      }

      // The cursor advances for **every** event read, not only the ones
      // a projection claimed. See the file header.
      lastApplied = event.seq;
    }

    // ---- the write ---------------------------------------------------
    //
    // One transaction, carrying every projection's rows **and** the
    // cursor. The store's `commit` does all of it in one transaction, so
    // a crash cannot leave the rows written and the cursor behind — and
    // cannot leave the cursor advanced and the rows behind, either.
    let upserts = 0;
    let removals = 0;

    const allUpserts: { readonly key: string; readonly row: unknown }[] = [];
    const allRemovals: string[] = [];

    for (const name of PROJECTIONS) {
      const target = pending.get(name) ?? emptyPending();
      for (const [key, row] of target.upserts) {
        allUpserts.push({ key: `${name} ${key}`, row });
      }
      for (const key of target.removals) {
        allRemovals.push(`${name} ${key}`);
      }
      upserts += target.upserts.size;
      removals += target.removals.size;
    }

    await this.deps.store.commit({
      name: PROJECTOR_CURSOR,
      upserts: allUpserts,
      removals: allRemovals,
      states,
      lastSeq: lastApplied,
    });

    return {
      read: events.length,
      lastSeq: lastApplied,
      upserts,
      removals,
      projections: PROJECTIONS,
    };
  }

  /**
   * Run passes until the log is exhausted.
   *
   * The loop stops when a pass reads nothing. A pass that reads a full
   * batch might have more behind it, so the loop continues.
   */
  public async catchUp(maxPasses = 1000): Promise<readonly ProjectorPass[]> {
    const passes: ProjectorPass[] = [];
    for (let index = 0; index < maxPasses; index += 1) {
      const pass = await this.pass();
      passes.push(pass);
      if (pass.read === 0) {
        return passes;
      }
    }
    return passes;
  }
}

/**
 * Coerce a log row into the contracts' `EventEnvelope`.
 *
 * The `EventSource` port returns a **structural** subset of the
 * envelope, because the port must not depend on the contracts' full
 * Zod-inferred type. So the projector narrows it here — once, in one
 * place — rather than casting at every use.
 *
 * The cast is sound because the port's shape *is* the envelope's shape
 * for the fields the projector reads.
 */
const toEnvelope = (event: {
  readonly seq: number;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly eventType: string;
  readonly aggregate: { readonly kind: string; readonly id: string; readonly version: number };
  readonly correlationId: string;
  readonly actor: { readonly kind: string; readonly id: string };
  readonly authority: Readonly<Record<string, unknown>>;
  readonly subject: Readonly<Record<string, unknown>>;
  readonly payload: unknown;
  readonly context: Readonly<Record<string, unknown>>;
  readonly redaction: { readonly applied: readonly string[] };
  readonly costUsdMicros?: number;
  readonly durationMs?: number;
}): EventEnvelope =>
  event as unknown as EventEnvelope;
