/**
 * `runtime/fakes/in-memory-lease-store` — the in-memory lease store.
 *
 * The lease store's one load-bearing semantic is the **once-ness** of the
 * re-queue: pack `02` §4.8 says "the reaper re-queues expired leases
 * (`node.leased → ready`)", and a lease released twice would run the node
 * twice. So `release` removes the lease and reports whether it was the one
 * that removed it.
 */

import type { LeaseStore, NodeLease } from '../ports.js';

/**
 * The in-memory lease store.
 */
export class InMemoryLeaseStore implements LeaseStore {
  readonly #leases = new Map<string, NodeLease>();
  /** The release calls, in order. */
  readonly released: NodeLease[] = [];

  /** Add a lease. */
  public add(lease: NodeLease): void {
    this.#leases.set(this.#key(lease), lease);
  }

  /** Remove a lease without going through `release` — for a test's setup. */
  public drop(lease: NodeLease): void {
    this.#leases.delete(this.#key(lease));
  }

  public liveLeases(taskId: string): Promise<readonly NodeLease[]> {
    return Promise.resolve(
      [...this.#leases.values()].filter((lease) => lease.taskId === taskId),
    );
  }

  public release(lease: NodeLease): Promise<{ readonly released: boolean }> {
    this.released.push(lease);
    const key = this.#key(lease);
    if (!this.#leases.has(key)) {
      // Already released. The re-queue happens **once**.
      return Promise.resolve({ released: false });
    }
    this.#leases.delete(key);
    return Promise.resolve({ released: true });
  }

  /** Every live lease, for a test to inspect. */
  public all(): readonly NodeLease[] {
    return [...this.#leases.values()];
  }

  #key(lease: NodeLease): string {
    return `${lease.taskId}:${lease.nodeId}:${String(lease.attempt)}`;
  }
}
