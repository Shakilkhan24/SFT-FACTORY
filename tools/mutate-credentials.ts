/**
 * The credentials package's mutation harness.
 *
 * ## Why this exists
 *
 * A check that has never been **shown** to fail may be silently passing.
 * That is not a theoretical worry: in T-1.07 a mutation "survived" because
 * it changed nothing — the mutation was vacuous, and the suite's green was
 * meaningless.
 *
 * So this harness applies a named mutation to the credentials package's
 * source, runs the test file that is supposed to catch it, and reports
 * whether the suite **failed**. A mutation that survives means the oracle
 * does not cover the rule it claims to cover.
 *
 * ## The rules worth breaking
 *
 * The credentials package holds the factory's **least privilege** rule, its
 * **containment** rule and its **lifetime** rule. Each mutation below
 * breaks exactly one of them, and names the test file that is supposed to
 * catch it:
 *
 * 1. the intersection — the deny-list stops overriding, the grant stops
 *    narrowing, the empty scope stops being a refusal;
 * 2. the containment — the lease starts carrying the material;
 * 3. the lifetime — the TTL cap is removed, the expiry is not bounded, the
 *    revocation is not recorded.
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
 * pnpm run test:mutation:credentials
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
    name: 'the deny-list no longer overrides the allow-list',
    file: 'packages/credentials/src/scope.ts',
    search: `    if (denied.has(scope)) {
      return false;
    }
    return inputs.allowed.includes(scope);`,
    replace: `    return inputs.allowed.includes(scope);`,
    test: 'tests/unit/credentials-scope.test.ts',
  },
  {
    name: 'the grant no longer narrows the capability’s ask',
    file: 'packages/credentials/src/scope.ts',
    search: `    return inputs.allowed.includes(scope);`,
    replace: `    return true;`,
    test: 'tests/unit/credentials-scope.test.ts',
  },
  {
    name: 'an empty intersection is a degraded credential, not a refusal',
    file: 'packages/credentials/src/scope.ts',
    search: `  if (surviving.length === 0) {
    return {
      ok: false,
      error: factoryError(
        'policy.denied',
        'the credential scope is empty: the capability needs a scope the grant does not allow',
        false,
        {
          required: [...inputs.required],
          allowed: [...inputs.allowed],
          denied: [...denied],
        },
      ),
    };
  }`,
    replace: `  // MUTATION: an empty intersection is no longer a refusal.`,
    test: 'tests/unit/credentials-scope.test.ts',
  },
  {
    name: 'no repository in scope is no longer a refusal',
    file: 'packages/credentials/src/scope.ts',
    search: `  if (inputs.repositories.length === 0) {
    return {
      ok: false,
      error: factoryError(
        'policy.denied',
        'the credential scope is empty: no repository is in scope',
        false,
        { required: [...inputs.required], allowed: [...inputs.allowed] },
      ),
    };
  }`,
    replace: `  // MUTATION: no repository in scope is no longer a refusal.`,
    test: 'tests/unit/credentials-scope.test.ts',
  },
  {
    name: 'a permission the grant omits is kept at the computed level',
    file: 'packages/credentials/src/scope.ts',
    search: `    const granted = grantPermissions[permission];
    if (granted === undefined) {
      continue;
    }`,
    replace: `    const granted = grantPermissions[permission];
    if (granted === undefined) {
      narrowed[permission] = level;
      continue;
    }`,
    test: 'tests/unit/credentials-scope.test.ts',
  },
  {
    name: 'a PR stage is given the contents permission',
    file: 'packages/credentials/src/scope.ts',
    search: `  'repo:write:pr': {
    pull_requests: 'write',
    metadata: 'read',
  },`,
    replace: `  'repo:write:pr': {
    pull_requests: 'write',
    contents: 'write',
    metadata: 'read',
  },`,
    test: 'tests/unit/credentials-scope.test.ts',
  },
  {
    name: 'the TTL is not capped at one hour',
    file: 'packages/credentials/src/scope.ts',
    search: `export const effectiveTtlSeconds = (requested: number): number =>
  Math.min(requested, MAX_CREDENTIAL_TTL_SECONDS);`,
    replace: `export const effectiveTtlSeconds = (requested: number): number => requested;`,
    test: 'tests/unit/credentials-scope.test.ts',
  },
  {
    name: 'the lease carries the credential’s material',
    file: 'packages/credentials/src/broker.ts',
    search: `      scope: {
        scopes: effective.scopes,
        permissions: effective.permissions,
        repositories: effective.repositories,
      },`,
    replace: `      scope: {
        scopes: effective.scopes,
        permissions: effective.permissions,
        repositories: effective.repositories,
        secret: minted.secret,
      } as unknown as CredentialLease['scope'],`,
    test: 'tests/unit/credentials-broker.test.ts',
  },
  {
    name: 'the provider’s expiry is not bounded by the broker’s ceiling',
    file: 'packages/credentials/src/broker.ts',
    search: `    const expiresAt =
      Date.parse(minted.expiresAt) > Date.parse(ceiling)
        ? ceiling
        : minted.expiresAt;`,
    replace: `    const expiresAt = minted.expiresAt;`,
    test: 'tests/unit/credentials-broker.test.ts',
  },
  {
    name: 'the lease is not marked revoked when the provider fails',
    file: 'packages/credentials/src/broker.ts',
    search: `      await this.#options.leases.markRevoked(
        lease.id,
        this.#options.clock.nowIso(),
      );
    }

    // The material leaves this process too.`,
    replace: `      // MUTATION: the lease is not marked revoked.
    }

    // The material leaves this process too.`,
    test: 'tests/unit/credentials-broker.test.ts',
  },
  {
    name: 'revoking task_1 also revokes task_10',
    file: 'packages/credentials/src/broker.ts',
    search: '      if (key.startsWith(`${taskId}:`)) {',
    replace: '      if (key.startsWith(taskId)) {',
    test: 'tests/unit/credentials-broker.test.ts',
  },
  {
    name: 'a revoked lease is revoked again',
    file: 'packages/credentials/src/broker.ts',
    search: `      if (lease.revokedAt !== undefined) {
        continue;
      }`,
    replace: `      // MUTATION: an already-revoked lease is revoked again.`,
    test: 'tests/unit/credentials-broker.test.ts',
  },
  {
    name: 'the minted token is not added to the redaction set',
    file: 'packages/credentials/src/broker.ts',
    search: `    this.#options.redaction?.addMinted(minted.secret);`,
    replace: `    // MUTATION: the minted token is not added to the redaction set.`,
    test: 'tests/unit/credentials-broker-integration.test.ts',
  },
  {
    name: 'the exact-match layer is removed',
    file: 'packages/credentials/src/redaction.ts',
    search: `      if (!value.includes(needle)) {
        continue;
      }
      value = value.split(needle).join(REDACTION_PLACEHOLDER);
      applied.push({ rule, digest: sha256(needle) });`,
    replace: `      // MUTATION: the exact-match layer is removed.`,
    test: 'tests/unit/credentials-redaction.test.ts',
  },
  {
    name: 'the high-entropy rule redacts a bare high-entropy string',
    file: 'packages/credentials/src/redaction.ts',
    search: `  apply(
    HIGH_ENTROPY_NEAR_SECRET_WORD,
    'pattern.high-entropy',
    (match) => {
      const separator = match.match(/^(key|token|secret|password|passwd|pwd)["'\\s:=]{1,4}/i);
      const prefix = separator === null ? '' : separator[0];
      return \`\${prefix}\${REDACTION_PLACEHOLDER}\`;
    },
  );`,
    replace: `  apply(
    /[A-Za-z0-9+/=_-]{20,}/g,
    'pattern.high-entropy',
    () => REDACTION_PLACEHOLDER,
  );`,
    test: 'tests/unit/credentials-redaction.test.ts',
  },
  {
    name: 'the secret store returns undefined instead of throwing',
    file: 'packages/credentials/src/secret-store.ts',
    search: `      const value = held.get(name);
      if (value === undefined) {
        throw new MissingSecretError(name);
      }
      return value;`,
    replace: `      const value = held.get(name);
      if (value === undefined) {
        return '';
      }
      return value;`,
    test: 'tests/unit/credentials-secret-store.test.ts',
  },
  {
    name: 'the secret store enumerates its VALUES',
    file: 'packages/credentials/src/secret-store.ts',
    search: `    names(): readonly string[] {
      return [...held.keys()].sort();
    },`,
    replace: `    names(): readonly string[] {
      return [...held.values()].sort();
    },`,
    test: 'tests/unit/credentials-secret-store.test.ts',
  },
  {
    name: 'the store does not copy the map on the way in',
    file: 'packages/credentials/src/secret-store.ts',
    search: `  const held: ReadonlyMap<string, string> = new Map(
    Object.entries(values),
  );`,
    replace: `  const held: ReadonlyMap<string, string> = values as ReadonlyMap<
    string,
    string
  >;`,
    test: 'tests/unit/credentials-secret-store.test.ts',
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
