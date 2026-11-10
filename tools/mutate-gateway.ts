/**
 * The gateway package's mutation harness.
 *
 * ## Why this exists
 *
 * A check that has never been **shown** to fail may be silently passing.
 * That is not a theoretical worry: in T-1.07 a mutation "survived" because
 * it changed nothing — the mutation was vacuous, and the suite's green was
 * meaningless.
 *
 * So this harness applies a named mutation to the gateway package's
 * source, runs the test file that is supposed to catch it, and reports
 * whether the suite **failed**. A mutation that survives means the oracle
 * does not cover the rule it claims to cover.
 *
 * ## The rules worth breaking
 *
 * The gateway holds the factory's **money** rule, its **safety** rule and
 * its **honesty** rule. Each mutation below breaks exactly one of them,
 * and names the test file that is supposed to catch it:
 *
 * 1. the money — the budget check stops happening before the call, the
 *    projection stops being an over-estimate, the cost stops being
 *    integer micro-USD, an unpriced model becomes free;
 * 2. the safety — an unknown model is routed to anyway, a provider whose
 *    catalogue cannot be read is assumed present, the failover ignores
 *    `neverOn`, the structured output is not re-validated, the repair
 *    attempt is unbounded;
 * 3. the honesty — the ledger records the wrong provider, the replay
 *    calls the provider again, the cache breakpoint moves off the stable
 *    prefix.
 *
 * ## How a mutation is declared
 *
 * A mutation is a **file**, a **search string**, and a **replacement**. The
 * harness:
 *
 * 1. reads the file;
 * 2. asserts the search string is present **exactly once** — a mutation that
 *    matches zero times or many times is *vacuous*, and it is reported as
 *    such rather than as a survivor;
 * 3. writes the mutated file in place, runs the tests, and restores the
 *    original in a `finally`, so a failing run still restores the file.
 *
 * ## Running it
 *
 * ```bash
 * pnpm run test:mutation:gateway
 * ```
 *
 * The exit code is non-zero when a mutation survives or is vacuous.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = resolve(import.meta.dirname, '..');

/**
 * A mutation.
 */
interface Mutation {
  /** The rule it breaks. */
  readonly name: string;
  /** The file it mutates, relative to the repo root. */
  readonly file: string;
  /** The text it replaces — must appear exactly once. */
  readonly search: string;
  /** The text it puts in its place. */
  readonly replace: string;
  /** The test file that must fail. */
  readonly test: string;
}

/**
 * The mutations.
 *
 * Each one breaks exactly **one** rule, and names the test file that is
 * supposed to catch it.
 */
