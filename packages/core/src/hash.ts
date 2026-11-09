import { createHash } from 'node:crypto';

import { canonicalJson, type JsonValue } from './canonical-json.js';

/**
 * sha256 over canonical JSON. Used for the event-log hash chain, artefact
 * digests and context-bundle fingerprints (pack 03 §2, pack 07 §8).
 */
export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

export const sha256Json = (value: JsonValue): string => sha256(canonicalJson(value));
