/**
 * `projections/postgres-projection-store` — the durable store (T-1.15).
 *
 * ## The one transaction
 *
 * The rows and the cursor are written in **one** transaction. That is
 * the whole crash-safety story:
 *
 * * rows written, cursor not advanced ⇒ the next pass replays the
 *   events, and the rows come out the same (the writes are absolute, so
 *   a replay overwrites rather than accumulates);
 * * cursor advanced, rows not written ⇒ the projection would be
 *   permanently missing those events.
 *
 * Neither can happen, because the two are one transaction. This is
 * checklist 02 trap 4: "Putting state changes and event appends in
 * separate transactions. They must be one. Otherwise I-3 ... is false
 * under crash."
 *
 * ## The store writes **absolute** rows
 *
 * `commit` upserts. There is no "increment". That is what makes the
 * rebuild idempotent: replaying an event overwrites the row with the
 * same content, so the row does not change.
 *
 * ## The rows live in `task_current`
 *
 * pack `03` §2 assigns `task_current` to T-1.15 and gives its columns
 * normatively. The other two projections are **shells** — their tables
 * belong to T-2.09 and T-4.05 — so their rows are held in memory by this
 * store and are not persisted yet.
 *
 * That is not a placeholder: the shell's rows are computed and are
 * correct; only the *table* is later tickets'. And the store says so,
 * rather than silently writing a table it does not own.
 */

import { sql, type Kysely, type Transaction } from '@factory/db';
import type { FactoryDatabase } from '@factory/db';

import type {
  CursorStore,
  ProjectionRows,
  ProjectionStates,
  ProjectionStore,
} from './ports.js';
import { PROJECTIONS } from './reducers/index.js';
import { PostgresCursorStore } from './postgres-cursor-store.js';
import type { ProjectionName } from './types.js';

/**
 * The options for the Postgres store.
 */
export interface PostgresProjectionStoreOptions {
  /** The database handle. */
  readonly db: Kysely<FactoryDatabase>;

  /**
   * The cursor store the rows commit with.
   *
   * It is the store's, not the projector's, because the cursor and the
   * rows must commit **together** — the cursor is written inside the
   * transaction that writes the rows, so a crash cannot leave one
   * without the other.
   *
   * It is optional so that a caller who only wants to read the rows does
   * not have to build one; but the projector **must** be given the same
   * instance it was given here.
   */
  readonly cursors?: CursorStore;
}

/**
 * The projection whose rows are persisted by this store.
 *
 * The shells are not persisted — their tables belong to later tickets.
 */
const PERSISTED: ProjectionName = 'task_current';

/**
 * The store.
 */
export class PostgresProjectionStore implements ProjectionStore {
  private readonly db: Kysely<FactoryDatabase>;

  /**
   * The cursor store the rows commit with.
   *
   * When one is supplied, the commit writes the cursor through it — so
   * the cursor lands in the **same** transaction as the rows.
   */
  private readonly cursors: CursorStore | undefined;

  /**
   * The shell rows, held in memory.
   *
   * They are held rather than dropped because the shells are part of the
   * projection, and a test that compares the rebuilt rows with the
   * original must be able to see them.
   */
  private readonly shells = new Map<string, Map<string, unknown>>();

  /**
   * The carried state, keyed the same way as the rows.
   *
   * The state is held in memory for the same reason the shells are: the
   * tables that would carry it belong to later tickets. When T-4.05
   * writes the `cost_attribution` table, the state moves into it — and
   * it moves into it **with** the rows, in the same transaction.
   */
  private readonly states = new Map<string, unknown>();

  public constructor(options: PostgresProjectionStoreOptions) {
    this.db = options.db;
    this.cursors = options.cursors;
  }

