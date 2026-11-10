/**
 * `artefacts` — the **local spool**.
 *
 * pack 04 INT-08: "S3-compatible object store | … | `artefact.write` |
 * T-1.11 | **spool locally, then fail stage**."
 *
 * ## What the spool is for
 *
 * When the object store is down, the record's bytes must not be lost —
 * the run happened, and its artefact is the only record of it. So the
 * bytes are written to a **local spool**, and the stage **fails**.
 *
 * The spool is **not** a way to keep going. A record that is "written" to
 * the spool but reported as stored would be a lie the factory would later
 * audit and find: the run would be marked complete with an artefact that
 * the object store does not hold.
 *
 * ## Why the spool is **not** a plain file
 *
 * It could be. But the spool has to be **testable without a filesystem**,
 * and it has to behave identically in the acceptance test and in the unit
 * test. So the spool is a **port** (`ports.ts`) with two implementations:
 * this one — an in-memory double — and the local-disk one, which is a
 * later ticket's business (the factory's own runtime needs a real spool
 * that survives the process).
 *
 * This module is therefore the in-memory spool: the double, and the
 * double is the oracle.
 */

import type { Spool } from './ports.js';

/**
 * The in-memory spool.
 *
 * The bytes are copied on the way in and on the way out, so a caller that
 * mutates the buffer it passed cannot change what is spooled — and a
 * caller that mutates the buffer it got back cannot change what will be
 * written later.
 */
export class InMemorySpool implements Spool {
  readonly #entries = new Map<string, Uint8Array>();

  /**
   * Spool an object's bytes.
   */
  public spool(key: string, bytes: Uint8Array): Promise<void> {
    this.#entries.set(key, new Uint8Array(bytes));
    return Promise.resolve();
  }

  /**
   * The bytes spooled under a key.
   */
  public peek(key: string): Promise<Uint8Array | undefined> {
    const bytes = this.#entries.get(key);
    return Promise.resolve(bytes === undefined ? undefined : new Uint8Array(bytes));
  }

  /**
   * The keys currently spooled, in sorted order.
   */
  public keys(): Promise<readonly string[]> {
    return Promise.resolve([...this.#entries.keys()].sort());
  }

  /**
   * Discard a spooled object.
   *
   * Discarding an absent object is not an error — the spool is a queue,
   * and a queue may be drained twice.
   */
  public discard(key: string): Promise<void> {
    this.#entries.delete(key);
    return Promise.resolve();
  }

  /**
   * The number of objects spooled.
   */
  public get size(): number {
    return this.#entries.size;
  }
}
