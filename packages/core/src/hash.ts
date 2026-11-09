import { createHash } from 'node:crypto';

import { canonicalJson, canonicalJsonOfUnknown, type JsonValue } from './canonical-json.js';

/**
 * sha256 over canonical JSON. Used for the event-log hash chain, artefact
 * digests and context-bundle fingerprints (pack 03 §2, pack 07 §8).
 */
export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

export const sha256Json = (value: JsonValue): string => sha256(canonicalJson(value));

/**
 * sha256 over an unknown value, canonicalising it first.
 *
 * Unlike `sha256Json`, this takes `unknown` and throws on any value JSON
 * cannot represent (`NaN`, `±Infinity`, `Date`, `Map`, class instances).
 */
export const sha256OfUnknown = (value: unknown): string =>
  sha256(canonicalJsonOfUnknown(value));

/**
 * The `sha256:<64 hex>` form used in JSON payloads.
 *
 * pack 03 §1: `Hashes | JSON: "sha256:<64 hex>"; SQL: bytea`. The SQL side
 * stores raw bytes; the JSON side stores the prefixed hex string. These two
 * helpers are the only place that conversion happens.
 */
export const toSha256Digest = (value: string | Uint8Array): `sha256:${string}` =>
  `sha256:${sha256(value)}`;

/** The `sha256:<64 hex>` form over a canonicalised JSON value. */
export const toSha256DigestJson = (value: JsonValue): `sha256:${string}` =>
  `sha256:${sha256Json(value)}`;

/** The raw bytes behind a `sha256:<64 hex>` digest — for a `bytea` column. */
export const sha256Bytes = (value: string | Uint8Array): Uint8Array => {
  const digest = createHash('sha256').update(value).digest();
  return new Uint8Array(digest);
};
