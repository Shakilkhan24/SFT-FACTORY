/**
 * `projections/postgres-cursor-store` — the durable cursor (T-1.15).
 *
 * pack `02` §4.18: "a projector … tails `events` by `seq` with a
 * **durable cursor**".
 *
 * The cursor lives in `projection_cursors`, which pack `03` §2 already
 * declares and grants to `factory_projector`:
 *
 * ```sql
 * GRANT SELECT, INSERT, UPDATE ON projection_cursors TO factory_projector;
 * ```
 *
 * So the table is the pack's, not this ticket's — and the grant says
 * exactly what the projector may do with it: read it, insert it, update
 * it. It may **not** delete it, and it may not write the log.
 */

import { sql, type Kysely, type Transaction } from '@factory/db';
import type { FactoryDatabase } from '@factory/db';

import type { CursorStore } from './ports.js';

/**
 * The Postgres cursor store.
 */
export class PostgresCursorStore implements CursorStore {
  private readonly db: Kysely<FactoryDatabase>;

  /**
   * The transaction the writes go through, when there is one.
   *
   * The cursor and the rows must commit **together**, so the store's
   * transaction hands its transaction to the cursor store, and the
   * cursor's write joins the same transaction. Without it, the cursor
   * would be a second, separate write — and the crash window would
   * reopen.
   */
  private trx: Transaction<FactoryDatabase> | undefined;

  public constructor(db: Kysely<FactoryDatabase>) {
    this.db = db;
  }

  /**
   * Run the callback inside a transaction, with the cursor store's
   * writes bound to it.
   *
   * The bound transaction is **released** when the transaction ends —
   * including when it throws — so a later write cannot accidentally join
   * a finished transaction.
   */
  public async transaction<T>(
    run: (trx: Transaction<FactoryDatabase>) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      this.trx = trx;
      try {
        return await run(trx);
      } finally {
        this.trx = undefined;
      }
    });
  }

  public async lastSeq(name: string): Promise<number> {
    const rows = await sql<{ last_seq: string | number }>`
      SELECT last_seq FROM factory.projection_cursors WHERE name = ${name}
    `.execute(this.db);

    const row = rows.rows[0];
    if (row === undefined) {
      // A cursor that has never been written is at the **start** of the
      // log. The log's `seq` starts at 1, and `afterSeq` is exclusive,
      // so 0 means "the first event".
      return 0;
    }
    return Number(row.last_seq);
  }

  public async advance(name: string, lastSeq: number): Promise<void> {
    await sql`
      INSERT INTO factory.projection_cursors (name, last_seq)
      VALUES (${name}, ${lastSeq})
      ON CONFLICT (name) DO UPDATE SET last_seq = EXCLUDED.last_seq
    `.execute(this.trx ?? this.db);
  }

  public async reset(name: string): Promise<void> {
    await sql`
      INSERT INTO factory.projection_cursors (name, last_seq)
      VALUES (${name}, 0)
      ON CONFLICT (name) DO UPDATE SET last_seq = 0
    `.execute(this.trx ?? this.db);
  }
}
