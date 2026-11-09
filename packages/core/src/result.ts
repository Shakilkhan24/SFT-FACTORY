/**
 * `Result<T,E>` — the profile's expected-failure idiom (A1 §4.1).
 *
 * AGENTS.md §4: "Expected failures return `Result<T,E>`; exceptions are for
 * programmer errors. Every error maps to a FailureClass."
 */

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;

export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;

/**
 * Every failure maps to a FailureClass. Unknown failures must not reach a
 * caller as an anonymous `Error` — they must be classified.
 */
export type FailureClass =
  | 'invalid-input'
  | 'not-found'
  | 'conflict'
  | 'permission-denied'
  | 'precondition-failed'
  | 'timeout'
  | 'unavailable'
  | 'budget-exceeded'
  | 'internal';

export interface Failure {
  readonly class: FailureClass;
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export const failure = (
  cls: FailureClass,
  message: string,
  detail?: Readonly<Record<string, unknown>>,
): Failure => ({ class: cls, message, ...(detail === undefined ? {} : { detail }) });

export const isFailure = (value: unknown): value is Failure =>
  typeof value === 'object' &&
  value !== null &&
  'class' in value &&
  'message' in value &&
  typeof (value as { class: unknown }).class === 'string';
