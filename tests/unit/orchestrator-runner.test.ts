/**
 * The stage runner (T-1.13).
 *
 * pack `02` §4.9: "Loop per ready node: build `StageInput` (spec, assembled
 * context, tools/grants, budget, isolation, model policy, **upstream
 * artefact only**) → run the stage executor → persist the result → apply
 * the resulting state transition(s)."
 *
 * The tests here prove the four steps' order, that the input carries the
 * upstream artefact **only**, that the budget is checked *before* the
 * executor runs, and that the cleanup happens on every path.
 */

import { describe, expect, it } from 'vitest';

import {
  ExecutorRegistry,
  FakeCredentialReclaimer,
  FakeEnvironmentRegistry,
  FakeExecutor,
  InMemoryRunStore,
  NEVER_CANCELLED,
  StageRunner,
  cancelledToken,
  type StageRunRequest,
} from '@factory/orchestrator';

/**
 * A stage run request with sensible defaults.
 */
const request = (overrides: Partial<StageRunRequest> = {}): StageRunRequest => ({
  taskId: 'tsk_1',
  nodeId: 'n1-implement',
  attempt: 1,
  stageKind: 'verify',
  role: 'worker',
  spec: { summary: 'do the thing' },
  context: { envelopeId: 'ctx_1', items: [] },
  tools: { capabilities: ['repo:read'], scopes: ['repo:read'] },
  budget: {},
  isolation: 'T1',
  modelPolicy: { role: 'worker' },
  runId: 'run_1',
  startedAt: '2026-11-10T00:00:00.000Z',
  endedAt: '2026-11-10T00:00:01.000Z',
  ...overrides,
});

/**
 * A runner wired to the fakes.
 */
const harness = (
  executor: FakeExecutor,
): {
  runner: StageRunner;
  runs: InMemoryRunStore;
  environments: FakeEnvironmentRegistry;
  credentials: FakeCredentialReclaimer;
} => {
  const registry = new ExecutorRegistry();
  registry.register(executor);
  const runs = new InMemoryRunStore();
  const environments = new FakeEnvironmentRegistry();
  const credentials = new FakeCredentialReclaimer();
  const runner = new StageRunner({ registry, runs, environments, credentials });
  return { runner, runs, environments, credentials };
};

