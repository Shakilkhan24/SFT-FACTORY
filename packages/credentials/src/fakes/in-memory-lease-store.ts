/**
 * `credentials` — the in-memory lease store.
 *
 * AGENTS.md §4: fakes live in `packages/{package}/fakes` and pass the same
 * contract tests as the real thing.
 *
 * The store is where the oracle for A3.4 lives: a lease's **death** must
 * be visible, and the material must never be in the row.
 */

import type { CredentialLease, CredentialLeaseStore } from '../broker.js';

/**
 * An in-memory lease store.
 */
export class InMemoryCredentialLeaseStore implements CredentialLeaseStore {
  readonly #leases = new Map<string, CredentialLease>();

  /**
   * The record calls this store received.
   */
  readonly recorded: CredentialLease[] = [];

  public record(lease: CredentialLease): Promise<void> {
    this.#leases.set(lease.id, lease);
    this.recorded.push(lease);
    return Promise.resolve(undefined);
  }

  public listByTask(taskId: string): Promise<readonly CredentialLease[]> {
    return Promise.resolve(
      [...this.#leases.values()].filter((lease) => lease.taskId === taskId),
    );
  }

  public listExpired(
    referencedAt: string,
  ): Promise<readonly CredentialLease[]> {
    const now = Date.parse(referencedAt);
    return Promise.resolve(
      [...this.#leases.values()].filter(
        (lease) =>
          lease.revokedAt === undefined && Date.parse(lease.expiresAt) <= now,
      ),
    );
  }

  /**
   * Mark a lease revoked.
   *
   * ## Why the first revocation wins
   *
   * The Postgres store's `markRevoked` is idempotent — `WHERE id = $1 AND
   * revoked_at IS NULL` — so a second call changes nothing. A fake that
   * overwrote the timestamp would disagree with the real thing, and a
   * disagreement between a fake and its real counterpart is exactly what
   * the contract tests (I-12) exist to catch. So the first revocation's
   * timestamp is the one that stands.
   */
  public markRevoked(
    leaseId: string,
    revokedAt: string,
  ): Promise<void> {
    const lease = this.#leases.get(leaseId);
    if (lease !== undefined && lease.revokedAt === undefined) {
      this.#leases.set(leaseId, { ...lease, revokedAt });
    }
    return Promise.resolve(undefined);
  }

  /**
   * Every lease, revoked or not.
   */
  public all(): readonly CredentialLease[] {
    return [...this.#leases.values()];
  }

  /**
   * A lease by id.
   */
  public get(leaseId: string): CredentialLease | undefined {
    return this.#leases.get(leaseId);
  }
}
