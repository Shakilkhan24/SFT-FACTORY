/**
 * `gateway` — the pricing table and the cost computation.
 *
 * ## Why the cost is integer micro-USD
 *
 * pack 04 §6: "Costs are integer micro-USD."
 *
 * Not "rounded to" — **integer**. A cost computed in floating-point
 * dollars accumulates error, and the error lands on the *budget* check:
 * a request that costs 1499999.9999 micro-USD instead of 1500000 either
 * slips past a ceiling that should have stopped it, or stops a request
 * that should have been allowed. A budget check on a float is a budget
 * check on a coin flip near the limit.
 *
 * So the whole computation is integer arithmetic on micro-USD, and the
 * price itself is quoted **per million tokens** — the unit the
 * providers publish — as an integer number of micro-USD.
 *
 * ## The arithmetic
 *
 * ```
 * cost(tokens, pricePerMillion) = round(tokens * pricePerMillion / 1_000_000)
 * ```
 *
 * `tokens * pricePerMillion` is computed as an exact integer (both
 * operands are integers, so the product is), and only the final
 * division rounds. Rounding **once**, at the end, rather than per
 * token class and then summing, is what makes the total equal to the
 * cost of the whole request rather than the sum of four roundings.
 *
 * ## A model with no price is refused, not free
 *
 * The alternative — treating an unpriced model as costing zero — makes
 * the budget check a no-op for that model. An unpriced model is a
 * **configuration gap**, and the gateway refuses to route to it.
 */

import type { PriceEntry, PricingTable, TokenCounts } from './types.js';

/**
 * The tokens in a million.
 */
const TOKENS_PER_MILLION = 1_000_000;

/**
 * The cost of a token count at a price, in integer micro-USD.
 *
 * The product is exact; the division rounds half **up**, which is the
 * convention the golden cost tests assert.
 */
export const costOfTokens = (tokens: number, pricePerMillionUsdMicros: number): number => {
  if (tokens < 0) {
    throw new RangeError(`a token count cannot be negative (got ${String(tokens)})`);
  }
  if (pricePerMillionUsdMicros < 0) {
    throw new RangeError(
      `a price cannot be negative (got ${String(pricePerMillionUsdMicros)})`,
    );
  }
  return Math.round((tokens * pricePerMillionUsdMicros) / TOKENS_PER_MILLION);
};

/**
 * The cost of a whole call, in integer micro-USD.
 *
 * The four token classes are priced separately — a cache read is
 * cheaper than a fresh input token — and the **total** is the sum.
 */
export const costOfCall = (tokens: TokenCounts, price: PriceEntry): number =>
  costOfTokens(tokens.tokensIn, price.inputPerMillionUsdMicros) +
  costOfTokens(tokens.tokensOut, price.outputPerMillionUsdMicros) +
  costOfTokens(tokens.cacheRead, price.cacheReadPerMillionUsdMicros) +
  costOfTokens(tokens.cacheWrite, price.cacheWritePerMillionUsdMicros);

/**
 * The outcome of pricing a call.
 */
export type PricingResult =
  | { readonly ok: true; readonly costUsdMicros: number }
  | { readonly ok: false; readonly reason: string };

/**
 * Price a call against the table.
 *
 * @param table the pricing table.
 * @param model the model id — the key into the table.
 * @param tokens the token counts.
 */
export const priceCall = (
  table: PricingTable,
  model: string,
  tokens: TokenCounts,
): PricingResult => {
  const price = table[model];

  if (price === undefined) {
    return {
      ok: false,
      reason:
        `the model "${model}" has no price in the pricing table; ` +
        'an unpriced model is refused rather than treated as free',
    };
  }

  return { ok: true, costUsdMicros: costOfCall(tokens, price) };
};

/**
 * The **projected** cost of a request, before the call.
 *
 * blueprint 15 §4.5: *"Before a request, the gateway projects its cost
 * from the token estimate; a request that would breach the budget is
 * refused **before** it is made."*
 *
 * The projection uses the **most expensive** class — the output tokens.
 * The output count is not known before the call, so the estimate takes
 * the maximum the request could produce, and the **input** tokens are
 * what is actually known.
 *
 * The projection is deliberately **an over-estimate**, not a guess at
 * the middle: a budget check that under-estimates lets the request
 * through and overruns the ceiling, which is the failure the check
 * exists to prevent.
 *
 * @param price the model's price.
 * @param tokensIn the known input tokens.
 * @param maxOutputTokens the maximum output tokens the request may produce.
 */
export const projectCost = (
  price: PriceEntry,
  tokensIn: number,
  maxOutputTokens: number,
): number =>
  costOfTokens(tokensIn, price.inputPerMillionUsdMicros) +
  costOfTokens(maxOutputTokens, price.outputPerMillionUsdMicros);