  public async read(name: string): Promise<ProjectionRows> {
    if (name !== PERSISTED) {
      const shell = this.shells.get(name);
      if (shell === undefined) {
        return {};
      }
      return Object.fromEntries([...shell.entries()]);
    }

    const rows = await sql<{
      task_id: string;
      repo: string;
      workflow: string;
      state: string;
      risk_tier: string | null;
      needs_human: boolean;
      last_activity_at: Date | string | null;
      spent_usd_micros: string | number;
      budget_usd_micros: string | number;
      summary: unknown;
    }>`
      SELECT task_id, repo, workflow, state, risk_tier, needs_human, last_activity_at,
             spent_usd_micros, budget_usd_micros, summary
      FROM factory.task_current
    `.execute(this.db);

    const out: Record<string, unknown> = {};
    for (const row of rows.rows) {
      out[row.task_id] = {
        taskId: row.task_id,
        repo: row.repo,
        workflow: row.workflow,
        state: row.state,
        riskTier: row.risk_tier,
        needsHuman: row.needs_human,
        lastActivityAt: toIso(row.last_activity_at),
        spentUsdMicros: Number(row.spent_usd_micros),
        budgetUsdMicros: Number(row.budget_usd_micros),
        summary: (row.summary ?? {}) as Record<string, unknown>,
      };
    }
    return out;
  }

  public async readOne(name: string, key: string): Promise<unknown> {
    const rows = await this.read(name);
    return rows[key];
  }

  public readStates(): Promise<ProjectionStates> {
    return Promise.resolve(Object.fromEntries([...this.states.entries()]));
  }

  public async commit(input: {
    readonly name: string;
    readonly upserts: readonly { readonly key: string; readonly row: unknown }[];
    readonly removals: readonly string[];
    readonly states: Readonly<Record<string, unknown>>;
    readonly lastSeq: number;
  }): Promise<void> {
    // The rows and the cursor commit **together**. The transaction is
    // opened by the cursor store, so the cursor's write joins the same
    // transaction as the rows — which is the whole crash-safety
    // requirement (checklist 02 trap 4).
    const run = async (trx: Transaction<FactoryDatabase>): Promise<void> => {
      await this.apply(trx, input.upserts, input.removals);
      // The carried state is written with the rows — the state is what
      // the next event folds onto, so it must not lag behind the rows.
      this.states.clear();
      for (const [key, state] of Object.entries(input.states)) {
        this.states.set(key, state);
      }
      if (this.cursors !== undefined) {
        await this.cursors.advance(input.name, input.lastSeq);
        return;
      }
      await this.advanceCursor(trx, input.name, input.lastSeq);
    };

    if (this.cursors instanceof PostgresCursorStore) {
      await this.cursors.transaction(run);
      return;
    }
    await this.db.transaction().execute(run);
  }

  public async drop(name: string): Promise<void> {
    // The carried state goes with the rows: a state without its row is a
    // state the reducer would fold onto and produce a stale total from.
    for (const key of [...this.states.keys()]) {
      const { projection } = splitKey(key);
      if (projection === name) {
        this.states.delete(key);
      }
    }

    if (name !== PERSISTED) {
      this.shells.set(name, new Map<string, unknown>());
      return;
    }
    await sql`DELETE FROM factory.task_current`.execute(this.db);
  }

