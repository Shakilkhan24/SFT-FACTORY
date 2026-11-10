/**
 * The resume path (T-1.13).
 *
 * pack `02` §4.9: "Resume: on start, rebuild in-flight state from DB; nodes
 * with expired leases are re-queued; tasks in `RUNNING` with no live node
 * become `ESCALATED(resume_failed)`."
 *
 * These are the tests behind A0.5's first proof: killing the control plane
 * mid-run yields a resumed or explicitly failed task — **never a silent
 * loss**.
 */

import { describe, expect, it } from 'vitest';

import {
  FakeStateSink,
  InMemoryLeaseStore,
  InMemoryRunStore,
  RESUME_FAILED_TRIGGER,
  ResumePath,
  isKnownEscalationTrigger,
} from '@factory/orchestrator';

/**
 * A resume path wired to the fakes.
 */
const harness = (
  now = '2026-11-10T00:00:00.000Z',
): {
  resume: ResumePath;
  runs: InMemoryRunStore;
  leases: InMemoryLeaseStore;
  state: FakeStateSink;
} => {
  const runs = new InMemoryRunStore();
  const leases = new InMemoryLeaseStore();
  const state = new FakeStateSink();
  const resume = new ResumePath({
    runs,
    leases,
    state,
    clock: { now: () => now },
  });
  return { resume, runs, leases, state };
};

/**
 * A live run — started and not finished.
 */
const liveRun = (runId: string, nodeId: string, taskId = 'tsk_1') => ({
  runId,
  taskId,
  nodeId,
  attempt: 1,
  role: 'worker',
  stageKind: 'implement',
  executorKind: 'harness',
  status: 'running' as const,
  costUsdMicros: 0,
  startedAt: '2026-11-10T00:00:00.000Z',
});

describe('the resume path', () => {
  it('a task that is not RUNNING is left alone', async () => {
    const { resume, state } = harness();

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'PLANNED' }]);

    expect(report.outcomes[0]?.outcome.kind).toBe('not-running');
    expect(state.transitions).toHaveLength(0);
  });

  it('a terminal task is left alone', async () => {
    const { resume, state } = harness();

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'MERGED' }]);

    expect(report.outcomes[0]?.outcome.kind).toBe('not-running');
    expect(state.transitions).toHaveLength(0);
  });

  it('a RUNNING task with a live node is still running', async () => {
    const { resume, runs, state } = harness();
    await runs.start(liveRun('run_1', 'n1'));

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    expect(report.outcomes[0]?.outcome.kind).toBe('still-running');
    expect(state.transitions).toHaveLength(0);
  });

  it('a RUNNING task with no live node is escalated', async () => {
    // The control plane died holding it. The task becomes ESCALATED, which
    // is explicit — and resumable, because ESCALATED is not terminal.
    const { resume, state } = harness();

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    expect(report.outcomes[0]?.outcome.kind).toBe('escalated');
    expect(state.transitions).toHaveLength(1);
    expect(state.transitions[0]?.to).toBe('ESCALATED');
    expect(state.transitions[0]?.trigger).toBe('resume_failed');
  });

  it('the escalation names the resume_failed trigger', async () => {
    const { resume } = harness();

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    const outcome = report.outcomes[0]?.outcome;
    expect(outcome?.kind).toBe('escalated');
    if (outcome?.kind === 'escalated') {
      expect(outcome.trigger).toBe(RESUME_FAILED_TRIGGER);
    }
  });

  it('the resume_failed trigger is one the escalation vocabulary knows', () => {
    expect(isKnownEscalationTrigger(RESUME_FAILED_TRIGGER)).toBe(true);
  });

  it('an unknown trigger is not in the vocabulary', () => {
    expect(isKnownEscalationTrigger('made_up')).toBe(false);
  });

  it('a finished run does not count as a live node', async () => {
    const { resume, runs } = harness();
    await runs.start(liveRun('run_1', 'n1'));
    await runs.finish('run_1', {
      status: 'succeeded',
      endedAt: '2026-11-10T00:00:01.000Z',
    });

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    expect(report.outcomes[0]?.outcome.kind).toBe('escalated');
  });

  it('an expired lease is re-queued', async () => {
    const { resume, leases } = harness();
    leases.add({
      taskId: 'tsk_1',
      nodeId: 'n1',
      owner: 'worker-1',
      attempt: 1,
      expiresAt: '2026-11-09T23:00:00.000Z',
    });

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    expect(report.requeued).toHaveLength(1);
    expect(report.requeued[0]?.nodeId).toBe('n1');
  });

  it('a live lease is left alone', async () => {
    const { resume, leases } = harness();
    leases.add({
      taskId: 'tsk_1',
      nodeId: 'n1',
      owner: 'worker-1',
      attempt: 1,
      expiresAt: '2026-11-10T01:00:00.000Z',
    });

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    expect(report.requeued).toHaveLength(0);
  });

  it('an expired lease is re-queued once', async () => {
    // A lease released twice would run the node twice.
    const { resume, leases } = harness();
    const lease = {
      taskId: 'tsk_1',
      nodeId: 'n1',
      owner: 'worker-1',
      attempt: 1,
      expiresAt: '2026-11-09T23:00:00.000Z',
    };
    leases.add(lease);

    const first = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);
    expect(first.requeued).toHaveLength(1);

    // The second pass finds the lease already gone, so it re-queues
    // nothing — and the lease store says so.
    leases.drop(lease);
    const second = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);
    expect(second.requeued).toHaveLength(0);
  });

  it('the escalation is reported when the state machine refuses it', async () => {
    const { resume, state } = harness();
    state.refusals.set('tsk_1:tsk_1:ESCALATED', 'the task version moved');

    const report = await resume.resume([{ taskId: 'tsk_1', state: 'RUNNING' }]);

    expect(report.outcomes[0]?.outcome.kind).toBe('escalation-refused');
    const outcome = report.outcomes[0]?.outcome;
    if (outcome?.kind === 'escalation-refused') {
      expect(outcome.reason).toContain('the task version moved');
    }
  });

  it('several tasks are handled in one pass', async () => {
    const { resume, runs, state } = harness();
    await runs.start(liveRun('run_2', 'n2', 'tsk_2'));

    const report = await resume.resume([
      { taskId: 'tsk_1', state: 'RUNNING' },
      { taskId: 'tsk_2', state: 'RUNNING' },
      { taskId: 'tsk_3', state: 'DRAFT' },
    ]);

    expect(report.outcomes).toHaveLength(3);
    expect(report.outcomes[0]?.outcome.kind).toBe('escalated');
    expect(report.outcomes[1]?.outcome.kind).toBe('still-running');
    expect(report.outcomes[2]?.outcome.kind).toBe('not-running');
    expect(state.transitions).toHaveLength(1);
  });
});
