/**
 * The artefacts package's test fixtures.
 *
 * ## What the helpers are for
 *
 * The artefacts package's rules are proved by **what they observe**: what
 * was written, what was redacted, what was indexed, what the purge
 * deleted. So the helpers here are **recording doubles** plus the
 * **sample facts** a run record is assembled from.
 *
 * The sample facts matter as much as the doubles. A record has **twelve**
 * elements, and a test that assembles one by hand would spend most of its
 * lines on boilerplate — and, worse, would make it easy to assemble a
 * record that is *complete* by accident. The fixtures here make the
 * completeness explicit: {@link THE_PARTS} is a record that satisfies
 * A0.3, and the tests take it apart to show what happens when an element
 * is missing.
 */

import { RedactionRegistry } from '../../packages/credentials/src/index.ts';
import {
  InMemoryObjectStore,
  InMemoryRunRecordStore,
  InMemorySpool,
  RunArtifactStore,
  buildRecord,
  type RecordParts,
  type RunRecord,
} from '../../packages/artefacts/src/index.ts';

/**
 * The instant the fixtures' run starts.
 *
 * A **fixed** instant, so the record's expiry and the retention date are
 * deterministic. AGENTS.md §4: "Time via injected `Clock`."
 */
export const THE_INSTANT = '2026-11-10T00:00:00.000Z';

/**
 * The instant the fixtures' run completes.
 */
export const THE_COMPLETION = '2026-11-10T00:31:47.221Z';

/**
 * The parts of a **complete** run record.
 *
 * Every one of the twelve elements is present and non-empty, so
 * `assertComplete` on the assembled record passes. The tests that need an
 * incomplete record take this apart.
 */
export const THE_PARTS: RecordParts = {
  identity: {
    runId: 'run_01JCZ8JYTESTRUN000000',
    taskId: 'tsk_01JCZ8K1TESTTASK00000',
    workflow: { id: 'wf_bugfix', version: '4' },
    specVersion: 'spec-v7',
  },
  context: {
    envelopeId: 'ctx_01JCZ8JNTESTENV000000',
    resolvedContextSha256: `sha256:${'a'.repeat(64)}`,
    items: [
      {
        id: 'skill.backend-conventions',
        version: '7',
        sha256: `sha256:${'b'.repeat(64)}`,
        trust: 'trusted',
      },
    ],
    gaps: [],
  },
  configuration: {
    definitionRevision: 'def_01JCZ8ATESTDEF0000000',
    harnessVersion: '2.1.0',
    routingPolicy: 'default@3',
    toolRegistryRevision: 'tr_01JCZ8BTESTREG0000000',
  },
  nodes: [
    {
      nodeId: 'n_04',
      role: 'worker',
      model: { provider: 'providerA', model: 'modelX', version: '2026-04' },
      attempts: 1,
      turns: 47,
      durationMs: 812_430,
      toolCalls: [
        {
          invocationId: 'inv_01JCZ8NQTESTINV000000',
          capabilityId: 'repo.read',
          capabilityVersion: '1.0.0',
          argumentsSummary: 'read the repository map',
          resultSummary: 'read 42 files',
          durationMs: 42,
          costUsdMicros: 0,
        },
      ],
      artefacts: [
        {
          kind: 'patch',
          uri: 's3://factory-artifacts/chg_test/diff.patch',
          sha256: `sha256:${'c'.repeat(64)}`,
          bytes: 48_213,
        },
      ],
      verification: [
        {
          layer: 'acceptance',
          result: 'pass',
          authoredBy: 'generator',
          trusted: true,
        },
        {
          layer: 'unit',
          result: 'pass',
          authoredBy: 'agent',
          trusted: false,
        },
      ],
    },
  ],
  prompts: [
    {
      kind: 'prompt',
      role: 'user',
      text: 'Fix the failing test in packages/core.',
      sha256: `sha256:${'d'.repeat(64)}`,
    },
    {
      kind: 'generated',
      role: 'assistant',
      text: 'I have located the failure and applied the fix.',
      sha256: `sha256:${'e'.repeat(64)}`,
    },
  ],
  outcome: { status: 'success', failureClassification: null },
  authority: [
    {
      action: 'merge',
      source: 'accesspoint.approve',
      approver: 'human:alice',
      artefactSha256: `sha256:${'c'.repeat(64)}`,
    },
  ],
  cost: {
    tokensIn: 184_220,
    tokensOut: 39_100,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    modelUsdMicros: 1_842_000,
    toolUsdMicros: 14_000,
    infraUsdMicros: 221_000,
    totalUsdMicros: 2_077_000,
  },
  budget: {
    declaredUsdMicros: 5_000_000,
    consumedUsdMicros: 2_077_000,
    turnsDeclared: 100,
    turnsUsed: 47,
  },
  policyDecisions: [
    {
      id: 'pol_test_0001',
      action: 'repo.write',
      outcome: 'ALLOW',
      ruleIds: ['repo.write.scope'],
      reason: 'the path is inside the task scope',
    },
  ],
  redaction: { applied: [], policyRef: 'redaction.v1' },
  retention: { class: 'engineering', expiresAt: '2027-11-10T00:00:00.000Z' },
  startedAt: THE_INSTANT,
  completedAt: THE_COMPLETION,
};