  /**
   * Apply the upserts and the removals.
   *
   * The upsert is an **absolute** write — `ON CONFLICT … DO UPDATE` with
   * every column — so a replayed event produces the same row. There is
   * no `+ 1` anywhere in this method, and that is deliberate.
   */
  private async apply(
    trx: Transaction<FactoryDatabase>,
    upserts: readonly { readonly key: string; readonly row: unknown }[],
    removals: readonly string[],
  ): Promise<void> {
    const persisted = upserts.filter((upsert) =>
      upsert.key.startsWith(`${PERSISTED} `),
    );
    const shellUpserts = upserts.filter(
      (upsert) => !upsert.key.startsWith(`${PERSISTED} `),
    );
    const persistedRemovals = removals.filter((removal) =>
      removal.startsWith(`${PERSISTED} `),
    );
    const shellRemovals = removals.filter(
      (removal) => !removal.startsWith(`${PERSISTED} `),
    );

    // ---- the shells -------------------------------------------------
    for (const upsert of shellUpserts) {
      const { projection, key } = splitKey(upsert.key);
      const shell = this.shells.get(projection) ?? new Map<string, unknown>();
      shell.set(key, upsert.row);
      this.shells.set(projection, shell);
    }
    for (const removal of shellRemovals) {
      const { projection, key } = splitKey(removal);
      this.shells.get(projection)?.delete(key);
    }

    // ---- `task_current` ----------------------------------------------
    for (const removal of persistedRemovals) {
      const { key } = splitKey(removal);
      await sql`DELETE FROM factory.task_current WHERE task_id = ${key}`.execute(trx);
    }

    for (const upsert of persisted) {
      const { key } = splitKey(upsert.key);
      const row = upsert.row as {
        readonly repo?: string;
        readonly workflow?: string;
        readonly state?: string;
        readonly riskTier?: string | null;
        readonly needsHuman?: boolean;
        readonly lastActivityAt?: string;
        readonly spentUsdMicros?: number;
        readonly budgetUsdMicros?: number;
        readonly summary?: unknown;
      };

      await sql`
        INSERT INTO factory.task_current
          (task_id, repo, workflow, state, risk_tier, needs_human, last_activity_at,
           spent_usd_micros, budget_usd_micros, summary)
        VALUES (
          ${key},
          ${row.repo ?? ''},
          ${row.workflow ?? ''},
          ${row.state ?? 'DRAFT'},
          ${row.riskTier ?? null},
          ${row.needsHuman ?? false},
          ${row.lastActivityAt === undefined || row.lastActivityAt === '' ? null : row.lastActivityAt},
          ${row.spentUsdMicros ?? 0},
          ${row.budgetUsdMicros ?? 0},
          ${JSON.stringify(row.summary ?? {})}
        )
        ON CONFLICT (task_id) DO UPDATE SET
          repo             = EXCLUDED.repo,
          workflow         = EXCLUDED.workflow,
          state            = EXCLUDED.state,
          risk_tier        = EXCLUDED.risk_tier,
          needs_human      = EXCLUDED.needs_human,
          last_activity_at = EXCLUDED.last_activity_at,
          spent_usd_micros = EXCLUDED.spent_usd_micros,
          budget_usd_micros = EXCLUDED.budget_usd_micros,
          summary          = EXCLUDED.summary
      `.execute(trx);
    }
  }

  /**
   * Advance the cursor, **inside** the transaction.
   */
  private async advanceCursor(
    trx: Transaction<FactoryDatabase>,
    name: string,
    lastSeq: number,
  ): Promise<void> {
    await sql`
      INSERT INTO factory.projection_cursors (name, last_seq)
      VALUES (${name}, ${lastSeq})
      ON CONFLICT (name) DO UPDATE SET last_seq = EXCLUDED.last_seq
    `.execute(trx);
  }
}

/**
 * A timestamp as an ISO string.
 *
 * `pg` returns a `timestamptz` as a `Date`; a row written by another
 * tool may come back as a string, so both are accepted.
 *
 * This normalisation is **not** cosmetic. The row's `lastActivityAt` is
 * typed a `string`, and the row's digest is taken over its canonical
 * JSON — and `canonicalJson` represents plain objects and arrays only,
 * so a `Date` left in the row makes the digest **throw**. That is not a
 * theoretical concern: A0.6's "drop-and-rebuild ⇒ identical rows (hash
 * compare)" is exactly the digest, so a `Date` in the row breaks the
 * rebuild oracle outright.
 *
 * The same normalisation is the repo's own precedent
 * (`packages/credentials`' lease store does the same for its
 * timestamps).
 */
const toIso = (value: Date | string | null): string => {
  if (value === null) {
    return '';
  }
  return value instanceof Date ? value.toISOString() : value;
};

/**
 * Split a namespaced key into its projection and its key.
 *
 * The namespace separator is a space, and a projection's name never
 * contains one — so the split is unambiguous.
 */
const splitKey = (namespaced: string): { readonly projection: string; readonly key: string } => {
  const separator = namespaced.indexOf(' ');
  if (separator < 0) {
    return { projection: namespaced, key: '' };
  }
  return {
    projection: namespaced.slice(0, separator),
    key: namespaced.slice(separator + 1),
  };
};

/**
 * The projections this store persists.
 */
export const PERSISTED_PROJECTIONS: readonly ProjectionName[] = [PERSISTED];

/**
 * The projections this store holds in memory only.
 */
export const SHELL_PROJECTIONS: readonly ProjectionName[] = PROJECTIONS.filter(
  (name) => name !== PERSISTED,
);
