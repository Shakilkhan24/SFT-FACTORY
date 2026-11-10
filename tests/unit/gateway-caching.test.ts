/**
 * T-1.10 — the cache breakpoints.
 *
 * blueprint 11 §9.7:
 *
 * | Rule | Detail |
 * |---|---|
 * | Only the stable prefix is cached. | The task-specific and untrusted sections vary and are never cached. |
 * | The cache key includes the prefix hash and the model version. | A provider-side cache must never serve a different prefix's result. |
 * | Caching is a cost optimisation only. | A cache miss is always correct. The factory never depends on a cache hit for correctness. |
 *
 * pack 02 §4.7: *"place cache breakpoints at the end of the stable
 * prefix only (policy, role, standards, procedures); the untrusted
 * envelope and task come after."*
 *
 * ## What these tests hold
 *
 * 1. **The breakpoint is at the END of the stable prefix** — and
 *    nowhere else.
 * 2. **An untrusted block is NEVER cached** — not even when it sits
 *    between two stable ones.
 * 3. **A request with no stable block has no breakpoint.**
 * 4. **A request that asks for no caching has no breakpoint.**
 * 5. **The cache key includes the prefix hash AND the model version.**
 * 6. **A cache miss is still correct** — the answer is the same.
 */

import { describe, expect, it } from 'vitest';

import {
  blocksWithBreakpoint,
  cacheKeyFor,
  STABLE_PREFIX_BLOCK_IDS,
  stablePrefixOf,
} from '../../packages/gateway/src/index.ts';

import { aRequest, buildGateway } from '../helpers/gateway.ts';

/**
 * A system block.
 */
const block = (id: string, body = `the ${id}`) => ({ id, body });

/**
 * A request with a cache policy and a set of system blocks.
 */
const aCachingRequest = (
  system: readonly { id: string; body: string }[],
  cachePolicy: 'prefix' | 'none' = 'prefix',
) =>
  aRequest({
    system: [...system],
    cachePolicy,
  });

