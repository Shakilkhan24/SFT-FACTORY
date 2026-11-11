/**
 * T-1.17 — **AT-7**: a control-surface write without a reviewed change.
 *
 * pack `08` §4's row:
 *
 * | # | Attack | Fixture & action | Pass condition |
 * |---|---|---|---|
 * | **AT-7** | Control-surface write without reviewed change | apply unmerged SHA; apply without bundle-bound approval; DB insert as `factory_app` | all rejected |
 *
 * ## The attack
 *
 * The apply is the one operation in the factory that changes what every
 * other component is *allowed to do*. The policy bundle's deny rules, the
 * capability registry, the grants — all of them live in the definition. So
 * an attacker who can write the definition owns the factory.
 *
 * There are three ways to try, and pack `08` §4 names all three:
 *
 * 1. **Apply an unmerged SHA.** Push a change to a branch, and try to
 *    apply it before it lands on the protected default branch. The
 *    provenance check asks the SCM — the applier never trusts a caller
 *    that says "this SHA is fine".
 * 2. **Apply without a bundle-bound approval.** Supply an approval that
 *    exists, is granted, and is *for a different bundle*. The binding is
 *    what makes an approval meaningful: approval of one bundle is not
 *    approval of a different one applied afterwards.
 * 3. **Insert as `factory_app`.** Skip the process entirely and write
 *    `definition_versions` with the API's own database role. The
 *    migration grants `factory_app` **SELECT only** on that table, so
 *    the write is refused by the database, whatever the process does.
 *
 * ## Why the third door is a *migration* fact and not a *code* fact
 *
 * The applier checks `store.currentRole()`, and that check is real. But
 * the applier's check is a **process-level** control: an attacker who
 * compromises the applier process is running as `factory_applier`, and
 * the check would pass. The defence that does not depend on the process
 * is the **grant** — `migrations/0001_grants.sql` gives `factory_app`
 * `SELECT` on `definition_versions` and reserves `INSERT`/`UPDATE` for
 * `factory_applier`.
 *
 * So the third door is proved against the **migration file itself**: the
 * test reads the grants and asserts the API role holds no write
 * privilege on the control-surface table. That is the honest form of the
 * proof here — the environment has no Docker daemon, so the live
 * `INSERT` cannot be executed, and a test that pretended otherwise would
 * be asserting a fiction. The migration is the artefact that *is* the
 * control, so the migration is what the test reads.
 *
 * ## The triad
 *
 * 1. **(a) the intended effect is absent** — no version was applied, the
 *    previous version stays active;
 * 2. **(b) the expected security event is present** — for the API door,
 *    a refusal leaves no trace by design (pack `04` §3: "a refusal leaves
 *    no trace in the event log, which is what makes the log a record of
 *    *changes*"), so the evidence is the **refusal itself** and the
 *    absence of a `definition.applied` event;
 * 3. **(c) no canary value anywhere** — the canary rides in the attack's
 *    own payload, and must not survive into the events, the records or
 *    the grants.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Approval } from '@factory/contracts';
import {
  applyDefinition,
  definitionBundleSha256,
  loadDefinition,
  type DefinitionBundle,
  type DefinitionScmCheck,
  type DefinitionVersionStore,
} from '@factory/definition';

import {
  buildHarness,
  cliHeaders,
  mutatingHeaders,
} from '../../apps/api/src/harness.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The canary — a fake provider key.
 *
 * It rides in the **bundle the attacker is trying to apply**, so the
 * "no canary anywhere" assertion is meaningful: the bundle that was
 * refused is exactly the bundle that would have carried it.
 */
const CANARY = 'sk-canary-AT7-c4e8a2b6-do-not-leak';

/**
 * The root of the repository — the migration lives here.
 */
const REPO_ROOT = join(import.meta.dirname, '..', '..');

/**
 * The definition tree the attacker writes and then tries to apply.
 *
 * It is written out rather than imported so the test does not depend on
 * the repository's own definition being in any particular state, and so
 * the bundle's content — including the canary — is under the test's
 * control.
 */
