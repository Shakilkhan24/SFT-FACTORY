/**
 * `runtime/registry` — **the executor registry** (T-1.13).
 *
 * ## What the registry does
 *
 * It resolves a stage kind to the executor that will run it, and it
 * **refuses** the ones it cannot run. The refusals are the interesting half.
 *
 * ## The three refusals
 *
 * 1. **The stage kind is not implemented.** `deploy` and `investigate` are
 *    not implemented in v1, and a workflow that reaches one must fail
 *    loudly rather than hang.
 * 2. **The declared executor is not permitted for the stage.** ADR-0017:
 *    "a misconfigured workflow could try to use `harness` for a Reviewer
 *    unless the registry checks it." This is the check ADR-0017's
 *    validation section names.
 * 3. **No executor is registered for the resolved kind.** A registry with
 *    no `harness` executor in v1 is *correct* — the production harness
 *    adapter is T-2.x — but a stage that resolves to `harness` must say so
 *    rather than fail obscurely.
 *
 * ## The registry is a *lookup*, not a chain
 *
 * Every executor implements the same {@link StageExecutor} interface, so
 * the registry is a map from kind to executor. There is no chain of
 * `if (kind === ...)` branches, because a chain would make the four
 * executor kinds behave differently in ways the caller cannot see — and the
 * whole point of the registry is that the *stage* does not change, only the
 * executor.
 *
 * ## Why the registry refuses rather than falls back
 *
 * blueprint 13 §2.3: "**Deny by default and escalate.** 'Let the
 * orchestrator try and see' is not available anywhere in the system."
 *
 * So an unimplemented executor is a refusal with a reason, not a fallback
 * to `deterministic`. Falling back would be *worse* than failing: a
 * `harness` stage that silently ran as `deterministic` would produce a
 * change with no code written, and report success.
 */

import type { ExecutorKind, StageKind } from '@factory/contracts';

import {
  resolveExecutorKind,
  type ExecutorResolution,
} from './stage-kinds.js';
import type { StageExecutor } from './ports.js';

/**
 * The outcome of asking the registry for an executor.
 */
export type RegistryResolution =
  | { readonly ok: true; readonly executor: StageExecutor; readonly kind: ExecutorKind }
  | { readonly ok: false; readonly reason: string };

/**
 * The executor registry.
 */
export class ExecutorRegistry {
  readonly #executors = new Map<string, StageExecutor>();

  /**
   * Register an executor.
   *
   * Registering a second executor for the same kind **replaces** the
   * first — a registry is a lookup table, and a duplicate is a
   * configuration mistake rather than a dispatch rule.
   */
  public register(executor: StageExecutor): void {
    this.#executors.set(executor.kind, executor);
  }

  /**
   * The executor kinds that are registered.
   */
  public registeredKinds(): readonly string[] {
    return [...this.#executors.keys()].sort();
  }

  /**
   * Is an executor registered for this kind?
   */
  public has(kind: string): boolean {
    return this.#executors.has(kind);
  }

  /**
   * Resolve the executor for a stage.
   *
   * @param stageKind the stage kind
   * @param declared the executor the workflow declared, when it declared one
   */
  public resolve(
    stageKind: StageKind,
    declared?: ExecutorKind,
  ): RegistryResolution {
    const resolved: ExecutorResolution = resolveExecutorKind(stageKind, declared);
    if (!resolved.ok) {
      return { ok: false, reason: resolved.reason };
    }

    const executor = this.#executors.get(resolved.executor);
    if (executor === undefined) {
      return {
        ok: false,
        reason: `no executor is registered for the "${resolved.executor}" executor kind, so the "${stageKind}" stage cannot run`,
      };
    }

    return { ok: true, executor, kind: resolved.executor };
  }
}