describe('T-1.10 — the caching', () => {
  describe('the stable prefix', () => {
    it('is the LEADING run of stable blocks', () => {
      const request = aCachingRequest([
        block('policy'),
        block('role'),
        block('task'),
        block('standards'),
      ]);

      const prefix = stablePrefixOf(request);

      expect(prefix.blocks.map((b) => b.id)).toEqual(['policy', 'role']);
    });

    it('stops at the FIRST unstable block', () => {
      // A set-based selection would have taken `standards` as well —
      // and the cache would then have served an answer computed for a
      // prefix the request did not have.
      const request = aCachingRequest([
        block('policy'),
        block('envelope'),
        block('standards'),
      ]);

      const prefix = stablePrefixOf(request);

      expect(prefix.blocks.map((b) => b.id)).toEqual(['policy']);
    });

    it('is EMPTY when no block is stable', () => {
      const request = aCachingRequest([block('envelope'), block('task')]);

      expect(stablePrefixOf(request).blocks).toHaveLength(0);
    });

    it('is EMPTY when the request asks for NO caching', () => {
      const request = aCachingRequest([block('policy')], 'none');

      expect(stablePrefixOf(request).blocks).toHaveLength(0);
    });

    it('names the four block ids the corpus names', () => {
      // pack 02 §4.7: "the stable prefix only (policy, role, standards,
      // procedures)".
      expect([...STABLE_PREFIX_BLOCK_IDS]).toEqual([
        'policy',
        'role',
        'standards',
        'procedures',
      ]);
    });
  });

  describe('the breakpoint', () => {
    it('is at the END of the stable prefix', () => {
      const request = aCachingRequest([
        block('policy'),
        block('role'),
        block('envelope'),
      ]);

      const blocks = blocksWithBreakpoint(request);

      expect(blocks[1]?.cacheBreakpoint).toBe(true);
      expect(blocks[0]?.cacheBreakpoint).toBeUndefined();
      expect(blocks[2]?.cacheBreakpoint).toBeUndefined();
    });

    it('is NEVER on an untrusted block', () => {
      const request = aCachingRequest([
        block('policy'),
        block('envelope'),
        block('role'),
      ]);

      const blocks = blocksWithBreakpoint(request);

      // Only one block carries the mark, and it is the last stable
      // one — not the `role` block that follows the untrusted one.
      const marked = blocks.filter((b) => b.cacheBreakpoint === true);
      expect(marked).toHaveLength(1);
      expect(marked[0]?.id).toBe('policy');
    });

    it('is ABSENT when there is no stable block', () => {
      const request = aCachingRequest([block('envelope')]);

      const blocks = blocksWithBreakpoint(request);

      expect(
        blocks.some((b) => b.cacheBreakpoint === true),
      ).toBe(false);
    });

    it('is ABSENT when the request asks for NO caching', () => {
      const request = aCachingRequest([block('policy')], 'none');

      const blocks = blocksWithBreakpoint(request);

      expect(
        blocks.some((b) => b.cacheBreakpoint === true),
      ).toBe(false);
    });

    it('is carried to the PROVIDER', async () => {
      const { gateway, alpha } = buildGateway();

      await gateway.complete(
        aCachingRequest([block('policy'), block('role'), block('envelope')]),
      );

      expect(alpha.cacheBreakpointIndex).toBe(1);
    });

    it('is NOT carried when the request asks for NO caching', async () => {
      const { gateway, alpha } = buildGateway();

      await gateway.complete(aCachingRequest([block('policy')], 'none'));

      expect(alpha.cacheBreakpointIndex).toBeUndefined();
    });
  });

  describe('the cache key', () => {
    const prefix = stablePrefixOf(aCachingRequest([block('policy')]));

    it('includes the prefix hash', () => {
      const key = cacheKeyFor(prefix, 'a-model', 'v1');

      expect(key).toContain(prefix.sha256);
    });

    it('includes the MODEL VERSION', () => {
      // blueprint 11 §9.7: "The cache key includes the prefix hash
      // **and** the model version."
      const key = cacheKeyFor(prefix, 'a-model', 'v1');

      expect(key).toContain('v1');
    });

    it('is DIFFERENT for a different model version', () => {
      expect(cacheKeyFor(prefix, 'a-model', 'v1')).not.toBe(
        cacheKeyFor(prefix, 'a-model', 'v2'),
      );
    });

    it('is DIFFERENT for a different model', () => {
      expect(cacheKeyFor(prefix, 'a-model', 'v1')).not.toBe(
        cacheKeyFor(prefix, 'another-model', 'v1'),
      );
    });

    it('is DIFFERENT for a different prefix', () => {
      const other = stablePrefixOf(aCachingRequest([block('policy', 'other')]));

      expect(cacheKeyFor(prefix, 'a-model', 'v1')).not.toBe(
        cacheKeyFor(other, 'a-model', 'v1'),
      );
    });
  });

  describe('a cache hit', () => {
    it('is reported as CACHED', async () => {
      const { gateway } = buildGateway({
        alpha: { usage: { tokensIn: 0, tokensOut: 10, cacheRead: 500 } },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok && result.value.cached).toBe(true);
    });

    it('is recorded in the ledger as CACHED', async () => {
      const { gateway, calls } = buildGateway({
        alpha: { usage: { tokensIn: 0, tokensOut: 10, cacheRead: 500 } },
      });

      await gateway.complete(aRequest());

      expect(calls.records[0]?.cached).toBe(true);
    });

    it('is NOT reported as cached when nothing was read from the cache', async () => {
      const { gateway } = buildGateway({
        alpha: { usage: { tokensIn: 10, tokensOut: 10, cacheRead: 0 } },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok && result.value.cached).toBe(false);
    });
  });

  describe('a cache MISS', () => {
    it('is still CORRECT — the answer is the same', async () => {
      // blueprint 11 §9.7: "Caching is a cost optimisation only. A
      // cache miss is always correct."
      const { gateway } = buildGateway({
        alpha: { usage: { tokensIn: 10, tokensOut: 10, cacheRead: 0 } },
      });

      const result = await gateway.complete(aRequest());

      expect(result.ok).toBe(true);
      expect(result.ok && result.value.content).toBe('ok');
    });
  });
});
