/**
 * `gateway` — the cache breakpoints.
 *
 * ## The rules
 *
 * blueprint 11 §9.7:
 *
 * | Rule | Detail |
 * |---|---|
 * | Only the stable prefix is cached. | The task-specific and untrusted sections vary and are never cached. |
 * | The cache key includes the prefix hash and the model version. | A provider-side cache must never serve a different prefix's result. |
 * | Caching is a cost optimisation only. | A cache miss is always correct. The factory never depends on a cache hit for correctness. |
 *
 * pack 02 §4.7: *"place cache breakpoints at the end of the stable prefix only (policy, role,
 * standards, procedures); the untrusted envelope and task come after."*
 *
 * ## Which blocks are the stable prefix
 *
 * The request's `system` blocks carry an `id`. The stable ones are the
 * ones the corpus names: **policy**, **role**, **standards**,
 * **procedures**. Everything else — the untrusted envelope, the task
 * itself — varies between turns of the same stage and must never be
 * cached.
 *
 * The gateway therefore takes the **leading** run of stable blocks and
 * puts the breakpoint at the end of it. Taking a *leading run* rather
 * than "all the stable blocks" matters: if an unstable block sat
 * between two stable ones, a set-based selection would cache the second
 * one — and the cache would then serve an answer computed for a prefix
 * that included a block the request did not actually have.
 *
 * A request with **no** stable block has **no** prefix and **no**
 * breakpoint. Nothing is cached, and the call is simply uncached — which
 * is always correct (blueprint 11 §9.7: "a cache miss is always
 * correct").
 *
 * ## The cache key
 *
 * The key is the prefix's hash **and the model version**. Two requests
 * with the same prefix but different models must not share a cache
 * entry — the answers would not be interchangeable.
 */

import { sha256 } from '@factory/core';

import type { ModelRequest, SystemBlock } from '@factory/contracts';

/**
 * The block ids that make up the stable prefix.
 *
 * pack 02 §4.7: "the stable prefix only (policy, role, standards,
 * procedures)".
 *
 * These are **not** model ids — they are the ids the context assembler
 * gives the blocks it puts in the request's `system`.
 */
export const STABLE_PREFIX_BLOCK_IDS = [
  'policy',
  'role',
  'standards',
  'procedures',
] as const;

/**
 * The outcome of finding the stable prefix.
 */
export interface StablePrefix {
  /** The blocks that form the prefix, in order. */
  readonly blocks: readonly SystemBlock[];
  /** The hash of the prefix's canonical form. */
  readonly sha256: string;
  /** Where the breakpoint goes — after the last block of the prefix. */
  readonly breakpointIndex: number;
}

/**
 * Is this block part of the stable prefix?
 */
const isStable = (block: SystemBlock): boolean =>
  (STABLE_PREFIX_BLOCK_IDS as readonly string[]).includes(block.id);

/**
 * Find the request's stable prefix.
 *
 * The prefix is the **leading run** of stable blocks. When the request
 * asks for no caching, or has no stable block, the prefix is empty and
 * there is no breakpoint.
 *
 * @param request the model request.
 */
export const stablePrefixOf = (request: ModelRequest): StablePrefix => {
  const blocks = request.system ?? [];

  // No caching was asked for. There is no prefix to find.
  if (request.cachePolicy !== 'prefix') {
    return { blocks: [], sha256: sha256(''), breakpointIndex: 0 };
  }

  const prefix: SystemBlock[] = [];

  for (const block of blocks) {
    if (!isStable(block)) {
      break;
    }
    prefix.push(block);
  }

  if (prefix.length === 0) {
    return { blocks: [], sha256: sha256(''), breakpointIndex: 0 };
  }

  const canonical = JSON.stringify(
    prefix.map((block) => ({ id: block.id, body: block.body })),
  );

  return {
    blocks: prefix,
    sha256: sha256(canonical),
    breakpointIndex: prefix.length,
  };
};

/**
 * The cache key for a request.
 *
 * blueprint 11 §9.7: *"The cache key includes the prefix hash and the
 * model version."*
 *
 * The key is a string, so the two parts cannot be confused with one
 * another — the prefix hash and the model version are separated by a
 * character neither can contain.
 *
 * @param prefix the request's stable prefix.
 * @param model the model id.
 * @param modelVersion the model's version.
 */
export const cacheKeyFor = (
  prefix: StablePrefix,
  model: string,
  modelVersion: string,
): string => `${prefix.sha256}::${model}::${modelVersion}`;

/**
 * The blocks to send, with the breakpoint marked.
 *
 * The breakpoint goes at the **end of the stable prefix** and nowhere
 * else — pack 02 §4.7. A breakpoint on an untrusted block would cache
 * a per-turn prefix, which is not a cache but a leak of the turn's
 * content into the provider's cache.
 */
export const blocksWithBreakpoint = (
  request: ModelRequest,
): readonly (SystemBlock & { readonly cacheBreakpoint?: boolean })[] => {
  const prefix = stablePrefixOf(request);
  const blocks = request.system ?? [];

  return blocks.map((block, index) =>
    index === prefix.breakpointIndex - 1 && prefix.blocks.length > 0
      ? { ...block, cacheBreakpoint: true }
      : { ...block },
  );
};
