/**
 * T-1.07 — the scheduler and its leases.
 *
 * pack 02 §4.8, blueprint ADR-0012.
 *
 * ## The oracle, in the ticket's own words
 *
 * > 1000-iteration race ⇒ no double-claim; an expired lease is re-queued
 * > **once**; a duplicate completion is recorded as `node.duplicateExecution`
 * > and the first wins; caps are respected; **no auto-fill** of spare
 * > capacity
 *
 * Every one of those is a property of the *rules*, and the rules are behind
 * ports. So these checks run against the in-memory queue and need no
 * database — which matters, because this repository's environment has no
 * Docker daemon (the Postgres-backed path is CI's job, and `postgres-job-
 * queue.ts` is written to the same contract).
 *
 * ## The five checks, and what each one is really guarding
 *
 * 1. **No double-claim.** 1000 workers race for one job. Exactly one gets
 *    it. This is the property `SKIP LOCKED` buys, proven against the
 *    in-memory double's lock chain.
 *
 * 2. **An expired lease is re-queued once.** Reaping twice must not
 *    re-queue twice. The failure this guards against is a job being
 *    duplicated by the reaper itself — a self-inflicted double-claim.
 *
 * 3. **A duplicate completion is recorded, and the first wins.** A stale
 *    worker reports after its lease was reaped. Its result must not
 *    overwrite the committed one, and `node.duplicateExecution` must be
 *    emitted with the winner named.
 *
 * 4. **Caps are respected.** The global cap and the per-workflow cap both
 *    bound the concurrently leased jobs.
 *
 * 5. **No auto-fill.** Adding workers must not increase the load. This is
 *    I-11: "Surplus capacity is allocated by policy, not by default."
 */

import { describe, expect, it } from 'vitest';

import {
  type CapProvider,
  type Clock,
  type ConcurrencyCaps,
  InMemoryJobQueue,
  type JobQueue,
  type KillSwitch,
  type KillSwitchState,
  nodeIdempotencyKey,
  Scheduler,
  type SchedulerEvent,
  type SchedulerEventSink,
} from '../../packages/orchestrator/src/index.js';

/**
 * A clock the test moves by hand.
 *
 * The scheduler takes its clock by injection, so the lease expiry can be
 * driven exactly — no sleeping, no flakiness.
 */
class ManualClock implements Clock {
  #now: string;

  public constructor(start = '2026-11-10T00:00:00.000Z') {
    this.#now = start;
  }

  public now(): string {
    return this.#now;
  }

  public advance(ms: number): void {
    this.#now = new Date(new Date(this.#now).getTime() + ms).toISOString();
  }
}

/**
 * A caps provider that returns fixed caps.
 */
const fixedCaps = (caps: ConcurrencyCaps): CapProvider => ({
  caps: (): Promise<ConcurrencyCaps> => Promise.resolve(caps),
});

/**
 * A kill-switch that can be flipped.
 */
class ManualKillSwitch implements KillSwitch {
  #state: KillSwitchState;

  public constructor(state: KillSwitchState = { engaged: false }) {
    this.#state = state;
  }

  public state(): Promise<KillSwitchState> {
    return Promise.resolve(this.#state);
  }

  public engage(reason: string): void {
    this.#state = { engaged: true, engagedBy: 'test', reason };
  }

  public release(): void {
    this.#state = { engaged: false };
  }
}

/**
 * A sink that records every event.
 */
class RecordingSink implements SchedulerEventSink {
  public readonly events: SchedulerEvent[] = [];

  public append(events: readonly SchedulerEvent[]): Promise<readonly unknown[]> {
    this.events.push(...events);
    return Promise.resolve(events.map(() => ({})));
  }

