/**
 * **INV-5** — no factory change without a reviewed, evaluated, reversible
 * change.
 *
 * checklist 14 §"The twelve invariants and their mutations", row INV-5:
 *
 * > | **INV-5** | No factory change without a reviewed, evaluated,
 * > reversible change | *grant the API role INSERT on `definition_versions`* |
 *
 * and pack `08` §3, on what the test asserts:
 *
 * > **INV-5** — applying an unmerged SHA, or one without a bundle-bound
 * > approval, fails; no code path other than the applier writes
 * > `definition_versions` (route + grep inventory); proposals have no apply
 * > path.
 *
 * ## Why the definition is worth this much attention
 *
 * The apply is the one operation in the factory that changes what every
 * other component is *allowed to do*. The policy bundle's deny rules, the
 * capability registry, the grants — all of them live in the definition. So
 * an attacker who can write the definition owns the factory.
 *
 * blueprint `13` §3.3 quotes ADR-0001's acceptance test: "A control-surface
 * write that is not backed by a reviewed change in the definition is
 * **rejected**." So the refusal is the *behaviour*, not a limitation.
 *
 * ## The four claims, and how each one is proved
 *
 * | # | claim | how |
 * |---|---|---|
 * | 1 | an **unmerged** SHA cannot be applied | the applier asks the SCM; a SHA that is not on the protected default branch is refused, and **nothing is written** |
 * | 2 | an apply **without a bundle-bound approval** cannot be applied | the approval's `artefactSha256` must equal the bundle's digest; a mismatch is refused, and **nothing is written** |
 * | 3 | **no code path other than the applier writes `definition_versions`** | a *grep inventory* over the source tree plus a *route inventory* over the API's declared routes |
 * | 4 | the API role holds **no write privilege** on the table | the live PostgreSQL grant, checked with `has_table_privilege` and with a real `INSERT` that must be refused |
 *
 * Claim 3 is the one the specified mutation attacks. "Grant the API role
 * INSERT on `definition_versions`" does **not** change any TypeScript — it
 * changes `migrations/0001_grants.sql`. So the test has to notice a change
 * in the *migration*, and it has to notice it **twice**:
 *
 * * the **static** half reads the grants file and asserts the API role's
 *   grant on `definition_versions` names `SELECT` and not `INSERT`; and
 * * the **live** half asks the running database whether `factory_app` holds
 *   `INSERT` on the table — which is the *privilege*, not the text of a
 *   file. A grant applied by hand, or a `DEFAULT PRIVILEGES`, would show
 *   up in the live half even though the file still says the right thing.
 *
 * And the **grep inventory** is the other half of claim 3: it enumerates
 * every source file that writes `definition_versions` and asserts the set
 * is exactly the applier. A new writer anywhere in the tree — the API, a
 * worker, a migration helper — changes that set and the test goes red.
 *
 * ## "Proposals have no apply path"
 *
 * blueprint `13` §3.1, AP-6: a human *proposes* a change to the factory's
 * own definition "and it is reviewed like any other change". A proposal is
 * an artefact that goes through the ordinary review; it is not itself an
 * apply. So the test proves that the **only** route that reaches the applier
 * is `POST /v1/definition/apply`, that it requires an **approval id** — a
 * proposal has no approval id — and that the applier refuses an apply whose
 * approval does not bind the bundle.
 *
 * ## The environment
 *
 * The privilege half needs a real server — `docker-compose.dev.yml`'s
 * `postgres:16-alpine`, driven by `tests/helpers/postgres.ts`. Where no
 * Docker daemon is available it **skips**: that is an environment limit,
 * not a defect. The behavioural halves always run.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Approval } from '../../packages/contracts/src/index.ts';
import {
  applyDefinition,
  definitionBundleSha256,
  loadDefinition,
  type DefinitionBundle,
  type DefinitionScmCheck,
  type DefinitionVersionStore,
} from '../../packages/definition/src/index.ts';
import { ROUTES } from '../../apps/api/src/routes.ts';
import {
  buildHarness,
  cliHeaders,
  mutatingHeaders,
} from '../../apps/api/src/harness.ts';
import {
  containerRunning,
  createEventLogHarness,
  type EventLogHarness,
} from '../helpers/eventlog.ts';
import { isError, isPermissionDenied, type Postgres } from '../helpers/postgres.ts';

/**
 * Whether the dev Postgres container is up.
 *
 * Where it is not, the privilege half **skips** rather than fails: the
 * absence of a Docker daemon is an environment limit, not a defect in the
 * factory.
 */
