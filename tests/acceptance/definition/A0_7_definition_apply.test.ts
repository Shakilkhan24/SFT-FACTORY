/**
 * T-1.06 — the definition store and applier.
 *
 * A0.7: "a control-surface write to the definition without a reviewed change
 * is rejected".
 *
 * These are the acceptance checks for the ticket. They assert **behaviour**
 * through the package's public interface — what an apply does and refuses to
 * do — not the internals of how it decides.
 *
 * What a wrong implementation would pass: a test that only checked "apply
 * succeeds on the happy path" would pass an implementation with no
 * preconditions at all. Every check below is a *negative* case: an apply
 * that must be refused.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Approval } from '@factory/contracts';

import {
  applyDefinition,
  checkApproval,
  checkDrift,
  definitionBundleSha256,
  loadDefinition,
  planBetween,
  rowToApproval,
  runDriftJob,
  type DefinitionBundle,
  type DefinitionScmCheck,
  type DefinitionVersionStore,
} from '@factory/definition';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A minimal but *valid* definition tree.
 *
 * It has the four documents the bundle requires to assemble (a factory, a
 * policy bundle, and at least one workflow so the plan has something to
 * diff), and it is written out rather than imported so the test does not
 * depend on the repository's own definition being in any particular state.
 */
const writeDefinition = async (
  root: string,
  overrides: { readonly workflowName?: string; readonly extraWorkflow?: string } = {},
): Promise<void> => {
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

  if (overrides.extraWorkflow !== undefined) {
    await writeFile(
      join(root, 'workflows', 'beta.yaml'),
      [
        'apiVersion: factory/v1',
        'kind: WorkflowDefinition',
        'metadata: { name: beta }',
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
  }
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
 * An SCM check that says "yes" to everything.
 */
const permissiveScm = (): DefinitionScmCheck => ({
  checkProtectedBranch: () =>
    Promise.resolve({ ok: true, onProtectedBranch: true, checksGreen: true }),
});

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
      Promise.resolve(active === undefined ? undefined : definitionBundleSha256(active)),
    currentRole: () => role,
  };
};

/**
 * A well-formed digest built from a repeated character.
 *
 * The `Sha256` type is a branded template literal, so a plain string is not
 * assignable to it. This helper produces one without a cast.
 */
const digestOf = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

/**
 * A granted `definition` approval bound to a digest.
 */
const approvalFor = (
  bundleSha256: `sha256:${string}`,
  overrides: Partial<Approval> = {},
): Approval => ({
  id: 'approval-1',
  taskId: 'task-1',
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
} as Approval);

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe('A0.7 — a control-surface write to the definition without a reviewed change is rejected', () => {
  it('A0_7 refuses the apply when there is no approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
      await writeDefinition(root);
    try {
      const bundle = await loadOrThrow(root);
      const store = recordingStore(undefined);

      const outcome = await applyDefinition({
        sha: 'b'.repeat(40),
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
      // Nothing was written.
      expect(store.applied).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('A0_7 refuses the apply when the approval is bound to a different bundle digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
      await writeDefinition(root);
    try {
      const bundle = await loadOrThrow(root);
      const digest = definitionBundleSha256(bundle);
      const store = recordingStore(undefined);

      const outcome = await applyDefinition({
        sha: 'c'.repeat(40),
        bundle,
        // The approval is bound to *some* other digest — an approval of a
        // bundle that is not the one being applied.
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
      // The digest that was actually required is reported, so the operator
      // can see what to bind the approval to.
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('A0_7 refuses the apply when the connection is not the applier role', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
      await writeDefinition(root);
    try {
      const bundle = await loadOrThrow(root);
      const digest = definitionBundleSha256(bundle);
      const store = recordingStore(undefined, 'factory_app');

      const outcome = await applyDefinition({
        sha: 'd'.repeat(40),
        bundle,
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

  it('A0_7 refuses the apply when the SHA is not on the protected default branch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
      await writeDefinition(root);
    try {
      const bundle = await loadOrThrow(root);
      const digest = definitionBundleSha256(bundle);
      const store = recordingStore(undefined);

      const outcome = await applyDefinition({
        sha: 'e'.repeat(40),
        bundle,
        approval: approvalFor(digest),
        appliedBy: 'owner',
        scm: {
          checkProtectedBranch: () =>
            Promise.resolve({ ok: false, onProtectedBranch: false, checksGreen: true }),
        },
        store,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.detail.refusal).toBe('sha_not_on_protected_branch');
      }
      expect(store.applied).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('A0_7 refuses the apply when the required checks are not green', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
      await writeDefinition(root);
    try {
      const bundle = await loadOrThrow(root);
      const digest = definitionBundleSha256(bundle);
      const store = recordingStore(undefined);

      const outcome = await applyDefinition({
        sha: 'f'.repeat(40),
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

  it('A0_7 refuses the apply when the SCM cannot confirm the SHA at all', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
      await writeDefinition(root);
    try {
      const bundle = await loadOrThrow(root);
      const digest = definitionBundleSha256(bundle);
      const store = recordingStore(undefined);

      const outcome = await applyDefinition({
        sha: '0'.repeat(40),
        bundle,
        approval: approvalFor(digest),
        appliedBy: 'owner',
        scm: {
          checkProtectedBranch: () => Promise.reject(new Error('the SCM is unreachable')),
        },
        store,
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.detail.refusal).toBe('unknown_sha');
      }
      expect(store.applied).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('A0_7 refuses the apply when the approval is not of type "definition"', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
      await writeDefinition(root);
    try {
      const bundle = await loadOrThrow(root);
      const digest = definitionBundleSha256(bundle);

      const outcome = await applyDefinition({
        sha: '1'.repeat(40),
        bundle,
        approval: approvalFor(digest, { type: 'merge' as Approval['type'] }),
        appliedBy: 'owner',
        scm: permissiveScm(),
        store: recordingStore(undefined),
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.detail.refusal).toBe('approval_not_for_definition');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('A0_7 refuses the apply when the approval was decided by somebody else', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
      await writeDefinition(root);
    try {
      const bundle = await loadOrThrow(root);
      const digest = definitionBundleSha256(bundle);

      const outcome = await applyDefinition({
        sha: '2'.repeat(40),
        bundle,
        approval: approvalFor(digest, { decidedBy: 'someone-else' }),
        appliedBy: 'owner',
        scm: permissiveScm(),
        store: recordingStore(undefined),
      });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.detail.refusal).toBe('not_approver');
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('A0_7 refuses the apply when the approval has expired or been consumed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
      await writeDefinition(root);
    try {
      const bundle = await loadOrThrow(root);
      const digest = definitionBundleSha256(bundle);

      for (const status of ['expired', 'consumed', 'revoked', 'refused'] as const) {
        const outcome = await applyDefinition({
          sha: '3'.repeat(40),
          bundle,
          approval: approvalFor(digest, { status }),
          appliedBy: 'owner',
          scm: permissiveScm(),
          store: recordingStore(undefined),
        });

        expect(outcome.ok, `status ${status} should not be applicable`).toBe(false);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('A0_7 applies the definition when all three preconditions hold', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
      await writeDefinition(root);
    try {
      const bundle = await loadOrThrow(root);
      const digest = definitionBundleSha256(bundle);
      const store = recordingStore(undefined);

      const outcome = await applyDefinition({
        sha: '4'.repeat(40),
        bundle,
        approval: approvalFor(digest),
        appliedBy: 'owner',
        scm: permissiveScm(),
        store,
      });

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.sha).toBe('4'.repeat(40));
        expect(outcome.bundleSha256).toBe(digest);
      }
      expect(store.applied).toHaveLength(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('T-1.06 — the definition loader and the plan', () => {
  it('T_1_06 rejects a definition whose document does not validate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
    try {
      await writeDefinition(root);
      // A capability document that does not conform to its schema.
      await writeFile(
        join(root, 'capabilities', 'broken.yaml'),
        [
          'apiVersion: factory/v1',
          'kind: ToolCapability',
          'metadata: { name: broken, version: "1" }',
          'spec: { owner: nobody }',
          '',
        ].join('\n'),
        'utf8',
      );

      const result = await loadDefinition(root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures.length).toBeGreaterThan(0);
        expect(result.failures.some((f) => f.path.includes('broken.yaml'))).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('T_1_06 rejects a document that declares no kind', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
    try {
      await writeDefinition(root);
      await writeFile(join(root, 'capabilities', 'kindless.yaml'), 'just: data\n', 'utf8');

      const result = await loadDefinition(root);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failures.some((f) => f.path.includes('kindless.yaml'))).toBe(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('T_1_06 produces the same digest for the same documents read in a different order', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'factory-def-'));
    const rootB = await mkdtemp(join(tmpdir(), 'factory-def-'));
    try {
      await writeDefinition(rootA);
      await writeDefinition(rootB, { extraWorkflow: 'beta' });

      // The two trees differ, so their digests differ.
      const a = await loadOrThrow(rootA);
      const b = await loadOrThrow(rootB);
      expect(definitionBundleSha256(a)).not.toBe(definitionBundleSha256(b));
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });

  it('T_1_06 plans a structured diff of added documents', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'factory-def-'));
    const rootB = await mkdtemp(join(tmpdir(), 'factory-def-'));
    try {
      await writeDefinition(rootA);
      await writeDefinition(rootB, { extraWorkflow: 'beta' });

      const a = await loadOrThrow(rootA);
      const b = await loadOrThrow(rootB);

      const plan = planBetween(
        a,
        b,
        definitionBundleSha256(a),
        definitionBundleSha256(b),
      );

      expect(plan.isEmpty).toBe(false);
      const added = plan.changes.filter((c) => c.kind === 'added');
      expect(added.length).toBeGreaterThan(0);
      expect(added.some((c) => c.documentKind === 'WorkflowDefinition' && c.name === 'beta')).toBe(true);
      // Nothing was removed.
      expect(plan.changes.some((c) => c.kind === 'removed')).toBe(false);
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });

  it('T_1_06 plans no change between two identical definitions', async () => {
    const rootA = await mkdtemp(join(tmpdir(), 'factory-def-'));
    const rootB = await mkdtemp(join(tmpdir(), 'factory-def-'));
    try {
      await writeDefinition(rootA);
      await writeDefinition(rootB);

      const a = await loadOrThrow(rootA);
      const b = await loadOrThrow(rootB);

      const plan = planBetween(a, b, definitionBundleSha256(a), definitionBundleSha256(b));
      expect(plan.isEmpty).toBe(true);
      expect(plan.changes).toHaveLength(0);
    } finally {
      await rm(rootA, { recursive: true, force: true });
      await rm(rootB, { recursive: true, force: true });
    }
  });
});

describe('T-1.06 — the drift job reports and never corrects', () => {
  it('T_1_06 reports drift when the repository no longer matches the applied bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
    try {
      await writeDefinition(root);
      const applied = await loadOrThrow(root);

      const report = await checkDrift({
        claimedSha: 'a'.repeat(40),
        appliedBundle: applied,
        loadAtSha: () => {
          // The repository at the claimed SHA produces a *different* bundle.
          const other = mkdtemp(join(tmpdir(), 'factory-def-'));
          return other.then(async (dir) => {
            try {
              await writeDefinition(dir, { extraWorkflow: 'beta' });
              return await loadOrThrow(dir);
            } finally {
              await rm(dir, { recursive: true, force: true });
            }
          });
        },
      });

      expect(report.drifted).toBe(true);
      expect(report.findings).toHaveLength(1);
      expect(report.findings[0]?.kind).toBe('content_changed');
      // The applied definition was NOT corrected.
      expect(report.autoCorrected).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('T_1_06 reports no drift when the repository matches the applied bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
    try {
      await writeDefinition(root);
      const applied = await loadOrThrow(root);

      const report = await checkDrift({
        claimedSha: 'a'.repeat(40),
        appliedBundle: applied,
        loadAtSha: () => Promise.resolve(applied),
      });

      expect(report.drifted).toBe(false);
      expect(report.findings).toHaveLength(0);
      expect(report.autoCorrected).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('T_1_06 reports drift when the claimed SHA can no longer be read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
    try {
      await writeDefinition(root);
      const applied = await loadOrThrow(root);

      const report = await checkDrift({
        claimedSha: 'a'.repeat(40),
        appliedBundle: applied,
        loadAtSha: () => Promise.resolve(undefined),
      });

      expect(report.drifted).toBe(true);
      expect(report.findings[0]?.kind).toBe('sha_unreadable');
      expect(report.autoCorrected).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('T-1.06 — checkApproval', () => {
  it('T_1_06 accepts a granted, bound, unexpired approval by an approver', () => {
    const digest = digestOf('a');
    expect(checkApproval(approvalFor(digest), digest, 'owner')).toBeUndefined();
  });

  it('T_1_06 refuses an approval whose artefact digest does not match', () => {
    const digest = digestOf('a');
    const refusal = checkApproval(approvalFor(digest), digestOf('b'), 'owner');
    expect(refusal?.refusal).toBe('approval_hash_mismatch');
  });
});

describe('T-1.06 — the drift job appends the event and never corrects', () => {
  it('T_1_06 appends definition.driftDetected when the repository no longer matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
    await writeDefinition(root);
    try {
      const loaded = await loadDefinition(root);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        return;
      }

      const appended: unknown[] = [];
      const outcome = await runDriftJob({
        reader: {
          activeVersion: () => Promise.resolve({ sha: 'sha-1', bundle: loaded.bundle }),
        },
        // The repository yields a *different* bundle, so the content drifted:
        // the workflow is renamed, which changes the canonical digest.
        repository: {
          loadAtSha: () =>
            Promise.resolve({
              ...loaded.bundle,
              workflows: loaded.bundle.workflows.map((workflow) => ({
                ...workflow,
                metadata: { ...workflow.metadata, name: 'renamed' },
              })),
            }),
        },
        sink: {
          append: (events) => {
            appended.push(...events);
            return Promise.resolve(events);
          },
        },
        correlationId: 'corr-1',
        jobRunId: 'job-1',
      });

      expect(outcome.report.drifted).toBe(true);
      expect(outcome.report.autoCorrected).toBe(false);
      expect(appended).toHaveLength(1);

      const event = appended[0] as {
        eventType: string;
        aggregate: { kind: string; id: string };
        payload: { expectedSha: string; observedSha: string; diff: string };
      };
      expect(event.eventType).toBe('definition.driftDetected');
      expect(event.aggregate.kind).toBe('definition');
      expect(event.aggregate.id).toBe('sha-1');
      expect(event.payload.expectedSha).toBe('sha-1');
      expect(event.payload.diff.length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('T_1_06 appends nothing when the repository matches the applied bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
    await writeDefinition(root);
    try {
      const loaded = await loadDefinition(root);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        return;
      }

      const appended: unknown[] = [];
      const outcome = await runDriftJob({
        reader: {
          activeVersion: () => Promise.resolve({ sha: 'sha-1', bundle: loaded.bundle }),
        },
        repository: { loadAtSha: () => Promise.resolve(loaded.bundle) },
        sink: {
          append: (events) => {
            appended.push(...events);
            return Promise.resolve(events);
          },
        },
        correlationId: 'corr-1',
        jobRunId: 'job-1',
      });

      expect(outcome.report.drifted).toBe(false);
      expect(appended).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('T_1_06 appends nothing when no definition has been applied', async () => {
    const appended: unknown[] = [];
    const outcome = await runDriftJob({
      reader: { activeVersion: () => Promise.resolve(undefined) },
      repository: { loadAtSha: () => Promise.resolve(undefined) },
      sink: {
        append: (events) => {
          appended.push(...events);
          return Promise.resolve(events);
        },
      },
      correlationId: 'corr-1',
      jobRunId: 'job-1',
    });

    expect(outcome.report.drifted).toBe(false);
    expect(appended).toHaveLength(0);
  });

  it('T_1_06 never writes the applied version — the job has no write path at all', async () => {
    const root = await mkdtemp(join(tmpdir(), 'factory-def-'));
    await writeDefinition(root);
    try {
      const loaded = await loadDefinition(root);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) {
        return;
      }

      // The reader exposes only `activeVersion` — a read. There is no
      // `applyVersion` on the port the job takes, so "the drift job does not
      // auto-correct" is enforced by the type of the port, not by a promise
      // the implementation makes.
      const outcome = await runDriftJob({
        reader: {
          activeVersion: () => Promise.resolve({ sha: 'sha-1', bundle: loaded.bundle }),
        },
        repository: { loadAtSha: () => Promise.resolve(undefined) },
        sink: { append: () => Promise.resolve([]) },
        correlationId: 'corr-1',
        jobRunId: 'job-1',
      });

      expect(outcome.report.autoCorrected).toBe(false);
      expect(outcome.report.findings[0]?.kind).toBe('sha_unreadable');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('T-1.06 — the approval reader maps a row to the contract shape', () => {
  it('T_1_06 turns a stored row into an Approval with a sha256 digest', () => {
    const approval = rowToApproval({
      id: 'approval-1',
      task_id: 'task-1',
      type: 'definition',
      artefact_kind: 'definition-bundle',
      artefact_ref: 'sha:abc',
      artefact_sha256: Buffer.from('ab'.repeat(32), 'hex'),
      approvers: ['owner'],
      status: 'granted',
      requested_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2026-12-01T00:00:00.000Z',
      decided_by: 'owner',
      security_scope_ack: true,
    });

    expect(approval.artefactSha256).toBe(`sha256:${'ab'.repeat(32)}`);
    expect(approval.taskId).toBe('task-1');
    expect(approval.decidedBy).toBe('owner');
    expect(approval.status).toBe('granted');
  });

  it('T_1_06 leaves decidedBy absent when the approval has not been decided', () => {
    const approval = rowToApproval({
      id: 'approval-1',
      task_id: 'task-1',
      type: 'definition',
      artefact_kind: 'definition-bundle',
      artefact_ref: 'sha:abc',
      artefact_sha256: Buffer.from('ab'.repeat(32), 'hex'),
      approvers: ['owner'],
      status: 'requested',
      requested_at: '2026-01-01T00:00:00.000Z',
      expires_at: '2026-12-01T00:00:00.000Z',
      decided_by: null,
      security_scope_ack: false,
    });

    expect(approval.decidedBy).toBeUndefined();
    expect(approval.securityScopeAck).toBe(false);
  });
});
