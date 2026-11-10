/**
 * The broker's mutation harness.
 *
 * ## Why this exists
 *
 * A check that has never been **shown** to fail may be silently passing.
 * That is not a theoretical worry: in T-1.07 a mutation "survived" because
 * it changed nothing — the mutation was vacuous, and the suite's green was
 * meaningless.
 *
 * So this harness applies a named mutation to the broker's source, runs the
 * test file that is supposed to catch it, and reports whether the suite
 * **failed**. A mutation that survives means the oracle does not cover the
 * rule it claims to cover.
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
 * pnpm exec tsx tools/mutate-broker.ts
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
  {
    name: 'a policy engine that throws is allowed',
    file: 'packages/broker/src/broker.ts',
    search: `    } catch (error) {
      return {
        outcome: 'DENY',
        ruleIds: ['policy.engine_error'],`,
    replace: `    } catch (error) {
      return {
        outcome: 'ALLOW',
        ruleIds: [],`,
    test: 'tests/unit/broker-policy-fail-closed.test.ts',
  },
  {
    name: 'the credential is not stripped from the result',
    file: 'packages/broker/src/broker.ts',
    search: `    const contained = stripSecret(value, credential?.secret);`,
    replace: `    const contained = value;`,
    test: 'tests/unit/broker-credential-containment.test.ts',
  },
  {
    name: 'the timeout does not abort the call',
    file: 'packages/broker/src/broker.ts',
    search: `        controller.abort();`,
    replace: `        // MUTATION: the signal is never aborted.`,
    test: 'tests/unit/broker-timeout.test.ts',
  },
  {
    name: 'a failed attempt replays instead of being retried',
    file: 'packages/broker/src/broker.ts',
    search: `    if (record === undefined || record.status !== 'succeeded') {`,
    replace: `    if (record === undefined) {`,
    test: 'tests/unit/broker-idempotency.test.ts',
  },
  {
    name: 'the replay re-executes the capability',
    file: 'packages/broker/src/broker.ts',
    search: `    const replayed = await this.#replayOf(request, argsSha256);
    if (replayed !== undefined) {
      return replayed;
    }`,
    replace: `    const replayed = await this.#replayOf(request, argsSha256);
    if (replayed !== undefined && false) {
      return replayed;
    }`,
    test: 'tests/unit/broker-idempotency.test.ts',
  },
  {
    name: 'the approval is not bound to the arguments digest',
    file: 'packages/broker/src/broker.ts',
    search: `      const approved = await this.#options.approvals.hasApproval(
        request.capabilityId,
        argsSha256,
        context,
      );`,
    replace: `      const approved = await this.#options.approvals.hasApproval(
        request.capabilityId,
        'a-digest-that-is-not-the-arguments',
        context,
      );`,
    test: 'tests/unit/broker-approval.test.ts',
  },
  {
    name: 'the policy denial is not recorded as a security event',
    file: 'packages/broker/src/broker.ts',
    search: `    if (decision.outcome === 'DENY') {
      await this.#recordDenial(
        request,
        capability.capability,
        argsSha256,
        'policy',
        decision.reason,
        decision.ruleIds,
      );`,
    replace: `    if (decision.outcome === 'DENY') {`,
    test: 'tests/unit/broker-policy-fail-closed.test.ts',
  },
  {
    name: 'the capability ids are copied into the grant allow list',
    file: 'packages/broker/src/grants.ts',
    search: `  allow: [...grant.scopes],`,
    replace: `  allow: [...grant.scopes, ...grant.capabilities],`,
    test: 'tests/unit/broker-grant-mapper.test.ts',
  },
  {
    name: 'the schema validator ignores an unknown keyword',
    file: 'packages/broker/src/schema/json-schema.ts',
    search: `    if (!KNOWN_KEYWORDS.has(keyword)) {
      errors.push(\`\${path}: the schema uses the unknown keyword "\${keyword}"\`);
    }`,
    replace: `    if (false) {
      errors.push(\`\${path}: the schema uses the unknown keyword "\${keyword}"\`);
    }`,
    test: 'tests/unit/broker-schema-validator.test.ts',
  },
  {
    name: 'the registry accepts an advertised capability it does not list',
    file: 'packages/broker/src/registry.ts',
    search: `export const reconcileAgainst = (
  registered: readonly RegistryEntry[],
  transport: string,
  advertised: readonly string[],
): ReconciliationReport => {`,
    replace: `export const reconcileAgainst = (
  registered: readonly RegistryEntry[],
  transport: string,
  advertised: readonly string[],
): ReconciliationReport => {
  if (registered.length >= 0) {
    return { transport, advertised: [...advertised], findings: [] };
  }`,
    test: 'tests/unit/broker-mcp-reconciliation.test.ts',
  },
  {
    name: 'the deny-list is checked after the grant',
    file: 'packages/broker/src/broker.ts',
    search: `    const denied = this.#denyListed(capability.capability, request);`,
    replace: `    const denied = undefined as ReturnType<typeof this.#denyListed> | undefined;`,
    test: 'tests/unit/broker-a0-1-outside-grant.test.ts',
  },
  {
    name: 'the grant is not checked at all',
    file: 'packages/broker/src/broker.ts',
    search: `    const grantCheck = this.#granted(capability.capability, request);`,
    replace: `    const grantCheck = { granted: true, reason: '' } as ReturnType<typeof this.#granted>;`,
    test: 'tests/unit/broker-a0-1-outside-grant.test.ts',
  },
  {
    name: 'the resource scope is not checked',
    file: 'packages/broker/src/broker.ts',
    search: `    const scopeCheck = this.#inResourceScope(request);`,
    replace: `    const scopeCheck = { inScope: true, reason: '' } as ReturnType<typeof this.#inResourceScope>;`,
    test: 'tests/unit/broker-a0-1-outside-grant.test.ts',
  },
  {
    name: 'the adapter is invoked without the guard token',
    file: 'packages/broker/src/broker.ts',
    search: `    const token = this.#options.adapters.guardToken();`,
    replace: `    const token = Symbol('not-the-factory-token');`,
    test: 'tests/unit/broker-step-order.test.ts',
  },
];

/**
 * Run a test file and report whether it failed.
 *
 * A **failure** is the expected outcome for a caught mutation. A crash of
 * the runner itself is not a failure of the oracle — it is a failure of the
 * harness, and it is reported separately.
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