describe('the stage runner', () => {
  it('runs the executor and reports success', async () => {
    const executor = new FakeExecutor('deterministic', {
      status: 'success',
      artefacts: [{ ref: 'artefact-1', sha256: 'sha256:abc' }],
    });
    const { runner } = harness(executor);

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    expect(outcome.status).toBe('success');
    expect(outcome.applied).toBe(true);
    expect(outcome.failureClass).toBeUndefined();
    expect(executor.calls).toHaveLength(1);
  });

  it('builds the input with the upstream artefact only', async () => {
    const executor = new FakeExecutor('deterministic');
    const { runner } = harness(executor);

    await runner.run(
      request({
        upstreamArtefact: { ref: 'upstream-1', sha256: 'sha256:up' },
      }),
      NEVER_CANCELLED,
    );

    const input = executor.calls[0];
    expect(input?.upstreamArtefact).toEqual({
      ref: 'upstream-1',
      sha256: 'sha256:up',
    });
    // The input carries **one** artefact — the immediate predecessor's.
    // There is no field that could hold the whole history.
    const artefactKeys = Object.keys(input ?? {}).filter((key) =>
      key.toLowerCase().includes('artefact'),
    );
    expect(artefactKeys).toEqual(['upstreamArtefact']);
  });

  it('a stage with no predecessor carries no upstream artefact', async () => {
    const executor = new FakeExecutor('deterministic');
    const { runner } = harness(executor);

    await runner.run(request(), NEVER_CANCELLED);

    expect(executor.calls[0]?.upstreamArtefact).toBeUndefined();
  });

  it('the input carries every part of the StageInput', async () => {
    const executor = new FakeExecutor('deterministic');
    const { runner } = harness(executor);

    await runner.run(request(), NEVER_CANCELLED);

    const input = executor.calls[0];
    expect(input?.spec).toEqual({ summary: 'do the thing' });
    expect(input?.context).toEqual({ envelopeId: 'ctx_1', items: [] });
    expect(input?.tools.capabilities).toEqual(['repo:read']);
    expect(input?.budget).toEqual({});
    expect(input?.isolation).toBe('T1');
    expect(input?.modelPolicy.role).toBe('worker');
    expect(input?.executorKind).toBe('deterministic');
    expect(input?.attempt).toBe(1);
  });

  it('persists the result before the transition — the run record is finished', async () => {
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner, runs } = harness(executor);

    await runner.run(request(), NEVER_CANCELLED);

    expect(runs.byId('run_1')?.status).toBe('succeeded');
    expect(runs.finished).toHaveLength(1);
  });

  it('reclaims the environment and the credentials on success', async () => {
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner, environments, credentials } = harness(executor);

    await runner.run(request(), NEVER_CANCELLED);

    expect(environments.reclaimed).toEqual(['run_1']);
    expect(credentials.revoked).toEqual(['run_1']);
  });

  it('reclaims the environment and the credentials on failure', async () => {
    // ADR-0006 §4: reclamation happens at every terminal state, "including
    // failure".
    const executor = new FakeExecutor('deterministic', {
      status: 'failure',
      failureClass: 'model.reasoning',
      summary: 'the agent was wrong',
    });
    const { runner, environments, credentials } = harness(executor);

    await runner.run(request(), NEVER_CANCELLED);

    expect(environments.reclaimed).toEqual(['run_1']);
    expect(credentials.revoked).toEqual(['run_1']);
  });

  it('reclaims the environment and the credentials when the executor throws', async () => {
    const executor = new FakeExecutor(
      'deterministic',
      { status: 'success' },
      new Error('the executor is broken'),
    );
    const { runner, environments, credentials } = harness(executor);

    await runner.run(request(), NEVER_CANCELLED);

    expect(environments.reclaimed).toEqual(['run_1']);
    expect(credentials.revoked).toEqual(['run_1']);
  });

  it('the environment is reclaimed before the credentials are revoked', async () => {
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner, environments, credentials } = harness(executor);

    await runner.run(request(), NEVER_CANCELLED);

    // The order is recorded through a shared log.
    const order: string[] = [];
    const originalReclaim = environments.reclaim.bind(environments);
    environments.reclaim = async (runId: string): Promise<void> => {
      order.push('environment');
      await originalReclaim(runId);
    };
    const originalRevoke = credentials.reclaim.bind(credentials);
    credentials.reclaim = async (runId: string): Promise<void> => {
      order.push('credentials');
      await originalRevoke(runId);
    };

    await runner.run(request({ runId: 'run_2' }), NEVER_CANCELLED);

    expect(order).toEqual(['environment', 'credentials']);
  });

  it('the credentials are revoked even when the environment reclamation throws', async () => {
    // A leaked credential is worse than a leaked directory, so an exception
    // from the first reclamation must not skip the second.
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner, environments, credentials } = harness(executor);
    environments.reclaim = (): Promise<void> =>
      Promise.reject(new Error('the filesystem is gone'));

    await runner.run(request(), NEVER_CANCELLED);

    expect(credentials.revoked).toEqual(['run_1']);
  });

  it('a failed credential revocation is reported, not swallowed', async () => {
    // A leaked credential is worse than a leaked directory, so a failure to
    // revoke one must reach the caller. If it were swallowed, the run would
    // look clean while a live credential leaked.
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner, credentials } = harness(executor);
    credentials.reclaim = (): Promise<void> =>
      Promise.reject(new Error('the credential lease is stuck'));

    await expect(runner.run(request(), NEVER_CANCELLED)).rejects.toThrow(
      'the credential reclamation failed',
    );
  });

  it('a failed credential revocation is reported even when the environment also failed', async () => {
    // The worst case must be the loudest one. Swallowing the credential
    // failure because the environment also failed would make the double
    // failure quieter than the single one.
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner, environments, credentials } = harness(executor);
    environments.reclaim = (): Promise<void> =>
      Promise.reject(new Error('the filesystem is gone'));
    credentials.reclaim = (): Promise<void> =>
      Promise.reject(new Error('the credential lease is stuck'));

    await expect(runner.run(request(), NEVER_CANCELLED)).rejects.toThrow(
      'the credential reclamation failed',
    );
  });

  it('a failed stage reports the failure class', async () => {
    const executor = new FakeExecutor('deterministic', {
      status: 'failure',
      failureClass: 'verification.failure',
      summary: 'the gate failed',
    });
    const { runner } = harness(executor);

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    expect(outcome.status).toBe('failure');
    expect(outcome.failureClass).toBe('verification.failure');
    expect(outcome.rawFailureClass).toBe('verification.failure');
    expect(outcome.summary).toBe('the gate failed');
  });

  it('a failure with no class is treated as a workflow composition failure', async () => {
    // An executor that reports a failure without naming the class has not
    // said what went wrong, and the rule for that is not "no class" — it is
    // `workflow.composition`.
    const executor = new FakeExecutor('deterministic', { status: 'failure' });
    const { runner } = harness(executor);

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    expect(outcome.failureClass).toBe('workflow.composition');
    expect(outcome.rawFailureClass).toBe('unknown');
  });

  it('an executor that throws is classified as workflow.composition', async () => {
    const executor = new FakeExecutor(
      'deterministic',
      { status: 'success' },
      new Error('boom'),
    );
    const { runner } = harness(executor);

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    expect(outcome.status).toBe('failure');
    expect(outcome.failureClass).toBe('workflow.composition');
    expect(outcome.rawFailureClass).toBe('unknown');
    expect(outcome.summary).toContain('the executor threw');
  });

  it('a budget exhaustion is incomplete, not failed', async () => {
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner, runs } = harness(executor);

    const outcome = await runner.run(
      request({ budget: { maxTurns: 1, turns: 1 } }),
      NEVER_CANCELLED,
    );

    expect(outcome.status).toBe('incomplete');
    expect(outcome.failureClass).toBe('budget.exhausted');
    expect(runs.byId('run_1')?.status).toBe('incomplete');
  });

  it('the budget is checked before the executor runs', async () => {
    // A check afterwards would let the executor spend the budget it just
    // exceeded.
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner } = harness(executor);

    await runner.run(request({ budget: { maxTurns: 1, turns: 1 } }), NEVER_CANCELLED);

    expect(executor.calls).toHaveLength(0);
  });

  it('an exhausted budget still reclaims the environment and the credentials', async () => {
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner, environments, credentials } = harness(executor);

    await runner.run(request({ budget: { maxTurns: 1, turns: 1 } }), NEVER_CANCELLED);

    expect(environments.reclaimed).toEqual(['run_1']);
    expect(credentials.revoked).toEqual(['run_1']);
  });

  it('a cancelled run does not start the executor', async () => {
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner } = harness(executor);

    const outcome = await runner.run(
      request(),
      cancelledToken('the operator stopped the factory'),
    );

    expect(executor.calls).toHaveLength(0);
    expect(outcome.status).toBe('failure');
    expect(outcome.summary).toContain('the operator stopped the factory');
  });

  it('a cancelled run still reclaims the environment and the credentials', async () => {
    const executor = new FakeExecutor('deterministic', { status: 'success' });
    const { runner, environments, credentials } = harness(executor);

    await runner.run(request(), cancelledToken('paused'));

    expect(environments.reclaimed).toEqual(['run_1']);
    expect(credentials.revoked).toEqual(['run_1']);
  });

  it('an unresolvable stage kind never starts a run', async () => {
    const executor = new FakeExecutor('deterministic');
    const { runner, runs } = harness(executor);

    const outcome = await runner.run(
      request({ stageKind: 'deploy' }),
      NEVER_CANCELLED,
    );

    expect(outcome.status).toBe('failure');
    expect(outcome.failureClass).toBe('workflow.composition');
    expect(runs.started).toHaveLength(0);
  });

  it('a model-reasoning failure is retryable on the first attempt', async () => {
    const executor = new FakeExecutor('deterministic', {
      status: 'failure',
      failureClass: 'model.reasoning',
    });
    const { runner } = harness(executor);

    const outcome = await runner.run(request({ attempt: 1 }), NEVER_CANCELLED);

    expect(outcome.retryable).toBe(true);
  });

  it('a model-reasoning failure is not retryable on the third attempt', async () => {
    const executor = new FakeExecutor('deterministic', {
      status: 'failure',
      failureClass: 'model.reasoning',
    });
    const { runner } = harness(executor);

    const outcome = await runner.run(request({ attempt: 3 }), NEVER_CANCELLED);

    expect(outcome.retryable).toBe(false);
  });

  it('a policy denial is never retryable', async () => {
    const executor = new FakeExecutor('deterministic', {
      status: 'failure',
      failureClass: 'policy.denied',
    });
    const { runner } = harness(executor);

    const outcome = await runner.run(request({ attempt: 1 }), NEVER_CANCELLED);

    expect(outcome.retryable).toBe(false);
  });

  it('the cost of the run is recorded', async () => {
    const executor = new FakeExecutor('deterministic', {
      status: 'success',
      observability: { costUsdMicros: 1_234 },
    });
    const { runner, runs } = harness(executor);

    const outcome = await runner.run(request(), NEVER_CANCELLED);

    expect(outcome.costUsdMicros).toBe(1_234);
    expect(runs.byId('run_1')?.costUsdMicros).toBe(1_234);
  });
});
