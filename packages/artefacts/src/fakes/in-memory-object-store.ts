/**
 * `artefacts` — the in-memory object store.
 *
 * ## Why this double is the oracle
 *
 * The S3 adapter's *shape* — the key, the URI, the error taxonomy — is
 * proved against this double, and against the **injected transport** in
 * the adapter's own test. The double is what lets the store's rules
 * (atomic with the outcome, the spool-then-fail path, the incremental
 * write) be exercised without a network and without a bucket.
 *
 * ## It can be made to fail
 *
 * The double has an **outage switch**: when it is on, every write
 * throws. That is how the spool-then-fail path is proved — the run's
 * bytes are spooled, the stage fails, and no completed row appears.
 *
 * It also **records** every call, so a test can assert that the purge job
 * deleted an object rather than merely claiming to.
 */

import { ObjectStoreError, type ObjectLocation, type ObjectStore } from '../ports.js';

/**
 * The options for an {@link InMemoryObjectStore}.
 */
export interface InMemoryObjectStoreOptions {
  /** The bucket name the URIs carry. */
  readonly bucket?: string;
}

/**
 * The in-memory object store.
 */
export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, Uint8Array>();

  /** The bucket name the URIs carry. */
  public readonly bucket: string;

  /** Whether the store is refusing writes. */
  public outage = false;

  /** The keys written, in order. */
  public readonly puts: string[] = [];

  /** The keys deleted, in order. */
  public readonly deletes: string[] = [];

  constructor(options: InMemoryObjectStoreOptions = {}) {
    this.bucket = options.bucket ?? 'factory-artifacts';
  }

  /**
   * Put an object's bytes.
   *
   * @throws {ObjectStoreError} when the store is in outage.
   */
  public put(key: string, bytes: Uint8Array): Promise<ObjectLocation> {
    if (this.outage) {
      throw new ObjectStoreError(`the object store is unavailable (writing "${key}")`);
    }
    this.#objects.set(key, new Uint8Array(bytes));
    this.puts.push(key);
    return Promise.resolve({ key, uri: `s3://${this.bucket}/${key}` });
  }

  /**
   * Get an object's bytes.
   */
  public get(key: string): Promise<Uint8Array | undefined> {
    const bytes = this.#objects.get(key);
    return Promise.resolve(bytes === undefined ? undefined : new Uint8Array(bytes));
  }

  /**
   * Delete an object's bytes.
   */
  public delete(key: string): Promise<void> {
    this.#objects.delete(key);
    this.deletes.push(key);
    return Promise.resolve();
  }

  /**
   * The keys the store holds, in sorted order.
   */
  public keys(): readonly string[] {
    return [...this.#objects.keys()].sort();
  }

  /**
   * The number of objects the store holds.
   */
  public get size(): number {
    return this.#objects.size;
  }
}
