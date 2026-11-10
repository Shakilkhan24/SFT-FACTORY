/**
 * The access-point API's mutation harness.
 *
 * ## Why this exists
 *
 * A check that has never been **shown** to fail may be silently passing.
 * That is not a theoretical worry in this repo: in T-1.07 a mutation
 * "survived" because it changed nothing; in T-1.11 one survived because
 * the test asserted a **constant against itself**; in T-1.12 four
 * survived, three of them because two different checks could produce the
 * *same* refusal, so a test asserting either one passed even when the
 * check it meant was gone.
 *
 * T-1.14 found two real defects *by reading*, and then wrote tests for
 * them — the dead idempotency-conflict check, and the rate-limited health
 * check. Those two mutations are in this harness, because a regression on
 * either would be silent: the tests would still be green if the rule came
 * back wrong in the other direction.
 *
 * So this harness applies a named mutation to the API's source, runs the
 * test file that is supposed to catch it, and reports whether the suite
 * **failed**. A mutation that survives means the oracle does not cover
 * the rule it claims to cover.
 *
 * ## The rules worth breaking
 *
 * The API is the factory's **control surface** — the write path that
 * merges code, stops the fleet and spends money. Each mutation below
 * breaks exactly one rule, and names the test file that is supposed to
 * catch it:
 *
 * 1. the **authentication** — the allow-list, the CSRF check, the token
 *    checks, the scope check;
 * 2. the **idempotency** — the key is required, a repeat is a replay, a
 *    key on a different route is a conflict, a failed call does not
 *    consume the key;
 * 3. the **events** — the actor is derived, the authority is derived, a
 *    refused call records nothing;
 * 4. the **access points** — the kill switch refuses intake, the
 *    approver list, the hash binding, the expiry, the TTL cap;
 * 5. the **rate limit** — it applies by default, the health checks are
 *    exempt;
 * 6. the **inventory** — the schemas are strict, so no free-form
 *    instruction field can be smuggled in.
 *
 * ## How a mutation is declared
 *
 * A mutation is a **file**, a **search string**, and a **replacement**. The
 * harness:
 *
 * 1. reads the file;
 * 2. asserts the search string is present **exactly once** — a mutation
 *    that matches zero times or many times is *vacuous*, and it is
 *    reported as such rather than as a survivor;
 * 3. writes the mutated file in place, runs the tests, and restores the
 *    original in a `finally`, so a failing run still restores the file.
 *
 * ## Running it
 *
 * ```bash
 * pnpm run test:mutation:api
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
  // ---- the authentication ---------------------------------------------
  {
    name: 'the allow-list is not checked for a session',
    file: 'apps/api/src/auth.ts',
    search: `  if (!(await deps.allowList.isAllowed(session.login))) {
    return {
      ok: false,
      refusal: unauthenticated(
        \`"\${session.login}" is not on the factory's allow-list\`,
      ),
    };
  }`,
    replace: `  // MUTATION: the allow-list is not checked for a session.`,
    test: 'tests/unit/api-auth.test.ts',
  },
  {
    name: 'the allow-list is not checked for a CLI token',
    file: 'apps/api/src/auth.ts',
    search: `    if (!(await deps.allowList.isAllowed(token.login))) {
      return {
        ok: false,
        refusal: unauthenticated(
          \`"\${token.login}" is not on the factory's allow-list\`,
        ),
      };
    }`,
    replace: `    // MUTATION: the allow-list is not checked for a CLI token.`,
    test: 'tests/unit/api-auth.test.ts',
  },
  {
    name: 'the CSRF token is not checked on a mutating call',
    file: 'apps/api/src/auth.ts',
    search: `  if (needsCsrf) {
    if (credentials.csrfToken === undefined) {`,
    replace: `  if (false) {
    if (credentials.csrfToken === undefined) {`,
    test: 'tests/unit/api-auth.test.ts',
  },
  {
    name: 'the CSRF token is compared to nothing',
    file: 'apps/api/src/auth.ts',
    search: `    if (credentials.csrfToken !== session.csrfToken) {`,
    replace: `    if (false) {`,
    test: 'tests/unit/api-auth.test.ts',
  },
  {
    name: 'a revoked CLI token is still accepted',
    file: 'apps/api/src/auth.ts',
    search: `    if (token.revokedAt !== undefined) {
      return {
        ok: false,
        refusal: unauthenticated('the bearer token has been revoked'),
      };
    }`,
    replace: `    // MUTATION: a revoked CLI token is still accepted.`,
    test: 'tests/unit/api-auth.test.ts',
  },
  {
    name: 'an expired CLI token is still accepted',
    file: 'apps/api/src/auth.ts',
    search: `    if (token.expiresAt <= deps.now()) {
      return {
        ok: false,
        refusal: unauthenticated('the bearer token has expired'),
      };
    }`,
    replace: `    // MUTATION: an expired CLI token is still accepted.`,
    test: 'tests/unit/api-auth.test.ts',
  },
  {
    name: 'an expired session is still accepted',
    file: 'apps/api/src/auth.ts',
    search: `  if (session.expiresAt <= deps.now()) {
    return {
      ok: false,
      refusal: unauthenticated('the session has expired'),
    };
  }`,
    replace: `  // MUTATION: an expired session is still accepted.`,
    test: 'tests/unit/api-auth.test.ts',
  },
  {
    name: 'a token without the fac_ prefix is accepted',
    file: 'apps/api/src/auth.ts',
    search: `    if (!isCliToken(credentials.bearerToken)) {`,
    replace: `    if (false) {`,
    test: 'tests/unit/api-auth.test.ts',
  },
  {
    name: 'the scope check accepts a token without the scope',
    file: 'apps/api/src/auth.ts',
    search: `  return scopes.every((scope) =>
    (token.scopes as readonly string[]).includes(scope),
  );`,
    replace: `  return true;`,
    test: 'tests/unit/api-auth.test.ts',
  },
  {
    name: 'the session cookie is preferred over the bearer token',
    file: 'apps/api/src/auth.ts',
    search: `  if (credentials.bearerToken !== undefined) {`,
    replace: `  if (false) {`,
    test: 'tests/unit/api-auth.test.ts',
  },

  // ---- the scope check in the app --------------------------------------
  {
    name: 'the app stops checking the scope',
    file: 'apps/api/src/app.ts',
    search: `        if (!hasScope(auth.token, route.scopes)) {`,
    replace: `        if (false) {`,
    test: 'tests/unit/api-auth.test.ts',
  },

  // ---- the idempotency key ---------------------------------------------
  {
    name: 'the idempotency key is no longer required on a mutating route',
    file: 'apps/api/src/app.ts',
    search: `          if (key === undefined) {`,
    replace: `          if (false) {`,
    test: 'tests/unit/api-idempotency.test.ts',
  },
  {
    name: 'the lookup identity includes the route again, so a cross-route clash is silent',
    // This is the defect T-1.14 found: `recordId` hashed the route in, so
    // a key reused on a different route *missed* and the caller got two
    // actions from one key.
    file: 'apps/api/src/idempotency.ts',
    search: `export const recordId = (k: IdempotencyKey): string =>
  sha256(
    [k.login, k.key].join(' '),
  );`,
    replace: `export const recordId = (k: IdempotencyKey): string =>
  sha256(
    [k.login, k.method, k.path, k.key].join(' '),
  );`,
    test: 'tests/unit/api-idempotency.test.ts',
  },
  {
    name: 'a key on a different route is a replay rather than a conflict',
    file: 'apps/api/src/app.ts',
    search: `            if (!existing.sameRoute) {`,
    replace: `            if (false) {`,
    test: 'tests/unit/api-idempotency.test.ts',
  },
  {
    name: 'a replay runs the action again',
    file: 'apps/api/src/app.ts',
    search: `          const existing = await deps.idempotency.get(identity);
          if (existing.found) {`,
    replace: `          const existing = await deps.idempotency.get(identity);
          if (false) {`,
    test: 'tests/unit/api-idempotency.test.ts',
  },
  {
    name: 'a failed call consumes the idempotency key',
    file: 'apps/api/src/app.ts',
    search: `          const parsed = parseBody(route, request.body);
          if (!parsed.ok) {`,
    replace: `          const parsed = parseBody(route, request.body);
          if (false) {`,
    test: 'tests/unit/api-idempotency.test.ts',
  },
  {
    name: 'the key is scoped to the route rather than to the caller',
    file: 'apps/api/src/app.ts',
    search: `          const identity = {
            login: auth.identity.login,
            method: request.method,
            path: request.url.split('?')[0] ?? request.url,
            key,
          };`,
    replace: `          const identity = {
            login: auth.identity.login,
            method: request.method,
            path: request.url.split('?')[0] ?? request.url,
            key: \`\${key}:\${request.url}\`,
          };`,
    test: 'tests/unit/api-idempotency.test.ts',
  },

  // ---- the events -------------------------------------------------------
  {
    name: 'the actor is no longer derived from the caller',
    file: 'apps/api/src/events.ts',
    search: `export const actorFor = (identity: CallerIdentity): Actor => ({
  kind: 'human',
  id: identity.login,
});`,
    replace: `export const actorFor = (identity: CallerIdentity): Actor => ({
  kind: 'human',
  id: 'system',
});`,
    test: 'tests/unit/api-events.test.ts',
  },
  {
    name: 'the authority is no longer the human access point',
    file: 'apps/api/src/events.ts',
    search: `export const authorityFor = (): Authority => ({ basis: 'human-access-point' });`,
    replace: `export const authorityFor = (): Authority => ({ basis: 'orchestrator' as Authority['basis'] });`,
    test: 'tests/unit/api-events.test.ts',
  },
  {
    name: 'a refused call records an event anyway',
    file: 'apps/api/src/handlers/shared.ts',
    search: `  if (!result.ok) {
    // Nothing changed, so nothing is recorded. A refusal leaves no trace
    // in the event log — which is what makes the log a record of *changes*.
    return refused(result.refusal);
  }`,
    replace: `  if (!result.ok) {
    // MUTATION: a refused call records an event anyway.
  }`,
    test: 'tests/unit/api-access-points.test.ts',
  },
  {
    name: 'the event is emitted after the reply leaves',
    file: 'apps/api/src/handlers/shared.ts',
    search: `  await emit(
    { sink: deps.events, now: () => deps.clock.nowIso() },
    identity,
    event.type,
    aggregate,
    payload,
    requestId,
  );

  return handled(result.value, status);`,
    replace: `  // MUTATION: the event is never emitted.
  return handled(result.value, status);`,
    test: 'tests/unit/api-events.test.ts',
  },
  {
    name: "the review's three decisions collapse to one event type",
    file: 'apps/api/src/handlers/review.ts',
    search: `export const REVIEW_EVENT_TYPES = {
  approve: 'review.approved',
  reject: 'review.rejected',
  defer: 'review.deferred',
} as const;`,
    replace: `export const REVIEW_EVENT_TYPES = {
  approve: 'review.approved',
  reject: 'review.approved',
  defer: 'review.approved',
} as const;`,
    test: 'tests/unit/api-access-points.test.ts',
  },

  // ---- the access points ------------------------------------------------
  {
    name: 'the kill switch no longer refuses intake',
    file: 'apps/api/src/handlers/define-intent.ts',
    search: `    if (await deps.killSwitch.isEngaged()) {`,
    replace: `    if (false) {`,
    test: 'tests/unit/api-access-points.test.ts',
  },
  {
    name: 'the approver list is not checked',
    file: 'apps/api/src/handlers/approve.ts',
    search: `    if (!approval.approvers.includes(ctx.login)) {`,
    replace: `    if (false) {`,
    test: 'tests/unit/api-access-points.test.ts',
  },
  {
    name: 'the hash binding is not checked',
    file: 'apps/api/src/handlers/approve.ts',
    search: `    if (approval.artefact.sha256 !== approval.artefactSha256) {`,
    replace: `    if (false) {`,
    test: 'tests/unit/api-access-points.test.ts',
  },
  {
    name: 'the approval expiry is not checked',
    file: 'apps/api/src/handlers/approve.ts',
    search: `    if (approval.expiresAt <= deps.clock.nowIso()) {`,
    replace: `    if (false) {`,
    test: 'tests/unit/api-access-points.test.ts',
  },
  {
    name: 'the temporary grant TTL is no longer capped at an hour',
    file: 'apps/api/src/routes.ts',
    search: `    ttlSeconds: z.number().int().positive().max(3600),`,
    replace: `    ttlSeconds: z.number().int().positive(),`,
    test: 'tests/unit/api-access-points.test.ts',
  },
  {
    name: 'the review rationale is no longer required',
    file: 'apps/api/src/routes.ts',
    search: `    rationale: z.string().min(1).max(10_000),`,
    replace: `    rationale: z.string().max(10_000).optional(),`,
    test: 'tests/unit/api-access-points.test.ts',
  },

  // ---- the rate limit ----------------------------------------------------
  {
    name: 'the rate limit does not apply by default',
    // The defect T-1.14 found: the flag is optional, and `if
    // (route.rateLimited)` read `undefined` as "exempt" — so every route
    // that did not declare the flag was unbounded.
    file: 'apps/api/src/app.ts',
    search: `      if (route.rateLimited !== false) {`,
    replace: `      if (route.rateLimited === true) {`,
    test: 'tests/unit/api-rate-limit.test.ts',
  },
  {
    name: 'the health checks are no longer exempt from the rate limit',
    file: 'apps/api/src/app.ts',
    search: `      if (route.rateLimited !== false) {`,
    replace: `      if (true) {`,
    test: 'tests/unit/api-rate-limit.test.ts',
  },
  {
    name: 'the limiter refuses open',
    file: 'apps/api/src/rate-limit.ts',
    search: `    if (window.count >= this.#limit) {`,
    replace: `    if (false) {`,
    test: 'tests/unit/api-rate-limit.test.ts',
  },
  {
    name: 'the rate limit is keyed on the address rather than the credential',
    file: 'apps/api/src/app.ts',
    search: `  const authorization = headerValue(request, 'authorization');
  if (authorization !== undefined) {
    return \`token:\${authorization}\`;
  }`,
    replace: `  const authorization = headerValue(request, 'authorization');
  if (false) {
    return \`token:\${authorization ?? ''}\`;
  }`,
    test: 'tests/unit/api-rate-limit.test.ts',
  },

  // ---- the inventory ------------------------------------------------------
  {
    name: 'the body schemas stop rejecting unknown fields',
    file: 'apps/api/src/routes.ts',
    search: `    /** The budget, in integer micro-USD. */
    budgetUsdMicros: z.number().int().nonnegative().optional(),
  })
  .strict();`,
    replace: `    /** The budget, in integer micro-USD. */
    budgetUsdMicros: z.number().int().nonnegative().optional(),
  });`,
    test: 'tests/unit/api-route-inventory.test.ts',
  },
  {
    name: 'a body schema accepts a free-form instruction field',
    file: 'apps/api/src/routes.ts',
    search: `    /** The workflow to run, when the caller names one. */
    workflow: z.string().min(1).optional(),`,
    replace: `    /** The workflow to run, when the caller names one. */
    workflow: z.string().min(1).optional(),
    /** The instructions for the agent. */
    instructions: z.string().optional(),`,
    test: 'tests/unit/api-route-inventory.test.ts',
  },
  {
    name: 'the app registers routes that are not in the inventory',
    file: 'apps/api/src/handlers/index.ts',
    search: `  if (route === undefined) {
    // The binding names a route the inventory does not have. That is a
    // typo, and it is a hard error — a handler nobody can reach is dead
    // code, and the route it was meant to serve has none.
    throw new Error(
      \`the binding "\${method} \${path}" names a route that is not in the inventory\`,
    );
  }`,
    replace: `  if (route === undefined) {
    // MUTATION: a binding for a route that is not in the inventory is
    // accepted.
    return;
  }`,
    test: 'tests/unit/api-route-inventory.test.ts',
  },
];

/**
 * Run a test file and report whether it **failed**.
 *
 * Vitest exits 1 when the suite fails — that is the mutation being caught.
 * Any other exit code is a harness error and is re-thrown.
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
