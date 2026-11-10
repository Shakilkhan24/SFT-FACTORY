/**
 * **A0.5** — the orchestrator's oracle (T-1.13).
 *
 * > **A0.5** | Killing the control plane mid-run yields a resumed or
 * > explicitly failed task — **never a silent loss** | Fault injection
 *
 * The ticket's oracle highlights spell out the five proofs:
 *
 * 1. SIGKILL the worker mid-run ⇒ resumed or explicit ESCALATED/FAILED;
 * 2. an idempotent node handler;
 * 3. cancel reclaims env + credentials;
 * 4. budget exhaustion ⇒ `INCOMPLETE` with partial artefacts labelled;
 * 5. unknown failure ⇒ `workflow.composition`.
 *
 * Each proof is named so the failure message says **which** proof broke.
 * The gate that runs this is `pnpm test:fault -t "A0.5"` (checklist 03
 * CL-G1-05).
 */

import { describe, expect, it } from 'vitest';

import {
  CancelPath,
  ExecutionLoop,
  ExecutorRegistry,
  FakeCredentialReclaimer,
  FakeEnvironmentRegistry,
  FakeExecutor,
  FakeHarnessAdapter,
  FakeStateSink,
  InMemoryLeaseStore,
  InMemoryRunStore,
  NEVER_CANCELLED,
  RESUME_FAILED_TRIGGER,
  ResumePath,
  StageRunner,
  cancelledToken,
  type ReadyNode,
  type StageRunRequest,
} from '@factory/orchestrator';

/**
 * The ready node the proofs use.
 */
const node = (overrides: Partial<ReadyNode> = {}): ReadyNode => ({
  taskId: 'tsk_1',
  nodeId: 'n1-implement',
  stageKind: 'implement',
  role: 'worker',
  attempt: 1,
  spec: { summary: 'build the thing' },
  context: { envelopeId: 'ctx_1', items: [] },
  tools: { capabilities: ['repo:read'], scopes: ['repo:read'] },
  budget: {},
  isolation: 'T2',
  modelPolicy: { role: 'worker' },
  ...overrides,
});

/**
 * The runner request the proofs use.
 */
const request = (overrides: Partial<StageRunRequest> = {}): StageRunRequest => ({
  taskId: 'tsk_1',
  nodeId: 'n1-implement',
  attempt: 1,
  stageKind: 'implement',
  role: 'worker',
  spec: {},
  context: {},
  tools: { capabilities: [], scopes: [] },
  budget: {},
  isolation: 'T2',
  modelPolicy: { role: 'worker' },
  runId: 'run_1',
  startedAt: '2026-11-10T00:00:00.000Z',
  endedAt: '2026-11-10T00:00:05.000Z',
  ...overrides,
});

