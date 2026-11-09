/**
 * `core` — the pure helpers every package uses.
 *
 * pack 02 §3: `core` → `contracts`; `core` depends on no other internal
 * package. HR-7: no `node:fs/net/child_process`, no `pg`, no network, no
 * clock, no randomness except injected.
 *
 * The clock and the id source are injected (AGENTS.md §4: "Time via injected
 * `Clock`; ids via `core`"), so `core` never calls `Date.now()` or
 * `Math.random()` in a path a pure package can reach.
 */

export {
  canonicalise,
  canonicalJson,
  canonicalJsonOfUnknown,
  CanonicalJsonError,
  type JsonValue,
} from './canonical-json.js';

export {
  sha256,
  sha256Bytes,
  sha256Json,
  sha256OfUnknown,
  toSha256Digest,
  toSha256DigestJson,
} from './hash.js';

export {
  eventId,
  ID_PREFIXES,
  prefixedUlid,
  prefixedUlidUnsafe,
  type Entropy,
  type IdPrefix,
  ulid,
  uuidv7,
} from './ids.js';

export {
  classifyError,
  err,
  errorOf,
  factoryError,
  FAILURE_CLASSES,
  isErr,
  isOk,
  ok,
  toFactoryError,
  UNKNOWN_FAILURE_CLASS,
  type FactoryError,
  type FailureClass,
  type Result,
} from './result.js';

export {
  fixedClock,
  sequentialIds,
  systemClock,
  type Clock,
  type IdSource,
} from './clock.js';
