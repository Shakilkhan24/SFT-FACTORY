/**
 * `Result<T,E>` — the profile's expected-failure idiom (A1 §4.1).
 *
 * AGENTS.md §4: "Expected failures return `Result<T,E>`; exceptions are for
 * programmer errors. Every error maps to a FailureClass."
 *
 * pack 03 §3 (shared block):
 *
 * ```ts
 * export type Result<T, E = FactoryError> = { ok: true; value: T } | { ok: false; error: E };
 * export type FailureClass = 'model.reasoning'|'model.capability'|'workflow.composition'|'context.insufficient'
 *   |'verification.failure'|'environment.failure'|'policy.denied'|'budget.exhausted'|'tool.unavailable'|'unknown';
 * ```
 *
 * pack 03 §7: "**Failure classes** (10): see `FailureClass` above; unknown ⇒
 * `workflow.composition`." The fallback is not optional — an unclassified
 * failure is itself a workflow-composition defect.
 */

export type Result<T, E = FactoryError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;

export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;

/**
 * The ten failure classes (pack 03 §3, §7).
 *
 * These are *why a run failed*, not *what went wrong technically*. A network
 * timeout during a tool call is `tool.unavailable`; an agent that produced
 * wrong code is `model.reasoning`.
 */
export const FAILURE_CLASSES = [
  'model.reasoning',
  'model.capability',
  'workflow.composition',
  'context.insufficient',
  'verification.failure',
  'environment.failure',
  'policy.denied',
  'budget.exhausted',
  'tool.unavailable',
  'unknown',
] as const;

export type FailureClass = (typeof FAILURE_CLASSES)[number];

/**
 * The class an unclassified failure falls back to (pack 03 §7: "unknown ⇒
 * `workflow.composition`").
 */
export const UNKNOWN_FAILURE_CLASS: FailureClass = 'workflow.composition';

/**
 * The factory's error shape — the default `E` of `Result`.
 *
 * Every field the failure class needs to be actionable in the event log and
 * on the Health surface.
 */
export interface FactoryError {
  readonly class: FailureClass;
  readonly message: string;
  readonly retriable: boolean;
  readonly detail?: Readonly<Record<string, unknown>>;
}

/**
 * Build a `FactoryError`.
 *
 * @param cls the failure class
 * @param message what happened, in one line
 * @param retriable whether a retry could plausibly succeed
 * @param detail structured context (never secret material)
 */
export const factoryError = (
  cls: FailureClass,
  message: string,
  retriable = false,
  detail?: Readonly<Record<string, unknown>>,
): FactoryError => ({
  class: cls,
  message,
  retriable,
  ...(detail === undefined ? {} : { detail }),
});

/**
 * Classify an unknown thrown value.
 *
 * An unrecognised error is `unknown` — and the caller is expected to treat
 * `unknown` as `workflow.composition` when it aggregates. This function never
 * invents a class it cannot justify.
 */
export const classifyError = (error: unknown): FailureClass => {
  if (typeof error === 'object' && error !== null && 'class' in error) {
    const candidate = (error as { class: unknown }).class;
    if (typeof candidate === 'string' && (FAILURE_CLASSES as readonly string[]).includes(candidate)) {
      return candidate as FailureClass;
    }
  }
  return 'unknown';
};

/**
 * Turn a thrown value into a `FactoryError`.
 */
export const toFactoryError = (
  error: unknown,
  retriable = false,
): FactoryError => {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  return factoryError(classifyError(error), message, retriable);
};

/** Narrow a `Result` to its error branch, with the class. */
export const errorOf = <T, E extends { class: FailureClass }>(
  r: Result<T, E>,
): E | undefined => (r.ok ? undefined : r.error);
