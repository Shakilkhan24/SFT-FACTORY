/**
 * T-1.04 — the state machine against a real database.
 *
 * The property tests in `tests/unit/state-machine.test.ts` prove the
 * machine's *logic*. They run against an in-memory store, so they say
 * nothing about the parts that only exist in Postgres:
 *
 * * the row lock (`SELECT … FOR UPDATE`) actually serialising two writers;
 * * the state change and its event landing in **one** transaction;
 * * the event log's CAS and the state change's version bump agreeing;
 * * the replay reading the state back out of the log.
 *
 * Those are claims about a database, so they are tested against one.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresEventLog } from '../../packages/eventlog/src/index.ts';
import { PostgresStateMachineStore } from '../../packages/orchestrator/src/index.ts';
import {
  StateMachine,
  replayTaskFrom,
  type GuardFacts,
  type TaskState,
} from '../../packages/state/src/index.ts';
import {
  containerRunning,
  createEventLogHarness,
  insertTask,
  taskVersion,
  type EventLogHarness,
} from '../helpers/eventlog.ts';

const running = await containerRunning();

const ACTOR = { kind: 'agent' as const, id: 'agent_test' };
const AUTHORITY = { basis: 'system-rule' as const };

const facts: GuardFacts = {
  criteriaCount: 3,
  oracleRef: 'orc_1',
  graph: {
    acyclic: true,
    fanOutEdgesJustified: true,
    capabilitiesWithinGrant: true,
    oracleAdmitted: true,
    planApprovalValid: true,
  },
  nodeStates: ['SUCCEEDED'],
  gatesPassed: true,
  iterationBudgetRemains: true,
  requiredApprovalClass: 'merge',
  approval: { exists: true, unexpired: true, boundToArtefact: true },
  approvedSha: 'sha256:head',
  headSha: 'sha256:head',
  humanInitiated: true,
  accessPoint: 'github',
  cancelledByHuman: true,
};

describe('T-1.04 · the state machine over Postgres', () => {
  let harness: EventLogHarness;

  beforeAll(async () => {
    if (!running) {
      return;
    }
    harness = await createEventLogHarness('factory_t1_04_state');
  }, 180_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  it.skipIf(!running)('A1.32 a transition changes the state and appends the event', async () => {
    const store = new PostgresStateMachineStore({ db: harness.db });
    const machine = new StateMachine(store);
    await insertTask(harness.db, 'tsk_sm_1');

    const result = await machine.transition({
      taskId: 'tsk_sm_1',
      to: 'TRIAGED',
      trigger: 'triage complete',
      actor: ACTOR,
      authority: AUTHORITY,
      expectedVersion: 0,
      eventType: 'request.triaged',
      facts,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.snapshot.state).toBe('TRIAGED');
    expect(result.snapshot.version).toBe(1);

    // The row changed.
    const row = await harness.db
      .selectFrom('tasks')
      .select(['state', 'version'])
      .where('id', '=', 'tsk_sm_1')
      .execute();
    expect(row[0]?.state).toBe('TRIAGED');
    expect(row[0]?.version).toBe(1);

    // And the event was written.
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.eventType).toBe('request.triaged');
    expect(result.events[0]?.aggregate.id).toBe('tsk_sm_1');
  }, 60_000);

  it.skipIf(!running)('A1.32 the state change and its event are in one transaction', async () => {
    // If the append fails, the state change must roll back with it. The
    // way to prove that is to make the append fail — here by pointing the
    // machine at an event type the log will not accept — and check that
    // the state did not change.
    const store = new PostgresStateMachineStore({ db: harness.db });
    const machine = new StateMachine(store);
    await insertTask(harness.db, 'tsk_sm_2');

    await expect(
      machine.transition({
        taskId: 'tsk_sm_2',
        to: 'TRIAGED',
        trigger: 'triage complete',
        actor: ACTOR,
        authority: AUTHORITY,
        expectedVersion: 0,
        // Not in the registered vocabulary — the log rejects it.
        eventType: 'not.a.real.event' as never,
        facts,
      }),
    ).rejects.toThrow();

    // The state did not move and the version did not advance.
    const row = await harness.db
      .selectFrom('tasks')
      .select(['state', 'version'])
      .where('id', '=', 'tsk_sm_2')
      .execute();
    expect(row[0]?.state).toBe('DRAFT');
    expect(row[0]?.version).toBe(0);
  }, 60_000);

  it.skipIf(!running)('A1.32 replaying the log reproduces the task state', async () => {
    const store = new PostgresStateMachineStore({ db: harness.db });
    const machine = new StateMachine(store);
    await insertTask(harness.db, 'tsk_sm_3');

    const path: TaskState[] = ['TRIAGED', 'REFINED', 'PLANNED', 'QUEUED'];

    let version = 0;
    let previous: TaskState = 'DRAFT';
    for (const to of path) {
      const result = await machine.transition({
        taskId: 'tsk_sm_3',
        to,
        trigger: 'step',
        actor: ACTOR,
        authority: AUTHORITY,
        expectedVersion: version,
        eventType: 'request.triaged',
        facts,
      });
      expect(result.ok, `${previous}->${to}`).toBe(true);
      if (result.ok) {
        version = result.snapshot.version;
      }
      previous = to;
    }

    // Rebuild the state from the log alone.
    const log = new PostgresEventLog({ db: harness.db });
    const replayed = await replayTaskFrom(
      'tsk_sm_3',
      log.read({ aggregate: { kind: 'task', id: 'tsk_sm_3' } }),
    );

    expect(replayed.state).toBe('QUEUED');
    expect(replayed.version).toBe(await taskVersion(harness.db, 'tsk_sm_3'));
    expect(replayed.transitions).toBe(path.length);
  }, 60_000);

  it.skipIf(!running)('A1.32 an illegal transition leaves no state change and records a policy.denied event', async () => {
    const store = new PostgresStateMachineStore({ db: harness.db });
    const machine = new StateMachine(store);
    await insertTask(harness.db, 'tsk_sm_4');

    const result = await machine.transition({
      taskId: 'tsk_sm_4',
      to: 'MERGED',
      trigger: 'illegal',
      actor: ACTOR,
      authority: AUTHORITY,
      expectedVersion: 0,
      eventType: 'request.triaged',
      facts,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe('IllegalTransition');

    // No state change.
    const row = await harness.db
      .selectFrom('tasks')
      .select(['state', 'version'])
      .where('id', '=', 'tsk_sm_4')
      .execute();
    expect(row[0]?.state).toBe('DRAFT');
    expect(row[0]?.version).toBe(0);

    // But the refusal was recorded, and it did not consume a version.
    const log = new PostgresEventLog({ db: harness.db });
    const events = [];
    for await (const event of log.read({ aggregate: { kind: 'task', id: 'tsk_sm_4' } })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('policy.denied');
    expect(events[0]?.aggregate.version).toBe(0);
  }, 60_000);

  it.skipIf(!running)('A1.32 two concurrent transitions leave exactly one winner', async () => {
    // The row lock is what makes this true. Both writers read the same
    // version, so without the lock both would succeed.
    const store = new PostgresStateMachineStore({ db: harness.db });
    const machine = new StateMachine(store);
    await insertTask(harness.db, 'tsk_sm_5');

    const attempt = (to: TaskState) =>
      machine.transition({
        taskId: 'tsk_sm_5',
        to,
        trigger: 'race',
        actor: ACTOR,
        authority: AUTHORITY,
        expectedVersion: 0,
        eventType: 'request.triaged',
        facts,
      });

    const results = await Promise.all([attempt('TRIAGED'), attempt('REJECTED')]);

    const accepted = results.filter((result) => result.ok);
    const refused = results.filter((result) => !result.ok);

    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const loser = refused[0];
    expect(loser?.ok).toBe(false);
    if (loser !== undefined && !loser.ok) {
      expect(loser.error).toBe('ConcurrencyError');
    }

    // The version advanced exactly once.
    expect(await taskVersion(harness.db, 'tsk_sm_5')).toBe(1);
  }, 60_000);

  it.skipIf(!running)('A1.32 the APPROVED→MERGING guard refuses an L2 autonomous merge', async () => {
    const store = new PostgresStateMachineStore({ db: harness.db });
    const machine = new StateMachine(store);
    await insertTask(harness.db, 'tsk_sm_6');

    // Put the task in APPROVED.
    await harness.db
      .updateTable('tasks')
      .set({ state: 'APPROVED' })
      .where('id', '=', 'tsk_sm_6')
      .execute();

    const result = await machine.transition({
      taskId: 'tsk_sm_6',
      to: 'MERGING',
      trigger: 'agent decided to merge',
      actor: ACTOR,
      authority: AUTHORITY,
      expectedVersion: 0,
      eventType: 'change.merged',
      facts: {
        autonomyLevel: 2,
        policyDecision: 'ALLOW',
        humanInitiated: false,
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('GuardFailed');
      expect(result.guard).toBe('autonomyPermitsOrHumanInitiated');
    }

    const row = await harness.db
      .selectFrom('tasks')
      .select('state')
      .where('id', '=', 'tsk_sm_6')
      .execute();
    expect(row[0]?.state).toBe('APPROVED');
  }, 60_000);

  it.skipIf(!running)('A1.32 the APPROVED→MERGING guard accepts a human-initiated merge with a matching SHA', async () => {
    const store = new PostgresStateMachineStore({ db: harness.db });
    const machine = new StateMachine(store);
    await insertTask(harness.db, 'tsk_sm_7');

    await harness.db
      .updateTable('tasks')
      .set({ state: 'APPROVED' })
      .where('id', '=', 'tsk_sm_7')
      .execute();

    const result = await machine.transition({
      taskId: 'tsk_sm_7',
      to: 'MERGING',
      trigger: 'human merged from the access point',
      actor: { kind: 'human', id: 'reviewer' },
      authority: { basis: 'human-access-point' },
      expectedVersion: 0,
      eventType: 'change.merged',
      facts: {
        autonomyLevel: 2,
        humanInitiated: true,
        accessPoint: 'github',
        approvedSha: 'sha256:head',
        headSha: 'sha256:head',
      },
    });

    expect(result.ok).toBe(true);
    const row = await harness.db
      .selectFrom('tasks')
      .select('state')
      .where('id', '=', 'tsk_sm_7')
      .execute();
    expect(row[0]?.state).toBe('MERGING');
  }, 60_000);
});