const running = await containerRunning();

/**
 * The repository root — the grants migration and the source tree live here.
 */
const repoRoot = resolve(import.meta.dirname, '..', '..');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The **applier** — the one source file allowed to write
 * `definition_versions`.
 *
 * It is named here rather than derived, because the assertion is about the
 * set of writers: the inventory below enumerates the writers and compares
 * the set with this one. If a second file starts writing the table, the set
 * grows and the comparison fails.
 */
const APPLIER = 'packages/definition/src/postgres-store.ts';

/**
 * A minimal but *valid* definition tree.
 *
 * It is written out rather than imported so the test does not depend on
 * the repository's own definition being in any particular state.
 */
const writeDefinition = async (root: string): Promise<void> => {
  await mkdir(join(root, 'workflows'), { recursive: true });
  await mkdir(join(root, 'capabilities'), { recursive: true });

  await writeFile(
    join(root, 'factory.yaml'),
    [
      'apiVersion: factory/v1',
      'kind: FactoryDefinition',
      'metadata: { name: factory }',
      'spec:',
      '  owner: { githubLogin: owner }',
      '  global: { maxConcurrentTasks: 2 }',
      '  defaults: { autonomyLevel: 1 }',
      '  repos: []',
      '  workflows: [alpha]',
      '',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(root, 'policy-bundle.yaml'),
    [
      'apiVersion: factory/v1',
      'kind: PolicyBundle',
      'spec:',
      '  denyRules: []',
      '  protectedPaths: [".github/**"]',
      '  effectRules: { E0: allow, E1: allow, E2: allowIfResourceScoped, E3: requireApproval, E4: requireApproval }',
      '  tierRules: { R3: { approveActions: requireApproval-security } }',
      '  default: deny',
      '',
    ].join('\n'),
    'utf8',
  );

  await writeFile(
    join(root, 'workflows', 'alpha.yaml'),
    [
      'apiVersion: factory/v1',
      'kind: WorkflowDefinition',
      'metadata: { name: alpha }',
      'spec:',
      '  autonomy: { level: 1, ceiling: 2 }',
      '  trigger: { kind: manual }',
      '  stages:',
      '    - { id: triage, kind: specify, role: triage, executor: deterministic }',
      '  completion: []',
      '',
    ].join('\n'),
    'utf8',
  );
};

/**
 * Load a definition tree, failing the test if it does not load.
 */
const loadOrThrow = async (root: string): Promise<DefinitionBundle> => {
  const result = await loadDefinition(root);
  if (!result.ok) {
    throw new Error(
      `the fixture definition did not load: ${result.failures.map((f) => `${f.path}: ${f.reason}`).join('; ')}`,
    );
  }
  return result.bundle;
};

/**
 * A store that records what it was asked to apply.
 *
 * The `applied` array is what the "nothing was written" assertions read:
 * a refusal must leave it **empty**.
 */
const recordingStore = (
  bundle: DefinitionBundle | undefined,
  role = 'factory_applier',
): DefinitionVersionStore & { readonly applied: unknown[] } => {
  const applied: unknown[] = [];
  let active = bundle;
  return {
    applied,
    applyVersion: (input) => {
      applied.push(input);
      active = input.bundle;
      return Promise.resolve(input.sha);
    },
    activeBundle: () => Promise.resolve(active),
    activeSha256: () =>
      Promise.resolve(active === undefined ? undefined : definitionBundleSha256(active)),
    currentRole: () => role,
  };
};

/**
 * A digest built from a repeated character.
 *
 * The `Sha256` type is a branded template literal, so a plain string is not
 * assignable to it.
 */
const digestOf = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

/**
 * A granted `definition` approval bound to a digest.
 */
const approvalFor = (
  bundleSha256: `sha256:${string}`,
  overrides: Partial<Approval> = {},
): Approval =>
  ({
    id: 'approval-inv5',
    taskId: 'task-inv5',
    type: 'definition',
    artefactKind: 'definition-bundle',
    artefactRef: 'sha:abc123',
    artefactSha256: bundleSha256,
    approvers: ['owner'],
    status: 'granted',
    requestedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-12-01T00:00:00.000Z',
    decidedAt: '2026-01-01T01:00:00.000Z',
    decidedBy: 'owner',
    securityScopeAck: true,
    ...overrides,
  }) as Approval;

/**
 * An SCM check that says "yes" to everything.
 */
const permissiveScm = (): DefinitionScmCheck => ({
  checkProtectedBranch: () =>
    Promise.resolve({ ok: true, onProtectedBranch: true, checksGreen: true }),
});

/**
 * Every `.ts` file under the source tree, relative to the repository root.
 *
 * The directories walked are the ones that hold **product** code: the
 * packages and the apps. The `tests/` tree is deliberately excluded —
 * a test that inserts a row is not a *code path* in the factory, and a
 * test that merely *mentions* the table is not a writer at all.
 */
const sourceFiles = (): string[] => {
  const roots = ['packages', 'apps'];
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      const stats = statSync(absolute);
      if (stats.isDirectory()) {
        // `dist` and `node_modules` are build output, not source.
        if (entry === 'dist' || entry === 'node_modules') {
          continue;
        }
        walk(absolute);
        continue;
      }
      if (entry.endsWith('.ts')) {
        found.push(absolute);
      }
    }
  };

  for (const root of roots) {
    walk(join(repoRoot, root));
  }

  return found.map((absolute) => absolute.slice(repoRoot.length + 1)).sort();
};