const MUTATIONS: readonly Mutation[] = [
  // ---- the money ----------------------------------------------------
  {
    name: 'the budget is checked AFTER the call, not before',
    file: 'packages/gateway/src/gateway.ts',
    search: `    // ---- 3. the budget, BEFORE the call ------------------------------
    const budget = await this.#checkBudget(request, route.candidates);
    if (budget !== undefined) {
      return budget;
    }`,
    replace: `    // ---- 3. the budget, BEFORE the call ------------------------------
    // MUTATION: the budget is no longer checked before the call.`,
    test: 'tests/unit/gateway-budget.test.ts',
  },
  {
    name: 'the budget is checked against the LIMIT, not the remaining',
    file: 'packages/gateway/src/budget.ts',
    search: `  return Math.max(0, amount.limitUsdMicros - amount.spentUsdMicros);`,
    replace: `  return amount.limitUsdMicros;`,
    test: 'tests/unit/gateway-budget.test.ts',
  },
  {
    name: 'the tightest scope does not win — the request scope always does',
    file: 'packages/gateway/src/budget.ts',
    search: `  for (const [scope, amount] of scopes) {
    if (amount === undefined) {
      continue;
    }
    if (projectedUsdMicros > remainingOf(amount)) {
      return { scope, amount };
    }
  }`,
    replace: `  for (const [scope, amount] of scopes) {
    if (amount === undefined) {
      continue;
    }
    if (scope === 'request' && projectedUsdMicros > remainingOf(amount)) {
      return { scope, amount };
    }
  }`,
    test: 'tests/unit/gateway-budget.test.ts',
  },
  {
    name: 'the projection stops being an over-estimate',
    file: 'packages/gateway/src/gateway.ts',
    search: `    const projected = projectCost(
      price,
      estimate.tokensIn,
      Math.min(estimate.maxOutputTokens, this.#options.maxOutputTokens ?? estimate.maxOutputTokens),
    );`,
    replace: `    const projected = projectCost(
      price,
      estimate.tokensIn,
      0,
    );`,
    test: 'tests/unit/gateway-budget.test.ts',
  },
  {
    name: 'the cost is no longer rounded to integer micro-USD',
    file: 'packages/gateway/src/pricing.ts',
    search: `  return Math.round((tokens * pricePerMillionUsdMicros) / TOKENS_PER_MILLION);`,
    replace: `  return (tokens * pricePerMillionUsdMicros) / TOKENS_PER_MILLION;`,
    test: 'tests/unit/gateway-pricing.test.ts',
  },
  {
    name: 'an unpriced model is treated as free',
    file: 'packages/gateway/src/pricing.ts',
    search: `  if (price === undefined) {
    return {
      ok: false,
      reason:
        \`the model "\${model}" has no price in the pricing table; \` +
        'an unpriced model is refused rather than treated as free',
    };
  }`,
    replace: `  if (price === undefined) {
    return { ok: true, costUsdMicros: 0 };
  }`,
    test: 'tests/unit/gateway-pricing.test.ts',
  },
  {
    name: 'the token classes are priced as one',
    file: 'packages/gateway/src/pricing.ts',
    search: `export const costOfCall = (tokens: TokenCounts, price: PriceEntry): number =>
  costOfTokens(tokens.tokensIn, price.inputPerMillionUsdMicros) +
  costOfTokens(tokens.tokensOut, price.outputPerMillionUsdMicros) +
  costOfTokens(tokens.cacheRead, price.cacheReadPerMillionUsdMicros) +
  costOfTokens(tokens.cacheWrite, price.cacheWritePerMillionUsdMicros);`,
    replace: `export const costOfCall = (tokens: TokenCounts, price: PriceEntry): number =>
  costOfTokens(tokens.tokensIn, price.inputPerMillionUsdMicros);`,
    test: 'tests/unit/gateway-pricing.test.ts',
  },

  // ---- the safety ---------------------------------------------------
  {
    name: 'an unknown model is routed to anyway',
    file: 'packages/gateway/src/catalog.ts',
    search: `  if (!catalog.models.includes(model)) {`,
    replace: `  if (false) {`,
    test: 'tests/unit/gateway-models-check.test.ts',
  },
  {
    name: 'a provider whose catalogue cannot be read is assumed present',
    file: 'packages/gateway/src/catalog.ts',
    search: `  if (catalog.kind === 'unavailable') {`,
    replace: `  if (false) {`,
    test: 'tests/unit/gateway-models-check.test.ts',
  },
  {
    name: 'the gateway does not check the models before the call',
    file: 'packages/gateway/src/gateway.ts',
    search: `    const modelCheck = await this.#checkModels(route.candidates);
    if (modelCheck !== undefined) {
      return modelCheck;
    }`,
    replace: `    // MUTATION: the models are not checked before the call.`,
    test: 'tests/unit/gateway-models-check.test.ts',
  },
  {
    name: 'the failover ignores the policy\'s neverOn',
    file: 'packages/gateway/src/gateway.ts',
    search: `    if (failover.neverOn.includes(trigger)) {
      return false;
    }`,
    replace: `    // MUTATION: neverOn is ignored.`,
    test: 'tests/unit/gateway-failover.test.ts',
  },
  {
    name: 'the failover ignores the policy\'s on',
    file: 'packages/gateway/src/gateway.ts',
    search: `    return failover.on.includes(trigger);`,
    replace: `    return true;`,
    test: 'tests/unit/gateway-failover.test.ts',
  },
  {
    name: 'the structured answer is not re-validated with Zod',
    file: 'packages/gateway/src/structured.ts',
    search: `  const parsed = schema.safeParse(value);

  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }`,
    replace: `  const parsed = schema.safeParse(value);

  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  // MUTATION: an invalid answer is accepted as-is.
  return { ok: true, value };`,
    test: 'tests/unit/gateway-structured-output.test.ts',
  },
  {
    name: 'the repair attempt is unbounded',
    file: 'packages/gateway/src/structured.ts',
    search: `export const STRUCTURED_ATTEMPTS = 2;`,
    replace: `export const STRUCTURED_ATTEMPTS = 5;`,
    test: 'tests/unit/gateway-structured-output.test.ts',
  },
  {
    name: 'the structured failure is a provider error, not model.reasoning',
    file: 'packages/gateway/src/structured.ts',
    search: `export const STRUCTURED_FAILURE_CLASS = 'model.reasoning';`,
    replace: `export const STRUCTURED_FAILURE_CLASS = 'model.capability';`,
    test: 'tests/unit/gateway-structured-output.test.ts',
  },
  {
    name: 'a structured request with no schema is answered anyway',
    file: 'packages/gateway/src/gateway.ts',
    search: `    if (this.#options.structuredSchema !== undefined) {
      return undefined;
    }`,
    replace: `    // MUTATION: a structured request with no schema is answered anyway.`,
    test: 'tests/unit/gateway-structured-output.test.ts',
  },

  // ---- the honesty ---------------------------------------------------
  {
    name: 'the ledger records the primary even after a failover',
    file: 'packages/gateway/src/gateway.ts',
    search: `        const record: ModelCallRecord = {
          id: this.#options.nextId(),
          taskId: request.taskId,
          provider: candidate.provider,
          model: candidate.model,`,
    replace: `        const record: ModelCallRecord = {
          id: this.#options.nextId(),
          taskId: request.taskId,
          provider: candidates[0]?.provider ?? candidate.provider,
          model: candidates[0]?.model ?? candidate.model,`,
    test: 'tests/unit/gateway-failover.test.ts',
  },
  {
    name: 'the replay calls the provider again',
    file: 'packages/gateway/src/gateway.ts',
    search: `    const recorded = await this.#options.calls.findByKey(key);
    if (recorded !== undefined) {`,
    replace: `    const recorded = undefined as Awaited<ReturnType<typeof this.#options.calls.findByKey>>;
    if (recorded !== undefined) {`,
    test: 'tests/unit/gateway-idempotency.test.ts',
  },
  {
    name: 'the idempotency key drops the model version',
    file: 'packages/gateway/src/idempotency.ts',
    search: `      parts.promptSha256,
      parts.modelVersion,
    ].join(SEPARATOR),`,
    replace: `      parts.promptSha256,
    ].join(SEPARATOR),`,
    test: 'tests/unit/gateway-idempotency.test.ts',
  },
  {
    name: 'the idempotency key drops the attempt',
    file: 'packages/gateway/src/idempotency.ts',
    search: `      String(parts.attempt),
      parts.promptSha256,`,
    replace: `      parts.promptSha256,`,
    test: 'tests/unit/gateway-idempotency.test.ts',
  },
  {
    name: 'the cache breakpoint moves off the stable prefix',
    file: 'packages/gateway/src/caching.ts',
    search: `  return blocks.map((block, index) =>
    index === prefix.breakpointIndex - 1 && prefix.blocks.length > 0
      ? { ...block, cacheBreakpoint: true }
      : { ...block },
  );`,
    replace: `  return blocks.map((block) => ({ ...block }));`,
    test: 'tests/unit/gateway-caching.test.ts',
  },
  {
    name: 'the stable prefix is no longer a leading run',
    file: 'packages/gateway/src/caching.ts',
    search: `  for (const block of blocks) {
    if (!isStable(block)) {
      break;
    }
    prefix.push(block);
  }`,
    replace: `  for (const block of blocks) {
    if (isStable(block)) {
      prefix.push(block);
    }
  }`,
    test: 'tests/unit/gateway-caching.test.ts',
  },
  {
    name: 'the cache key drops the model version',
    file: 'packages/gateway/src/caching.ts',
    search: `): string => \`\${prefix.sha256}::\${model}::\${modelVersion}\`;`,
    replace: `): string => \`\${prefix.sha256}::\${model}\`;`,
    test: 'tests/unit/gateway-caching.test.ts',
  },
  {
    name: 'the route falls back to a default class',
    file: 'packages/gateway/src/routing.ts',
    search: `  const rule = policy.spec.rules.find((candidate) => matches(candidate.match, input));`,
    replace: `  const rule =
    policy.spec.rules.find((candidate) => matches(candidate.match, input)) ??
    policy.spec.rules[0];`,
    test: 'tests/unit/gateway-routing.test.ts',
  },
  {
    name: 'a fallback to the same provider is accepted',
    file: 'packages/gateway/src/routing.ts',
    search: `      if (fallback.provider === routeClass.primary.provider) {`,
    replace: `      if (false) {`,
    test: 'tests/unit/gateway-routing.test.ts',
  },
];

