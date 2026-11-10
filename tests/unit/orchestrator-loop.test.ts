/**
 * The execution loop (T-1.13).
 *
 * pack `02` §4.9: "Cancellation/pause: cooperative flag checked between
 * steps and via `docker kill` for harness nodes; always followed by
 * cleanup."
 *
 * The tests here prove the loop runs the nodes in order, that the
 * cancellation flag is checked **between** steps, and that the nodes that
 * were not run stay resumable.
 */

import { describe, expect, it } from 'vitest';

import {
  ExecutionLoop,
  ExecutorRegistry,
  FakeCredentialReclaimer,
  FakeEnvironmentRegistry,
  FakeExecutor,
  FakeStateSink,
  InMemoryRunStore,
  NEVER_CANCELLED,
  StageRunner,
  cancelledToken,
  type ReadyNode,
} from '@factory/orchestrator';

/**
 * A ready node with sensible defaults.
 */
const node = (overrides: Partial<ReadyNode> = {}): ReadyNode => ({
  taskId: 'tsk_1',
  nodeId: 'n1',
  stageKind: 'verify',
  role: 'worker',
  attempt: 1,
  spec: {},
  context: {},
  tools: { capabilities: [], scopes: [] },
  budget: {},
  isolation: 'T1',
  modelPolicy: { role: 'worker' },
  ...overrides,
});

/**
 * A loop wired to the fakes.
 */
const harness = (
  executor: FakeExecutor,
): {
  loop: ExecutionLoop;
  executor: FakeExecutor;
  state: FakeStateSink;
  runs: InMemoryRunStore;
} => {
  const registry = new ExecutorRegistry();
  registry.register(executor);
  const runs = new InMemoryRunStore();
  const state = new FakeStateSink();
  const runner = new StageRunner({
    registry,
    runs,
    environments: new FakeEnvironmentRegistry(),
    credentials: new FakeCredentialReclaimer(),
  });
  let counter = 0;
  const loop = new ExecutionLoop({
    runner,
    runs,
    environments: new FakeEnvironmentRegistry(),
    credentials: new FakeCredentialReclaimer(),
    state,
    nextRunId: () => {
      counter += 1;
      return `run_${String(counter)}`;
    },
    clock: { now: () => '2026-11-10T00:00:00.000Z' },
  });
  return { loop, executor, state, runs };
};

describe('the execution loop', () => {
  it('runs each ready node in the order it was given', async () => {
    const executor = new FakeExecutor('deterministic');
    const { loop } = harness(executor);

    const outcome = await loop.run(
      [node({ nodeId: 'n1' }), node({ nodeId: 'n2' }), node({ nodeId: 'n3' })],
      NEVER_CANCELLED,
    );

    expect(outcome.outcomes.map((entry) => entry.nodeId)).toEqual(['n1', 'n2', 'n3']);
    expect(executor.calls).toHaveLength(3);
  });

  it('the node is RUNNING before it runs and SUCCEEDED after', async () => {
    const executor = new FakeExecutor('deterministic');
    const { loop, state } = harness(executor);

    await loop.run([node({ nodeId: 'n1' })], NEVER_CANCELLED);

    expect(state.transitions.map((transition) => transition.to)).toEqual([
      'RUNNING',
      'SUCCEEDED',
    ]);
  });

  it('a failed node ends in FAILED', async () => {
    const executor = new FakeExecutor('deterministic', {
      status: 'failure',
      failureClass: 'verification.failure',
    });
    const { loop, state } = harness(executor);

    await loop.run([node({ nodeId: 'n1' })], NEVER_CANCELLED);

    expect(state.toState('FAILED')).toHaveLength(1);
  });

  it('an incomplete node ends in INCOMPLETE', async () => {
    const executor = new FakeExecutor('deterministic', { status: 'incomplete' });
    const { loop, state } = harness(executor);

    await loop.run([node({ nodeId: 'n1', budget: { maxTurns: 1, turns: 1 } })], NEVER_CANCELLED);

    expect(state.toState('INCOMPLETE')).toHaveLength(1);
  });

  it('a cancelled loop runs no node at all', async () => {
    const executor = new FakeExecutor('deterministic');
    const { loop } = harness(executor);

    const outcome = await loop.run([node({ nodeId: 'n1' })], cancelledToken('paused'));

    expect(executor.calls).toHaveLength(0);
    expect(outcome.outcomes).toHaveLength(0);
    expect(outcome.cancelled).toBe(true);
    expect(outcome.cancelReason).toBe('paused');
  });

  it('a cancelled loop stops before the next node, not after it', async () => {
    // The cancellation is checked **between** steps, so the first node runs
    // and the second does not.
    let cancelled = false;
    const executor = new FakeExecutor('deterministic', () => {
      cancelled = true;
      return { status: 'success' };
    });
    const { loop } = harness(executor);

    const outcome = await loop.run(
      [node({ nodeId: 'n1' }), node({ nodeId: 'n2' })],
      {
        get cancelled(): boolean {
          return cancelled;
        },
      },
    );

    expect(executor.calls).toHaveLength(1);
    expect(outcome.outcomes.map((entry) => entry.nodeId)).toEqual(['n1']);
    expect(outcome.cancelled).toBe(true);
  });

  it('the loop reports the run id of each node', async () => {
    const executor = new FakeExecutor('deterministic');
    const { loop } = harness(executor);

    const outcome = await loop.run([node({ nodeId: 'n1' }), node({ nodeId: 'n2' })], NEVER_CANCELLED);

    expect(outcome.outcomes.map((entry) => entry.runId)).toEqual(['run_1', 'run_2']);
  });

  it('the nodes that were not run are not reported as failed', async () => {
    // They were not run, so they cannot be reported as failed. They stay
    // `READY`, and the loop is resumable.
    const executor = new FakeExecutor('deterministic');
    const { loop, state } = harness(executor);

    const outcome = await loop.run(
      [node({ nodeId: 'n1' }), node({ nodeId: 'n2' })],
      cancelledToken('paused'),
    );

    expect(outcome.outcomes).toHaveLength(0);
    expect(state.toState('FAILED')).toHaveLength(0);
    expect(state.toState('SUCCEEDED')).toHaveLength(0);
  });

  it('the loop does not sort the nodes', async () => {
    // The caller established the topological order; re-sorting here would
    // break the dependency the caller resolved.
    const executor = new FakeExecutor('deterministic');
    const { loop } = harness(executor);

    await loop.run([node({ nodeId: 'z' }), node({ nodeId: 'a' })], NEVER_CANCELLED);

    expect(executor.calls.map((call) => call.nodeId)).toEqual(['z', 'a']);
  });

  it('an empty node list is not an error', async () => {
    const executor = new FakeExecutor('deterministic');
    const { loop } = harness(executor);

    const outcome = await loop.run([], NEVER_CANCELLED);

    expect(outcome.outcomes).toHaveLength(0);
    expect(outcome.cancelled).toBe(false);
  });
});