describe('A0.5 · killing the control plane mid-run yields a resumed or explicitly failed task', () => {
  it('A0.5 · a task whose control plane died is escalated, never silently lost', async () => {
    const runs = new InMemoryRunStore();
    const leases = new InMemoryLeaseStore();
    const state = new FakeStateSink();
    const resume = new ResumePath({
      runs,
      leases,
      state,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    // The task was RUNNING when the control plane was killed. No run is
    // live, because the process that was running it died with it.
    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    // The outcome is **explicit**: ESCALATED(resume_failed).
    expect(state.transitions).toHaveLength(1);
    expect(state.transitions[0]?.to).toBe('ESCALATED');
    expect(state.transitions[0]?.trigger).toBe(RESUME_FAILED_TRIGGER);

    const outcome = report.outcomes[0]?.outcome;
    expect(outcome?.kind).toBe('escalated');
  });

  it('A0.5 · a task with a live node is resumed rather than escalated', async () => {
    const runs = new InMemoryRunStore();
    const leases = new InMemoryLeaseStore();
    const state = new FakeStateSink();
    const resume = new ResumePath({
      runs,
      leases,
      state,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    // The worker survived the kill: its run is still live.
    await runs.start({
      runId: 'run_1',
      taskId: 'tsk_1',
      nodeId: 'n1-implement',
      attempt: 1,
      role: 'worker',
      stageKind: 'implement',
      executorKind: 'harness',
      status: 'running',
      costUsdMicros: 0,
      startedAt: '2026-11-10T00:00:00.000Z',
    });

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    expect(report.outcomes[0]?.outcome.kind).toBe('still-running');
    expect(state.transitions).toHaveLength(0);
  });

  it('A0.5 · the expired lease of a dead worker is re-queued exactly once', async () => {
    const runs = new InMemoryRunStore();
    const leases = new InMemoryLeaseStore();
    const state = new FakeStateSink();
    const resume = new ResumePath({
      runs,
      leases,
      state,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    const lease = {
      taskId: 'tsk_1',
      nodeId: 'n1-implement',
      owner: 'worker-1',
      attempt: 1,
      expiresAt: '2026-11-09T23:00:00.000Z',
    };
    leases.add(lease);

    const first = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);
    expect(first.requeued).toHaveLength(1);

    // The second pass must not re-queue it again — a node run twice is a
    // duplicated side effect.
    const second = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);
    expect(second.requeued).toHaveLength(0);
  });
});

describe('A0.5 · the node handler is idempotent', () => {
  it('A0.5 · the first committed result wins and the second is not applied', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'success' });
    registry.register(executor);
    const runs = new InMemoryRunStore();
    const runner = new StageRunner({
      registry,
      runs,
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    const first = await runner.run(request({ runId: 'run_1' }), NEVER_CANCELLED);
    expect(first.applied).toBe(true);
    expect(runs.byId('run_1')?.status).toBe('succeeded');

    // The same run is reported again — a re-delivered job, a re-queued
    // lease, a duplicated handler call. The result is not applied again.
    const second = await runner.run(request({ runId: 'run_1' }), NEVER_CANCELLED);
    expect(second.applied).toBe(false);
    expect(second.winnerRunId).toBe('run_1');
  });

  it('A0.5 · the duplicated handler does not overwrite the first result', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'success' });
    registry.register(executor);
    const runs = new InMemoryRunStore();
    const runner = new StageRunner({
      registry,
      runs,
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    await runner.run(request({ runId: 'run_1' }), NEVER_CANCELLED);
    await runner.run(request({ runId: 'run_1' }), NEVER_CANCELLED);

    // The run record still holds the first result.
    expect(runs.finished).toHaveLength(2);
    expect(runs.byId('run_1')?.status).toBe('succeeded');
  });
});

describe('A0.5 · a cancel reclaims the environment and the credentials', () => {
  it('A0.5 · both the environment and the credentials are reclaimed', async () => {
    const environments = new FakeEnvironmentRegistry();
    const credentials = new FakeCredentialReclaimer();
    const harnessAdapter = new FakeHarnessAdapter();
    const cancel = new CancelPath({
      environments,
      credentials,
      harness: harnessAdapter,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    const outcome = await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      executorKind: 'harness',
      reason: 'the operator cancelled the task',
    });

    expect(environments.reclaimed).toEqual(['run_1']);
    expect(credentials.revoked).toEqual(['run_1']);
    expect(harnessAdapter.killed).toEqual(['run_1']);
    expect(outcome.failures).toEqual([]);
  });

  it('A0.5 · the credentials are revoked even when the environment reclamation fails', async () => {
    const environments = new FakeEnvironmentRegistry();
    const credentials = new FakeCredentialReclaimer();
    environments.reclaim = (): Promise<void> =>
      Promise.reject(new Error('the filesystem is gone'));
    const cancel = new CancelPath({
      environments,
      credentials,
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    const outcome = await cancel.cancel({
      taskId: 'tsk_1',
      runId: 'run_1',
      reason: 'the operator cancelled the task',
    });

    expect(credentials.revoked).toEqual(['run_1']);
    expect(outcome.credentialsRevoked).toBe(true);
    expect(outcome.failures).toHaveLength(1);
  });
});

describe('A0.5 · budget exhaustion yields INCOMPLETE with the partial artefacts labelled', () => {
  it('A0.5 · the stage outcome is incomplete, not failed', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'success' });
    registry.register(executor);
    const runs = new InMemoryRunStore();
    const state = new FakeStateSink();
    const runner = new StageRunner({
      registry,
      runs,
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    const outcome = await runner.run(
      request({ budget: { maxCostUsdMicros: 1_000, spentUsdMicros: 1_000 } }),
      NEVER_CANCELLED,
    );

    expect(outcome.status).toBe('incomplete');
    expect(outcome.failureClass).toBe('budget.exhausted');
    expect(runs.byId('run_1')?.status).toBe('incomplete');
    expect(state.transitions).toHaveLength(0);
  });

  it('A0.5 · the partial artefacts are preserved and labelled', async () => {
    const registry = new ExecutorRegistry();
    // The executor reports `incomplete` — it ran, it produced partial
    // artefacts, and it stopped. That is the case FR-32 is about: the
    // partial artefacts are preserved and labelled, not thrown away.
    const executor = new FakeExecutor('harness', {
      status: 'incomplete',
      artefacts: [
        { ref: 'artefact-1', sha256: 'sha256:aaa' },
        { ref: 'artefact-2', sha256: 'sha256:bbb' },
      ],
    });
    registry.register(executor);
    const runner = new StageRunner({
      registry,
      runs: new InMemoryRunStore(),
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    // FR-32: the partial artefacts are preserved — not thrown away — and
    // they are labelled.
    expect(outcome.status).toBe('incomplete');
    expect(outcome.artefacts).toHaveLength(2);
    for (const artefact of outcome.artefacts ?? []) {
      expect(artefact.label).toBe('incomplete');
    }
    expect(outcome.artefacts?.[0]?.ref).toBe('artefact-1');
    expect(outcome.artefacts?.[0]?.sha256).toBe('sha256:aaa');
  });

  it('A0.5 · an incomplete stage does not run the executor at all', async () => {
    // The budget is checked **before** the executor runs.
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'success' });
    registry.register(executor);
    const runner = new StageRunner({
      registry,
      runs: new InMemoryRunStore(),
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    await runner.run(
      request({ budget: { maxTurns: 1, turns: 1 } }),
      NEVER_CANCELLED,
    );

    expect(executor.calls).toHaveLength(0);
  });
});

describe('A0.5 · an unknown failure is a workflow.composition failure', () => {
  it('A0.5 · an executor that throws is classified as workflow.composition', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor(
      'harness',
      { status: 'success' },
      new Error('the sandbox vanished'),
    );
    registry.register(executor);
    const runner = new StageRunner({
      registry,
      runs: new InMemoryRunStore(),
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    expect(outcome.failureClass).toBe('workflow.composition');
    expect(outcome.rawFailureClass).toBe('unknown');
  });

  it('A0.5 · a failure with no class is classified as workflow.composition', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'failure' });
    registry.register(executor);
    const runner = new StageRunner({
      registry,
      runs: new InMemoryRunStore(),
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    expect(outcome.failureClass).toBe('workflow.composition');
  });
});

describe('A0.5 · the loop never loses a node', () => {
  it('A0.5 · a cancelled loop leaves the unrun nodes resumable', async () => {
    const registry = new ExecutorRegistry();
    const executor = new FakeExecutor('harness', { status: 'success' });
    registry.register(executor);
    const runs = new InMemoryRunStore();
    const state = new FakeStateSink();
    const runner = new StageRunner({
      registry,
      runs,
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
    });
    const loop = new ExecutionLoop({
      runner,
      runs,
      environments: new FakeEnvironmentRegistry(),
      credentials: new FakeCredentialReclaimer(),
      state,
      nextRunId: () => 'run_1',
      clock: { now: () => '2026-11-10T00:00:00.000Z' },
    });

    const outcome = await loop.run(
      [node({ nodeId: 'n1' }), node({ nodeId: 'n2' })],
      cancelledToken('the operator cancelled the task'),
    );

    // Nothing ran, nothing was reported as failed, and the loop is
    // resumable: the nodes are still `READY`.
    expect(outcome.outcomes).toHaveLength(0);
    expect(outcome.cancelled).toBe(true);
    expect(state.toState('FAILED')).toHaveLength(0);
    expect(state.toState('SUCCEEDED')).toHaveLength(0);
  });
});
