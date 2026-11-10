/**
 * `runtime/cancel` — **the cancellation and pause path** (T-1.13).
 *
 * ## What cancellation does
 *
 * pack `02` §4.9:
 *
 * > Cancellation/pause: cooperative flag checked between steps and via
 * > `docker kill` for harness nodes; **always followed by cleanup**.
 *
 * So there are **three** things, and the third is unconditional:
 *
 * 1. the **cooperative flag** — the executor notices it between steps and
 *    stops at the next boundary;
 * 2. the **`docker kill`** — a harness node runs code inside a container,
 *    so the container is killed rather than asked politely;
 * 3. the **cleanup** — the environment is reclaimed and the credentials are
 *    revoked.
 *
 * ## The ordering is the point
 *
 * The kill comes **before** the cleanup, and the cleanup comes **before**
 * the answer is returned. A cancellation that returned while the container
 * was still running would report a cancellation that had not happened yet.
 *
 * The environment is reclaimed **before** the credentials are revoked,
 * because the environment is the sandbox the credentials were minted into:
 * tearing the sandbox down first means a credential that is live for a
 * moment is live in a sandbox that is going away, not the other way round.
 *
 * ## Why the credential revocation is never skipped
 *
 * ADR-0006 §4: "Environments, worktrees, containers, and credentials are
 * destroyed when the task reaches a terminal state, **including failure**."
 *
 * A cancelled task reaches a terminal state. So both reclamations are
 * mandatory. When one throws, the other is **still attempted** — a leaked
 * credential is worse than a leaked directory, and an exception from the
 * first reclamation must not skip the second.
 *
 * ## The cancellation is *cooperative*, not pre-emptive
 *
 * A stage that is one long model call is not interrupted mid-call. It is
 * interrupted at the next step boundary. This is deliberate: an executor
 * cannot be killed at an arbitrary point without leaving the environment in
 * an unknown state, and the cleanup depends on the executor returning.
 */

import type {
  CancellationToken,
  CredentialReclaimer,
  EnvironmentRegistry,
  HarnessAdapter,
} from './ports.js';

/**
 * The outcome of a cancellation.
 */
export interface CancelOutcome {
  /** The task that was cancelled. */
  readonly taskId: string;
  /** The run that was cancelled, when one was named. */
  readonly runId?: string;
  /** Whether the sandbox was killed. */
  readonly sandboxKilled: boolean;
  /** Whether the environment was reclaimed. */
  readonly environmentReclaimed: boolean;
  /** Whether the credentials were revoked. */
  readonly credentialsRevoked: boolean;
  /**
   * The failures that happened during the cancellation.
   *
   * The cancellation is **not** aborted by a reclamation failure — the
   * remaining reclamations still happen — so the failures are reported
   * rather than thrown.
   */
  readonly failures: readonly string[];
}

/**
 * The cancel path's dependencies.
 */
export interface CancelDeps {
  /** The environment registry — what to reclaim. */
  readonly environments: EnvironmentRegistry;
  /** The credential reclaimer. */
  readonly credentials: CredentialReclaimer;
  /** The harness adapter — for the `docker kill`. */
  readonly harness?: HarnessAdapter;
  /** The clock. */
  readonly clock: { now(): string };
}

/**
 * The cancellation path.
 */
export class CancelPath {
  readonly #deps: CancelDeps;

  public constructor(deps: CancelDeps) {
    this.#deps = deps;
  }

  /**
   * Cancel a run.
   *
   * @param input what to cancel
   */
  public async cancel(input: {
    readonly taskId: string;
    readonly runId?: string;
    /** The executor kind of the run — a harness run is killed. */
    readonly executorKind?: string;
    /** The reason, for the record. */
    readonly reason: string;
  }): Promise<CancelOutcome> {
    const failures: string[] = [];

    // ---- 1. the kill, for a harness node ----------------------------
    // A harness node runs code inside a container. The container is
    // killed — a cooperative flag cannot stop a process that is already
    // running.
    let sandboxKilled = false;
    if (input.executorKind === 'harness' && this.#deps.harness !== undefined) {
      if (input.runId !== undefined) {
        try {
          await this.#deps.harness.kill(input.runId);
          sandboxKilled = true;
        } catch (error) {
          failures.push(
            `the sandbox could not be killed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    // ---- 2. the environment -----------------------------------------
    let environmentReclaimed = false;
    if (input.runId !== undefined) {
      try {
        await this.#deps.environments.reclaim(input.runId);
        environmentReclaimed = true;
      } catch (error) {
        failures.push(
          `the environment could not be reclaimed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // ---- 3. the credentials -----------------------------------------
    // Attempted **even if** the environment reclamation threw: a leaked
    // credential is worse than a leaked directory.
    let credentialsRevoked = false;
    if (input.runId !== undefined) {
      try {
        await this.#deps.credentials.reclaim(input.runId);
        credentialsRevoked = true;
      } catch (error) {
        failures.push(
          `the credentials could not be revoked: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      taskId: input.taskId,
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      sandboxKilled,
      environmentReclaimed,
      credentialsRevoked,
      failures,
    };
  }

  /**
   * The token to hand to a running executor.
   *
   * The token is **cooperative**: the executor checks it between steps.
   */
  public token(reason: string): CancellationToken {
    return { cancelled: true, reason };
  }
}
