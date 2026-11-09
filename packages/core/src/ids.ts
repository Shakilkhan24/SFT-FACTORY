/**
 * ULID and UUIDv7 — the factory's two id schemes.
 *
 * pack 03 §1 (IDs row): "Prefixed ULIDs, generated in the app: `tsk_`, `run_`,
 * `apr_`, `chg_`, `orc_`, `gat_`, `crd_` (credential lease), `cps_`,
 * `env_`. Node ids are slugs unique within a task (`n1-implement`). Event ids
 * are UUIDv7."
 *
 * pack 03 §2 (events table): `event_id uuid NOT NULL, -- UUIDv7; global
 * uniqueness by construction + audit query`.
 *
 * **Randomness is injected.** The pure packages may not call `Math.random()`
 * (HR-7, enforced by `pnpm lint:deps` and by the dependency rules in
 * `.dependency-cruiser.json`). `ulid()` takes the entropy it uses, so a test
 * is deterministic and a caller that wants cryptographic entropy asks for it
 * explicitly.
 */

/** A source of random bytes. `crypto.randomFillSync` satisfies this. */
export type Entropy = (byteLength: number) => Uint8Array;

/**
 * Crockford base32 — the ULID alphabet. Excludes `I`, `L`, `O` and `U` so a
 * ULID cannot be misread as `1`, `1`, `0` or `V`.
 */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const encodeTime = (time: number): string => {
  let out = '';
  let remaining = time;
  for (let i = 0; i < 10; i += 1) {
    out = (CROCKFORD[remaining % 32] ?? '0') + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
};

const encodeRandom = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out = (CROCKFORD[(bytes[i] ?? 0) % 32] ?? '0') + out;
  }
  return out;
};

/**
 * A ULID without a prefix.
 *
 * The timestamp is milliseconds since the Unix epoch; the 80 random bits
 * make the id unique within a millisecond and sortable by creation time.
 *
 * @param time the creation instant, in milliseconds since the epoch
 * @param entropy the randomness source
 */
export const ulid = (time: number, entropy: Entropy): string => {
  if (!Number.isInteger(time) || time < 0) {
    throw new RangeError(`ulid: time must be a non-negative integer, got ${String(time)}`);
  }
  if (time > 281_474_976_710_655) {
    throw new RangeError(`ulid: time ${time} exceeds the 48-bit ULID range`);
  }
  const bytes = entropy(16);
  if (bytes.length < 16) {
    throw new RangeError(`ulid: entropy returned ${bytes.length} bytes, expected 16`);
  }
  return encodeTime(time) + encodeRandom(bytes);
};

/**
 * A prefixed ULID — `tsk_01JCZ8K2QF7V9N4M6P8R0S2T4U`.
 *
 * The prefixes are fixed by pack 03 §1. `IdPrefix` makes a typo in a
 * prefix a compile error rather than an id that no query will ever match.
 */
export const ID_PREFIXES = [
  'tsk',
  'run',
  'apr',
  'chg',
  'orc',
  'gat',
  'crd',
  'cps',
  'env',
] as const;

export type IdPrefix = (typeof ID_PREFIXES)[number];

const isIdPrefix = (value: string): value is IdPrefix =>
  (ID_PREFIXES as readonly string[]).includes(value);

/**
 * A prefixed ULID.
 *
 * @throws {RangeError} when the prefix is not one of the registered prefixes.
 */
export const prefixedUlid = (
  prefix: IdPrefix,
  time: number,
  entropy: Entropy,
): string => `${prefix}_${ulid(time, entropy)}`;

/** A prefixed ULID from an unvalidated string prefix. */
export const prefixedUlidUnsafe = (
  prefix: string,
  time: number,
  entropy: Entropy,
): string => {
  if (!isIdPrefix(prefix)) {
    throw new RangeError(`prefixedUlid: unknown id prefix '${prefix}'`);
  }
  return prefixedUlid(prefix, time, entropy);
};

/**
 * UUIDv7 — a time-ordered UUID.
 *
 * Layout (RFC 9562 §5.7):
 *   - 48 bits: Unix timestamp in milliseconds, big-endian
 *   -  4 bits: version (`7`)
 *   - 12 bits: `rand_a`
 *   -  2 bits: variant (`10`)
 *   - 62 bits: `rand_b`
 *
 * UUIDv7 sorts lexicographically by creation time, which is why the event log
 * uses it rather than a v4 UUID.
 */
export const uuidv7 = (time: number, entropy: Entropy): string => {
  if (!Number.isInteger(time) || time < 0) {
    throw new RangeError(`uuidv7: time must be a non-negative integer, got ${String(time)}`);
  }
  if (time > 281_474_976_710_655) {
    throw new RangeError(`uuidv7: time ${time} exceeds the 48-bit UUIDv7 range`);
  }

  const bytes = entropy(16);
  if (bytes.length < 16) {
    throw new RangeError(`uuidv7: entropy returned ${bytes.length} bytes, expected 16`);
  }

  const bytesOut = new Uint8Array(16);
  bytesOut.set(bytes);

  // 48-bit big-endian timestamp.
  bytesOut[0] = Math.floor(time / 2 ** 40) & 0xff;
  bytesOut[1] = Math.floor(time / 2 ** 32) & 0xff;
  bytesOut[2] = Math.floor(time / 2 ** 24) & 0xff;
  bytesOut[3] = Math.floor(time / 2 ** 16) & 0xff;
  bytesOut[4] = Math.floor(time / 2 ** 8) & 0xff;
  bytesOut[5] = time & 0xff;

  // Version 7 in the high nibble of byte 6.
  bytesOut[6] = ((bytesOut[6] ?? 0) & 0x0f) | 0x70;
  // Variant `10` in the top two bits of byte 8.
  bytesOut[8] = ((bytesOut[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytesOut, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
};

/**
 * The UUIDv7 form of an event id, matching the `uuid` column type in
 * pack 03 §2. Events carry the bare UUID; only domain objects (tasks, runs,
 * approvals) carry a prefixed ULID.
 */
export const eventId = (time: number, entropy: Entropy): string => uuidv7(time, entropy);
