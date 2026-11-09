/**
 * Canonical JSON — the single serialisation used for hashing.
 *
 * AGENTS.md §4: "hashes over canonical JSON only". Two structurally equal
 * values must produce byte-identical output, so key order is fixed by
 * sorting, and `undefined` members are dropped rather than emitted.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue | undefined };

/** Sort object keys recursively; arrays keep their order (order is meaning). */
export const canonicalise = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalise(item as JsonValue));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const source = value as { readonly [key: string]: JsonValue | undefined };
  const out: { [key: string]: JsonValue } = {};
  for (const key of Object.keys(source).sort()) {
    const member = source[key];
    if (member === undefined) {
      continue;
    }
    out[key] = canonicalise(member);
  }
  return out;
};

export const canonicalJson = (value: JsonValue): string => JSON.stringify(canonicalise(value));