/**
 * The source files that **write** `definition_versions`.
 *
 * A file counts as a writer when it contains a write against the table —
 * an `INSERT`, an `UPDATE` or a `DELETE`. A file that only *reads* the
 * table (the applier's own `activeBundle`, the drift job's reader) is not
 * a writer, and neither is a file that only mentions the table in a
 * comment or in a type.
 *
 * The patterns are deliberately narrow — a write verb immediately followed
 * by the table name — so a prose mention is never mistaken for a write.
 */
const writersOfDefinitionVersions = (): string[] =>
  sourceFiles().filter((relative) => {
    const source = readFileSync(join(repoRoot, relative), 'utf8');
    // Strip the comments, so a comment that talks about an `INSERT INTO
    // definition_versions` is not read as a write.
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');
    return /\b(insertInto|INSERT\s+INTO|updateTable|UPDATE\s+|deleteFrom|DELETE\s+FROM)\b[^\n]*definition_versions/.test(
      code,
    );
  });

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe('INV-5 · no factory change without a reviewed, evaluated, reversible change', () => {
  describe('the first door — an unmerged SHA cannot be applied', () => {
    it('INV-5 refuses a SHA that is not on the protected default branch', async () => {
      const root = await mkdtemp(join(tmpdir(), 'factory-inv5-'));
      try {
        await writeDefinition(root);
        const bundle = await loadOrThrow(root);
        const digest = definitionBundleSha256(bundle);
        const store = recordingStore(undefined);

        const outcome = await applyDefinition({
          sha: 'a'.repeat(40),
          bundle,
          // A *valid* approval bound to the right digest — so the only
          // thing missing is the provenance. Without a good approval the
          // test would pass for the wrong reason.
          approval: approvalFor(digest),
          appliedBy: 'owner',
          scm: {
            checkProtectedBranch: () =>
              Promise.resolve({
                ok: false,
                onProtectedBranch: false,
                checksGreen: true,
              }),
          },
          store,
        });

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.detail.refusal).toBe('sha_not_on_protected_branch');
        }
        // Nothing was written — the previous version stays active.
        expect(store.applied).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('INV-5 refuses a SHA whose required checks are not green', async () => {
      const root = await mkdtemp(join(tmpdir(), 'factory-inv5-'));
      try {
        await writeDefinition(root);
        const bundle = await loadOrThrow(root);
        const digest = definitionBundleSha256(bundle);
        const store = recordingStore(undefined);

        const outcome = await applyDefinition({
          sha: 'b'.repeat(40),
          bundle,
          approval: approvalFor(digest),
          appliedBy: 'owner',
          scm: {
            checkProtectedBranch: () =>
              Promise.resolve({
                ok: false,
                onProtectedBranch: true,
                checksGreen: false,
                reason: 'the build failed',
              }),
          },
          store,
        });

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.detail.refusal).toBe('required_checks_not_green');
        }
        expect(store.applied).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('INV-5 applies a merged, green SHA with a bound approval — so the refusal is the provenance', async () => {
      // The control: the same bundle, the same approval, a SHA the SCM
      // *does* confirm. The apply goes through.
      //
      // Without this, a test that only proved the refusal would pass
      // against an applier that refuses everything — a broken feature
      // rather than a working control.
      const root = await mkdtemp(join(tmpdir(), 'factory-inv5-'));
      try {
        await writeDefinition(root);
        const bundle = await loadOrThrow(root);
        const digest = definitionBundleSha256(bundle);
        const store = recordingStore(undefined);

        const outcome = await applyDefinition({
          sha: 'c'.repeat(40),
          bundle,
          approval: approvalFor(digest),
          appliedBy: 'owner',
          scm: permissiveScm(),
          store,
        });

        expect(outcome.ok).toBe(true);
        expect(store.applied).toHaveLength(1);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('the second door — an apply without a bundle-bound approval cannot be applied', () => {
    it('INV-5 refuses an approval bound to a different bundle', async () => {
      const root = await mkdtemp(join(tmpdir(), 'factory-inv5-'));
      try {
        await writeDefinition(root);
        const bundle = await loadOrThrow(root);
        const store = recordingStore(undefined);

        const outcome = await applyDefinition({
          sha: 'd'.repeat(40),
          bundle,
          // The approval is *granted*, *unexpired*, *by an approver* — it
          // is simply bound to a different bundle. This is the attack:
          // reuse a real approval for a different change.
          approval: approvalFor(digestOf('0')),
          appliedBy: 'owner',
          scm: permissiveScm(),
          store,
        });

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.detail.refusal).toBe('approval_hash_mismatch');
        }
        expect(store.applied).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('INV-5 refuses an apply with no approval at all', async () => {
      const root = await mkdtemp(join(tmpdir(), 'factory-inv5-'));
      try {
        await writeDefinition(root);
        const bundle = await loadOrThrow(root);
        const store = recordingStore(undefined);

        const outcome = await applyDefinition({
          sha: 'e'.repeat(40),
          bundle,
          approval: undefined,
          appliedBy: 'owner',
          scm: permissiveScm(),
          store,
        });

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.detail.refusal).toBe('no_approval');
        }
        expect(store.applied).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('INV-5 refuses the apply when the connection is not the applier role', async () => {
      // The **role** is the third precondition, and it is the one that does
      // not depend on the process: the API's own database role cannot
      // write the table at all.
      const root = await mkdtemp(join(tmpdir(), 'factory-inv5-'));
      try {
        await writeDefinition(root);
        const bundle = await loadOrThrow(root);
        const digest = definitionBundleSha256(bundle);
        const store = recordingStore(undefined, 'factory_app');

        const outcome = await applyDefinition({
          sha: 'f'.repeat(40),
          bundle,
          // A *perfect* approval — so the only thing missing is the role.
          approval: approvalFor(digest),
          appliedBy: 'owner',
          scm: permissiveScm(),
          store,
        });

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.detail.refusal).toBe('wrong_db_role');
        }
        expect(store.applied).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('the third door — the writer inventory', () => {
    it('INV-5 no source file other than the applier writes definition_versions', () => {
      // The **grep inventory**. The set of writers is enumerated from the
      // source tree and compared with the applier — so a new writer
      // anywhere (the API, a worker, a helper) changes the set and the
      // test goes red.
      const writers = writersOfDefinitionVersions();

      expect(writers).toEqual([APPLIER]);
    });

    it('INV-5 the applier is the only writer, and the drift job is not one', () => {
      // The same inventory, read from the other side: the *readers* are
      // fine — the drift job and the applier both read the applied bundle
      // — but a reader must never be a writer.
      //
      // So the drift job, which "never writes `definition_versions`"
      // (its own module comment), is asserted to be absent from the
      // writer set. That is a claim about the *code*, not about a promise
      // in a comment.
      const writers = writersOfDefinitionVersions();

      expect(writers).not.toContain('packages/definition/src/drift-job.ts');
      expect(writers).not.toContain('packages/definition/src/apply.ts');
      // The applier's *logic* is in `apply.ts`, but it writes through the
      // store port; the store is what touches the table.
      expect(writers).toContain(APPLIER);
    });

    it('INV-5 the API exposes no route that writes the definition', () => {
      // The **route inventory**. The routes the API serves are declared in
      // one place (`apps/api/src/routes.ts`), and the app registers them
      // from that inventory — so there is no second place a route can be
      // added. The claim is that the only *mutating* definition route is
      // the apply, and that it demands an approval id.
      const definitionRoutes = ROUTES.filter((route) => route.path.includes('/definition/'));

      // The only mutating definition route is the apply.
      const mutating = definitionRoutes.filter((route) => route.mutating);
      expect(mutating).toHaveLength(1);
      expect(mutating[0]?.path).toBe('/v1/definition/apply');
      expect(mutating[0]?.accessPoint).toBe('amend-factory');

      // The apply's body demands a SHA **and an approval id** — a
      // proposal carries neither, so a proposal cannot reach the applier
      // through this route.
      const body = mutating[0]?.body;
      expect(body).toBeDefined();
      const parsed = body?.safeParse({ sha: 'a'.repeat(40), approvalId: 'apr_1' });
      expect(parsed?.success).toBe(true);

      // A proposal — a SHA with no approval id — does not satisfy the
      // body, so the route refuses it at the boundary.
      const withoutApproval = body?.safeParse({ sha: 'a'.repeat(40) });
      expect(withoutApproval?.success).toBe(false);
    });

    it('INV-5 a proposal cannot reach the applier through the access point', async () => {
      // The behavioural form of the route claim: a call that names a
      // proposal — no approval, or an approval that does not bind the
      // bundle — is refused, and **no** `definition.applied` event is
      // emitted.
      const harness = await buildHarness();

      try {
        // An approval bound to a *different* bundle than the active one.
        harness.definition.approvals.set('apr-unbound', {
          artefactSha256: `sha256:${'0'.repeat(64)}`,
          approvers: ['alice'],
        });

        const response = await harness.app.inject({
          method: 'POST',
          url: '/v1/definition/apply',
          headers: mutatingHeaders(cliHeaders(harness), 'key-inv5-1'),
          payload: {
            sha: 'a'.repeat(40),
            approvalId: 'apr-unbound',
          },
        });

        expect(response.statusCode).toBe(409);
        const body = response.json<{ code: string }>();
        expect(body.code).toBe('hash_mismatch');

        // Nothing was applied.
        expect(harness.definition.applies).toHaveLength(1);

        // And — the point of a proposal — no *change* was recorded. The
        // attempt is visible in the port's own `applies` array, but the
        // event log says nothing changed.
        const applied = harness.events.events.filter(
          (event) => event.eventType === 'definition.applied',
        );
        expect(applied).toEqual([]);
      } finally {
        await harness.close();
      }
    });
  });

  describe('the fourth door — the database privilege', () => {
    it('INV-5 the grants file gives the API role SELECT and nothing more on definition_versions', () => {
      // The **static** half of the privilege claim: the migration is the
      // artefact that *is* the control, so the migration is what this
      // reads.
      //
      // "Grant the API role INSERT on `definition_versions`" is a change
      // to this file — so the file is what the test must look at.
      const grants = readFileSync(join(repoRoot, 'migrations', '0001_grants.sql'), 'utf8');

      const appGrant = grants
        .split('\n')
        .filter((line) => line.includes('factory_app'))
        .find((line) => line.includes('definition_versions'));

      expect(appGrant).toBeDefined();
      expect(appGrant).toContain('SELECT');
      expect(appGrant).not.toContain('INSERT');
      expect(appGrant).not.toContain('UPDATE');
      expect(appGrant).not.toContain('DELETE');

      // And the applier role holds the write privilege — so the control
      // is not "nobody may write", it is "only the applier may write".
      const applierGrant = grants
        .split('\n')
        .filter((line) => line.includes('factory_applier'))
        .find((line) => line.includes('definition_versions'));

      expect(applierGrant).toBeDefined();
      expect(applierGrant).toContain('INSERT');
    });

    describe('against a live database', () => {
      let harness: EventLogHarness;

      /**
       * The harness's `pg` handle — a `psql` runner against the **same**
       * database the migrations were applied to.
       *
       * The privileges are a property of the *database*, so the queries
       * have to run against the database that carries the schema and the
       * grants. A second, empty database would answer "the schema does
       * not exist" rather than the question.
       */
      const pg = (): Postgres => harness.pg;

      beforeAll(async () => {
        if (!running) {
          return;
        }
        harness = await createEventLogHarness('factory_t1_inv5_live');
      }, 180_000);

      afterAll(async () => {
        await harness?.destroy();
      });

      it.skipIf(!running)('INV-5 the API role holds no INSERT privilege on definition_versions', async () => {
        // The **live** half of the privilege claim.
        //
        // The applier's role check is a *process-level* control: an
        // attacker who has compromised the applier process is running as
        // `factory_applier`, and the check would pass. The control that
        // does not depend on the process is the **grant** — and the grant
        // is a property of the running database, not of a file.
        //
        // So the question is asked of PostgreSQL itself: does `factory_app`
        // hold `INSERT` on the table? `has_table_privilege` is the
        // authoritative answer, and it accounts for every path a privilege
        // can arrive by — a direct grant, a role membership, a
        // `DEFAULT PRIVILEGES` — not just the text of the grants file.
        const out = await pg().psqlAsOwner(`
          SELECT has_table_privilege('factory_app', 'factory.definition_versions', 'INSERT')::text;
        `);

        expect(out.split('\n').pop()?.trim()).toBe('false');
      }, 60_000);

      it.skipIf(!running)('INV-5 the API role cannot actually insert into definition_versions', async () => {
        // The same claim, exercised rather than introspected: the insert
        // is attempted as `factory_app` and must be **refused by the
        // database**.
        //
        // This is the assertion that turns red when the API role is
        // granted `INSERT`: the statement would succeed, and the row
        // would land.
        const out = await pg().psqlAs(
          'factory_app',
          "INSERT INTO definition_versions(sha,bundle_sha256,bundle,applied_by) VALUES ('inv5_sneak','\\x00','{}','attacker');",
        );

        expect(isPermissionDenied(out)).toBe(true);

        // And the row is not there.
        const count = await pg().psqlAsOwner(
          "SELECT count(*) FROM factory.definition_versions WHERE sha = 'inv5_sneak';",
        );
        expect(Number(count.split('\n').pop())).toBe(0);
      }, 60_000);

      it.skipIf(!running)('INV-5 the applier role CAN insert into definition_versions', async () => {
        // The control for the check above: a test that only proved the
        // refusal would pass against a database where *nobody* may write.
        const out = await pg().psqlAs(
          'factory_applier',
          "INSERT INTO definition_versions(sha,bundle_sha256,bundle,applied_by) VALUES ('inv5_applier','\\x00','{}','owner');",
        );

        expect(isError(out)).toBe(false);
      }, 60_000);
    });
  });
});
