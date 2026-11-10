/**
 * `projections/scratch-store` — the in-memory row store (T-1.15).
 *
 * ## What this file is
 *
 * An in-memory `ProjectionStore`. It is used in two places:
 *
 * * the **rebuild's safe form** — the replay is projected into a scratch
 *   store so the live rows are not disturbed while they are being
 *   compared;
 * * the **tests**, as the double the Postgres store must agree with.
 *
 * So it is in the package proper and not in `fakes/`, because the
 * rebuild depends on it.
 *
 * ## The commit is **atomic**
 *
 * `commit` applies the upserts and the removals and only then — and it
 * applies them to a **copy**. So a store that throws part-way through
 * leaves the store exactly as it was, which is what "the rows and the
 * cursor commit together" means for an in-memory double.
 *
 * ## The store **owns** its cursor store
 *
 * The rows and the cursor must commit **together** — that is the
 * crash-safety requirement (checklist 02 trap 4). So the store holds a
 * `CursorStore` and writes the cursor through it as part of the same
 * atomic step.
 *
 * The in-memory cursor store's `advance` is the last thing the commit
 * does, and it happens **after** the rows are swapped in. If the rows
 * could not be applied, the cursor is not advanced — which is exactly
 * the state a crash between the two writes would leave, and exactly the
 * state the projector is designed to recover from by replaying.
 *
 * So the in-memory double is not a weaker version of the Postgres one:
 * it has the same ordering, and therefore the same recovery.
 */

import type {
  CursorStore,
  ProjectionRows,
  ProjectionStates,
  ProjectionStore,
} from './ports.js';

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
 * An in-memory cursor store.
 *
 * The same shape as the fakes' `InMemoryCursorStore`, but declared here
 * because the store needs one and the fakes' copy would make the
 * package's own dependency point at its test doubles.
 */
export class InMemoryCursorPositions implements CursorStore {
  private readonly positions = new Map<string, number>();

  public lastSeq(name: string): Promise<number> {
    return Promise.resolve(this.positions.get(name) ?? 0);
  }

  public advance(name: string, lastSeq: number): Promise<void> {
    this.positions.set(name, lastSeq);
    return Promise.resolve();
  }

  public reset(name: string): Promise<void> {
    this.positions.set(name, 0);
    return Promise.resolve();
  }

  /**
   * The cursor's position, for a test's own assertions.
   */
  public positionOf(name: string): number {
    return this.positions.get(name) ?? 0;
  }
}

/**
 * An in-memory projection store.
 */
export class InMemoryProjectionStore implements ProjectionStore {
  private readonly rows = new Map<string, Map<string, unknown>>();

  /**
   * The carried state, keyed the same way as the rows.
   *
   * It is written in the same commit as the rows, so a restart cannot
   * find the rows without the state they were derived from.
   */
  private readonly states = new Map<string, unknown>();

  /**
   * The cursor store the rows commit with.
   *
   * The store **owns** it, because the cursor and the rows must commit
   * together. A caller that wanted a different cursor store passes one
   * in the constructor.
   */
  private readonly cursors: CursorStore;

  /**
   * How many commits have been made.
   *
   * A test asserts that a crash-free run commits **once** per batch, so
   * the counter is part of the observable behaviour rather than a
   * debugging aid.
   */
  public commits = 0;

  public constructor(cursors: CursorStore = new InMemoryCursorPositions()) {
    this.cursors = cursors;
  }

  /**
   * The cursor store this store commits with.
   */
  public get cursorStore(): CursorStore {
    return this.cursors;
  }

  public read(name: string): Promise<ProjectionRows> {
    const projection = this.rows.get(name);
    if (projection === undefined) {
      return Promise.resolve({});
    }
    return Promise.resolve(
      Object.fromEntries([...projection.entries()].map(([k, v]) => [k, v])),
    );
  }

  public readOne(name: string, key: string): Promise<unknown> {
    return Promise.resolve(this.rows.get(name)?.get(key));
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
    // The projections are copied, mutated, and swapped in — so a failure
    // part-way through leaves the store untouched.
    const next = new Map(this.rows);

    for (const removal of input.removals) {
      const { projection, key } = splitKey(removal);
      const rows = next.get(projection);
      if (rows !== undefined) {
        const copied = new Map(rows);
        copied.delete(key);
        next.set(projection, copied);
      }
    }
    for (const upsert of input.upserts) {
      const { projection, key } = splitKey(upsert.key);
      const rows = new Map(next.get(projection) ?? []);
      rows.set(key, upsert.row);
      next.set(projection, rows);
    }

    this.rows.clear();
    for (const [name, rows] of next.entries()) {
      this.rows.set(name, rows);
    }

    // The carried state is written **with** the rows — the state is what
    // the next event folds onto, so it must not lag behind the rows.
    this.states.clear();
    for (const [key, state] of Object.entries(input.states)) {
      this.states.set(key, state);
    }

    // The cursor is advanced **after** the rows are in place — the same
    // order the Postgres store uses inside its transaction.
    await this.cursors.advance(input.name, input.lastSeq);

    this.commits += 1;
  }

  public drop(name: string): Promise<void> {
    this.rows.set(name, new Map<string, unknown>());
    // The carried state goes with the rows: a state without its row is a
    // state the reducer would fold onto and produce a stale total from.
    for (const key of [...this.states.keys()]) {
      const { projection } = splitKey(key);
      if (projection === name) {
        this.states.delete(key);
      }
    }
    return Promise.resolve();
  }

  /**
   * The cursor's position, for the store's own bookkeeping.
   */
  public cursorOf(name: string): number {
    return this.cursors instanceof InMemoryCursorPositions ? this.cursors.positionOf(name) : 0;
  }
}

/**
 * A store that is thrown away after the rebuild.
 *
 * It is the same in-memory store, under a name that says what it is for.
 */
export class ScratchStore extends InMemoryProjectionStore {}