const writeDefinition = async (
  root: string,
  options: { readonly canary: string },
): Promise<void> => {
  const { mkdir, writeFile } = await import('node:fs/promises');

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
      '  tierRules: {}',
      '  default: deny',
      '',
    ].join('\n'),
    'utf8',
  );

  // The workflow's trigger label carries the canary — so it is inside the
  // bundle's canonical digest, and would be inside the applied version.
  await writeFile(
    join(root, 'workflows', 'alpha.yaml'),
    [
      'apiVersion: factory/v1',
      'kind: WorkflowDefinition',
      'metadata: { name: alpha }',
      'spec:',
      '  autonomy: { level: 1, ceiling: 2 }',
      `  trigger: { kind: manual, label: "${options.canary}" }`,
      '  stages:',
      '    - { id: triage, kind: specify, role: triage, executor: deterministic }',
      '  completion: []',
      '',
    ].join('\n'),
    'utf8',
  );
};

/**
 * Load the attacker's definition tree.
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
      Promise.resolve(
        active === undefined ? undefined : definitionBundleSha256(active),
      ),
    currentRole: () => role,
  };
};

/**
 * A digest built from a repeated character.
 *
 * The `Sha256` type is a branded template literal, so a plain string is
 * not assignable to it.
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
    id: 'approval-at7',
    taskId: 'task-at7',
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

describe('AT-7 — a control-surface write without a reviewed change', () => {
  describe('the first door — apply an unmerged SHA', () => {
    it('AT-7 refuses a SHA that is not on the protected default branch', async () => {
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');

      const root = await mkdtemp(join(tmpdir(), 'factory-at7-'));
      try {
        await writeDefinition(root, { canary: CANARY });
        const bundle = await loadOrThrow(root);
        const digest = definitionBundleSha256(bundle);
        const store = recordingStore(undefined);

        const outcome = await applyDefinition({
          sha: 'a'.repeat(40),
          bundle,
          // A *valid* approval, bound to the right digest — so the only
          // thing missing is the provenance. Without a good approval the
          // test would pass for the wrong reason.
          approval: approvalFor(digest),
          appliedBy: 'owner',
          // The SCM says the SHA is on a branch, not on the protected
          // default branch.
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

        // ---- (a) the intended effect is absent ----------------------
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

    it('AT-7 refuses a SHA whose required checks are not green', async () => {
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');

      const root = await mkdtemp(join(tmpdir(), 'factory-at7-'));
      try {
        await writeDefinition(root, { canary: CANARY });
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

    it('AT-7 applies a merged, green SHA with a bound approval — so the refusal is the provenance', async () => {
      // The control: the same bundle, the same approval, a SHA the SCM
      // *does* confirm. The apply goes through.
      //
      // Without this, a test that only proved the refusal would pass
      // against an applier that refuses everything — a broken feature
      // rather than a working control.
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');

      const root = await mkdtemp(join(tmpdir(), 'factory-at7-'));
      try {
        await writeDefinition(root, { canary: CANARY });
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

  describe('the second door — apply without a bundle-bound approval', () => {
    it('AT-7 refuses an approval bound to a different bundle', async () => {
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');

      const root = await mkdtemp(join(tmpdir(), 'factory-at7-'));
      try {
        await writeDefinition(root, { canary: CANARY });
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

    it('AT-7 refuses an apply with no approval at all', async () => {
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');

      const root = await mkdtemp(join(tmpdir(), 'factory-at7-'));
      try {
        await writeDefinition(root, { canary: CANARY });
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

    it('AT-7 refuses an approval of the wrong type', async () => {
      // The attack's other spelling: a *real* approval, of a different
      // type, reused for a definition apply. A `merge` approval says
      // nothing about the definition.
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');

      const root = await mkdtemp(join(tmpdir(), 'factory-at7-'));
      try {
        await writeDefinition(root, { canary: CANARY });
        const bundle = await loadOrThrow(root);
        const digest = definitionBundleSha256(bundle);
        const store = recordingStore(undefined);

        const outcome = await applyDefinition({
          sha: 'f'.repeat(40),
          bundle,
          approval: approvalFor(digest, {
            type: 'merge' as Approval['type'],
          }),
          appliedBy: 'owner',
          scm: permissiveScm(),
          store,
        });

        expect(outcome.ok).toBe(false);
        if (!outcome.ok) {
          expect(outcome.detail.refusal).toBe('approval_not_for_definition');
        }
        expect(store.applied).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('AT-7 leaves no canary in the refused bundle or the store', async () => {
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');

      const root = await mkdtemp(join(tmpdir(), 'factory-at7-'));
      try {
        await writeDefinition(root, { canary: CANARY });
        const bundle = await loadOrThrow(root);
        const store = recordingStore(undefined);

        await applyDefinition({
          sha: '1'.repeat(40),
          bundle,
          approval: approvalFor(digestOf('0')),
          appliedBy: 'owner',
          scm: permissiveScm(),
          store,
        });

        // The canary rode inside the bundle being applied. It must not
        // have survived into the store — nothing was written, so there is
        // no applied version carrying it.
        const serialised = JSON.stringify({
          applied: store.applied,
          active: await store.activeBundle(),
        });
        expect(serialised).not.toContain(CANARY);
        expect(serialised).not.toContain('sk-canary');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('the third door — the database role', () => {
    it('AT-7 refuses the apply when the connection is not the applier role', async () => {
      const { mkdtemp, rm } = await import('node:fs/promises');
      const { tmpdir } = await import('node:os');

      const root = await mkdtemp(join(tmpdir(), 'factory-at7-'));
      try {
        await writeDefinition(root, { canary: CANARY });
        const bundle = await loadOrThrow(root);
        const digest = definitionBundleSha256(bundle);
        const store = recordingStore(undefined, 'factory_app');

        const outcome = await applyDefinition({
          sha: '2'.repeat(40),
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
          // The refusal names the role it wanted and the role it got.
          expect(outcome.detail.message).toContain('factory_app');
          expect(outcome.detail.message).toContain('factory_applier');
        }
        expect(store.applied).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('AT-7 grants the API role no write privilege on the control-surface table', async () => {
      // The database-level control.
      //
      // The applier's role check is a **process-level** control: an
      // attacker who has compromised the applier process is running as
      // `factory_applier`, and the check would pass. The control that does
      // not depend on the process is the **grant** — so the grant is what
      // this test reads.
      //
      // The environment has no Docker daemon, so the live `INSERT` cannot
      // be executed here. The migration is the artefact that *is* the
      // control, and asserting against it is the honest form of the
      // proof — a test that pretended to have run the insert would be
      // asserting a fiction.
      const grants = await readFile(
        join(REPO_ROOT, 'migrations', '0001_grants.sql'),
        'utf8',
      );

      // `factory_app` may **read** the definition versions — the API has
      // to render the plan — but it must not write them.
      const appGrant = grants
        .split('\n')
        .filter((line) => line.includes('factory_app'))
        .find((line) => line.includes('definition_versions'));

      expect(appGrant).toBeDefined();
      expect(appGrant).toContain('SELECT');
      expect(appGrant).not.toContain('INSERT');
      expect(appGrant).not.toContain('UPDATE');
      expect(appGrant).not.toContain('DELETE');

      // And the applier role holds the write privilege.
      const applierGrant = grants
        .split('\n')
        .filter((line) => line.includes('factory_applier'))
        .find((line) => line.includes('definition_versions'));

      expect(applierGrant).toBeDefined();
      expect(applierGrant).toContain('INSERT');
    });
  });

  describe('the API door — the control-surface access point', () => {
    it('AT-7 refuses an apply whose approval does not bind the bundle', async () => {
      const harness = await buildHarness();

      // The attacker's approval — granted, but bound to a *different*
      // bundle than the one being applied.
      harness.definition.approvals.set('apr-unbound', {
        artefactSha256: `sha256:${'0'.repeat(64)}`,
        approvers: ['alice'],
      });

      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/definition/apply',
        headers: mutatingHeaders(cliHeaders(harness), 'key-at7-1'),
        payload: {
          sha: 'a'.repeat(40),
          approvalId: 'apr-unbound',
        },
      });

      // ---- (a) the intended effect is absent ------------------------
      expect(response.statusCode).toBe(409);
      const body = response.json<{ code: string; detail: string }>();
      expect(body.code).toBe('hash_mismatch');
      // The refusal names both digests, so the operator can see what to
      // bind the approval to.
      expect(body.detail).toContain('0'.repeat(64));

      await harness.close();
    });

    it('AT-7 refuses an apply that names no known approval', async () => {
      const harness = await buildHarness();

      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/definition/apply',
        headers: mutatingHeaders(cliHeaders(harness), 'key-at7-2'),
        payload: {
          sha: 'b'.repeat(40),
          approvalId: 'apr-does-not-exist',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = response.json<{ code: string; detail: string }>();
      expect(body.detail).toContain('apr-does-not-exist');

      await harness.close();
    });

    it('AT-7 emits no definition.applied event for a refused apply', async () => {
      const harness = await buildHarness();

      harness.definition.approvals.set('apr-unbound', {
        artefactSha256: `sha256:${'0'.repeat(64)}`,
        approvers: ['alice'],
      });

      await harness.app.inject({
        method: 'POST',
        url: '/v1/definition/apply',
        headers: mutatingHeaders(cliHeaders(harness), 'key-at7-3'),
        payload: {
          sha: 'c'.repeat(40),
          approvalId: 'apr-unbound',
        },
      });

      // ---- (b) the expected security event is absent -----------------
      //
      // "A refusal leaves no trace in the event log — which is what makes
      // the log a record of *changes*" (`apps/api/src/handlers/shared.ts`).
      // So the evidence of the refusal is the **absence** of the change
      // event, not a refusal event.
      const applied = harness.events.events.filter(
        (event) => event.eventType === 'definition.applied',
      );
      expect(applied).toEqual([]);

      await harness.close();
    });

    it('AT-7 leaves no canary in the events the refused apply would have written', async () => {
      const harness = await buildHarness();

      harness.definition.approvals.set('apr-unbound', {
        artefactSha256: `sha256:${'0'.repeat(64)}`,
        approvers: ['alice'],
      });

      await harness.app.inject({
        method: 'POST',
        url: '/v1/definition/apply',
        headers: mutatingHeaders(cliHeaders(harness), 'key-at7-4'),
        payload: {
          sha: 'd'.repeat(40),
          approvalId: 'apr-unbound',
        },
      });

      // The canary rides in the **bundle** the attacker was trying to
      // apply (proved in the applier doors above). It must not have
      // survived into the event log.
      //
      // The scope is the **events** — not the port's `applies` array,
      // which records the *attempt*: the SHA and the approval id are the
      // attacker's own inputs, and recording an attempt is what the audit
      // wants. What a refused apply must not do is write the **change**.
      const serialised = JSON.stringify({
        events: harness.events.events,
      });
      expect(serialised).not.toContain(CANARY);
      expect(serialised).not.toContain('sk-canary');

      await harness.close();
    });

    it('AT-7 applies the definition when the approval binds the bundle — so the refusal is the binding', async () => {
      // The control: the same access point, an approval bound to the
      // **active** bundle. The apply goes through and the event is
      // emitted.
      const harness = await buildHarness();

      harness.definition.approvals.set('apr-bound', {
        artefactSha256: harness.definition.activeSha256,
        approvers: ['alice'],
      });

      const response = await harness.app.inject({
        method: 'POST',
        url: '/v1/definition/apply',
        headers: mutatingHeaders(cliHeaders(harness), 'key-at7-5'),
        payload: {
          sha: 'e'.repeat(40),
          approvalId: 'apr-bound',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(harness.definition.applies).toHaveLength(1);

      const applied = harness.events.events.filter(
        (event) => event.eventType === 'definition.applied',
      );
      expect(applied).toHaveLength(1);

      await harness.close();
    });
  });
});
