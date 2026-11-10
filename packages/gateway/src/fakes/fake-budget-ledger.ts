/**
 * `gateway` — the in-memory budget ledger.
 *
 * The ledger answers the question the budget check asks: **how much is
 * left?** — at each scope, for a task.
 *
 * ## The spent amount comes from the recorded calls
 *
 * The ledger's `spent` is the sum of the costs of the calls recorded
 * for the task. So the ledger and the call store cannot disagree: the
 * ledger reads the same records the gateway wrote.
 *
 * That matters because a budget check against a *separately maintained*
 * counter can drift from the ledger it is supposed to bound — and a
 * counter that under-counts lets the budget be exceeded without anyone
 * noticing.
 */

import type { BudgetLedger, ModelCallStore } from '../ports.js';
import type { BudgetState } from '../budget.js';

/**
 * The options for a {@link FakeBudgetLedger}.
 */
export interface FakeBudgetLedgerOptions {
  /** The call store the ledger reads. */
  readonly calls: ModelCallStore;
  /** The per-request limit, in micro-USD. */
  readonly perRequestUsdMicros?: number;
  /** The per-task limit, in micro-USD. */
  readonly perTaskUsdMicros?: number;
  /** The per-workflow-day limit, in micro-USD. */
  readonly perWorkflowDayUsdMicros?: number;
  /** The per-task limit, by task id — overrides the general one. */
  readonly perTaskByTaskId?: Readonly<Record<string, number>>;
}

/**
 * The in-memory budget ledger.
 */
export class FakeBudgetLedger implements BudgetLedger {
  readonly #options: FakeBudgetLedgerOptions;

  constructor(options: FakeBudgetLedgerOptions) {
    this.#options = options;
  }

  /** The remaining budget for a task. */
  public remainingFor(taskId: string): Promise<BudgetState> {
    const records = this.#recordsFor(taskId);
    const spent = records.reduce(
      (total, record) => total + record.costUsdMicros,
      0,
    );

    const perTask =
      this.#options.perTaskByTaskId?.[taskId] ?? this.#options.perTaskUsdMicros;

    return Promise.resolve({
      request: undefined,
      task:
        perTask === undefined
          ? undefined
          : { limitUsdMicros: perTask, spentUsdMicros: spent },
      workflowDay:
        this.#options.perWorkflowDayUsdMicros === undefined
          ? undefined
          : {
              limitUsdMicros: this.#options.perWorkflowDayUsdMicros,
              spentUsdMicros: spent,
            },
    });
  }

  /** The per-request limit, when one is configured. */
  public get perRequestUsdMicros(): number | undefined {
    return this.#options.perRequestUsdMicros;
  }

  /**
   * The calls recorded for a task.
   *
   * The ledger reads the **records** the store holds — so the spent
   * amount and the ledger can never disagree. The store's port does
   * not expose the records (the port is deliberately narrow), so the
   * ledger reads them through the concrete double's `records` getter,
   * and falls back to no records when the store is a different
   * implementation.
   */
  #recordsFor(taskId: string): readonly {
    readonly taskId: string;
    readonly costUsdMicros: number;
  }[] {
    const store = this.#options.calls as unknown as {
      records?: readonly { readonly taskId: string; readonly costUsdMicros: number }[];
    };
    const records = store.records;
    if (records === undefined) {
      return [];
    }
    return records.filter((record) => record.taskId === taskId);
  }
}
