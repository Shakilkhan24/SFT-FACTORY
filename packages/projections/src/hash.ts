/**
 * `projections/hash` — the row digest (T-1.15).
 *
 * ## What this file is
 *
 * A0.6: "drop-and-rebuild ⇒ **identical rows (hash compare)**". So the
 * comparison is a **hash**, and the hash must be a function of the
 * rows' *content* and nothing else.
 *
 * ## Why the hash cannot include anything else
 *
 * A digest that included the wall clock, the write order, or the
 * projection's run id would differ between the original projection and
 * the rebuild — and the comparison would prove nothing. So the digest is
 * over:
 *
 * * the **rows**, sorted by key, so the order the store returned them in
 *   cannot change the digest;
 * * each row's **canonical JSON**, so the key order inside a row cannot
 *   change the digest either.
 *
 * AGENTS.md §4: "hashes over canonical JSON only". `@factory/core` owns
 * that function, so this file does not re-implement it.
 *
 * ## What is deliberately **excluded**
 *
 * * **The row's `lastActivityAt` is included** — it is part of the
 *   row's content, and a rebuild that produced a different activity
 *   timestamp would be a different row.
 * * **The write time is excluded** — it is not a column of the row.
 * * **The projection's cursor is excluded** — the cursor is a *position*,
 *   not a row. It is compared separately, by the rebuild's own report.
 */

import { canonicalJsonOfUnknown, sha256 } from '@factory/core';

/**
 * The digest of one row.
 *
 * @param row the row
 * @returns the `sha256:<hex>` digest of the row's canonical JSON
 */
export const rowDigest = (row: unknown): string =>
  `sha256:${sha256(canonicalJsonOfUnknown(row))}`;

/**
 * The digest of a whole set of rows.
 *
 * The rows are sorted by their **key**, so the digest is a function of
 * the set and not of the order the store returned them in. Without the
 * sort, a rebuild that wrote the rows in a different order would produce
 * a different digest and the comparison would fail for no reason.
 *
 * @param rows the rows, keyed
 * @returns the digest of the set
 */
export const rowsDigest = (
  rows: Readonly<Record<string, unknown>>,
): string => {
  const sorted = Object.keys(rows)
    .sort()
    .map((key) => [key, rows[key]] as const);

  return `sha256:${sha256(
    canonicalJsonOfUnknown(sorted.map(([key, row]) => ({ key, row }))),
  )}`;
};