  public ofType(eventType: string): SchedulerEvent[] {
    return this.events.filter((event) => event.eventType === eventType);
  }
}

/**
 * Build a scheduler over the in-memory queue.
 */
const build = (options?: {
  readonly caps?: ConcurrencyCaps;
  readonly killSwitch?: ManualKillSwitch;
  readonly clock?: ManualClock;
  readonly sink?: RecordingSink;
}): {
  readonly scheduler: Scheduler;
  readonly queue: InMemoryJobQueue;
  readonly clock: ManualClock;
  readonly killSwitch: ManualKillSwitch;
  readonly sink: RecordingSink;
} => {
  const queue = new InMemoryJobQueue();
  const settings = options ?? {};
  const clock = settings.clock ?? new ManualClock();
  const killSwitch = settings.killSwitch ?? new ManualKillSwitch();
  const sink = settings.sink ?? new RecordingSink();

  const scheduler = new Scheduler(
    {
      queue,
      caps: fixedCaps(settings.caps ?? {}),
      killSwitch,
      clock,
      events: sink,
    },
    { honourKillSwitch: true },
  );

  return { scheduler, queue, clock, killSwitch, sink };
};

/**
 * Enqueue one node job.
 */
const enqueueNode = async (
  queue: JobQueue,
  input: { taskId: string; nodeId: string; workflow: string; attempt?: number },
): Promise<void> => {
  await queue.enqueue({
    taskId: input.taskId,
    nodeId: input.nodeId,
    workflow: input.workflow,
    kind: 'node.execute',
    idempotencyKey: nodeIdempotencyKey(
      input.taskId,
      input.nodeId,
      input.attempt ?? 1,
    ),
  });
};

describe('T-1.07 · scheduler', () => {
  describe('the race: no double-claim', () => {
    it('gives the job to exactly one of 1000 concurrent claims', async () => {
      const { scheduler, queue } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });

      // 1000 workers race for the one job.
      const attempts = await Promise.all(
        Array.from({ length: 1000 }, (_unused, index) =>
          scheduler.claim({ owner: `worker-${String(index)}`, leaseMs: 60_000 }),
        ),
      );

      const winners = attempts.filter((attempt) => attempt.claimed);
      const losers = attempts.filter((attempt) => !attempt.claimed);

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(999);
      expect(losers.every((loser) => !loser.claimed && loser.reason.kind === 'empty')).toBe(true);

      // The queue saw exactly one claim.
      expect(queue.claims).toHaveLength(1);
    });

    it('gives each of 100 jobs to exactly one of 1000 concurrent claims', async () => {
      const { scheduler, queue } = build();

      for (let index = 0; index < 100; index += 1) {
        await enqueueNode(queue, {
          taskId: `task-${String(index)}`,
          nodeId: 'node-1',
          workflow: 'alpha',
        });
      }

      const attempts = await Promise.all(
        Array.from({ length: 1000 }, (_unused, index) =>
          scheduler.claim({ owner: `worker-${String(index)}`, leaseMs: 60_000 }),
        ),
      );

      const winners = attempts.filter((attempt) => attempt.claimed);
      expect(winners).toHaveLength(100);

      // No job was leased twice.
      const claimedIds = queue.claims.map((claim) => claim.jobId);
      expect(new Set(claimedIds).size).toBe(100);
    });

    it('hands out no job that is already leased', async () => {
      const { scheduler, queue } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });

      const first = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      expect(first.claimed).toBe(true);

      const second = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });
      expect(second.claimed).toBe(false);
      expect(second.claimed === false && second.reason.kind).toBe('empty');
    });
  });

  describe('the lease: expiry and reaping', () => {
    it('re-queues an expired lease exactly once', async () => {
      const { scheduler, queue, clock } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });

      const claim = await scheduler.claim({ owner: 'worker-a', leaseMs: 1_000 });
      expect(claim.claimed).toBe(true);
      expect(claim.claimed && claim.job.attempt).toBe(1);

      // The lease expires.
      clock.advance(2_000);

      const first = await scheduler.reap();
      expect(first.requeued).toHaveLength(1);
      expect(first.requeued[0]?.expiredAttempt).toBe(1);

      // The re-queue **increments the node's attempt**. The re-queued job
      // is a new attempt of the same node, and the attempt is part of the
      // idempotency key — so a handler keyed by `(taskId,nodeId,attempt)`
      // treats it as distinct work.
      expect(first.requeued[0]?.attempt).toBe(2);

      const requeuedJob = await queue.byId(first.requeued[0]?.jobId ?? 0);
      expect(requeuedJob?.attempt).toBe(2);
      expect(requeuedJob?.idempotencyKey).toBe('task-1:node-1:2');

      // The status flips back to `ready` — that is the ticket's mechanism
      // ("`node.leased → ready`"), and it is what makes a second reap find
      // nothing: the job is no longer `leased`.
      expect(requeuedJob?.status).toBe('ready');
      expect(requeuedJob?.leaseOwner).toBeNull();
      expect(requeuedJob?.leaseExpiresAt).toBeNull();

      // A second reap must not re-queue it again.
      const second = await scheduler.reap();
      expect(second.requeued).toHaveLength(0);

      const third = await scheduler.reap();
      expect(third.requeued).toHaveLength(0);
    });

    it('does not re-queue a lease that has not expired', async () => {
      const { scheduler, queue, clock } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      await scheduler.claim({ owner: 'worker-a', leaseMs: 10_000 });

      clock.advance(5_000);

      const reaped = await scheduler.reap();
      expect(reaped.requeued).toHaveLength(0);
    });

    it('renews a lease on heartbeat', async () => {
      const { scheduler, queue, clock } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      const claim = await scheduler.claim({ owner: 'worker-a', leaseMs: 1_000 });
      expect(claim.claimed).toBe(true);
      const jobId = claim.claimed ? claim.job.id : 0;

      // The lease is about to expire; the heartbeat moves the deadline out.
      clock.advance(900);
      const beat = await scheduler.heartbeat({ jobId, owner: 'worker-a', leaseMs: 1_000 });
      expect(beat.renewed).toBe(true);

      // Past the original deadline but inside the renewed one.
      clock.advance(500);
      const reaped = await scheduler.reap();
      expect(reaped.requeued).toHaveLength(0);
    });

    it('refuses to renew a lease that was already lost', async () => {
      const { scheduler, queue, clock } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      const claim = await scheduler.claim({ owner: 'worker-a', leaseMs: 1_000 });
      const jobId = claim.claimed ? claim.job.id : 0;

      clock.advance(2_000);
      await scheduler.reap();

      const beat = await scheduler.heartbeat({ jobId, owner: 'worker-a', leaseMs: 1_000 });
      expect(beat.renewed).toBe(false);
    });

    it('heartbeats at lease/3', async () => {
      const { scheduler, queue, clock } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      const claim = await scheduler.claim({ owner: 'worker-a', leaseMs: 3_000 });
      const jobId = claim.claimed ? claim.job.id : 0;

      // The lease expires at t+3000. A heartbeat at lease/3 = t+1000 must
      // push it to t+4000.
      clock.advance(1_000);
      const beat = await scheduler.heartbeat({ jobId, owner: 'worker-a', leaseMs: 3_000 });
      expect(beat.renewed).toBe(true);
      expect(beat.lease?.expiresAt).toBe(
        new Date(new Date(clock.now()).getTime() + 3_000).toISOString(),
      );

      // At t+3500 the original lease would have expired, but the renewed one
      // has not.
      clock.advance(2_500);
      const reaped = await scheduler.reap();
      expect(reaped.requeued).toHaveLength(0);
    });
  });

  describe('the first committed result wins', () => {
    it('keeps the first result and refuses the second', async () => {
      const { scheduler, queue } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      await enqueueNode(queue, {
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: 2,
      });

      const first = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      const second = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });
      expect(first.claimed).toBe(true);
      expect(second.claimed).toBe(true);

      const winner = await scheduler.complete({
        jobId: first.claimed ? first.job.id : 0,
        owner: 'worker-a',
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: first.claimed ? first.job.attempt : 0,
        runId: 'run-a',
        outcome: 'succeeded',
        result: { from: 'run-a' },
      });
      expect(winner.applied).toBe(true);
      expect(winner.duplicate).toBe(false);

      const loser = await scheduler.complete({
        jobId: second.claimed ? second.job.id : 0,
        owner: 'worker-b',
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: second.claimed ? second.job.attempt : 0,
        runId: 'run-b',
        outcome: 'succeeded',
        result: { from: 'run-b' },
      });
      expect(loser.applied).toBe(false);
      expect(loser.duplicate).toBe(true);
      expect(loser.winnerRunId).toBe('run-a');

      // The committed result is the first one.
      const committed = queue.committedResult('task-1', 'node-1');
      expect(committed?.runId).toBe('run-a');
      expect(committed?.result).toEqual({ from: 'run-a' });
    });

    it('records node.duplicateExecution naming the winner', async () => {
      const { scheduler, queue, sink } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      await enqueueNode(queue, {
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: 2,
      });

      const first = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      const second = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });

      await scheduler.complete({
        jobId: first.claimed ? first.job.id : 0,
        owner: 'worker-a',
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: first.claimed ? first.job.attempt : 0,
        runId: 'run-a',
        outcome: 'succeeded',
      });

      await scheduler.complete({
        jobId: second.claimed ? second.job.id : 0,
        owner: 'worker-b',
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: second.claimed ? second.job.attempt : 0,
        runId: 'run-b',
        outcome: 'succeeded',
      });

      const duplicates = sink.ofType('node.duplicateExecution');
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]?.payload).toEqual({
        nodeId: 'node-1',
        attempt: 2,
        winnerRunId: 'run-a',
      });
    });

    it('names the duplicate\'s attempt, not the winner\'s', async () => {
      const { scheduler, queue, sink } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      await enqueueNode(queue, {
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: 2,
      });

      const first = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      const second = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });

      // The two job rows carry the node's attempts 1 and 2.
      expect(first.claimed && first.job.attempt).toBe(1);
      expect(second.claimed && second.job.attempt).toBe(2);

      await scheduler.complete({
        jobId: first.claimed ? first.job.id : 0,
        owner: 'worker-a',
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: first.claimed ? first.job.attempt : 0,
        runId: 'run-a',
        outcome: 'succeeded',
      });

      await scheduler.complete({
        jobId: second.claimed ? second.job.id : 0,
        owner: 'worker-b',
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: second.claimed ? second.job.attempt : 0,
        runId: 'run-b',
        outcome: 'succeeded',
      });

      const duplicates = sink.ofType('node.duplicateExecution');
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]?.payload['attempt']).toBe(2);
    });

    it('treats a stale worker reporting after the reap as a duplicate', async () => {
      const { scheduler, queue, clock, sink } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });

      const stale = await scheduler.claim({ owner: 'worker-a', leaseMs: 1_000 });
      expect(stale.claimed).toBe(true);
      const staleJobId = stale.claimed ? stale.job.id : 0;
      const staleAttempt = stale.claimed ? stale.job.attempt : 0;

      // The worker stalls; the lease expires; the reaper re-queues the job.
      clock.advance(2_000);
      const reaped = await scheduler.reap();
      expect(reaped.requeued).toHaveLength(1);

      // Another worker picks it up and commits.
      const fresh = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });
      expect(fresh.claimed).toBe(true);

      const winner = await scheduler.complete({
        jobId: fresh.claimed ? fresh.job.id : 0,
        owner: 'worker-b',
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: fresh.claimed ? fresh.job.attempt : 0,
        runId: 'run-b',
        outcome: 'succeeded',
        result: { from: 'run-b' },
      });
      expect(winner.applied).toBe(true);

      // The stale worker wakes up and reports. Its result must not win.
      const staleOutcome = await scheduler.complete({
        jobId: staleJobId,
        owner: 'worker-a',
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: staleAttempt,
        runId: 'run-a',
        outcome: 'succeeded',
        result: { from: 'run-a' },
      });
      expect(staleOutcome.applied).toBe(false);
      expect(staleOutcome.duplicate).toBe(true);
      expect(staleOutcome.winnerRunId).toBe('run-b');

      const committed = queue.committedResult('task-1', 'node-1');
      expect(committed?.runId).toBe('run-b');

      const duplicates = sink.ofType('node.duplicateExecution');
      expect(duplicates).toHaveLength(1);
      expect(duplicates[0]?.payload['winnerRunId']).toBe('run-b');
    });

    it('refuses a stale worker even when no result has been committed yet', async () => {
      const { scheduler, queue, clock, sink } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });

      const stale = await scheduler.claim({ owner: 'worker-a', leaseMs: 1_000 });
      expect(stale.claimed).toBe(true);
      const staleJobId = stale.claimed ? stale.job.id : 0;
      const staleAttempt = stale.claimed ? stale.job.attempt : 0;

      // The worker stalls; the lease expires; the reaper re-queues the job.
      clock.advance(2_000);
      const reaped = await scheduler.reap();
      expect(reaped.requeued).toHaveLength(1);

      // A fresh worker takes the job — but has NOT reported yet.
      const fresh = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });
      expect(fresh.claimed).toBe(true);

      // The stale worker wakes up and reports first. It no longer holds the
      // lease, so its result must not be applied — even though nothing has
      // been committed for the node yet. Otherwise two workers would both
      // believe they own the node.
      const staleOutcome = await scheduler.complete({
        jobId: staleJobId,
        owner: 'worker-a',
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: staleAttempt,
        runId: 'run-a',
        outcome: 'succeeded',
        result: { from: 'run-a' },
      });
      expect(staleOutcome.applied).toBe(false);
      expect(staleOutcome.duplicate).toBe(true);

      // And the node is still uncommitted — the fresh worker may report.
      expect(queue.committedResult('task-1', 'node-1')).toBeUndefined();

      const freshOutcome = await scheduler.complete({
        jobId: fresh.claimed ? fresh.job.id : 0,
        owner: 'worker-b',
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        attempt: fresh.claimed ? fresh.job.attempt : 0,
        runId: 'run-b',
        outcome: 'succeeded',
        result: { from: 'run-b' },
      });
      expect(freshOutcome.applied).toBe(true);

      const committed = queue.committedResult('task-1', 'node-1');
      expect(committed?.runId).toBe('run-b');

      // The stale report was recorded as a duplicate.
      expect(sink.ofType('node.duplicateExecution')).toHaveLength(1);
    });
  });

  describe('the concurrency caps', () => {
    it('respects the global cap', async () => {
      const { scheduler, queue } = build({ caps: { global: 2 } });

      for (let index = 0; index < 5; index += 1) {
        await enqueueNode(queue, {
          taskId: `task-${String(index)}`,
          nodeId: 'node-1',
          workflow: 'alpha',
        });
      }

      const first = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      const second = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });
      const third = await scheduler.claim({ owner: 'worker-c', leaseMs: 60_000 });

      expect(first.claimed).toBe(true);
      expect(second.claimed).toBe(true);
      expect(third.claimed).toBe(false);
      expect(third.claimed === false && third.reason.kind).toBe('cap-reached');
    });

    it('respects the per-workflow cap', async () => {
      const { scheduler, queue } = build({ caps: { perWorkflow: { alpha: 1 } } });

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      await enqueueNode(queue, { taskId: 'task-2', nodeId: 'node-1', workflow: 'alpha' });

      const first = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      const second = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });

      expect(first.claimed).toBe(true);
      expect(second.claimed).toBe(false);
      expect(second.claimed === false && second.reason.kind).toBe('cap-reached');
      expect(
        second.claimed === false &&
          second.reason.kind === 'cap-reached' &&
          second.reason.workflow,
      ).toBe('alpha');
    });

    it('does not let one workflow consume another workflow\'s headroom', async () => {
      const { scheduler, queue } = build({
        caps: { global: 3, perWorkflow: { alpha: 1, beta: 1 } },
      });

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      await enqueueNode(queue, { taskId: 'task-2', nodeId: 'node-1', workflow: 'beta' });
      await enqueueNode(queue, { taskId: 'task-3', nodeId: 'node-1', workflow: 'beta' });

      const alpha = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      expect(alpha.claimed).toBe(true);

      // Alpha is at its cap, but beta has headroom — so beta's work is
      // claimable. Alpha's saturation must not stall the whole queue.
      const beta = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });
      expect(beta.claimed).toBe(true);
      expect(beta.claimed && beta.job.workflow).toBe('beta');

      // Now beta is at its cap too.
      const betaAgain = await scheduler.claim({ owner: 'worker-c', leaseMs: 60_000 });
      expect(betaAgain.claimed).toBe(false);
      expect(
        betaAgain.claimed === false &&
          betaAgain.reason.kind === 'cap-reached' &&
          betaAgain.reason.workflow,
      ).toBe('beta');
    });

    it('reports the global cap when both are reached', async () => {
      const { scheduler, queue } = build({
        caps: { global: 2, perWorkflow: { alpha: 1 } },
      });

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      await enqueueNode(queue, { taskId: 'task-2', nodeId: 'node-1', workflow: 'beta' });
      await enqueueNode(queue, { taskId: 'task-3', nodeId: 'node-1', workflow: 'beta' });

      expect((await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 })).claimed).toBe(true);
      expect((await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 })).claimed).toBe(true);

      // The global cap (2) is reached. It is the broader constraint, so it
      // is the one reported — adding workflow headroom would not help.
      const third = await scheduler.claim({ owner: 'worker-c', leaseMs: 60_000 });
      expect(third.claimed).toBe(false);
      expect(
        third.claimed === false &&
          third.reason.kind === 'cap-reached' &&
          third.reason.workflow,
      ).toBeUndefined();
    });

    it('treats an absent cap as no cap, not as zero', async () => {
      const { scheduler, queue } = build({ caps: {} });

      for (let index = 0; index < 3; index += 1) {
        await enqueueNode(queue, {
          taskId: `task-${String(index)}`,
          nodeId: 'node-1',
          workflow: 'alpha',
        });
      }

      for (const owner of ['worker-a', 'worker-b', 'worker-c']) {
        const claim = await scheduler.claim({ owner, leaseMs: 60_000 });
        expect(claim.claimed).toBe(true);
      }
    });

    it('reports the global cap when both caps are reached', async () => {
      const { scheduler, queue } = build({
        caps: { global: 1, perWorkflow: { alpha: 1 } },
      });

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });

      expect((await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 })).claimed).toBe(true);

      const second = await scheduler.claim({ owner: 'worker-b', leaseMs: 60_000 });
      expect(second.claimed).toBe(false);
      expect(
        second.claimed === false &&
          second.reason.kind === 'cap-reached' &&
          second.reason.workflow,
      ).toBeUndefined();
    });
  });

  describe('no auto-fill of spare capacity (I-11)', () => {
    it('does not lease more jobs when more workers arrive', async () => {
      const { scheduler, queue } = build({ caps: { global: 2 } });

      for (let index = 0; index < 10; index += 1) {
        await enqueueNode(queue, {
          taskId: `task-${String(index)}`,
          nodeId: 'node-1',
          workflow: 'alpha',
        });
      }

      // One worker claims once — one job.
      await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      expect(queue.claims).toHaveLength(1);

      // Ten more workers arrive. The queue must not be drained to fill them.
      await Promise.all(
        Array.from({ length: 10 }, (_unused, index) =>
          scheduler.claim({ owner: `worker-${String(index)}`, leaseMs: 60_000 }),
        ),
      );

      // Exactly the cap's worth of jobs is leased — no more, no less.
      const counts = await queue.leasedCounts();
      expect(counts.global).toBe(2);
      expect(queue.claims).toHaveLength(2);
    });

    it('leases nothing beyond the cap however many workers race', async () => {
      const { scheduler, queue } = build({ caps: { global: 3 } });

      for (let index = 0; index < 50; index += 1) {
        await enqueueNode(queue, {
          taskId: `task-${String(index)}`,
          nodeId: 'node-1',
          workflow: 'alpha',
        });
      }

      await Promise.all(
        Array.from({ length: 200 }, (_unused, index) =>
          scheduler.claim({ owner: `worker-${String(index)}`, leaseMs: 60_000 }),
        ),
      );

      const counts = await queue.leasedCounts();
      expect(counts.global).toBe(3);
      expect(queue.claims).toHaveLength(3);
    });
  });

  describe('the kill-switch', () => {
    it('refuses to claim while engaged', async () => {
      const { scheduler, queue, killSwitch } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      killSwitch.engage('operator asked for a pause');

      const claim = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      expect(claim.claimed).toBe(false);
      expect(claim.claimed === false && claim.reason.kind).toBe('kill-switch-engaged');
    });

    it('leaves the work ready — a pause, not a cancellation', async () => {
      const { scheduler, queue, killSwitch } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      killSwitch.engage('pause');

      await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });

      const counts = await queue.leasedCounts();
      expect(counts.global).toBe(0);

      // The job is still claimable once the switch is released.
      killSwitch.release();
      const claim = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      expect(claim.claimed).toBe(true);
    });

    it('does not claim when the definition says the switch is not honoured', async () => {
      const queue = new InMemoryJobQueue();
      const killSwitch = new ManualKillSwitch();
      killSwitch.engage('ignored by the definition');

      const scheduler = new Scheduler(
        {
          queue,
          caps: fixedCaps({}),
          killSwitch,
          clock: new ManualClock(),
        },
        { honourKillSwitch: false },
      );

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });

      const claim = await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });
      expect(claim.claimed).toBe(true);
    });
  });

  describe('enqueue', () => {
    it('is idempotent on the idempotency key', async () => {
      const { scheduler } = build();

      const first = await scheduler.enqueue({
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        kind: 'node.execute',
        idempotencyKey: nodeIdempotencyKey('task-1', 'node-1', 1),
      });
      expect(first.created).toBe(true);

      const second = await scheduler.enqueue({
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        kind: 'node.execute',
        idempotencyKey: nodeIdempotencyKey('task-1', 'node-1', 1),
      });
      expect(second.created).toBe(false);
      expect(second.job.id).toBe(first.job.id);
    });

    it('treats a different attempt as a different key', async () => {
      const { scheduler } = build();

      const first = await scheduler.enqueue({
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        kind: 'node.execute',
        idempotencyKey: nodeIdempotencyKey('task-1', 'node-1', 1),
      });
      const second = await scheduler.enqueue({
        taskId: 'task-1',
        nodeId: 'node-1',
        workflow: 'alpha',
        kind: 'node.execute',
        idempotencyKey: nodeIdempotencyKey('task-1', 'node-1', 2),
      });

      expect(first.created).toBe(true);
      expect(second.created).toBe(true);
      expect(second.job.id).not.toBe(first.job.id);
    });
  });

  describe('the events', () => {
    it('records node.leased with the lease details', async () => {
      const { scheduler, queue, sink } = build();

      await enqueueNode(queue, { taskId: 'task-1', nodeId: 'node-1', workflow: 'alpha' });
      await scheduler.claim({ owner: 'worker-a', leaseMs: 60_000 });

      const leased = sink.ofType('node.leased');
      expect(leased).toHaveLength(1);
      expect(leased[0]?.payload['nodeId']).toBe('node-1');
      expect(leased[0]?.payload['attempt']).toBe(1);
      expect(leased[0]?.payload['leaseOwner']).toBe('worker-a');
      expect(typeof leased[0]?.payload['leaseExpiresAt']).toBe('string');
    });
  });
});