/**
 * A **complete** run record.
 *
 * Assembled from {@link THE_PARTS}, so it satisfies A0.3.
 */
export const THE_RECORD: RunRecord = buildRecord(THE_PARTS);

/**
 * The parts with one element replaced.
 *
 * The generic form: `parts({ outcome: { ... } })` returns a copy of
 * {@link THE_PARTS} with the named member replaced. It keeps the fixtures
 * **immutable** — a test that mutated the shared parts would corrupt every
 * test after it.
 */
export const parts = (overrides: Partial<RecordParts> = {}): RecordParts => ({
  ...THE_PARTS,
  ...overrides,
});

/**
 * The `runs` index entry for {@link THE_PARTS}.
 */
export const THE_INDEX = {
  runId: THE_PARTS.identity.runId,
  taskId: THE_PARTS.identity.taskId,
  nodeId: 'n_04',
  attempt: 1,
  role: 'worker',
  stageKind: 'implement',
  executorKind: 'harness' as const,
  status: 'completed',
  outcome: 'success',
  startedAt: THE_INSTANT,
  endedAt: THE_COMPLETION,
  costUsdMicros: 2_077_000,
  tokens: { tokensIn: 184_220, tokensOut: 39_100 },
  retentionClass: 'engineering',
};

/**
 * A registry holding one minted secret.
 *
 * The secret is a **fake** — a shape that the pattern layer would catch
 * anyway, so the test proves the *exact-match* layer works by using a
 * value the pattern layer would **not** catch.
 *
 * `plain-value-9f3a2b7c4d6e` has no token prefix, no key block, no JWT
 * shape and no high-entropy word near it. Only the exact-match layer
 * catches it.
 */
export const registryWith = (secret: string): RedactionRegistry => {
  const registry = new RedactionRegistry(THE_PARTS.identity.taskId);
  registry.addMinted(secret);
  return registry;
};

/**
 * The seeded secret the redaction tests use.
 *
 * It is deliberately **not** catchable by the pattern layer, so a test
 * that passes proves the exact-match layer ran.
 */
export const THE_SEEDED_SECRET = 'plain-value-9f3a2b7c4d6e';

/**
 * A store, with its doubles.
 *
 * The whole assembly — the writer, the object store, the spool and the
 * index — so a test can reach each one.
 */
export interface ArtefactHarness {
  /** The record writer. */
  readonly store: RunArtifactStore;
  /** The object store. */
  readonly objectStore: InMemoryObjectStore;
  /** The spool. */
  readonly spool: InMemorySpool;
  /** The `runs` index. */
  readonly runStore: InMemoryRunRecordStore;
}

/**
 * Build the harness.
 */
export const harness = (): ArtefactHarness => {
  const objectStore = new InMemoryObjectStore();
  const spool = new InMemorySpool();
  const runStore = new InMemoryRunRecordStore();
  const store = new RunArtifactStore({ objectStore, spool, runStore });
  return { store, objectStore, spool, runStore };
};
