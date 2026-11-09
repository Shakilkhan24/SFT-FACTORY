/**
 * T-1.03 — the `factory events` command group.
 *
 * The event log is only useful if a human can look at it. These tests drive
 * the CLI the way a person would, against a real database, and check that
 * what it prints is the truth.
 *
 * The commands read through the **projector** role, so the tests also prove
 * the privilege boundary holds from the command line: the projector may read
 * the log and may not write it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PostgresEventLog } from '../../packages/eventlog/src/index.ts';
import { run } from '../../apps/cli/src/index.ts';
import {
  containerRunning,
  createEventLogHarness,
  insertTask,
  type EventLogHarness,
} from '../helpers/eventlog.ts';

const running = await containerRunning();

describe('T-1.03 · the `factory events` commands', () => {
  let harness: EventLogHarness;

  beforeAll(async () => {
    if (!running) {
      return;
    }
    harness = await createEventLogHarness('factory_t1_03_events_cli');
  }, 180_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  it.skipIf(!running)('A1.24 `factory events` with no subcommand explains itself', async () => {
    const result = await run(['events'], {});
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/factory events list \| show \| health/);
  });

  it.skipIf(!running)('A1.24 `factory events` without a connection string explains itself', async () => {
    const result = await run(['events', 'list'], {});
    expect(result.exitCode).toBe(2);
    expect(result.lines.join('\n')).toMatch(/FACTORY_PROJECTOR_DATABASE_URL is not set/);
  });

  it.skipIf(!running)('A1.24 `factory events list` shows the recent events', async () => {
    await insertTask(harness.db, 'tsk_cli');
    const log = new PostgresEventLog({ db: harness.db });
    await log.append([
      {
        eventType: 'intent.recorded',
        aggregate: { kind: 'task', id: 'tsk_cli', version: 0 },
        correlationId: 'tsk_cli',
        actor: { kind: 'human', id: 'tester' },
        authority: { basis: 'human-access-point' },
        subject: {},
        payload: { source: 'manual', repo: 'org/repo' },
        context: { items: [] },
      },
    ]);

    const result = await run(['events', 'list'], {
      FACTORY_PROJECTOR_DATABASE_URL: harness.pg.superuserUrl,
      FACTORY_DB_ROLE_MODE: 'assume',
    });

    expect(result.exitCode).toBe(0);
    const output = result.lines.join('\n');
    expect(output).toMatch(/intent\.recorded/);
    expect(output).toMatch(/task:tsk_cli/);
  }, 60_000);

  it.skipIf(!running)('A1.24 `factory events show` reports the chain verdict', async () => {
    await insertTask(harness.db, 'tsk_chain_cli');
    const log = new PostgresEventLog({ db: harness.db });
    await log.append([
      {
        eventType: 'intent.recorded',
        aggregate: { kind: 'task', id: 'tsk_chain_cli', version: 0 },
        correlationId: 'tsk_chain_cli',
        actor: { kind: 'human', id: 'tester' },
        authority: { basis: 'human-access-point' },
        subject: {},
        payload: { source: 'manual', repo: 'org/repo' },
        context: { items: [] },
      },
    ]);

    const result = await run(['events', 'show', 'tsk_chain_cli'], {
      FACTORY_PROJECTOR_DATABASE_URL: harness.pg.superuserUrl,
      FACTORY_DB_ROLE_MODE: 'assume',
    });

    expect(result.exitCode).toBe(0);
    const output = result.lines.join('\n');
    expect(output).toMatch(/intent\.recorded/);
    expect(output).toMatch(/chain: intact/);
  }, 60_000);

  it.skipIf(!running)('A1.24 `factory events show` reports a broken chain', async () => {
    await insertTask(harness.db, 'tsk_broken_cli');
    const log = new PostgresEventLog({ db: harness.db });
    const written = await log.append([
      {
        eventType: 'intent.recorded',
        aggregate: { kind: 'task', id: 'tsk_broken_cli', version: 0 },
        correlationId: 'tsk_broken_cli',
        actor: { kind: 'human', id: 'tester' },
        authority: { basis: 'human-access-point' },
        subject: {},
        payload: { source: 'manual', repo: 'org/repo' },
        context: { items: [] },
      },
      {
        eventType: 'review.queued',
        aggregate: { kind: 'task', id: 'tsk_broken_cli', version: 0 },
        correlationId: 'tsk_broken_cli',
        actor: { kind: 'human', id: 'tester' },
        authority: { basis: 'human-access-point' },
        subject: {},
        payload: {},
        context: { items: [] },
      },
    ]);

    const targetSeq = written[0]?.seq ?? 0;
    const tampered = await harness.pg.psqlAsOwner(`
      ALTER TABLE factory.events DISABLE TRIGGER events_no_update_delete;
      UPDATE factory.events
      SET payload = jsonb_set(payload, '{source}', '"tampered"')
      WHERE aggregate_id = 'tsk_broken_cli' AND seq = ${String(targetSeq)};
      ALTER TABLE factory.events ENABLE TRIGGER events_no_update_delete;
    `);
    expect(tampered).not.toMatch(/ERROR:/i);

    const result = await run(['events', 'show', 'tsk_broken_cli'], {
      FACTORY_PROJECTOR_DATABASE_URL: harness.pg.superuserUrl,
      FACTORY_DB_ROLE_MODE: 'assume',
    });

    // The command exits non-zero when the chain is broken — a broken chain
    // is not a cosmetic problem.
    expect(result.exitCode).toBe(1);
    expect(result.lines.join('\n')).toMatch(/chain: BROKEN at seq/);
  }, 60_000);

  it.skipIf(!running)('A1.24 `factory events health` reports a healthy log', async () => {
    const result = await run(['events', 'health'], {
      FACTORY_PROJECTOR_DATABASE_URL: harness.pg.superuserUrl,
      FACTORY_DB_ROLE_MODE: 'assume',
    });

    expect(result.exitCode).toBe(0);
    const output = result.lines.join('\n');
    expect(output).toMatch(/event log: healthy/);
    expect(output).toMatch(/seq gaps:\s+none/);
    expect(output).toMatch(/version gaps:\s+none/);
  }, 60_000);

  it.skipIf(!running)('A1.24 the projector role may read the log but not write it', async () => {
    // The CLI reads through `factory_projector`. That role has SELECT on
    // `events` and no INSERT — so the command works and a write does not.
    const result = await run(['events', 'list'], {
      FACTORY_PROJECTOR_DATABASE_URL: harness.pg.superuserUrl,
      FACTORY_DB_ROLE_MODE: 'assume',
    });
    expect(result.exitCode).toBe(0);

    const write = await harness.pg.psqlAs(
      'factory_projector',
      "INSERT INTO factory.events (seq, event_id, event_type, aggregate_kind, aggregate_id, aggregate_version, correlation_id, actor_kind, actor_id, authority, subject, payload, context, redaction, hash) VALUES (999999, gen_random_uuid(), 'intent.recorded', 'system', 'x', 0, 'x', 'human', 'x', '{}', '{}', '{}', '{}', '{}', decode(repeat('00',32),'hex'));",
    );
    expect(write).toMatch(/permission denied/i);
  }, 60_000);
});
