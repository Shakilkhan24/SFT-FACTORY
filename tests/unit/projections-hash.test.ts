/**
 * `projections` — the row digest (T-1.15).
 *
 * A0.6: "drop-and-rebuild ⇒ **identical rows (hash compare)**". So the
 * digest is the comparison, and the digest must be a function of the
 * rows' **content** and nothing else.
 *
 * The properties:
 *
 * 1. The same rows give the same digest.
 * 2. The **order** the rows come in does not change the digest.
 * 3. The **key order** inside a row does not change the digest.
 * 4. A different row gives a different digest — otherwise the comparison
 *    would pass for the wrong reason.
 */

import { describe, expect, it } from 'vitest';

import { rowDigest, rowsDigest } from '@factory/projections';

describe('projections · the digest', () => {
  it('is stable for the same rows', () => {
    const rows = { a: { x: 1, y: 2 }, b: { z: 3 } };
    expect(rowsDigest(rows)).toBe(rowsDigest(rows));
  });

  it('does not depend on the order the rows come in', () => {
    const a = { first: { x: 1 }, second: { y: 2 } };
    const b = { second: { y: 2 }, first: { x: 1 } };
    expect(rowsDigest(a)).toBe(rowsDigest(b));
  });

  it('does not depend on the key order inside a row', () => {
    const a = { r: { x: 1, y: 2 } };
    const b = { r: { y: 2, x: 1 } };
    expect(rowsDigest(a)).toBe(rowsDigest(b));
  });

  it('changes when a row changes', () => {
    const a = { r: { x: 1 } };
    const b = { r: { x: 2 } };
    expect(rowsDigest(a)).not.toBe(rowsDigest(b));
  });

  it('changes when a row is added', () => {
    const a = { r: { x: 1 } };
    const b = { r: { x: 1 }, s: { y: 2 } };
    expect(rowsDigest(a)).not.toBe(rowsDigest(b));
  });

  it('changes when a row is removed', () => {
    const a = { r: { x: 1 }, s: { y: 2 } };
    const b = { r: { x: 1 } };
    expect(rowsDigest(a)).not.toBe(rowsDigest(b));
  });

  it('is not the digest of the empty set', () => {
    expect(rowsDigest({})).not.toBe(rowsDigest({ r: { x: 1 } }));
  });

  it('digests a row on its own', () => {
    expect(rowDigest({ x: 1 })).toBe(rowDigest({ x: 1 }));
    expect(rowDigest({ x: 1 })).not.toBe(rowDigest({ x: 2 }));
  });

  it('names the algorithm', () => {
    expect(rowsDigest({}).startsWith('sha256:')).toBe(true);
    expect(rowDigest({}).startsWith('sha256:')).toBe(true);
  });
});
