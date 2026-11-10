/**
 * `runtime/fakes/in-memory-run-store` — the in-memory run store.
 *
 * ## Why a double, and not a mock
 *
 * AGENTS.md §4: "fakes live in `packages` under `fakes` and must pass the
 * same contract tests as the real thing (I-12)". So this is a **fake**: it
 * implements the store's semantics, not a record of calls.
 *
 * The semantics that matter are the **idempotency** ones, because the
 * oracle depends on them:
 *
 * * `finish` on a run that has already finished does **not** apply again —
 *   the first committed result wins (pack 02 §4.8);
 * * `liveRuns` reports the runs that have started and not finished — this is
 *   what the resume path asks, and it is what makes A0.5's "the task is
 *   `RUNNING` with no live node" case constructible.
 */

import type { RunRecord, RunStore } from '../ports.js';

/**
 * The in-memory run store.
 */
export class InMemoryRunStore implements RunStore {
  readonly #runs = new Map<string, RunRecord>();
  /** The order the runs were started in. */
  readonly started: string[] = [];
  /** The finish calls, in order. */
  readonly finished: {
    readonly runId: string;
    readonly status: string;
    readonly failureClass?: string;
  }[] = [];

  public start(run: RunRecord): Promise<void> {
    const existing = this.#runs.get(run.runId);
    if (existing === undefined) {
      this.started.push(run.runId);
      this.#runs.set(run.runId, run);
      return Promise.resolve();
    }

    // A run that has already finished is **not** restarted. The first
    // committed result wins (pack 02 §4.8), so a re-delivered job, a
    // re-queued lease or a duplicated handler call must not resurrect the
    // run and overwrite the result that stuck.
    if (existing.status !== 'running') {
      return Promise.resolve();
    }

    this.#runs.set(run.runId, run);
    return Promise.resolve();
  }

  public finish(
    runId: string,
    patch: {
      readonly status: 'succeeded' | 'failed' | 'incomplete';
      readonly outcome?: string;
      readonly failureClass?: string;
      readonly costUsdMicros?: number;
      readonly endedAt: string;
    },
  ): Promise<{ readonly applied: boolean; readonly winnerRunId?: string }> {
    this.finished.push({
      runId,
      status: patch.status,
      ...(patch.failureClass === undefined ? {} : { failureClass: patch.failureClass }),
    });

    const existing = this.#runs.get(runId);
    if (existing === undefined) {
      return Promise.resolve({ applied: false });
    }

    // The first committed result wins: a run that has already finished is
    // not finished again.
    if (existing.status !== 'running') {
      return Promise.resolve({ applied: false, winnerRunId: existing.runId });
    }

    this.#runs.set(runId, {
      ...existing,
      status: patch.status,
      costUsdMicros: patch.costUsdMicros ?? existing.costUsdMicros,
      endedAt: patch.endedAt,
      ...(patch.failureClass === undefined
        ? {}
        : { failureClass: patch.failureClass }),
      ...(patch.outcome === undefined ? {} : { outcome: patch.outcome }),
    });

    return Promise.resolve({ applied: true });
  }

  public runsFor(
    taskId: string,
    nodeId: string,
  ): Promise<readonly RunRecord[]> {
    return Promise.resolve(
      [...this.#runs.values()].filter(
        (run) => run.taskId === taskId && run.nodeId === nodeId,
      ),
    );
  }

  public liveRuns(taskId: string): Promise<readonly RunRecord[]> {
    return Promise.resolve(
      [...this.#runs.values()].filter(
        (run) => run.taskId === taskId && run.status === 'running',
      ),
    );
  }

  /** The run with the given id, for a test to inspect. */
  public byId(runId: string): RunRecord | undefined {
    return this.#runs.get(runId);
  }

  /** Every run, for a test to inspect. */
  public all(): readonly RunRecord[] {
    return [...this.#runs.values()];
  }
}