/**
 * Run a test file and report whether it failed.
 *
 * A **failure** is the expected outcome for a caught mutation. A crash of
 * the runner itself is not a failure of the oracle — it is a failure of
 * the harness, and it is reported separately.
 */
const testsFailed = async (file: string): Promise<boolean> => {
  try {
    await execFileAsync(
      'pnpm',
      ['exec', 'vitest', 'run', file, '--reporter=dot'],
      { cwd: repoRoot, timeout: 300_000, maxBuffer: 32 * 1024 * 1024 },
    );
    return false;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 1) {
      // Vitest exits 1 when the suite fails. That is the mutation being
      // caught.
      return true;
    }
    throw error;
  }
};

/**
 * Run every mutation.
 */
const main = async (): Promise<void> => {
  let survived = 0;
  let vacuous = 0;
  let caught = 0;

  for (const mutation of MUTATIONS) {
    const path = join(repoRoot, mutation.file);
    const original = await readFile(path, 'utf8');

    const occurrences = original.split(mutation.search).length - 1;
    if (occurrences !== 1) {
      process.stdout.write(
        `VACUOUS  ${mutation.name} — the search text appears ${String(occurrences)} times in ${mutation.file}\n`,
      );
      vacuous += 1;
      continue;
    }

    await writeFile(path, original.replace(mutation.search, mutation.replace), 'utf8');

    let wasCaught = false;
    try {
      wasCaught = await testsFailed(mutation.test);
    } finally {
      await writeFile(path, original, 'utf8');
    }

    if (wasCaught) {
      caught += 1;
      process.stdout.write(`CAUGHT   ${mutation.name}\n`);
    } else {
      survived += 1;
      process.stdout.write(
        `SURVIVED ${mutation.name} — ${mutation.test} did not fail\n`,
      );
    }
  }

  process.stdout.write(
    `\n${String(caught)} caught, ${String(survived)} survived, ${String(vacuous)} vacuous\n`,
  );

  if (survived > 0 || vacuous > 0) {
    process.exitCode = 1;
  }
};

await main();
