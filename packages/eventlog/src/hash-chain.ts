/**
 * The per-aggregate hash chain.
 *
 * pack 02 §4.2: "compute `hash = sha256(prev_hash ‖ canonicalJson(envelope))`
 * (chain **per aggregate**)".
 *
 * The chain is what makes tampering *detectable*. The `events` table has no
 * UPDATE/DELETE grant for the application role and a trigger that raises for
 * the owner — but the owner is the role that runs migrations, so the trigger
 * is the last line of defence, not the only one. If someone with owner rights
 * disables the trigger and edits a row, the chain shows it: the edited row's
 * hash no longer matches the recomputed hash, and every later row in that
 * aggregate is also broken because its `prev_hash` no longer matches.
 *
 * The chain is **per aggregate**, not global. Two reasons, both from the
 * corpus:
 *
 *  * blueprint `09` §4.1: the chain is per aggregate so that a partition of
 *    the log can be verified on its own — `verifyChain(aggregate)` is the
 *    named operation in pack 03 §3.
 *  * A global chain would serialise every append on the *previous* event's
 *    hash, which is the same thing the counter row already does, and would
 *    make the two mechanisms redundant.
 *
 * **The hash covers the envelope without its own `hash` field.** A chain that
 * covered its own hash would be self-referential; the envelope is canonicalised
 * with `hash` removed and `prevHash` *included*, so the chain links.
 */

import { canonicalJsonOfUnknown, sha256 } from '@factory/core';

/**
 * The member of an event envelope that carries the previous hash.
 *
 * Kept as a string rather than a `Sha256` template type so that a row read
 * back from the database (which yields raw bytes) can be converted into the
 * same shape the envelope uses.
 */
export const PREV_HASH_FIELD = 'prevHash';

/**
 * The member of an event envelope that carries this event's hash.
 */
export const HASH_FIELD = 'hash';

/**
 * Normalise a digest to its bare 64-hex form.
 *
 * The same digest crosses the boundary in two shapes: `sha256:<64 hex>` in
 * the JSON envelope, and 32 raw bytes in the `bytea` column. Comparing the
 * two directly would report a mismatch for an intact chain, so every
 * comparison goes through here.
 */
export const normalizeDigest = (digest: string): string =>
  digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;

/**
 * Compute the hash of one envelope, given the previous hash in the same
 * aggregate's chain.
 *
 * `prevHash` is `null`/absent for the first event of an aggregate.
 *
 * The envelope is canonicalised with its own `hash` removed. `prevHash` is
 * **kept**, so the chain links: changing an earlier event changes every
 * later event's hash.
 */
export const chainHash = (
  envelope: Readonly<Record<string, unknown>>,
  prevHash: string | null | undefined,
): string => {
  const withoutOwnHash: Record<string, unknown> = { ...envelope };
  delete withoutOwnHash[HASH_FIELD];

  const canonical = canonicalJsonOfUnknown(withoutOwnHash);
  // `‖` is byte concatenation, not string concatenation of two hex digests
  // into one. The previous hash contributes its 32 raw bytes, so the input to
  // sha256 is unambiguous: a digest cannot be confused with the canonical
  // JSON that follows it, because the JSON always starts with `{`.
  const canonicalBytes = new TextEncoder().encode(canonical);
  const previous =
    prevHash === null || prevHash === undefined
      ? new Uint8Array(0)
      : hexToBytes(prevHash);
  const combined = new Uint8Array(previous.length + canonicalBytes.length);
  combined.set(previous, 0);
  combined.set(canonicalBytes, previous.length);
  return sha256(combined);
};

/**
 * Decode a `sha256:<hex>` or bare-hex digest into its 32 raw bytes.
 *
 * The database stores the digest as `bytea` (pack 03 §1: "JSON:
 * `sha256:<64 hex>`; SQL: `bytea`"), so the same value crosses the boundary
 * in two shapes. This is the only place that conversion happens.
 */
export const hexToBytes = (digest: string): Uint8Array => {
  const hex = digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : digest;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`not a sha256 digest: ${digest}`);
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

/**
 * Encode 32 raw bytes into the `sha256:<64 hex>` form.
 */
export const bytesToDigest = (bytes: Uint8Array): `sha256:${string}` => {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
};

/**
 * One link in a chain, as read back from the database.
 *
 * `prevHash` and `hash` are `null`/absent-tolerant because the first event
 * of an aggregate has no previous hash.
 */
export interface ChainLink {
  readonly seq: number;
  readonly prevHash: string | null | undefined;
  readonly hash: string;
  /** The envelope as stored, minus the `hash`/`prevHash` bookkeeping. */
  readonly envelope: Readonly<Record<string, unknown>>;
}

/**
 * The outcome of verifying one chain.
 */
export interface ChainVerificationResult {
  /** `true` when every link recomputes to its stored hash. */
  readonly ok: boolean;

  /**
   * The `seq` of the first link whose hash does not recompute.
   *
   * `undefined` when the chain is intact. A broken link at `seq` N means the
   * event at N was altered — or an earlier one was, in which case N's
   * `prev_hash` no longer matches.
   */
  readonly brokenAtSeq?: number;

  /** How many links were checked. */
  readonly checked: number;

  /**
   * A human-readable reason for the failure. `undefined` when the chain is
   * intact.
   */
  readonly reason?: string;
}

/**
 * Verify a chain, given its links in `seq` order.
 *
 * Pure: it computes and compares, and never touches the database. The
 * database-backed `verifyChain` reads the links and calls this.
 */
export const verifyChainLinks = (links: readonly ChainLink[]): ChainVerificationResult => {
  let previous: string | null = null;

  for (const link of links) {
    // The link's stored `prevHash` must match the hash of the link before it.
    // A mismatch here means an event was *removed* from the middle of the
    // chain, or the links are not in chain order.
    const storedPrev =
      link.prevHash === null || link.prevHash === undefined
        ? null
        : normalizeDigest(link.prevHash);
    if (storedPrev !== previous) {
      return {
        ok: false,
        brokenAtSeq: link.seq,
        checked: links.length,
        reason:
          `prev_hash mismatch at seq ${String(link.seq)}: stored ${
            storedPrev ?? 'null'
          }, expected ${previous ?? 'null'}`,
      };
    }

    const recomputed = chainHash(link.envelope, link.prevHash ?? null);
    if (recomputed !== normalizeDigest(link.hash)) {
      return {
        ok: false,
        brokenAtSeq: link.seq,
        checked: links.length,
        reason:
          `hash mismatch at seq ${String(link.seq)}: stored ${link.hash}, recomputed ${recomputed}`,
      };
    }

    previous = normalizeDigest(link.hash);
  }

  return { ok: true, checked: links.length };
};
