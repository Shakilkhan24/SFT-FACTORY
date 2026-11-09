/**
 * `orchestrator` — the orchestration runtime (pack 02 §3).
 *
 * pack 02 §3: "`orchestrator` may import everything except `apps`." So this
 * is where the pieces that talk to storage are wired together.
 *
 * For checklist 02 (T-1.04) it holds the Postgres implementation of the
 * state machine's storage interface — the row lock, and the one transaction
 * that carries the state change and its event.
 *
 * The *machine* itself is in `@factory/state`, which is a **pure** package
 * (pack 02 §3): no `pg`, no network, no clock. The separation is what makes
 * the guards testable without a database.
 */

export {
  PostgresStateMachineStore,
  type PostgresStateMachineStoreOptions,
} from './postgres-state-store.js';

export const packageName = 'orchestrator';
