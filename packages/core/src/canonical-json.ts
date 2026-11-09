/**
 * Canonical JSON — the single serialisation used for hashing.
 *
 * AGENTS.md §4: "hashes over canonical JSON only". Two structurally equal
 * values must produce byte-identical output, so key order is fixed by
 * sorting, and `undefined` members are dropped rather than emitted.
 *
 * pack 03 §1 (Hashes row): "All hashing is over **canonical JSON**: UTF-8,
 * keys sorted recursively, no insignificant whitespace, numbers as JSON
 * numbers, `NaN/Infinity` rejected (RFC 8785-style)."
 *
 * `NaN` and `Infinity` are the two cases where `JSON.stringify` silently
 * produces something that is NOT valid JSON (`null` for both). A hash over a
 * silently-mangled document is worse than a rejected one: two different
 * documents would hash the same. So this implementation throws instead.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

/**
 * Raised when a value cannot be canonicalised. `NaN` and `±Infinity` are the
 * only numeric rejections; everything else is a programmer error (a `Date`, a
 * `Map`, a class instance) and is reported rather than coerced.
 */
export class CanonicalJsonError extends Error {
  public readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} (at ${path === '' ? '<root>' : path})`);
    this.name = 'CanonicalJsonError';
    this.path = path;
  }
}

/** The set of non-finite numbers JSON cannot represent. */
const isNonFinite = (value: number): boolean => !Number.isFinite(value);

/** Sort object keys recursively; arrays keep their order (order is meaning). */
export const canonicalise = (value: JsonValue, path = ''): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((item, index) => canonicalise(item as JsonValue, `${path}[${index}]`));
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'number') {
    if (isNonFinite(value)) {
      throw new CanonicalJsonError(
        `non-finite number (${String(value)}) cannot be represented in JSON`,
        path,
      );
    }
    return value;
  }

  if (typeof value !== 'object') {
    // string | boolean — already primitive and JSON-representable.
    return value;
  }

  const source = value as { readonly [key: string]: JsonValue | undefined };
  const out: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(source).sort()) {
    const member = source[key];
    if (member === undefined) {
      continue;
    }
    out[key] = canonicalise(member, path === '' ? key : `${path}.${key}`);
  }
  return out;
};

/**
 * The canonical form of `value`.
 *
 * @throws {CanonicalJsonError} when the value contains `NaN` or `±Infinity`.
 */
export const canonicalJson = (value: JsonValue): string => JSON.stringify(canonicalise(value));

/**
 * The canonical form of an unknown value, after a type guard.
 *
 * Used at boundaries where the value has not been parsed yet (an HTTP body,
 * a YAML document). It rejects anything JSON cannot round-trip: `NaN`,
 * `±Infinity`, functions, symbols, `BigInt`, `Date`, `Map`, `Set` and class
 * instances. Only plain objects and arrays are accepted.
 *
 * @throws {CanonicalJsonError} when the value is not representable.
 */
export const canonicalJsonOfUnknown = (value: unknown, path = ''): string => {
  const check = (candidate: unknown, at: string): JsonValue => {
    if (candidate === null) {
      return null;
    }

    if (typeof candidate === 'number') {
      if (isNonFinite(candidate)) {
        throw new CanonicalJsonError(
          `non-finite number (${String(candidate)}) cannot be represented in JSON`,
          at,
        );
      }
      return candidate;
    }

    if (typeof candidate === 'string' || typeof candidate === 'boolean') {
      return candidate;
    }

    if (Array.isArray(candidate)) {
      return candidate.map((item, index) => check(item, `${at}[${index}]`));
    }

    if (typeof candidate === 'object') {
      const proto = Object.getPrototypeOf(candidate) as object | null;
      if (proto !== Object.prototype && proto !== null) {
        throw new CanonicalJsonError(
          `only plain objects and arrays are representable (got ${
            (candidate as { constructor?: { name?: string } }).constructor?.name ?? 'object'
          })`,
          at,
        );
      }
      const source = candidate as { readonly [key: string]: unknown };
      const out: { [key: string]: JsonValue } = {};
      for (const key of Object.keys(source).sort()) {
        const member = source[key];
        if (member === undefined) {
          continue;
        }
        out[key] = check(member, at === '' ? key : `${at}.${key}`);
      }
      return out;
    }

    throw new CanonicalJsonError(
      `value of type ${typeof candidate} is not representable in JSON`,
      at,
    );
  };

  return JSON.stringify(check(value, path));
};
